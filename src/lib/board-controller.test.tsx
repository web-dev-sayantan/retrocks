import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { createEffect, createRoot, createSignal, flush, snapshot, untrack } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardLiveMessage } from './board-live-protocol';
import type { LiveTransport } from './live-stream';
import {
  createBoardController,
  type BoardCommandDispatcher,
  type BoardController,
  type BoardFacilitatorClaimer,
  type BoardFragmentAdapter,
} from './board-controller';
import {
  createFakeBoardDispatcher,
  makeBoardView,
  makeCard,
} from './board-fixtures';
import type { BoardMutationResponse, BoardViewDTO } from './board-types';
import type { FacilitatorClaimInput, FacilitatorClaimResponse } from './sharing-actions';

// The controller seam under test: one reactive controller owning the Board store,
// live stream application, server clock, and mutation handlers. No workspace
// DOM is rendered — the single dispatchCommand double is the server.

interface FakeConnection {
  path: string;
  closed: boolean;
  emit(message: BoardLiveMessage): void;
  fail(): void;
}

function createFakeLiveTransport(): {
  transport: LiveTransport;
  connections: FakeConnection[];
} {
  const connections: FakeConnection[] = [];
  const transport: LiveTransport = {
    connect(path, handlers) {
      const connection: FakeConnection = {
        path,
        closed: false,
        emit(message) {
          handlers.onMessage(JSON.stringify(message));
        },
        fail() {
          handlers.onFailure();
        },
      };
      connections.push(connection);
      return {
        ping() {},
        close() {
          connection.closed = true;
        },
      };
    },
  };
  return { transport, connections };
}

interface FakeFragmentHarness {
  adapter: BoardFragmentAdapter;
  takenPaths: string[];
  triggerHashChange(token?: string | null): void;
  listenerCount(): number;
}

function createFakeFragmentAdapter(initialToken: string | null = null): FakeFragmentHarness {
  let currentToken = initialToken;
  const takenPaths: string[] = [];
  const listeners = new Set<() => void>();
  return {
    takenPaths,
    triggerHashChange(token) {
      if (token !== undefined) currentToken = token;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
    adapter: {
      takeToken(boardPath) {
        takenPaths.push(boardPath);
        const token = currentToken;
        currentToken = null;
        return token;
      },
      onHashChange(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

interface SessionHarness {
  controller: BoardController;
  setBoardProp: (board: BoardViewDTO | null) => void;
  connections: FakeConnection[];
  dispatchCommand: ReturnType<typeof vi.fn<BoardCommandDispatcher>>;
  claimLinkSpy: ReturnType<typeof vi.fn<BoardFacilitatorClaimer>>;
  fragment: FakeFragmentHarness;
  dispose: () => void;
}

const mounted: SessionHarness[] = [];

function mountSession(
  initialBoard: BoardViewDTO | null,
  options: {
    boardId?: string;
    initialFragmentToken?: string | null;
    useBrowserFragment?: boolean;
    claimFacilitatorLink?: BoardFacilitatorClaimer;
  } = {},
): SessionHarness {
  const { transport, connections } = createFakeLiveTransport();
  const { dispatchCommand } = createFakeBoardDispatcher(initialBoard ?? makeBoardView());
  const fragment = createFakeFragmentAdapter(options.initialFragmentToken ?? null);
  const claimLinkSpy = vi.fn<BoardFacilitatorClaimer>(
    options.claimFacilitatorLink
      ?? (async () => ({
        ok: false,
        code: 'FORBIDDEN',
        message: 'This Co-Facilitator Link is invalid or has expired.',
      })),
  );
  let harness!: SessionHarness;
  const dispose = createRoot((disposeRoot) => {
    const [boardProp, setBoardProp] = createSignal<BoardViewDTO | null>(initialBoard);
    const controller = createBoardController({
      boardId: options.boardId ?? initialBoard?.id,
      board: boardProp,
      dispatchCommand,
      claimFacilitatorLink: claimLinkSpy,
      fragment: options.useBrowserFragment ? undefined : fragment.adapter,
      liveTransport: transport,
    });
    harness = {
      controller,
      setBoardProp,
      connections,
      dispatchCommand,
      claimLinkSpy,
      fragment,
      dispose: disposeRoot,
    };
    return disposeRoot;
  });
  flush();
  mounted.push(harness);
  return { ...harness, dispose };
}

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.dispose();
  }
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('createBoardController', () => {
  it('returns uniform transfer outcomes and does not clobber a caller-reported error when an earlier transfer settles', async () => {
    const first = makeCard({ id: 'card_first' });
    const second = makeCard({ id: 'card_second' });
    const board = makeBoardView({ cards: [first, second] });
    const { controller, dispatchCommand } = mountSession(board);
    const olderResponse = Promise.withResolvers<BoardMutationResponse>();
    dispatchCommand.mockReturnValueOnce(olderResponse.promise).mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
      message: 'The destination Column was removed.',
    });

    const older = controller.moveCard(first.id, 'col_2');
    const newerResult = await controller.moveCard(second.id, 'col_2');
    expect(newerResult).toEqual({
      ok: false,
      message: 'The destination Column was removed.',
    });
    // Inline-error mutations never auto-write global errorMessage; transfer callers report it explicitly.
    expect(controller.errorMessage()).toBeNull();
    if (!newerResult.ok) controller.reportError(newerResult.message);
    flush();
    expect(controller.errorMessage()).toBe('The destination Column was removed.');

    olderResponse.resolve({ ok: true, version: board.version, events: [] });
    await expect(older).resolves.toEqual({ ok: true });
    flush();
    expect(controller.errorMessage()).toBe('The destination Column was removed.');
  });

  it('seeds the store from the route snapshot and reconciles newer snapshots through the prop feed', () => {
    const board = makeBoardView({ title: 'Seed title' });
    const { controller, setBoardProp } = mountSession(board);

    expect(controller.board()?.title).toBe('Seed title');

    setBoardProp({ ...board, version: 2, title: 'Fresh title' });
    flush();
    expect(controller.board()?.title).toBe('Fresh title');
    expect(controller.board()?.version).toBe(2);

    // Stale route snapshots never regress the store.
    setBoardProp({ ...board, version: 1, title: 'Stale title' });
    flush();
    expect(controller.board()?.title).toBe('Fresh title');

    // Same version with the same facilitator is a re-render, not an update.
    setBoardProp({ ...board, version: 2, title: 'Re-render title' });
    flush();
    expect(controller.board()?.title).toBe('Fresh title');
  });

  it('applies live server snapshots, syncs the server clock, and skips stale ones', () => {
    const board = makeBoardView();
    const { controller, connections } = mountSession(board);

    expect(connections).toHaveLength(1);
    expect(controller.isLive()).toBe(false);

    connections[0].emit({
      type: 'board:snapshot',
      version: 3,
      serverNow: 4242,
      board: { ...board, version: 3, title: 'Live title' },
    });
    flush();

    expect(controller.board()?.title).toBe('Live title');
    expect(controller.board()?.version).toBe(3);
    expect(controller.isLive()).toBe(true);
    expect(controller.timerClock()?.serverNow).toBe(4242);
    expect(controller.nowMs()).toBe(4242);

    connections[0].emit({ type: 'presence:count', count: 7 });
    flush();
    expect(controller.onlineCount()).toBe(7);

    // A stale snapshot must not regress the store or the clock.
    connections[0].emit({
      type: 'board:snapshot',
      version: 2,
      serverNow: 1111,
      board: { ...board, version: 2, title: 'Stale title' },
    });
    flush();
    expect(controller.board()?.title).toBe('Live title');
    expect(controller.board()?.version).toBe(3);
    expect(controller.timerClock()?.serverNow).toBe(4242);
  });

  it('applies live mutation events at the next version, ignores stale ones, and resyncs on a version gap', () => {
    const card = makeCard({ id: 'card_gap', content: 'Live card' });
    const board = makeBoardView({ cards: [card] });
    const { controller, connections } = mountSession(board);

    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      lastActiveAt: board.lastActiveAt + 1_000,
      events: [
        { type: 'card:upserted', version: 2, card: { ...card, content: 'Edited live' } },
      ],
    });
    flush();
    expect(controller.board()?.version).toBe(2);
    expect(controller.board()?.cards[0]?.content).toBe('Edited live');
    expect(controller.board()?.lastActiveAt).toBe(board.lastActiveAt + 1_000);

    // Duplicate (stale) delivery: ignored, no reconnect.
    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      lastActiveAt: board.lastActiveAt,
      events: [
        { type: 'card:upserted', version: 2, card: { ...card, content: 'Ignored' } },
      ],
    });
    flush();
    expect(controller.board()?.cards[0]?.content).toBe('Edited live');
    expect(connections).toHaveLength(1);

    // A gap (version > current + 1) drops the delta and reopens the stream.
    connections[0].emit({
      type: 'board:mutation',
      version: 9,
      lastActiveAt: board.lastActiveAt + 9_000,
      events: [
        { type: 'card:upserted', version: 9, card: { ...card, content: 'From the gap' } },
      ],
    });
    flush();
    expect(controller.board()?.version).toBe(2);
    expect(controller.board()?.cards[0]?.content).toBe('Edited live');
    expect(controller.board()?.lastActiveAt).toBe(board.lastActiveAt + 1_000);
    expect(connections[0].closed).toBe(true);
    expect(connections).toHaveLength(2);
  });

  it('dispatches consecutive live frames synchronously without dropping intermediate versions', () => {
    const card = makeCard({ id: 'card_burst', content: 'Initial' });
    const board = makeBoardView({ cards: [card] });
    const { controller, connections } = mountSession(board);

    // Emit two sequential versions in the same tick before flushing.
    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      events: [
        { type: 'card:upserted', version: 2, card: { ...card, content: 'Second' } },
      ],
    });
    connections[0].emit({
      type: 'board:mutation',
      version: 3,
      events: [
        { type: 'card:upserted', version: 3, card: { ...card, content: 'Third' } },
      ],
    });
    flush();

    expect(controller.board()?.version).toBe(3);
    expect(controller.board()?.cards[0]?.content).toBe('Third');
    expect(connections).toHaveLength(1);
  });

  it('clears live status and presence on disconnect and recovers after reconnect', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const board = makeBoardView();
      const { controller, connections } = mountSession(board);

      connections[0].emit({
        type: 'board:snapshot',
        version: 2,
        serverNow: 2000,
        board: { ...board, version: 2, title: 'Connected' },
      });
      connections[0].emit({ type: 'presence:count', count: 4 });
      flush();
      expect(controller.isLive()).toBe(true);
      expect(controller.onlineCount()).toBe(4);

      connections[0].fail();
      flush();
      expect(controller.isLive()).toBe(false);
      expect(controller.onlineCount()).toBeNull();
      expect(connections[0].closed).toBe(true);

      vi.advanceTimersByTime(500);
      flush();
      expect(connections).toHaveLength(2);

      connections[1].emit({
        type: 'board:snapshot',
        version: 3,
        serverNow: 3000,
        board: { ...board, version: 3, title: 'Reconnected' },
      });
      connections[1].emit({ type: 'presence:count', count: 5 });
      flush();
      expect(controller.isLive()).toBe(true);
      expect(controller.onlineCount()).toBe(5);
      expect(controller.board()?.title).toBe('Reconnected');
      expect(controller.board()?.version).toBe(3);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('clears the controller board and closes the stream on a live board:deleted', () => {
    const board = makeBoardView();
    const { controller, connections } = mountSession(board);

    connections[0].emit({ type: 'board:deleted', version: 2 });
    flush();

    expect(controller.board()).toBeNull();
    expect(connections[0].closed).toBe(true);
    expect(connections).toHaveLength(1);
  });

  it('creates Cards optimistically, reconciles on success, and rolls back on failure', async () => {
    const board = makeBoardView({ cards: [], columns: [{ id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 0 }] });
    const { controller, dispatchCommand } = mountSession(board);

    const serverCard = makeCard({ id: 'card_server', columnId: 'col_1', content: 'Hello' });
    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: 2,
      events: [{ type: 'card:upserted', version: 2, card: serverCard }],
    });

    const created = controller.createCard('col_1', 'Hello');
    flush();
    const optimistic = controller.board()?.cards ?? [];
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0].pending).toBe(true);
    expect(optimistic[0].isMine).toBe(true);
    expect(controller.board()?.columns[0]?.cardCount).toBe(1);
    expect(dispatchCommand).toHaveBeenCalledWith(board.id, {
      type: 'card:create',
      columnId: 'col_1',
      content: 'Hello',
    });

    await created;
    flush();
    expect(controller.board()?.cards.map((card) => card.id)).toEqual(['card_server']);
    expect(controller.board()?.version).toBe(2);
    expect(controller.board()?.columns[0]?.cardCount).toBe(1);

    dispatchCommand.mockResolvedValueOnce({
      ok: false,
      code: 'LIMIT_EXCEEDED',
      message: 'Board card limit reached.',
    });
    const failure = controller.createCard('col_1', 'Second');
    flush();
    expect(controller.board()?.cards).toHaveLength(2);
    const result = await failure;
    flush();
    expect(result).toEqual({ ok: false, message: 'Board card limit reached.' });
    expect(controller.errorMessage()).toBeNull();
    expect(controller.board()?.cards.map((card) => card.id)).toEqual(['card_server']);
    expect(controller.board()?.columns[0]?.cardCount).toBe(1);
  });

  it('toggles Reactions optimistically and inverts the delta on failure', async () => {
    const card = makeCard({ id: 'card_react', reactions: { '👍': 1 }, myReactions: [] });
    const board = makeBoardView({ cards: [card] });
    const { controller, dispatchCommand } = mountSession(board);

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: 2,
      events: [{ type: 'reaction:updated', version: 2, cardId: card.id, counts: { '👍': 2 }, myReactions: ['👍'] }],
    });
    const added = controller.toggleReaction(card.id, '👍');
    flush();
    expect(controller.board()?.cards[0]?.reactions['👍']).toBe(2);
    expect(controller.board()?.cards[0]?.myReactions).toEqual(['👍']);
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'reaction:toggle',
      cardId: card.id,
      emoji: '👍',
    });
    await added;
    flush();
    expect(controller.board()?.cards[0]?.reactions['👍']).toBe(2);

    dispatchCommand.mockResolvedValueOnce({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Slow down reactions.',
    });
    const removed = controller.toggleReaction(card.id, '👍');
    flush();
    expect(controller.board()?.cards[0]?.reactions['👍']).toBe(1);
    expect(controller.board()?.cards[0]?.myReactions).toEqual([]);
    const result = await removed;
    flush();
    expect(result).toEqual({ ok: false, message: 'Slow down reactions.' });
    expect(controller.errorMessage()).toBeNull();
    expect(controller.board()?.cards[0]?.reactions['👍']).toBe(2);
    expect(controller.board()?.cards[0]?.myReactions).toEqual(['👍']);
  });

  it('derives Vote pending state with isPending and surfaces optimistic balances', async () => {
    const card = makeCard({ id: 'card_v', votes: 0, myVotes: 0 });
    const board = makeBoardView({ cards: [card], isFacilitator: false, voteLimit: 5, remainingVotes: 5 });
    const { controller, dispatchCommand } = mountSession(board);

    const pending = Promise.withResolvers<BoardMutationResponse>();
    dispatchCommand.mockReturnValueOnce(pending.promise);

    const votePromise = controller.changeVote('card', card.id, 1);
    flush();
    const voting = controller.voting();
    expect(voting.pending).toBe(true);
    expect(voting.remainingVotes).toBe(4);
    expect(controller.board()?.cards[0]?.myVotes).toBe(1);

    // A second cast while one is in flight is dropped, not queued.
    void controller.changeVote('card', card.id, 1);
    flush();
    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCommand).toHaveBeenCalledWith(board.id, {
      type: 'vote:change',
      targetType: 'card',
      targetId: card.id,
      delta: 1,
    });

    pending.resolve({
      ok: true,
      version: 2,
      events: [{ type: 'vote:updated', version: 2, targetType: 'card', targetId: card.id, totalVotes: 1, myVotes: 1, remainingVotes: 4 }],
    });
    await votePromise;
    flush();
    expect(controller.voting().pending).toBe(false);
    expect(controller.board()?.cards[0]?.myVotes).toBe(1);
    expect(controller.voting().remainingVotes).toBe(4);

    dispatchCommand.mockRejectedValueOnce(new Error('offline'));
    await controller.changeVote('card', card.id, -1);
    flush();
    expect(controller.errorMessage()).toBe('Could not update your Vote. Try again.');
    controller.clearError();
    flush();
    expect(controller.errorMessage()).toBeNull();
  });

  it('applies Action Item patches optimistically, exposes isPending, and reverts on rejection', async () => {
    const card = makeCard({
      id: 'card_action',
      isActionItem: true,
      actionDone: false,
      actionOwner: '',
    });
    const board = makeBoardView({ cards: [card] });
    const { controller, dispatchCommand } = mountSession(board);

    const pending = Promise.withResolvers<BoardMutationResponse>();
    dispatchCommand.mockReturnValueOnce(pending.promise);
    const update = controller.updateActionItem(card.id, {
      actionDone: true,
      actionOwner: 'Platform',
    });
    flush();
    expect(controller.board()?.cards[0]?.actionDone).toBe(true);
    expect(controller.board()?.cards[0]?.actionOwner).toBe('Platform');
    expect(controller.isActionItemPending(card.id)).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith(board.id, {
      type: 'card:set-action',
      cardId: card.id,
      actionDone: true,
      actionOwner: 'Platform',
    });

    pending.resolve({
      ok: true,
      version: 2,
      events: [{
        type: 'card:upserted',
        version: 2,
        card: { ...card, actionDone: true, actionOwner: 'Platform' },
      }],
    });
    expect(await update).toEqual({ ok: true });
    flush();
    expect(controller.isActionItemPending(card.id)).toBe(false);
    expect(controller.board()?.cards[0]?.actionDone).toBe(true);
    expect(controller.board()?.cards[0]?.actionOwner).toBe('Platform');

    dispatchCommand.mockResolvedValueOnce({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Slow down.',
    });
    expect(await controller.updateActionItem(card.id, { actionDone: false })).toEqual({
      ok: false,
      message: 'Slow down.',
    });
    flush();
    // The optimistic guess reverted to the last committed server value.
    expect(controller.board()?.cards[0]?.actionDone).toBe(true);
    expect(controller.isActionItemPending(card.id)).toBe(false);
    expect(controller.errorMessage()).toBeNull();
  });

  it('checks permissions once at the mutation seam before dispatching', async () => {
    const card = makeCard({ id: 'card_guard' });
    const participant = makeBoardView({ cards: [card], isFacilitator: false });
    const harness = mountSession(participant);
    const { controller, dispatchCommand } = harness;

    expect(await controller.renameBoard('Nope')).toEqual({
      ok: false,
      message: 'Could not rename the Board. Try again.',
    });
    expect(await controller.saveVotingSettings({ voteLimit: 3 })).toEqual({
      ok: false,
      message: 'Voting settings are unavailable.',
    });
    expect(await controller.toggleBoardLock(true)).toEqual({
      ok: false,
      message: 'Only a Facilitator can Lock or Unlock the Board.',
    });
    expect(await controller.deleteColumn('col_1')).toEqual({
      ok: false,
      message: 'Could not delete the Column. Try again.',
    });
    expect(dispatchCommand).not.toHaveBeenCalled();

    const locked = makeBoardView({ isLocked: true, isFacilitator: false, cards: [card] });
    const lockedHarness = mountSession(locked);
    expect(await lockedHarness.controller.updateCard(card.id, 'Nope')).toEqual({
      ok: false,
      message: 'This Card can no longer be edited.',
    });
    expect(await lockedHarness.controller.createCard('col_1', 'Nope')).toEqual({
      ok: false,
      message: 'This Board is not accepting new Cards.',
    });
    expect(lockedHarness.dispatchCommand).not.toHaveBeenCalled();
  });

  it('enforces whole-Card-Group Private Mode on ungroupCard without dispatching', async () => {
    const myCard = makeCard({
      id: 'card_mine',
      columnId: 'col_1',
      groupId: 'group_mixed',
      isMine: true,
    });
    const peerCard = makeCard({
      id: 'card_peer',
      columnId: 'col_1',
      groupId: 'group_mixed',
      isMine: false,
      redacted: true,
    });
    const ownCardA = makeCard({
      id: 'card_own_a',
      columnId: 'col_1',
      groupId: 'group_own',
      isMine: true,
    });
    const ownCardB = makeCard({
      id: 'card_own_b',
      columnId: 'col_1',
      groupId: 'group_own',
      isMine: true,
    });
    const board = makeBoardView({
      isFacilitator: true,
      isBlurred: true,
      groups: [
        {
          id: 'group_mixed',
          columnId: 'col_1',
          title: 'Mixed',
          cardIds: [myCard.id, peerCard.id],
          votes: 0,
          myVotes: 0,
          createdAt: 0,
        },
        {
          id: 'group_own',
          columnId: 'col_1',
          title: 'Own',
          cardIds: [ownCardA.id, ownCardB.id],
          votes: 0,
          myVotes: 0,
          createdAt: 0,
        },
      ],
      cards: [myCard, peerCard, ownCardA, ownCardB],
    });
    const { controller, dispatchCommand } = mountSession(board);

    expect((await controller.ungroupCard(myCard.id)).ok).toBe(false);
    expect(dispatchCommand).not.toHaveBeenCalled();

    expect(await controller.ungroupCard(ownCardA.id)).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCommand).toHaveBeenCalledWith(board.id, {
      type: 'group:ungroup',
      cardId: ownCardA.id,
    });
  });

  it('rejects pending Cards, invalid Votes, Private Mode comment moderation, and Private Mode Locked Action Items at preflight with zero dispatches', async () => {
    const pendingCard = makeCard({
      id: 'card_pending',
      columnId: 'col_1',
      groupId: 'group_own',
      isMine: true,
      pending: true,
      isActionItem: true,
    });
    const peerComment = {
      id: 'comment_peer',
      cardId: 'card_own',
      content: 'Peer note',
      isMine: false,
      createdAt: 0,
    };
    const ownCard = makeCard({
      id: 'card_own',
      columnId: 'col_1',
      isMine: true,
      myVotes: 1,
      votes: 1,
      comments: [peerComment],
      commentCount: 1,
    });
    const groupedCard = makeCard({
      id: 'card_grouped',
      columnId: 'col_1',
      groupId: 'group_own',
      isMine: true,
      myVotes: 0,
      votes: 0,
    });
    const board = makeBoardView({
      isFacilitator: true,
      isBlurred: true,
      maxVotesPerCard: 1,
      remainingVotes: 0,
      groups: [
        {
          id: 'group_own',
          columnId: 'col_1',
          title: 'Own Group',
          cardIds: [groupedCard.id],
          votes: 0,
          myVotes: 0,
          createdAt: 0,
        },
      ],
      cards: [pendingCard, ownCard, groupedCard],
    });
    const { controller, dispatchCommand } = mountSession(board);

    // Optimistic pending Card is rejected across all Card mutations.
    expect(await controller.toggleReaction(pendingCard.id, '👍')).toEqual({
      ok: false,
      message: 'This Card can no longer receive reactions.',
    });
    expect(await controller.createComment(pendingCard.id, 'Hello')).toEqual({
      ok: false,
      message: 'This Card can no longer receive comments.',
    });
    expect((await controller.updateActionItem(pendingCard.id, { actionDone: true })).ok).toBe(false);
    expect(await controller.updateCard(pendingCard.id, 'Edit')).toEqual({
      ok: false,
      message: 'This Card can no longer be edited.',
    });
    expect((await controller.moveCard(pendingCard.id, 'col_2')).ok).toBe(false);
    expect((await controller.deleteCard(pendingCard.id)).ok).toBe(false);
    expect((await controller.groupCard(pendingCard.id, 'card', ownCard.id)).ok).toBe(false);
    expect((await controller.ungroupCard(pendingCard.id)).ok).toBe(false);
    expect((await controller.changeVote('card', pendingCard.id, 1)).ok).toBe(false);

    // Vote policy preflight blocks cap/balance/zero-vote/grouped-Card violations.
    expect((await controller.changeVote('card', ownCard.id, 1)).ok).toBe(false);
    expect((await controller.changeVote('card', groupedCard.id, 1)).ok).toBe(false);
    expect((await controller.changeVote('group', 'group_own', -1)).ok).toBe(false);

    // Client-conservative Private Mode comment moderation blocks Facilitator deleting peer comment.
    expect(await controller.deleteComment(ownCard.id, peerComment.id)).toEqual({
      ok: false,
      message: 'This comment can no longer be deleted.',
    });
    expect(dispatchCommand).not.toHaveBeenCalled();

    // Facilitator on a Locked Board in Private Mode cannot follow up on another Participant's Action Item.
    const foreignAction = makeCard({
      id: 'card_foreign_action',
      columnId: 'col_1',
      isMine: false,
      isActionItem: true,
    });
    const lockedPrivate = makeBoardView({
      isFacilitator: true,
      isLocked: true,
      isBlurred: true,
      cards: [foreignAction],
    });
    const lockedHarness = mountSession(lockedPrivate);
    expect(
      (await lockedHarness.controller.updateActionItem(foreignAction.id, { actionDone: true })).ok,
    ).toBe(false);
    expect(lockedHarness.dispatchCommand).not.toHaveBeenCalled();
  });

  it('drops stale mutation responses and resyncs on a version gap', async () => {
    const card = makeCard({ id: 'card_version', columnId: 'col_1' });
    const board = makeBoardView({ cards: [card], version: 3 });
    const { controller, dispatchCommand, connections } = mountSession(board);

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: 3,
      events: [{
        type: 'card:upserted',
        version: 3,
        card: { ...card, columnId: 'col_2' },
      }],
    });
    expect(await controller.moveCard(card.id, 'col_2')).toEqual({ ok: true });
    flush();
    expect(controller.board()?.version).toBe(3);
    expect(controller.board()?.cards[0]?.columnId).toBe('col_1');

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: 9,
      events: [{
        type: 'card:upserted',
        version: 9,
        card: { ...card, columnId: 'col_2' },
      }],
    });
    expect(await controller.moveCard(card.id, 'col_2')).toEqual({ ok: true });
    flush();
    expect(controller.board()?.version).toBe(3);
    expect(controller.board()?.cards[0]?.columnId).toBe('col_1');
    expect(connections[0].closed).toBe(true);
    expect(connections).toHaveLength(2);
  });

  it('funnels mutation responses through the versioned-events seam', async () => {
    const card = makeCard({ id: 'card_m', columnId: 'col_1' });
    const board = makeBoardView({ cards: [card] });
    const { controller, dispatchCommand } = mountSession(board);

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: 2,
      lastActiveAt: board.lastActiveAt + 1_000,
      events: [{ type: 'card:upserted', version: 2, card: { ...card, columnId: 'col_2' } }],
    });

    const moved = await controller.moveCard(card.id, 'col_2');
    flush();
    expect(moved).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenCalledWith(board.id, {
      type: 'card:move',
      cardId: card.id,
      targetColumnId: 'col_2',
    });
    expect(controller.board()?.cards[0]?.columnId).toBe('col_2');
    expect(controller.board()?.version).toBe(2);
    expect(controller.board()?.lastActiveAt).toBe(board.lastActiveAt + 1_000);

    const locked = makeBoardView({ isLocked: true, isFacilitator: false, cards: [card] });
    const lockedSession = mountSession(locked).controller;
    const rejected = await lockedSession.updateCard(card.id, 'Nope');
    expect(rejected).toEqual({ ok: false, message: 'This Card can no longer be edited.' });
  });

  it('clears the board when the current Board is deleted', async () => {
    const board = makeBoardView();
    const { controller, dispatchCommand } = mountSession(board);

    const result = await controller.deleteCurrentBoard();
    flush();
    expect(result).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenCalledWith(board.id, { type: 'board:delete' });
    expect(controller.board()).toBeNull();
  });

  it('applies countdown changes and syncs the server clock from timer events', async () => {
    const board = makeBoardView();
    const { controller, dispatchCommand } = mountSession(board);

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: 2,
      events: [{
        type: 'timer:updated',
        version: 2,
        serverNow: 9090,
        timer: { endsAt: 20000, remainingMs: 60000, durationMs: 60000 },
      }],
    });
    const response = await controller.changeCountdown({ action: 'start', minutes: 1 });
    flush();
    expect(response).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenCalledWith(board.id, {
      type: 'timer:update',
      change: { action: 'start', minutes: 1 },
    });
    expect(controller.board()?.timer.remainingMs).toBe(60000);
    expect(controller.timerClock()?.serverNow).toBe(9090);
  });

  it('dispatches discriminated Board commands for facilitation, Columns, Comments, and Card Groups', async () => {
    const cardA = makeCard({
      id: 'card_a',
      columnId: 'col_1',
      content: 'Card A',
      comments: [{ id: 'cm_1', cardId: 'card_a', content: 'Old note', isMine: true, createdAt: 100 }],
      commentCount: 1,
    });
    const cardB = makeCard({ id: 'card_b', columnId: 'col_1', content: 'Card B' });
    const board = makeBoardView({ cards: [cardA, cardB] });
    const { controller, dispatchCommand } = mountSession(board);

    expect(await controller.renameBoard('  Sprint 43  ')).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'board:rename',
      title: 'Sprint 43',
    });

    expect(await controller.updateCard(cardA.id, 'Updated A')).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'card:update',
      cardId: cardA.id,
      content: 'Updated A',
    });

    expect(await controller.groupCard(cardA.id, 'card', cardB.id)).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'group:merge',
      cardId: cardA.id,
      targetType: 'card',
      targetId: cardB.id,
    });
    flush();
    const groupId = controller.board()?.groups[0]?.id;
    expect(groupId).toBeDefined();

    expect(await controller.renameCardGroup(groupId!, 'Cluster')).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'group:rename',
      groupId: groupId!,
      title: 'Cluster',
    });

    expect(await controller.moveCardGroup(groupId!, 'col_2')).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'group:move',
      groupId: groupId!,
      targetColumnId: 'col_2',
    });

    expect(await controller.ungroupCard(cardA.id)).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'group:ungroup',
      cardId: cardA.id,
    });

    expect(await controller.groupCard(cardA.id, 'card', cardB.id)).toEqual({ ok: true });
    flush();
    const nextGroupId = controller.board()?.groups[0]?.id;
    expect(await controller.dissolveCardGroup(nextGroupId!)).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'group:dissolve',
      groupId: nextGroupId!,
    });

    expect(await controller.deleteCard(cardB.id)).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'card:delete',
      cardId: cardB.id,
    });

    const added = await controller.addColumn({ title: 'Kudos', accent: 'amber', isActionColumn: false });
    expect(added.ok).toBe(true);
    if (!added.ok) throw new Error('Expected addColumn to succeed');
    expect(added.value.title).toBe('Kudos');
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'column:add',
      title: 'Kudos',
      accent: 'amber',
      isActionColumn: false,
    });

    expect(await controller.updateColumn(added.value.id, { title: 'Shoutouts' })).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'column:update',
      columnId: added.value.id,
      title: 'Shoutouts',
    });

    expect(await controller.moveColumn(added.value.id, -1)).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'column:reorder',
      columnIds: ['col_1', 'col_2', added.value.id, 'col_3'],
    });

    expect(await controller.deleteColumn(added.value.id)).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'column:delete',
      columnId: added.value.id,
    });

    const nextVersion = () => (controller.board()?.version ?? 0) + 1;

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: nextVersion(),
      events: [{ type: 'board:updated', version: nextVersion(), patch: { isBlurred: true } }],
    });
    expect(await controller.togglePrivateMode(false)).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'board:set-private-mode',
      isBlurred: true,
    });

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: nextVersion(),
      events: [{ type: 'board:updated', version: nextVersion(), patch: { isBlurred: false } }],
    });
    expect(await controller.togglePrivateMode(true)).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'board:set-private-mode',
      isBlurred: false,
    });

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: nextVersion(),
      events: [{
        type: 'comment:created',
        version: nextVersion(),
        cardId: cardA.id,
        comment: { id: 'cm_2', cardId: cardA.id, content: 'Nice!', isMine: true, createdAt: 200 },
      }],
    });
    expect(await controller.createComment(cardA.id, 'Nice!')).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'comment:create',
      cardId: cardA.id,
      content: 'Nice!',
    });

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: nextVersion(),
      events: [{ type: 'comment:deleted', version: nextVersion(), cardId: cardA.id, commentId: 'cm_1' }],
    });
    expect(await controller.deleteComment(cardA.id, 'cm_1')).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'comment:delete',
      cardId: cardA.id,
      commentId: 'cm_1',
    });

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: nextVersion(),
      events: [{ type: 'board:updated', version: nextVersion(), patch: { blindVoting: true } }],
    });
    expect(await controller.saveVotingSettings({ blindVoting: true })).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'voting:configure',
      blindVoting: true,
    });

    dispatchCommand.mockResolvedValueOnce({
      ok: true,
      version: nextVersion(),
      events: [{
        type: 'board:snapshot',
        version: nextVersion(),
        serverNow: Date.now(),
        board: { ...controller.board()!, version: nextVersion(), remainingVotes: 5 },
      }],
    });
    expect(await controller.resetAllVotes()).toEqual({ ok: true });
    expect(dispatchCommand).toHaveBeenLastCalledWith(board.id, {
      type: 'voting:reset',
    });
  });

  it('claims #f= Co-Facilitator Links in place, reconnects live updates (even when live advanced version), and keeps Solid 2.0 diagnostics clean', async () => {
    const { artifact } = await captureArtifact(
      async () => {
        const board = makeBoardView({ version: 2, isFacilitator: false });
        const pendingFirstClaim = Promise.withResolvers<FacilitatorClaimResponse>();
        const { controller, setBoardProp, connections, claimLinkSpy, fragment } = mountSession(board);

        expect(connections).toHaveLength(1);
        expect(controller.board()?.isFacilitator).toBe(false);
        expect(controller.claimPending()).toBe(false);
        expect(controller.claimError()).toBeNull();
        expect(fragment.takenPaths).toEqual([`/b/${board.id}`]);

        connections[0].emit({
          type: 'board:snapshot',
          version: board.version,
          board,
          serverNow: 1_000,
        });
        flush();
        expect(controller.isLive()).toBe(true);

        // Claim succeeds at the same Board version: claimPending toggles, Facilitator
        // state applies in place, and the live stream reconnects internally.
        claimLinkSpy.mockReturnValueOnce(pendingFirstClaim.promise);
        fragment.triggerHashChange('A'.repeat(43));
        flush();
        expect(claimLinkSpy).toHaveBeenCalledWith({ boardId: board.id, token: 'A'.repeat(43) });
        expect(controller.claimPending()).toBe(true);

        const claimed = { ...board, isFacilitator: true };
        pendingFirstClaim.resolve({ ok: true, board: claimed });
        await Promise.resolve();
        await Promise.resolve();
        flush();

        expect(controller.claimPending()).toBe(false);
        expect(controller.claimError()).toBeNull();
        expect(controller.board()?.isFacilitator).toBe(true);
        expect(connections[0].closed).toBe(true);
        expect(connections).toHaveLength(2);

        // Equal-version Participant route prop must never downgrade Facilitator back to false.
        setBoardProp({ ...board, isFacilitator: false });
        flush();
        expect(controller.board()?.isFacilitator).toBe(true);

        // Reconnected stream delivers a Facilitator-projected snapshot and restores live status.
        connections[1].emit({
          type: 'board:snapshot',
          version: 3,
          board: { ...claimed, version: 3, title: 'Advanced Live Title' },
          serverNow: 2_000,
        });
        flush();
        expect(controller.isLive()).toBe(true);
        expect(controller.board()?.version).toBe(3);
        expect(controller.board()?.title).toBe('Advanced Live Title');
        expect(controller.board()?.isFacilitator).toBe(true);

        // Even if live updates already advanced past a claimed snapshot's version,
        // the claim still reconnects internally without regressing version or content.
        claimLinkSpy.mockResolvedValueOnce({
          ok: true,
          board: { ...claimed, version: 2, title: 'Older snapshot' },
        });
        fragment.triggerHashChange('B'.repeat(43));
        await Promise.resolve();
        await Promise.resolve();
        flush();

        expect(controller.board()?.version).toBe(3);
        expect(controller.board()?.title).toBe('Advanced Live Title');
        expect(connections[1].closed).toBe(true);
        expect(connections).toHaveLength(3);
      },
      { scenario: 'board-controller-facilitator-claim-reconnect' },
    );
    expectNoDiagnostics(artifact);
  });

  it('scrubs #f= from browser history before claiming on mount, preserves query params, and upgrades after live version advance', async () => {
    const board = makeBoardView({ id: 'board_browser_claim_01', version: 2, isFacilitator: false });
    const token = 'C'.repeat(43);
    window.history.replaceState(null, '', `/b/${board.id}?view=all#f=${token}`);
    const pendingClaim = Promise.withResolvers<FacilitatorClaimResponse>();
    const claim = vi.fn(async (input: FacilitatorClaimInput): Promise<FacilitatorClaimResponse> => {
      // ADR-0001: URL fragment must be scrubbed before the server exchange starts.
      expect(window.location.hash).toBe('');
      expect(window.location.pathname + window.location.search).toBe(`/b/${board.id}?view=all`);
      expect(input).toEqual({ boardId: board.id, token });
      return pendingClaim.promise;
    });

    const { controller, connections } = mountSession(board, {
      useBrowserFragment: true,
      claimFacilitatorLink: claim,
    });

    expect(claim).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
    expect(controller.claimPending()).toBe(true);

    // Live mutation advances the Board to version 3 while the initial claim is in flight.
    connections[0].emit({
      type: 'board:mutation',
      version: 3,
      events: [{ type: 'board:updated', version: 3, patch: { title: 'Version 3 Live' } }],
    });
    flush();
    expect(controller.board()?.version).toBe(3);
    expect(controller.board()?.isFacilitator).toBe(false);

    // Claim resolves with version 2 Facilitator snapshot: must keep version 3 content,
    // immediately upgrade isFacilitator, and reconnect the live stream.
    pendingClaim.resolve({
      ok: true,
      board: { ...board, version: 2, title: 'Version 2 Claim', isFacilitator: true },
    });
    await vi.waitFor(() => {
      flush();
      expect(controller.claimPending()).toBe(false);
    });

    expect(controller.board()?.version).toBe(3);
    expect(controller.board()?.title).toBe('Version 3 Live');
    expect(controller.board()?.isFacilitator).toBe(true);
    expect(connections[0].closed).toBe(true);
    expect(connections).toHaveLength(2);
  });

  it('surfaces server and network claim errors, recovers on hashchange, ignores superseded races, and stops claiming after dispose', async () => {
    const board = makeBoardView({ id: 'board_claim_errors_01', version: 2, isFacilitator: false });
    const { controller, connections, claimLinkSpy, fragment, dispose } = mountSession(board);

    // 1. Server rejection surfaces message without reconnecting live stream.
    claimLinkSpy.mockResolvedValueOnce({
      ok: false,
      code: 'FORBIDDEN',
      message: 'This Co-Facilitator Link is invalid or has expired.',
    });
    fragment.triggerHashChange('bad-token');
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(controller.claimError()).toBe('This Co-Facilitator Link is invalid or has expired.');
    expect(controller.claimPending()).toBe(false);
    expect(controller.board()?.isFacilitator).toBe(false);
    expect(connections).toHaveLength(1);

    // Clear helper clears claimError cleanly.
    controller.clearClaimError();
    flush();
    expect(controller.claimError()).toBeNull();

    // 2. Network rejection surfaces fallback error copy.
    claimLinkSpy.mockRejectedValueOnce(new Error('network down'));
    fragment.triggerHashChange('offline-token');
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(controller.claimError()).toBe(
      'Could not claim Facilitator access. Reopen the link to try again.',
    );
    expect(controller.claimPending()).toBe(false);

    // 3. Superseded claim race: newer succeeds and clears prior error; older late result is ignored.
    const older = Promise.withResolvers<FacilitatorClaimResponse>();
    const newer = Promise.withResolvers<FacilitatorClaimResponse>();
    claimLinkSpy.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    fragment.triggerHashChange('old-token');
    flush();
    expect(controller.claimError()).toBeNull();
    expect(controller.claimPending()).toBe(true);

    fragment.triggerHashChange('new-token');
    flush();
    expect(claimLinkSpy).toHaveBeenCalledTimes(4);

    newer.resolve({ ok: true, board: { ...board, version: 3, isFacilitator: true } });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(controller.claimPending()).toBe(false);
    expect(controller.claimError()).toBeNull();
    expect(controller.board()?.version).toBe(3);
    expect(controller.board()?.isFacilitator).toBe(true);
    expect(connections).toHaveLength(2);

    older.resolve({ ok: false, code: 'FORBIDDEN', message: 'Stale error must be ignored' });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(controller.claimError()).toBeNull();
    expect(connections).toHaveLength(2);

    // 4. After dispose, hashchange listeners are removed and subsequent fragments are not claimed.
    dispose();
    expect(fragment.listenerCount()).toBe(0);
    fragment.triggerHashChange('after-dispose');
    expect(claimLinkSpy).toHaveBeenCalledTimes(4);
  });

  it('scrubs #f= and exposes claimError on a missing or unavailable Board', async () => {
    const missingBoardId = 'board_missing_claim_01';
    const token = 'D'.repeat(43);
    window.history.replaceState(null, '', `/b/${missingBoardId}#f=${token}`);
    const claim = vi.fn(async (): Promise<FacilitatorClaimResponse> => ({
      ok: false,
      code: 'FORBIDDEN',
      message: 'This Co-Facilitator Link is invalid or has expired.',
    }));

    const { controller, connections } = mountSession(null, {
      boardId: missingBoardId,
      useBrowserFragment: true,
      claimFacilitatorLink: claim,
    });
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(window.location.hash).toBe('');
    expect(claim).toHaveBeenCalledWith({ boardId: missingBoardId, token });
    expect(controller.board()).toBeNull();
    expect(connections).toHaveLength(0);
    expect(controller.claimError()).toBe('This Co-Facilitator Link is invalid or has expired.');
    expect(controller.claimPending()).toBe(false);
  });

  it('keeps live updates, snapshot reconciliation, and mutations free of Solid 2.0 diagnostics', async () => {
    const { artifact } = await captureArtifact(
      async () => {
        const card = makeCard({ id: 'card_diag' });
        const board = makeBoardView({ cards: [card] });
        const { controller, setBoardProp, connections, dispatchCommand } = mountSession(board);

        connections[0].emit({
          type: 'board:mutation',
          version: 2,
          events: [{ type: 'vote:updated', version: 2, targetType: 'card', targetId: card.id, totalVotes: 3, myVotes: 1, remainingVotes: 4 }],
        });
        flush();
        expect(controller.board()?.cards[0]?.myVotes).toBe(1);

        setBoardProp({ ...board, version: 3, title: 'Reconciled' });
        flush();
        expect(controller.board()?.title).toBe('Reconciled');

        dispatchCommand.mockResolvedValueOnce({
          ok: true,
          version: 4,
          events: [{ type: 'reaction:updated', version: 4, cardId: card.id, counts: { '🎉': 1 }, myReactions: ['🎉'] }],
        });
        await controller.toggleReaction(card.id, '🎉');
        flush();
        expect(controller.board()?.cards[0]?.myReactions).toEqual(['🎉']);
      },
      { scenario: 'board-controller-live-and-mutations' },
    );
    expectNoDiagnostics(artifact);
  });

  it('isolates single-Card live events and mutations so unrelated Cards and Columns do not recompute', async () => {
    const { artifact } = await captureArtifact(
      async () => {
        const cardA = makeCard({ id: 'card_a', columnId: 'col_1', content: 'Card A', votes: 0, myVotes: 0 });
        const cardB = makeCard({
          id: 'card_b',
          columnId: 'col_2',
          content: 'Card B',
          votes: 2,
          myVotes: 1,
          reactions: { '👍': 2 },
          myReactions: ['👍'],
          commentCount: 1,
          comments: [{ id: 'cm_1', cardId: 'card_b', content: 'Keep me stable', isMine: false, createdAt: 100 }],
        });
        const board = makeBoardView({
          columns: [
            { id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 1 },
            { id: 'col_2', title: 'To Improve', accent: 'rose', position: 1, isActionColumn: false, cardCount: 1 },
          ],
          cards: [cardA, cardB],
        });
        const { controller, connections, dispatchCommand } = mountSession(board);

        let cardARuns = 0;
        let cardBRuns = 0;
        let col2Runs = 0;
        let latestCardA = '';

        const disposeObservers = createRoot((dispose) => {
          const targetCard = controller.board()!.cards[0];
          const unrelatedCard = controller.board()!.cards[1];
          const unrelatedCol = controller.board()!.columns[1];

          createEffect(
            () => ({
              content: targetCard.content,
              votes: targetCard.votes,
              myVotes: targetCard.myVotes,
              reactions: Object.entries(targetCard.reactions).map(([k, v]) => `${k}:${v}`).join(','),
              myReactions: targetCard.myReactions.join(','),
            }),
            (summary) => {
              cardARuns += 1;
              latestCardA = `${summary.content}|${summary.votes}|${summary.myVotes}|${summary.reactions}|${summary.myReactions}`;
            },
          );

          createEffect(
            () => ({
              content: unrelatedCard.content,
              votes: unrelatedCard.votes,
              myVotes: unrelatedCard.myVotes,
              reactions: Object.entries(unrelatedCard.reactions).map(([k, v]) => `${k}:${v}`).join(','),
              myReactions: unrelatedCard.myReactions.join(','),
              comments: unrelatedCard.comments.map((c) => c.content).join(','),
            }),
            () => {
              cardBRuns += 1;
            },
          );

          createEffect(
            () => ({
              title: unrelatedCol.title,
              cardCount: unrelatedCol.cardCount,
            }),
            () => {
              col2Runs += 1;
            },
          );

          return dispose;
        });

        try {
          flush();
          expect(cardARuns).toBe(1);
          expect(cardBRuns).toBe(1);
          expect(col2Runs).toBe(1);

          const cardBRefBefore = controller.board()?.cards[1];

          // 1. Live vote:updated on card_a
          connections[0].emit({
            type: 'board:mutation',
            version: 2,
            events: [
              {
                type: 'vote:updated',
                version: 2,
                targetType: 'card',
                targetId: 'card_a',
                totalVotes: 1,
                myVotes: 1,
                remainingVotes: 4,
              },
            ],
          });
          flush();
          expect(cardARuns).toBe(2);
          expect(latestCardA).toBe('Card A|1|1||');
          expect(cardBRuns).toBe(1);
          expect(col2Runs).toBe(1);

          // 2. Live reaction:updated on card_a
          connections[0].emit({
            type: 'board:mutation',
            version: 3,
            events: [
              {
                type: 'reaction:updated',
                version: 3,
                cardId: 'card_a',
                counts: { '🎉': 1 },
                myReactions: ['🎉'],
              },
            ],
          });
          flush();
          expect(cardARuns).toBe(3);
          expect(latestCardA).toBe('Card A|1|1|🎉:1|🎉');
          expect(cardBRuns).toBe(1);
          expect(col2Runs).toBe(1);

          // 3. Live card:upserted on card_a
          connections[0].emit({
            type: 'board:mutation',
            version: 4,
            events: [
              {
                type: 'card:upserted',
                version: 4,
                card: { ...cardA, content: 'Card A edited', votes: 1, myVotes: 1, reactions: { '🎉': 1 }, myReactions: ['🎉'] },
              },
            ],
          });
          flush();
          expect(cardARuns).toBe(4);
          expect(latestCardA).toBe('Card A edited|1|1|🎉:1|🎉');
          expect(cardBRuns).toBe(1);
          expect(col2Runs).toBe(1);

          // 4. Optimistic + committed mutation on card_a (add and then remove one of two reactions)
          dispatchCommand.mockResolvedValueOnce({
            ok: true,
            version: 5,
            events: [
              {
                type: 'reaction:updated',
                version: 5,
                cardId: 'card_a',
                counts: { '🎉': 1, '👍': 1 },
                myReactions: ['🎉', '👍'],
              },
            ],
          });
          await controller.toggleReaction('card_a', '👍');
          flush();
          expect(latestCardA).toBe('Card A edited|1|1|🎉:1,👍:1|🎉,👍');
          expect(cardBRuns).toBe(1);
          expect(col2Runs).toBe(1);

          dispatchCommand.mockResolvedValueOnce({
            ok: true,
            version: 6,
            events: [
              {
                type: 'reaction:updated',
                version: 6,
                cardId: 'card_a',
                counts: { '🎉': 1 },
                myReactions: ['🎉'],
              },
            ],
          });
          await controller.toggleReaction('card_a', '👍');
          flush();
          expect(latestCardA).toBe('Card A edited|1|1|🎉:1|🎉');
          expect(cardBRuns).toBe(1);
          expect(col2Runs).toBe(1);

          // 5. Facilitation toggle (board:updated) leaves unrelated Card and Column readers untouched
          dispatchCommand.mockResolvedValueOnce({
            ok: true,
            version: 7,
            events: [{ type: 'board:updated', version: 7, patch: { isLocked: true } }],
          });
          expect(await controller.toggleBoardLock(true)).toEqual({ ok: true });
          flush();
          expect(controller.board()?.isLocked).toBe(true);
          expect(cardBRuns).toBe(1);
          expect(col2Runs).toBe(1);
          expect(controller.board()?.cards[1]).toBe(cardBRefBefore);
        } finally {
          disposeObservers();
        }
      },
      { scenario: 'board-controller-reactive-isolation' },
    );
    expectNoDiagnostics(artifact);
  });

  it('preserves concurrent live events when an in-flight optimistic mutation rejects', async () => {
    const { artifact } = await captureArtifact(
      async () => {
        const cardA = makeCard({ id: 'card_a', columnId: 'col_1', content: 'Card A', votes: 0, myVotes: 0 });
        const cardB = makeCard({ id: 'card_b', columnId: 'col_2', content: 'Card B', votes: 0, myVotes: 0 });
        const board = makeBoardView({
          isFacilitator: false,
          voteLimit: 5,
          remainingVotes: 5,
          cards: [cardA, cardB],
        });
        const { controller, connections, dispatchCommand } = mountSession(board);

        const pendingVote = Promise.withResolvers<BoardMutationResponse>();
        dispatchCommand.mockReturnValueOnce(pendingVote.promise);

        // Start optimistic vote on card_a
        const votePromise = controller.changeVote('card', 'card_a', 1);
        flush();
        expect(controller.voting().pending).toBe(true);
        expect(controller.voting().remainingVotes).toBe(4);
        expect(controller.board()?.cards[0]?.myVotes).toBe(1);

        // While card_a's vote is in flight, a live event updates card_b
        connections[0].emit({
          type: 'board:mutation',
          version: 2,
          events: [
            {
              type: 'card:upserted',
              version: 2,
              card: { ...cardB, content: 'Card B edited live' },
            },
          ],
        });
        flush();
        expect(controller.board()?.cards[1]?.content).toBe('Card B edited live');
        expect(controller.board()?.cards[0]?.myVotes).toBe(1);

        // Server rejects card_a's vote: card_a reverts while card_b's live edit stays intact
        pendingVote.resolve({
          ok: false,
          code: 'LIMIT_EXCEEDED',
          message: 'No votes left.',
        });
        await votePromise;
        flush();

        expect(controller.voting().pending).toBe(false);
        expect(controller.voting().remainingVotes).toBe(5);
        expect(controller.board()?.cards[0]?.myVotes).toBe(0);
        expect(controller.board()?.cards[1]?.content).toBe('Card B edited live');
        expect(controller.board()?.version).toBe(2);
        expect(controller.errorMessage()).toBe('No votes left.');
      },
      { scenario: 'board-controller-concurrent-live-and-rollback' },
    );
    expectNoDiagnostics(artifact, { allow: ['OPTIMISTIC_REVERTED'] });
  });

  it('reconciles Card create, edit, cross-Column move, and delete idempotently while keeping Column cardCounts and Card Group members accurate', () => {
    const board = makeBoardView({
      columns: [
        { id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 0 },
        { id: 'col_2', title: 'To Improve', accent: 'rose', position: 1, isActionColumn: false, cardCount: 0 },
      ],
      cards: [],
    });
    const { controller, connections } = mountSession(board);
    const card = makeCard({ id: 'card_1', columnId: 'col_1', content: 'Fast builds' });

    // Create Card (applied twice in one batch to prove idempotency)
    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      events: [
        { type: 'card:upserted', version: 2, card },
        { type: 'card:upserted', version: 2, card },
      ],
    });
    flush();

    const afterCreate = snapshot(controller.board()!);
    expect(afterCreate.version).toBe(2);
    expect(afterCreate.cards).toHaveLength(1);
    expect(afterCreate.columns[0].cardCount).toBe(1);
    expect(afterCreate.columns[1].cardCount).toBe(0);

    // Move Card from col_1 to col_2
    connections[0].emit({
      type: 'board:mutation',
      version: 3,
      events: [
        {
          type: 'card:upserted',
          version: 3,
          card: { ...card, columnId: 'col_2', content: 'Moved card' },
        },
      ],
    });
    flush();

    const afterMove = snapshot(controller.board()!);
    expect(afterMove.cards[0].columnId).toBe('col_2');
    expect(afterMove.cards[0].content).toBe('Moved card');
    expect(afterMove.columns[0].cardCount).toBe(0);
    expect(afterMove.columns[1].cardCount).toBe(1);

    // Group Card and delete it twice for idempotency: Column cardCount and group.cardIds both stay accurate
    connections[0].emit({
      type: 'board:mutation',
      version: 4,
      events: [
        {
          type: 'group:upserted',
          version: 4,
          group: {
            id: 'group_1',
            columnId: 'col_2',
            title: 'Theme',
            cardIds: [card.id, 'card_other'],
            votes: 0,
            myVotes: 0,
            createdAt: 1_760_000_002_000,
          },
        },
      ],
    });
    connections[0].emit({
      type: 'board:mutation',
      version: 5,
      events: [
        { type: 'card:deleted', version: 5, cardId: card.id },
        { type: 'card:deleted', version: 5, cardId: card.id },
      ],
    });
    flush();

    const afterDelete = snapshot(controller.board()!);
    expect(afterDelete.cards).toHaveLength(0);
    expect(afterDelete.columns[1].cardCount).toBe(0);
    expect(afterDelete.groups[0].cardIds).toEqual(['card_other']);
  });

  it('adopts whole Card and Card Group items in place while preserving store proxy identity', () => {
    const board = makeBoardView({
      columns: [
        { id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 2 },
        { id: 'col_2', title: 'To Improve', accent: 'rose', position: 1, isActionColumn: false, cardCount: 0 },
      ],
      cards: [
        makeCard({ id: 'card_a', content: 'Fast builds' }),
        makeCard({ id: 'card_b', content: 'Fast builds' }),
      ],
    });
    const { controller, connections } = mountSession(board);
    const cardSlotBefore = untrack(() => controller.board()!.cards[0]);
    const otherSlotBefore = untrack(() => controller.board()!.cards[1]);

    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      events: [
        {
          type: 'card:upserted',
          version: 2,
          card: makeCard({ id: 'card_a', content: 'Edited in place', updatedAt: 1_760_000_002_000 }),
        },
      ],
    });
    flush();

    expect(snapshot(controller.board()!).cards.map((card) => card.content)).toEqual([
      'Edited in place',
      'Fast builds',
    ]);
    expect(untrack(() => controller.board()!.cards[0])).toBe(cardSlotBefore);
    expect(untrack(() => controller.board()!.cards[1])).toBe(otherSlotBefore);

    connections[0].emit({
      type: 'board:mutation',
      version: 3,
      events: [
        {
          type: 'group:upserted',
          version: 3,
          group: {
            id: 'group_1',
            columnId: 'col_1',
            title: 'Merged theme',
            cardIds: ['card_a', 'card_b'],
            votes: 0,
            myVotes: 0,
            createdAt: 1_760_000_003_000,
          },
        },
      ],
    });
    flush();

    expect(snapshot(controller.board()!).groups[0].cardIds).toEqual(['card_a', 'card_b']);
    const groupSlotAfterCreate = untrack(() => controller.board()!.groups[0]);
    expect(untrack(() => controller.board()!.cards[1])).toBe(otherSlotBefore);

    connections[0].emit({
      type: 'board:mutation',
      version: 4,
      events: [
        {
          type: 'group:upserted',
          version: 4,
          group: {
            id: 'group_1',
            columnId: 'col_1',
            title: 'Renamed theme',
            cardIds: ['card_a', 'card_b'],
            votes: 0,
            myVotes: 0,
            createdAt: 1_760_000_003_000,
          },
        },
      ],
    });
    flush();

    expect(snapshot(controller.board()!).groups[0].title).toBe('Renamed theme');
    expect(untrack(() => controller.board()!.groups[0])).toBe(groupSlotAfterCreate);
    expect(untrack(() => controller.board()!.cards[1])).toBe(otherSlotBefore);
  });

  it('reconciles viewer reactions and keeps the anonymous comment thread chronological and idempotent', () => {
    const board = makeBoardView({
      cards: [
        makeCard({
          id: 'card_1',
          comments: [{ id: 'late', cardId: 'card_1', content: 'Later', isMine: false, createdAt: 300 }],
          commentCount: 1,
        }),
      ],
    });
    const { controller, connections } = mountSession(board);
    const early = { id: 'early', cardId: 'card_1', content: 'Earlier', isMine: true, createdAt: 100 };

    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      events: [
        { type: 'reaction:updated', version: 2, cardId: 'card_1', counts: { '👍': 2 }, myReactions: ['👍'] },
        { type: 'comment:created', version: 2, cardId: 'card_1', comment: early },
        { type: 'comment:created', version: 2, cardId: 'card_1', comment: early },
      ],
    });
    flush();

    let card = snapshot(controller.board()!).cards[0];
    expect(card.reactions).toEqual({ '👍': 2 });
    expect(card.myReactions).toEqual(['👍']);
    expect(card.comments.map((comment) => comment.id)).toEqual(['early', 'late']);
    expect(card.commentCount).toBe(2);

    connections[0].emit({
      type: 'board:mutation',
      version: 3,
      events: [
        { type: 'reaction:updated', version: 3, cardId: 'card_1', counts: {}, myReactions: [] },
        { type: 'comment:deleted', version: 3, cardId: 'card_1', commentId: 'late' },
        { type: 'comment:deleted', version: 3, cardId: 'card_1', commentId: 'late' },
      ],
    });
    flush();

    card = snapshot(controller.board()!).cards[0];
    expect(card.reactions).toEqual({});
    expect(card.myReactions).toEqual([]);
    expect(card.comments.map((comment) => comment.id)).toEqual(['early']);
    expect(card.commentCount).toBe(1);
  });

  it('reconciles Card Group create, rename, Column move, and dissolve across member Cards', () => {
    const first = makeCard({ id: 'card_1', columnId: 'col_1' });
    const second = makeCard({ id: 'card_2', columnId: 'col_1' });
    const board = makeBoardView({
      columns: [
        { id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 2 },
        { id: 'col_2', title: 'To Improve', accent: 'rose', position: 1, isActionColumn: false, cardCount: 0 },
      ],
      cards: [first, second],
    });
    const { controller, connections } = mountSession(board);

    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      events: [
        {
          type: 'group:upserted',
          version: 2,
          group: {
            id: 'group_1',
            columnId: 'col_1',
            title: 'CI stability',
            cardIds: ['card_1', 'card_2'],
            votes: 3,
            myVotes: 1,
            createdAt: 1_760_000_002_000,
          },
        },
        { type: 'card:upserted', version: 2, card: { ...first, groupId: 'group_1' } },
        { type: 'card:upserted', version: 2, card: { ...second, groupId: 'group_1' } },
      ],
    });
    flush();

    let next = snapshot(controller.board()!);
    expect(next.groups).toEqual([
      expect.objectContaining({ id: 'group_1', title: 'CI stability', votes: 3, myVotes: 1 }),
    ]);
    expect(next.cards.map((card) => card.groupId)).toEqual(['group_1', 'group_1']);

    connections[0].emit({
      type: 'board:mutation',
      version: 3,
      events: [
        {
          type: 'group:upserted',
          version: 3,
          group: { ...next.groups[0], columnId: 'col_2', title: 'CI reliability' },
        },
        { type: 'card:upserted', version: 3, card: { ...next.cards[0], columnId: 'col_2' } },
        { type: 'card:upserted', version: 3, card: { ...next.cards[1], columnId: 'col_2' } },
      ],
    });
    flush();

    next = snapshot(controller.board()!);
    expect(next.groups[0]).toMatchObject({ columnId: 'col_2', title: 'CI reliability' });
    expect(next.cards.map((card) => card.columnId)).toEqual(['col_2', 'col_2']);
    expect(next.columns.map((column) => column.cardCount)).toEqual([0, 2]);

    connections[0].emit({
      type: 'board:mutation',
      version: 4,
      events: [{ type: 'group:dissolved', version: 4, groupId: 'group_1' }],
    });
    flush();

    next = snapshot(controller.board()!);
    expect(next.groups).toEqual([]);
    expect(next.cards.map((card) => card.groupId)).toEqual([null, null]);
  });

  it('reconciles Board settings, Locked transitions, and Column add, update, reorder, and delete', () => {
    const board = makeBoardView({
      columns: [
        { id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 0 },
        { id: 'col_2', title: 'To Improve', accent: 'rose', position: 1, isActionColumn: false, cardCount: 0 },
      ],
      cards: [],
    });
    const { controller, connections } = mountSession(board);

    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      events: [
        {
          type: 'board:updated',
          version: 2,
          patch: {
            title: 'Sprint 43 Retro',
            subtitle: 'Core Platform',
            isBlurred: true,
            blindVoting: true,
            isLocked: true,
            allowParticipantGroup: true,
            voteLimit: 10,
            maxVotesPerCard: 1,
            retentionDays: 180,
          },
        },
        { type: 'board:updated', version: 2, patch: { isLocked: true } },
        {
          type: 'column:upserted',
          version: 2,
          column: {
            id: 'col_3',
            title: 'Kudos',
            accent: 'violet',
            position: 2,
            isActionColumn: false,
            cardCount: 0,
          },
        },
        {
          type: 'column:upserted',
          version: 2,
          column: {
            id: 'col_3',
            title: 'Shoutouts',
            accent: 'coral',
            position: 2,
            isActionColumn: false,
            cardCount: 0,
          },
        },
        { type: 'columns:reordered', version: 2, columnIds: ['col_3', 'col_1', 'col_2'] },
        {
          type: 'card:upserted',
          version: 2,
          card: makeCard({ id: 'card_in_col3', columnId: 'col_3', groupId: 'group_in_col3' }),
        },
        {
          type: 'group:upserted',
          version: 2,
          group: {
            id: 'group_in_col3',
            columnId: 'col_3',
            title: 'Kudos cluster',
            cardIds: ['card_in_col3'],
            votes: 0,
            myVotes: 0,
            createdAt: 1_760_000_002_000,
          },
        },
      ],
    });
    flush();

    const afterUpdate = snapshot(controller.board()!);
    expect(afterUpdate).toMatchObject({
      title: 'Sprint 43 Retro',
      subtitle: 'Core Platform',
      isBlurred: true,
      blindVoting: true,
      isLocked: true,
      allowParticipantGroup: true,
      voteLimit: 10,
      maxVotesPerCard: 1,
      retentionDays: 180,
    });
    expect(afterUpdate.columns.map((c) => c.id)).toEqual(['col_3', 'col_1', 'col_2']);
    expect(afterUpdate.columns[0]).toMatchObject({
      title: 'Shoutouts',
      accent: 'coral',
      position: 0,
      cardCount: 1,
    });

    connections[0].emit({
      type: 'board:mutation',
      version: 3,
      events: [
        { type: 'board:updated', version: 3, patch: { isLocked: false } },
        { type: 'column:deleted', version: 3, columnId: 'col_3' },
      ],
    });
    flush();

    const afterColDelete = snapshot(controller.board()!);
    expect(afterColDelete.isLocked).toBe(false);
    expect(afterColDelete.columns.map((c) => c.id)).toEqual(['col_1', 'col_2']);
    expect(afterColDelete.columns.map((c) => c.position)).toEqual([0, 1]);
    expect(afterColDelete.cards).toHaveLength(0);
    expect(afterColDelete.groups).toHaveLength(0);
  });

  it('reconciles live timer clock sync, gap-healing snapshots, and terminal deletion in one pipeline', () => {
    const board = makeBoardView({ version: 1, title: 'Initial' });
    const { controller, connections } = mountSession(board);

    // 1. Live timer:updated updates timer fields AND syncs server clock in one pass
    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      events: [
        {
          type: 'timer:updated',
          version: 2,
          serverNow: 7777,
          timer: { endsAt: 67777, remainingMs: 60000, durationMs: 60000 },
        },
      ],
    });
    flush();
    expect(controller.board()?.version).toBe(2);
    expect(controller.board()?.timer).toEqual({ endsAt: 67777, remainingMs: 60000, durationMs: 60000 });
    expect(controller.timerClock()?.serverNow).toBe(7777);
    expect(controller.nowMs()).toBe(7777);

    // 2. A board:mutation carrying a full board:snapshot heals a version gap without reconnecting
    connections[0].emit({
      type: 'board:mutation',
      version: 8,
      events: [
        {
          type: 'board:snapshot',
          version: 8,
          serverNow: 8888,
          board: { ...board, version: 8, title: 'Gap healed by snapshot' },
        },
      ],
    });
    flush();
    expect(controller.board()?.version).toBe(8);
    expect(controller.board()?.title).toBe('Gap healed by snapshot');
    expect(controller.timerClock()?.serverNow).toBe(8888);
    expect(connections).toHaveLength(1);

    // 3. A terminal board:deleted inside a mutation clears both the Board and active error even across a version gap
    controller.reportError('Transient error');
    flush();
    expect(controller.errorMessage()).toBe('Transient error');

    connections[0].emit({
      type: 'board:mutation',
      version: 15,
      events: [{ type: 'board:deleted', version: 15 }],
    });
    flush();
    expect(controller.board()).toBeNull();
    expect(controller.errorMessage()).toBeNull();
  });

  it('reconciles 3-Card Group shrink, grandfathered Vote decrement, and dissolve with zero Solid 2.0 diagnostics', async () => {
    const { artifact } = await captureArtifact(
      () => {
        const card1 = makeCard({ id: 'card_1', groupId: 'group_1', votes: 1, myVotes: 1 });
        const card2 = makeCard({ id: 'card_2', groupId: 'group_1', votes: 1, myVotes: 1 });
        const card3 = makeCard({ id: 'card_3', groupId: 'group_1', votes: 0, myVotes: 0 });
        const board = makeBoardView({
          remainingVotes: 3,
          columns: [
            { id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 3 },
            { id: 'col_2', title: 'To Improve', accent: 'rose', position: 1, isActionColumn: false, cardCount: 0 },
          ],
          groups: [
            {
              id: 'group_1',
              columnId: 'col_1',
              title: 'Merged theme',
              redacted: false,
              cardIds: ['card_1', 'card_2', 'card_3'],
              votes: 2,
              myVotes: 2,
              createdAt: 1_760_000_002_000,
            },
          ],
          cards: [card1, card2, card3],
        });
        const { controller, connections, dispose } = mountSession(board);

        try {
          // 1. Ungrouping card_3 emits group:upserted + card:upserted
          connections[0].emit({
            type: 'board:mutation',
            version: 2,
            events: [
              {
                type: 'group:upserted',
                version: 2,
                group: {
                  id: 'group_1',
                  columnId: 'col_1',
                  title: 'Merged theme',
                  redacted: false,
                  cardIds: ['card_1', 'card_2'],
                  votes: 2,
                  myVotes: 2,
                  createdAt: 1_760_000_002_000,
                },
              },
              { type: 'card:upserted', version: 2, card: { ...card3, groupId: null } },
            ],
          });
          flush();

          let current = snapshot(controller.board()!);
          expect(current.groups[0].cardIds).toEqual(['card_1', 'card_2']);
          expect(current.cards.find((c) => c.id === 'card_3')?.groupId).toBeNull();

          // 2. Group -1 removes grandfathered vote on card_2, emitting both group and card vote:updated
          connections[0].emit({
            type: 'board:mutation',
            version: 3,
            events: [
              {
                type: 'vote:updated',
                version: 3,
                targetType: 'group',
                targetId: 'group_1',
                totalVotes: 1,
                myVotes: 1,
                remainingVotes: 4,
              },
              {
                type: 'vote:updated',
                version: 3,
                targetType: 'card',
                targetId: 'card_2',
                totalVotes: 0,
                myVotes: 0,
                remainingVotes: 4,
              },
            ],
          });
          flush();

          // 3. Dissolving the group displays exact remaining Card Votes (card_1: 1, card_2: 0)
          connections[0].emit({
            type: 'board:mutation',
            version: 4,
            events: [
              { type: 'group:dissolved', version: 4, groupId: 'group_1' },
              { type: 'vote:balance', version: 4, remainingVotes: 4 },
            ],
          });
          flush();

          current = snapshot(controller.board()!);
          expect(current.groups).toEqual([]);
          expect(current.cards.find((c) => c.id === 'card_1')).toMatchObject({
            groupId: null,
            votes: 1,
            myVotes: 1,
          });
          expect(current.cards.find((c) => c.id === 'card_2')).toMatchObject({
            groupId: null,
            votes: 0,
            myVotes: 0,
          });
        } finally {
          dispose();
        }
      },
      { scenario: 'board-controller-group-shrink-and-vote-dissolve' },
    );
    expectNoDiagnostics(artifact);
  });

  it('tracks single-source scoped pending state and routes inline vs global errors strictly without double-reporting or Solid 2.0 diagnostics', async () => {
    const { artifact } = await captureArtifact(
      async () => {
        const card = makeCard({
          id: 'card_1',
          columnId: 'col_1',
          groupId: 'group_1',
          isMine: true,
          comments: [
            { id: 'cm_1', cardId: 'card_1', content: 'Note', isMine: true, createdAt: 100 },
          ],
          commentCount: 1,
        });
        const peer = makeCard({ id: 'card_2', columnId: 'col_1', groupId: 'group_1', isMine: true });
        const board = makeBoardView({
          isFacilitator: true,
          groups: [
            {
              id: 'group_1',
              columnId: 'col_1',
              title: 'Theme',
              cardIds: ['card_1', 'card_2'],
              votes: 0,
              myVotes: 0,
              createdAt: 100,
            },
          ],
          cards: [card, peer],
        });
        const { controller, dispatchCommand, dispose } = mountSession(board);
        try {
          // 1. Scoped pending helpers flip true while in flight and false on settle, and inline-error mutations do NOT write global errorMessage.
          const pendingMove = Promise.withResolvers<BoardMutationResponse>();
          dispatchCommand.mockReturnValueOnce(pendingMove.promise);
          const movePromise = controller.moveCard(card.id, 'col_2');
          expect(controller.isCardPending(card.id, 'move')).toBe(true);
          expect(controller.isCardPending(card.id)).toBe(true);
          expect(controller.isCardPending(peer.id)).toBe(false);
          pendingMove.resolve({ ok: false, code: 'VALIDATION_ERROR', message: 'Card move rejected.' });
          await expect(movePromise).resolves.toEqual({ ok: false, message: 'Card move rejected.' });
          flush();
          expect(controller.isCardPending(card.id, 'move')).toBe(false);
          expect(controller.errorMessage()).toBeNull();

          const pendingComment = Promise.withResolvers<BoardMutationResponse>();
          dispatchCommand.mockReturnValueOnce(pendingComment.promise);
          const commentPromise = controller.deleteComment(card.id, 'cm_1');
          expect(controller.isCommentPending(card.id, 'cm_1')).toBe(true);
          expect(controller.isCommentPending(card.id)).toBe(true);
          pendingComment.resolve({ ok: false, code: 'NOT_FOUND', message: 'Comment already removed.' });
          await expect(commentPromise).resolves.toEqual({ ok: false, message: 'Comment already removed.' });
          flush();
          expect(controller.isCommentPending(card.id, 'cm_1')).toBe(false);
          expect(controller.errorMessage()).toBeNull();

          const pendingGroupMove = Promise.withResolvers<BoardMutationResponse>();
          dispatchCommand.mockReturnValueOnce(pendingGroupMove.promise);
          const groupMovePromise = controller.moveCardGroup('group_1', 'col_2');
          expect(controller.isGroupPending('group_1', 'move')).toBe(true);
          pendingGroupMove.resolve({ ok: false, code: 'FORBIDDEN', message: 'Cannot move group.' });
          await expect(groupMovePromise).resolves.toEqual({ ok: false, message: 'Cannot move group.' });
          flush();
          expect(controller.isGroupPending('group_1', 'move')).toBe(false);
          expect(controller.errorMessage()).toBeNull();

          dispatchCommand.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN', message: 'Delete blocked.' });
          await expect(controller.deleteCard(card.id)).resolves.toEqual({ ok: false, message: 'Delete blocked.' });
          dispatchCommand.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN', message: 'Ungroup blocked.' });
          await expect(controller.ungroupCard(card.id)).resolves.toEqual({ ok: false, message: 'Ungroup blocked.' });
          dispatchCommand.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN', message: 'Timer locked.' });
          await expect(controller.changeCountdown({ action: 'start', minutes: 5 })).resolves.toEqual({
            ok: false,
            message: 'Timer locked.',
          });
          flush();
          expect(controller.errorMessage()).toBeNull();

          // 2. Global-banner mutations write errorMessage on failure and clear it on success.
          const pendingColDelete = Promise.withResolvers<BoardMutationResponse>();
          dispatchCommand.mockReturnValueOnce(pendingColDelete.promise);
          const deleteColPromise = controller.deleteColumn('col_2');
          expect(controller.isColumnPending('col_2', 'delete')).toBe(true);
          pendingColDelete.resolve({ ok: false, code: 'VALIDATION_ERROR', message: 'Column cannot be deleted.' });
          await expect(deleteColPromise).resolves.toEqual({ ok: false, message: 'Column cannot be deleted.' });
          flush();
          expect(controller.isColumnPending('col_2', 'delete')).toBe(false);
          expect(controller.errorMessage()).toBe('Column cannot be deleted.');

          dispatchCommand.mockResolvedValueOnce({
            ok: true,
            version: 2,
            events: [{ type: 'board:updated', version: 2, patch: { title: 'Updated' } }],
          });
          await expect(controller.renameBoard('Updated')).resolves.toEqual({ ok: true });
          flush();
          expect(controller.errorMessage()).toBeNull();
        } finally {
          dispose();
        }
      },
      { scenario: 'board-controller-uniform-outcomes-and-pending' },
    );
    expectNoDiagnostics(artifact);
  });
});
