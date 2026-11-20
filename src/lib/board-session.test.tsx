import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { createRoot, createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardWorkspaceActions } from './board-actions';
import type { BoardLiveMessage } from './board-live-protocol';
import type { BoardLiveTransport } from './board-live';
import { createBoardSession, type BoardSession } from './board-session';
import {
  createFakeActions,
  makeBoardView,
  makeCard,
} from './board-fixtures';
import type { BoardMutationResponse, BoardViewDTO } from './board-types';

// The controller seam under test: one reactive session owning the Board store,
// live stream application, server clock, and mutation handlers. No workspace
// DOM is rendered — the createFakeActions double is the server.

interface FakeConnection {
  path: string;
  closed: boolean;
  emit(message: BoardLiveMessage): void;
  fail(): void;
}

function createFakeLiveTransport(): {
  transport: BoardLiveTransport;
  connections: FakeConnection[];
} {
  const connections: FakeConnection[] = [];
  const transport: BoardLiveTransport = {
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

interface SessionHarness {
  session: BoardSession;
  setBoardProp: (board: BoardViewDTO | null) => void;
  connections: FakeConnection[];
  actions: BoardWorkspaceActions;
  spies: Record<keyof BoardWorkspaceActions, ReturnType<typeof vi.fn>>;
  dispose: () => void;
}

const mounted: SessionHarness[] = [];

function mountSession(initialBoard: BoardViewDTO | null): SessionHarness {
  const { transport, connections } = createFakeLiveTransport();
  const { actions, spies } = createFakeActions(initialBoard ?? makeBoardView());
  let harness!: SessionHarness;
  const dispose = createRoot((disposeRoot) => {
    const [boardProp, setBoardProp] = createSignal<BoardViewDTO | null>(initialBoard);
    const session = createBoardSession({
      board: boardProp,
      actions: () => actions,
      liveTransport: transport,
    });
    harness = { session, setBoardProp, connections, actions, spies, dispose: disposeRoot };
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
});

describe('createBoardSession', () => {
  it('seeds the store from the route snapshot and reconciles newer snapshots through the prop feed', () => {
    const board = makeBoardView({ title: 'Seed title' });
    const { session, setBoardProp } = mountSession(board);

    expect(session.board()?.title).toBe('Seed title');

    setBoardProp({ ...board, version: 2, title: 'Fresh title' });
    flush();
    expect(session.board()?.title).toBe('Fresh title');
    expect(session.board()?.version).toBe(2);

    // Stale route snapshots never regress the store.
    setBoardProp({ ...board, version: 1, title: 'Stale title' });
    flush();
    expect(session.board()?.title).toBe('Fresh title');

    // Same version with the same facilitator is a re-render, not an update.
    setBoardProp({ ...board, version: 2, title: 'Re-render title' });
    flush();
    expect(session.board()?.title).toBe('Fresh title');
  });

  it('applies live server snapshots, syncs the server clock, and skips stale ones', () => {
    const board = makeBoardView();
    const { session, connections } = mountSession(board);

    expect(connections).toHaveLength(1);
    expect(session.isLive()).toBe(false);

    connections[0].emit({
      type: 'board:snapshot',
      version: 3,
      serverNow: 4242,
      board: { ...board, version: 3, title: 'Live title' },
    });
    flush();

    expect(session.board()?.title).toBe('Live title');
    expect(session.board()?.version).toBe(3);
    expect(session.isLive()).toBe(true);
    expect(session.timerClock()?.serverNow).toBe(4242);
    expect(session.nowMs()).toBe(4242);

    connections[0].emit({ type: 'presence:count', count: 7 });
    flush();
    expect(session.onlineCount()).toBe(7);

    // A stale snapshot must not regress the store or the clock.
    connections[0].emit({
      type: 'board:snapshot',
      version: 2,
      serverNow: 1111,
      board: { ...board, version: 2, title: 'Stale title' },
    });
    flush();
    expect(session.board()?.title).toBe('Live title');
    expect(session.board()?.version).toBe(3);
    expect(session.timerClock()?.serverNow).toBe(4242);
  });

  it('applies live mutation events at the next version, ignores stale ones, and resyncs on a version gap', () => {
    const card = makeCard({ id: 'card_gap', content: 'Live card' });
    const board = makeBoardView({ cards: [card] });
    const { session, connections } = mountSession(board);

    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      events: [
        { type: 'card:upserted', version: 2, card: { ...card, content: 'Edited live' } },
      ],
    });
    flush();
    expect(session.board()?.version).toBe(2);
    expect(session.board()?.cards[0]?.content).toBe('Edited live');

    // Duplicate (stale) delivery: ignored, no reconnect.
    connections[0].emit({
      type: 'board:mutation',
      version: 2,
      events: [
        { type: 'card:upserted', version: 2, card: { ...card, content: 'Ignored' } },
      ],
    });
    flush();
    expect(session.board()?.cards[0]?.content).toBe('Edited live');
    expect(connections).toHaveLength(1);

    // A gap (version > current + 1) drops the delta and reopens the stream.
    connections[0].emit({
      type: 'board:mutation',
      version: 9,
      events: [
        { type: 'card:upserted', version: 9, card: { ...card, content: 'From the gap' } },
      ],
    });
    flush();
    expect(session.board()?.version).toBe(2);
    expect(session.board()?.cards[0]?.content).toBe('Edited live');
    expect(connections[0].closed).toBe(true);
    expect(connections).toHaveLength(2);
  });

  it('clears the session board and closes the stream on a live board:deleted', () => {
    const board = makeBoardView();
    const { session, connections } = mountSession(board);

    connections[0].emit({ type: 'board:deleted', version: 2 });
    flush();

    expect(session.board()).toBeNull();
    expect(connections[0].closed).toBe(true);
    expect(connections).toHaveLength(1);
  });

  it('creates Cards optimistically, reconciles on success, and rolls back on failure', async () => {
    const board = makeBoardView({ cards: [], columns: [{ id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 0 }] });
    const { session, spies } = mountSession(board);

    const serverCard = makeCard({ id: 'card_server', columnId: 'col_1', content: 'Hello' });
    spies.createCard.mockResolvedValueOnce({
      ok: true,
      version: 2,
      events: [{ type: 'card:upserted', version: 2, card: serverCard }],
    });

    const created = session.createCard('col_1', 'Hello');
    flush();
    const optimistic = session.board()?.cards ?? [];
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0].id.startsWith('optimistic:')).toBe(true);
    expect(optimistic[0].isMine).toBe(true);
    expect(session.board()?.columns[0]?.cardCount).toBe(1);
    expect(spies.createCard).toHaveBeenCalledWith({
      boardId: board.id,
      columnId: 'col_1',
      content: 'Hello',
    });

    await created;
    flush();
    expect(session.board()?.cards.map((card) => card.id)).toEqual(['card_server']);
    expect(session.board()?.version).toBe(2);
    expect(session.board()?.columns[0]?.cardCount).toBe(1);

    spies.createCard.mockResolvedValueOnce({
      ok: false,
      code: 'LIMIT_EXCEEDED',
      message: 'Board card limit reached.',
    });
    const failure = session.createCard('col_1', 'Second');
    flush();
    expect(session.board()?.cards).toHaveLength(2);
    const message = await failure;
    flush();
    expect(message).toBe('Board card limit reached.');
    expect(session.board()?.cards.map((card) => card.id)).toEqual(['card_server']);
    expect(session.board()?.columns[0]?.cardCount).toBe(1);
  });

  it('toggles Reactions optimistically and inverts the delta on failure', async () => {
    const card = makeCard({ id: 'card_react', reactions: { '👍': 1 }, myReactions: [] });
    const board = makeBoardView({ cards: [card] });
    const { session, spies } = mountSession(board);

    spies.toggleReaction.mockResolvedValueOnce({
      ok: true,
      version: 2,
      events: [{ type: 'reaction:updated', version: 2, cardId: card.id, counts: { '👍': 2 }, myReactions: ['👍'] }],
    });
    const added = session.toggleReaction(card.id, '👍');
    flush();
    expect(session.board()?.cards[0]?.reactions['👍']).toBe(2);
    expect(session.board()?.cards[0]?.myReactions).toEqual(['👍']);
    await added;
    flush();
    expect(session.board()?.cards[0]?.reactions['👍']).toBe(2);

    spies.toggleReaction.mockResolvedValueOnce({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Slow down reactions.',
    });
    const removed = session.toggleReaction(card.id, '👍');
    flush();
    expect(session.board()?.cards[0]?.reactions['👍']).toBe(1);
    expect(session.board()?.cards[0]?.myReactions).toEqual([]);
    const message = await removed;
    flush();
    expect(message).toBe('Slow down reactions.');
    expect(session.board()?.cards[0]?.reactions['👍']).toBe(2);
    expect(session.board()?.cards[0]?.myReactions).toEqual(['👍']);
  });

  it('serializes Votes through pendingVote and surfaces optimistic balances', async () => {
    const card = makeCard({ id: 'card_v', votes: 0, myVotes: 0 });
    const board = makeBoardView({ cards: [card], isFacilitator: false, voteLimit: 5, remainingVotes: 5 });
    const { session, spies } = mountSession(board);

    const pending = Promise.withResolvers<BoardMutationResponse>();
    spies.changeVote.mockReturnValueOnce(pending.promise);

    const votePromise = session.changeVote('card', card.id, 1);
    flush();
    const voting = session.voting();
    expect(voting.pending).toBe(true);
    expect(voting.optimisticVote).toMatchObject({ targetId: card.id, delta: 1 });
    expect(voting.remainingVotes).toBe(4);

    // A second cast while one is in flight is dropped, not queued.
    void session.changeVote('card', card.id, 1);
    flush();
    expect(spies.changeVote.mock.calls).toHaveLength(1);

    pending.resolve({
      ok: true,
      version: 2,
      events: [{ type: 'vote:updated', version: 2, targetType: 'card', targetId: card.id, totalVotes: 1, myVotes: 1, remainingVotes: 4 }],
    });
    await votePromise;
    flush();
    expect(session.voting().pending).toBe(false);
    expect(session.board()?.cards[0]?.myVotes).toBe(1);
    expect(session.voting().remainingVotes).toBe(4);

    spies.changeVote.mockRejectedValueOnce(new Error('offline'));
    await session.changeVote('card', card.id, -1);
    flush();
    expect(session.errorMessage()).toBe('Could not update your Vote. Try again.');
    session.clearError();
    flush();
    expect(session.errorMessage()).toBeNull();
  });

  it('funnels mutation responses through the versioned-events seam', async () => {
    const card = makeCard({ id: 'card_m', columnId: 'col_1' });
    const board = makeBoardView({ cards: [card] });
    const { session, spies } = mountSession(board);

    const moved = await session.moveCard(card.id, 'col_2');
    flush();
    expect(moved).toBe(true);
    expect(spies.moveCard).toHaveBeenCalledWith({
      boardId: board.id,
      cardId: card.id,
      targetColumnId: 'col_2',
    });
    expect(session.board()?.cards[0]?.columnId).toBe('col_2');
    expect(session.board()?.version).toBe(2);

    const locked = makeBoardView({ isLocked: true, isFacilitator: false, cards: [card] });
    const lockedSession = mountSession(locked).session;
    const rejected = await lockedSession.updateCard(card.id, 'Nope');
    expect(rejected).toBe('This Card can no longer be edited.');
  });

  it('clears the board when the current Board is deleted', async () => {
    const board = makeBoardView();
    const { session } = mountSession(board);

    const message = await session.deleteCurrentBoard();
    flush();
    expect(message).toBeNull();
    expect(session.board()).toBeNull();
  });

  it('applies countdown changes and syncs the server clock from timer events', async () => {
    const board = makeBoardView();
    const { session, spies } = mountSession(board);

    spies.updateTimer.mockResolvedValueOnce({
      ok: true,
      version: 2,
      events: [{
        type: 'timer:updated',
        version: 2,
        serverNow: 9090,
        timer: { endsAt: 20000, remainingMs: 60000, durationMs: 60000 },
      }],
    });
    const response = await session.changeCountdown(board.id, { action: 'start', minutes: 1 });
    flush();
    expect(response.ok).toBe(true);
    expect(session.board()?.timer.remainingMs).toBe(60000);
    expect(session.timerClock()?.serverNow).toBe(9090);
  });

  it('keeps live updates, snapshot reconciliation, and mutations free of Solid 2.0 diagnostics', async () => {
    const { artifact } = await captureArtifact(
      async () => {
        const card = makeCard({ id: 'card_diag' });
        const board = makeBoardView({ cards: [card] });
        const { session, setBoardProp, connections, spies } = mountSession(board);

        connections[0].emit({
          type: 'board:mutation',
          version: 2,
          events: [{ type: 'vote:updated', version: 2, targetType: 'card', targetId: card.id, totalVotes: 3, myVotes: 1, remainingVotes: 4 }],
        });
        flush();
        expect(session.board()?.cards[0]?.myVotes).toBe(1);

        setBoardProp({ ...board, version: 3, title: 'Reconciled' });
        flush();
        expect(session.board()?.title).toBe('Reconciled');

        spies.toggleReaction.mockResolvedValueOnce({
          ok: true,
          version: 4,
          events: [{ type: 'reaction:updated', version: 4, cardId: card.id, counts: { '🎉': 1 }, myReactions: ['🎉'] }],
        });
        await session.toggleReaction(card.id, '🎉');
        flush();
        expect(session.board()?.cards[0]?.myReactions).toEqual(['🎉']);
      },
      { scenario: 'board-session-live-and-mutations' },
    );
    expectNoDiagnostics(artifact);
  });
});
