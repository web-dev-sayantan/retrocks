import { commitEventResponse, createRequestEvent, isSafeError } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileBoardUpdate } from '../../lib/board-controller';
import type { BoardCommand } from '../../lib/schemas';
import { parseBoardLiveMessage } from '../../lib/wire-schemas';
import type { NodeBoardStore } from '../adapters/node/sqlite-board-store';
import { setBoardStoreForTests } from '../adapters/runtime';
import { readSseStream } from '../live/sse-test-helper';

const TEST_SECRET = 'test-command-dispatcher-secret-at-least-32-chars-xyz';

async function runRequest<T>(
  request: Request,
  handler: () => Promise<T>,
): Promise<{ result: T; response: Response; cookie: string | undefined }> {
  const event = createRequestEvent(request);
  return provideRequestEvent(event, async () => {
    const result = await handler();
    const response = commitEventResponse(
      new Response('ok', { status: event.response.status ?? 200 }),
      event,
    );
    const cookie = response.headers
      .getSetCookie()
      .filter((c) => c.startsWith('retrocks_session='))
      .at(-1)
      ?.split(';')[0];
    return { result, response, cookie };
  });
}

function readLiveStream(response: Response) {
  return readSseStream(response, parseBoardLiveMessage);
}

let store: NodeBoardStore;

beforeEach(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  vi.resetModules();
  const { createNodeBoardStore } = await import(
    '../adapters/node/sqlite-board-store'
  );
  store = await createNodeBoardStore(':memory:');
  const { setBoardStoreForTests: setStore } = await import(
    '../adapters/runtime'
  );
  setStore(store);
});

afterEach(() => {
  setBoardStoreForTests(null);
  store.close();
  delete process.env.SESSION_SECRET;
});

async function setupBoard(options: Record<string, unknown> = {}) {
  const service = await import('./board-service');
  const actions = await import('../../lib/board-actions');
  const origin = 'https://retrocks.app';

  const created = await runRequest(
    new Request(origin, { method: 'POST' }),
    () => service.createBoardForRequest(options),
  );
  const board = created.result;
  const facilitator = created.cookie;
  if (!facilitator) throw new Error('Expected a Facilitator session cookie');
  const boardUrl = `${origin}/b/${board.id}`;

  const read = (cookie?: string) =>
    runRequest(
      new Request(boardUrl, {
        method: 'GET',
        headers: cookie ? { cookie } : {},
      }),
      () => service.getBoardForRequest(board.id),
    );

  const join = async () => {
    const { cookie } = await read();
    if (!cookie) throw new Error('Expected a Participant session cookie');
    return cookie;
  };

  const participant = await join();
  const otherParticipant = await join();

  const dispatch = (cookie: string, command: unknown, boardId: unknown = board.id) =>
    runRequest(
      new Request(boardUrl, { method: 'POST', headers: { cookie } }),
      () => service.dispatchBoardCommandForRequest(boardId, command),
    );

  const actionDispatch = (
    cookie: string,
    command: Parameters<typeof actions.dispatchBoardCommand>[1],
    boardId = board.id,
  ) =>
    runRequest(
      new Request(boardUrl, { method: 'POST', headers: { cookie } }),
      () => actions.dispatchBoardCommand(boardId, command),
    );

  return {
    board,
    boardUrl,
    origin,
    facilitator,
    participant,
    otherParticipant,
    read,
    dispatch,
    actionDispatch,
    service,
  };
}

describe('Unified Board command dispatcher', () => {
  it('replays HTTP and live updates to the same viewer state as a fresh Board load', async () => {
    const { board, origin, facilitator, participant, read, dispatch } = await setupBoard({
      isBlurred: false,
      voteLimit: 5,
    });
    const { handleLiveRequest } = await import('../live-handler');
    const [firstColumn, secondColumn] = board.columns;
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const streams: ReturnType<typeof readLiveStream>[] = [];

    try {
      const viewers = await Promise.all([facilitator, participant].map(async (cookie) => {
        const stream = readLiveStream(await handleLiveRequest(
          board.id,
          new Request(`${origin}/api/boards/${board.id}/live`, { headers: { cookie } }),
        ));
        streams.push(stream);
        const { board: current } = await stream.until('board:snapshot');
        return { cookie, stream, state: { board: current as typeof board | null } };
      }));

      const change = async (actor: string, command: BoardCommand, elapsed = 1_000) => {
        now += elapsed;
        const { result } = await dispatch(actor, command);
        const snapshot = result.events.find((event) => event.type === 'board:snapshot');
        const actorState = {
          board: structuredClone(viewers.find((viewer) => viewer.cookie === actor)!.state.board),
        };
        const actorOutcome = reconcileBoardUpdate(actorState, board.id, {
          type: 'board:mutation',
          version: result.version,
          lastActiveAt: result.lastActiveAt,
          events: result.events,
        });
        expect(actorOutcome.needsResync).toBe(false);

        await Promise.all(viewers.map(async (viewer) => {
          const live = snapshot
            ? await viewer.stream.until('board:snapshot', (message) => message.version === result.version)
            : await viewer.stream.until('board:mutation', (message) => message.version === result.version);
          const parsed = parseBoardLiveMessage(JSON.stringify(live));
          const liveOutcome = reconcileBoardUpdate(viewer.state, board.id, parsed);
          expect(liveOutcome.needsResync).toBe(false);

          const fresh = (await read(viewer.cookie)).result;
          expect(viewer.state.board).toEqual(fresh);
          if (viewer.cookie === actor) expect(actorState.board).toEqual(fresh);
        }));
        return result.events;
      };

      const [first] = await change(participant, {
        type: 'card:create', columnId: firstColumn.id, content: 'First Card',
      });
      const [second] = await change(facilitator, {
        type: 'card:create', columnId: firstColumn.id, content: 'Second Card',
      });
      const [third] = await change(participant, {
        type: 'card:create', columnId: secondColumn.id, content: 'Card created at the same time',
      }, 0);
      const [fourth] = await change(facilitator, {
        type: 'card:create', columnId: secondColumn.id, content: 'Fourth Card',
      });
      if (first.type !== 'card:upserted' || second.type !== 'card:upserted' ||
          third.type !== 'card:upserted' || fourth.type !== 'card:upserted') {
        throw new Error('Expected new Cards');
      }

      const otherGroup = (await change(facilitator, {
        type: 'group:merge', cardId: third.card.id, targetType: 'card', targetId: fourth.card.id,
      })).find((event) => event.type === 'group:upserted');
      if (!otherGroup) throw new Error('Expected a Card Group');
      const group = (await change(facilitator, {
        type: 'group:merge', cardId: first.card.id, targetType: 'card', targetId: second.card.id,
      }, 0)).find((event) => event.type === 'group:upserted');
      if (!group) throw new Error('Expected a Card Group');
      await change(facilitator, { type: 'group:move', groupId: otherGroup.group.id, targetColumnId: firstColumn.id });
      await change(participant, { type: 'vote:change', targetType: 'group', targetId: group.group.id, delta: 1 });
      await change(participant, { type: 'card:move', cardId: first.card.id, targetColumnId: secondColumn.id });
      await change(facilitator, { type: 'board:set-private-mode', isBlurred: true });
      await change(facilitator, { type: 'voting:configure', blindVoting: true });
      await change(facilitator, { type: 'board:set-private-mode', isBlurred: false });
    } finally {
      await Promise.all(streams.map((stream) => stream.close()));
      clock.mockRestore();
    }
  });

  it('executes core Board and Card commands through the unified server dispatcher and action entry point', async () => {
    const { board, facilitator, participant, read, dispatch, actionDispatch } =
      await setupBoard({ title: 'Initial Retro' });

    const created = await dispatch(participant, {
      type: 'card:create',
      columnId: board.columns[0].id,
      content: '  Ship unified command seam  ',
    });
    expect(created.result.ok).toBe(true);
    const createdEvent = created.result.events[0];
    expect(createdEvent.type).toBe('card:upserted');
    if (createdEvent.type !== 'card:upserted') throw new Error('Expected card:upserted');
    const cardId = createdEvent.card.id;
    expect(cardId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(createdEvent.card).toMatchObject({
      columnId: board.columns[0].id,
      content: 'Ship unified command seam',
      isMine: true,
      isActionItem: false,
    });

    const updated = await actionDispatch(participant, {
      type: 'card:update',
      cardId,
      content: 'Ship unified Board command seam',
    });
    expect(updated.response.status).toBe(200);
    expect(updated.result).toMatchObject({
      ok: true,
      events: [{ type: 'card:upserted', card: { id: cardId, content: 'Ship unified Board command seam' } }],
    });

    const moved = await dispatch(participant, {
      type: 'card:move',
      cardId,
      targetColumnId: board.columns[1].id,
    });
    expect(moved.result.events[0]).toMatchObject({
      type: 'card:upserted',
      card: { id: cardId, columnId: board.columns[1].id },
    });

    const flagged = await dispatch(facilitator, {
      type: 'card:set-action',
      cardId,
      isActionItem: true,
      actionDone: false,
      actionOwner: 'Platform Team',
    });
    expect(flagged.result.events[0]).toMatchObject({
      type: 'card:upserted',
      card: {
        id: cardId,
        isActionItem: true,
        actionDone: false,
        actionOwner: 'Platform Team',
      },
    });

    const renamed = await dispatch(facilitator, {
      type: 'board:rename',
      title: 'Sprint 50 Retro',
      subtitle: 'Architecture deepening',
    });
    expect(renamed.result.events[0]).toMatchObject({
      type: 'board:updated',
      patch: { title: 'Sprint 50 Retro', subtitle: 'Architecture deepening' },
    });

    const timed = await dispatch(facilitator, {
      type: 'timer:update',
      change: { action: 'start', minutes: 5 },
    });
    expect(timed.result.events[0]).toMatchObject({
      type: 'timer:updated',
      timer: { durationMs: 300_000 },
    });

    const deleted = await dispatch(participant, {
      type: 'card:delete',
      cardId,
    });
    expect(deleted.result.events).toContainEqual(
      expect.objectContaining({ type: 'card:deleted', cardId }),
    );

    const snapshot = (await read(facilitator)).result;
    expect(snapshot).toMatchObject({
      title: 'Sprint 50 Retro',
      subtitle: 'Architecture deepening',
      cards: [],
    });
  });

  it('executes Column, Reaction, Comment, Card Group, and Voting commands end-to-end', async () => {
    const { board, facilitator, participant, read, dispatch } = await setupBoard({
      voteLimit: 5,
    });

    // Columns: add, update, reorder, delete
    const addedCol = await dispatch(facilitator, {
      type: 'column:add',
      title: 'Kudos',
      accent: 'violet',
    });
    const addedColEvent = addedCol.result.events[0];
    expect(addedColEvent.type).toBe('column:upserted');
    if (addedColEvent.type !== 'column:upserted') throw new Error('Expected column:upserted');
    const kudosColId = addedColEvent.column.id;
    expect(addedColEvent.column).toMatchObject({
      title: 'Kudos',
      accent: 'violet',
      isActionColumn: false,
    });

    const updatedCol = await dispatch(facilitator, {
      type: 'column:update',
      columnId: kudosColId,
      title: 'Shoutouts',
      accent: 'teal',
    });
    expect(updatedCol.result.events[0]).toMatchObject({
      type: 'column:upserted',
      column: { id: kudosColId, title: 'Shoutouts', accent: 'teal' },
    });

    const reorderedIds = [
      kudosColId,
      board.columns[0].id,
      board.columns[1].id,
      board.columns[2].id,
    ];
    const reordered = await dispatch(facilitator, {
      type: 'column:reorder',
      columnIds: reorderedIds,
    });
    expect(reordered.result.events[0]).toMatchObject({
      type: 'columns:reordered',
      columnIds: reorderedIds,
    });

    const deletedCol = await dispatch(facilitator, {
      type: 'column:delete',
      columnId: kudosColId,
    });
    expect(deletedCol.result.events[0]).toMatchObject({
      type: 'column:deleted',
      columnId: kudosColId,
    });

    // Cards, Reactions, and Comments
    const createCard = async (content: string, cookie = participant) => {
      const res = await dispatch(cookie, {
        type: 'card:create',
        columnId: board.columns[0].id,
        content,
      });
      const event = res.result.events[0];
      if (event?.type !== 'card:upserted') throw new Error('Expected card:upserted');
      return event.card.id;
    };

    const cardA = await createCard('CI speed');
    const cardB = await createCard('Build caching');
    const cardC = await createCard('Test parallelization');

    const reacted = await dispatch(participant, {
      type: 'reaction:toggle',
      cardId: cardA,
      emoji: '🎉',
    });
    expect(reacted.result.events[0]).toMatchObject({
      type: 'reaction:updated',
      cardId: cardA,
      counts: { '🎉': 1 },
      myReactions: ['🎉'],
    });

    const commented = await dispatch(participant, {
      type: 'comment:create',
      cardId: cardA,
      content: 'Great idea',
    });
    const commentEvent = commented.result.events[0];
    expect(commentEvent.type).toBe('comment:created');
    if (commentEvent.type !== 'comment:created') throw new Error('Expected comment:created');
    const commentId = commentEvent.comment.id;

    const deletedComment = await dispatch(participant, {
      type: 'comment:delete',
      cardId: cardA,
      commentId,
    });
    expect(deletedComment.result.events[0]).toMatchObject({
      type: 'comment:deleted',
      cardId: cardA,
      commentId,
    });

    // Card Groups: merge (card -> card, card -> group), rename, move, ungroup, dissolve
    const merged = await dispatch(facilitator, {
      type: 'group:merge',
      cardId: cardA,
      targetType: 'card',
      targetId: cardB,
    });
    const groupEvent = merged.result.events.find((e) => e.type === 'group:upserted');
    if (groupEvent?.type !== 'group:upserted') throw new Error('Expected group:upserted');
    const groupId = groupEvent.group.id;
    expect(groupEvent.group.cardIds).toEqual(expect.arrayContaining([cardA, cardB]));

    const addedToGroup = await dispatch(facilitator, {
      type: 'group:merge',
      cardId: cardC,
      targetType: 'group',
      targetId: groupId,
    });
    expect(addedToGroup.result.events).toContainEqual(
      expect.objectContaining({
        type: 'group:upserted',
        group: expect.objectContaining({
          id: groupId,
          cardIds: expect.arrayContaining([cardA, cardB, cardC]),
        }),
      }),
    );

    const renamedGroup = await dispatch(facilitator, {
      type: 'group:rename',
      groupId,
      title: 'CI & Build Velocity',
    });
    expect(renamedGroup.result.events[0]).toMatchObject({
      type: 'group:upserted',
      group: { id: groupId, title: 'CI & Build Velocity' },
    });

    const movedGroup = await dispatch(facilitator, {
      type: 'group:move',
      groupId,
      targetColumnId: board.columns[1].id,
    });
    expect(movedGroup.result.events[0]).toMatchObject({
      type: 'group:upserted',
      group: { id: groupId, columnId: board.columns[1].id },
    });

    // Voting: changeVote, configure, reset
    const voted = await dispatch(participant, {
      type: 'vote:change',
      targetType: 'group',
      targetId: groupId,
      delta: 1,
    });
    expect(voted.result.events[0]).toMatchObject({
      type: 'vote:updated',
      targetType: 'group',
      targetId: groupId,
      totalVotes: 1,
      myVotes: 1,
      remainingVotes: 4,
    });

    const configured = await dispatch(facilitator, {
      type: 'voting:configure',
      voteLimit: 7,
      maxVotesPerCard: 1,
      allowParticipantGroup: true,
    });
    expect(configured.result.events[0]).toMatchObject({
      type: 'board:snapshot',
      board: { voteLimit: 7, maxVotesPerCard: 1, allowParticipantGroup: true },
    });

    const reset = await dispatch(facilitator, { type: 'voting:reset' });
    expect(reset.result.events[0]).toMatchObject({
      type: 'board:snapshot',
      board: { remainingVotes: 7 },
    });

    // Ungroup & dissolve
    const ungrouped = await dispatch(participant, {
      type: 'group:ungroup',
      cardId: cardC,
    });
    expect(ungrouped.result.events).toContainEqual(
      expect.objectContaining({
        type: 'card:upserted',
        card: expect.objectContaining({ id: cardC, groupId: null }),
      }),
    );

    const dissolved = await dispatch(facilitator, {
      type: 'group:dissolve',
      groupId,
    });
    expect(dissolved.result.events).toContainEqual(
      expect.objectContaining({ type: 'group:dissolved', groupId }),
    );

    const snapshot = (await read(participant)).result;
    expect(snapshot?.groups).toEqual([]);
    expect(snapshot?.remainingVotes).toBe(7);
  });

  it('rejects malformed payloads and invalid or missing Board IDs with structured domain errors', async () => {
    const { board, facilitator, participant, dispatch, actionDispatch, service } =
      await setupBoard();

    // Invalid Board ID -> VALIDATION_ERROR (400)
    const badBoardId = await actionDispatch(
      facilitator,
      { type: 'voting:reset' },
      'bad!id',
    );
    expect(badBoardId.response.status).toBe(400);
    expect(badBoardId.result).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
    });

    // Missing Board (valid ID format) -> BOARD_NOT_FOUND (404)
    const missingBoard = await actionDispatch(
      facilitator,
      { type: 'voting:reset' },
      'nonexistent_board_1234',
    );
    expect(missingBoard.response.status).toBe(404);
    expect(missingBoard.result).toMatchObject({
      ok: false,
      code: 'BOARD_NOT_FOUND',
    });

    // Malformed commands -> VALIDATION_ERROR (safe-branded BoardDomainError)
    const malformedCommands: unknown[] = [
      null,
      'not-an-object',
      { type: 'unknown:command' },
      { type: 'board:rename', title: '   ' },
      { type: 'card:create', columnId: board.columns[0].id, content: '' },
      { type: 'card:set-action', cardId: 'card_1' },
      { type: 'reaction:toggle', cardId: 'card_1', emoji: '🙃' },
      { type: 'voting:configure', voteLimit: 2.5 },
      { type: 'voting:configure', voteLimit: 0 },
      { type: 'timer:update', change: { action: 'start', minutes: 0 } },
      { type: 'column:reorder', columnIds: [] },
    ];

    for (const badCommand of malformedCommands) {
      try {
        await dispatch(participant, badCommand);
        expect.unreachable(`Expected VALIDATION_ERROR for ${JSON.stringify(badCommand)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(service.BoardDomainError);
        expect((err as InstanceType<typeof service.BoardDomainError>).code).toBe(
          'VALIDATION_ERROR',
        );
        expect(isSafeError(err)).toBe(true);
      }
    }

    // Structured ActionError via 'use server' action entry point
    const badAction = await actionDispatch(
      participant,
      { type: 'board:rename', title: '   ' } as BoardCommand,
    );
    expect(badAction.response.status).toBe(400);
    expect(badAction.result).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
  });

  it('enforces Participant vs Facilitator capabilities and Locked Board guards (ADR-0001)', async () => {
    const {
      board,
      facilitator,
      participant,
      otherParticipant,
      dispatch,
      actionDispatch,
    } = await setupBoard();

    // Create two Cards authored by `participant`
    const cardRes1 = await dispatch(participant, {
      type: 'card:create',
      columnId: board.columns[0].id,
      content: 'Participant Card 1',
    });
    const card1 =
      cardRes1.result.events[0].type === 'card:upserted'
        ? cardRes1.result.events[0].card.id
        : '';
    const cardRes2 = await dispatch(participant, {
      type: 'card:create',
      columnId: board.columns[0].id,
      content: 'Participant Card 2',
    });
    const card2 =
      cardRes2.result.events[0].type === 'card:upserted'
        ? cardRes2.result.events[0].card.id
        : '';

    const commentRes = await dispatch(participant, {
      type: 'comment:create',
      cardId: card1,
      content: 'Author comment',
    });
    const commentId =
      commentRes.result.events[0].type === 'comment:created'
        ? commentRes.result.events[0].comment.id
        : '';

    // Participant rejected on Facilitator-only commands
    const facilitatorOnlyCommands: BoardCommand[] = [
      { type: 'board:rename', title: 'Hijacked' },
      { type: 'board:set-private-mode', isBlurred: true },
      { type: 'board:set-lock', isLocked: true },
      { type: 'board:delete' },
      { type: 'timer:update', change: { action: 'start', minutes: 5 } },
      { type: 'column:add', title: 'Sneaky' },
      { type: 'column:update', columnId: board.columns[0].id, title: 'Sneaky' },
      { type: 'column:reorder', columnIds: board.columns.map((c) => c.id) },
      { type: 'column:delete', columnId: board.columns[0].id },
      { type: 'voting:configure', voteLimit: 10 },
      { type: 'voting:reset' },
      { type: 'group:merge', cardId: card1, targetType: 'card', targetId: card2 },
    ];

    for (const command of facilitatorOnlyCommands) {
      const res = await actionDispatch(participant, command);
      expect(res.response.status).toBe(403);
      expect(res.result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    }

    // Another Participant cannot edit, move, delete someone else's Card or Comment
    for (const command of [
      { type: 'card:update', cardId: card1, content: 'Tampered' },
      { type: 'card:move', cardId: card1, targetColumnId: board.columns[1].id },
      { type: 'card:delete', cardId: card1 },
      { type: 'comment:delete', cardId: card1, commentId },
    ] satisfies BoardCommand[]) {
      await expect(dispatch(otherParticipant, command)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }

    // Lock the Board -> Participant content writes and delete return BOARD_LOCKED (403)
    await dispatch(facilitator, { type: 'board:set-lock', isLocked: true });
    for (const command of [
      { type: 'card:create', columnId: board.columns[0].id, content: 'Blocked' },
      { type: 'board:delete' },
    ] satisfies BoardCommand[]) {
      const res = await actionDispatch(participant, command);
      expect(res.response.status).toBe(403);
      expect(res.result).toMatchObject({ ok: false, code: 'BOARD_LOCKED' });
    }

    // Facilitator can still unlock the Board
    const unlocked = await dispatch(facilitator, {
      type: 'board:set-lock',
      isLocked: false,
    });
    expect(unlocked.result.events[0]).toMatchObject({
      type: 'board:updated',
      patch: { isLocked: false },
    });
  });

  it('enforces Private Mode and Blind Voting redaction and publishes live SSE events including board:delete', async () => {
    const { board, origin, facilitator, participant, read, dispatch } =
      await setupBoard({ isBlurred: true, voteLimit: 5 });
    const { handleLiveRequest } = await import('../live-handler');
    const liveUrl = `${origin}/api/boards/${board.id}/live`;
    const streams: ReturnType<typeof readLiveStream>[] = [];

    try {
      const [participantStream, facilitatorStream] = await Promise.all(
        [participant, facilitator].map(async (cookie) => {
          const stream = readLiveStream(
            await handleLiveRequest(
              board.id,
              new Request(liveUrl, { headers: { cookie } }),
            ),
          );
          streams.push(stream);
          await stream.until('board:snapshot');
          return stream;
        }),
      );

      // Private Mode: Participant creates a Card -> author sees full text, Facilitator sees redacted
      const secretText = 'Confidential sprint feedback';
      const created = await dispatch(participant, {
        type: 'card:create',
        columnId: board.columns[0].id,
        content: secretText,
      });
      const createdEvent = created.result.events[0];
      if (createdEvent.type !== 'card:upserted') throw new Error('Expected card:upserted');
      const cardId = createdEvent.card.id;
      expect(createdEvent.card).toMatchObject({
        content: secretText,
        isMine: true,
        redacted: false,
      });

      const [participantLiveCreate, facilitatorLiveCreate] = await Promise.all([
        participantStream.until('board:mutation'),
        facilitatorStream.until('board:mutation'),
      ]);
      expect(participantLiveCreate).toMatchObject({
        version: created.result.version,
        events: [{ type: 'card:upserted', card: { content: secretText, isMine: true, redacted: false } }],
      });
      expect(facilitatorLiveCreate).toMatchObject({
        version: created.result.version,
        events: [{ type: 'card:upserted', card: { content: '', isMine: false, redacted: true } }],
      });
      expect(JSON.stringify(facilitatorLiveCreate)).not.toContain(secretText);

      // Facilitator cannot edit Participant's redacted Card while Private Mode is on
      await expect(
        dispatch(facilitator, {
          type: 'card:update',
          cardId,
          content: 'Attempted overwrite',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // Reveal Private Mode -> both streams receive unredacted snapshot
      const revealed = await dispatch(facilitator, {
        type: 'board:set-private-mode',
        isBlurred: false,
      });
      const revealFrames = await Promise.all([
        participantStream.until('board:snapshot', (m) => m.version === revealed.result.version),
        facilitatorStream.until('board:snapshot', (m) => m.version === revealed.result.version),
      ]);
      for (const frame of revealFrames) {
        expect(frame.board.isBlurred).toBe(false);
        expect(frame.board.cards).toContainEqual(
          expect.objectContaining({ id: cardId, content: secretText, redacted: false }),
        );
      }

      // Blind Voting: enable blind voting and cast Votes -> totals redacted (null), own counts intact
      const blindOn = await dispatch(facilitator, {
        type: 'voting:configure',
        blindVoting: true,
      });
      await Promise.all([
        participantStream.until('board:snapshot', (m) => m.version === blindOn.result.version),
        facilitatorStream.until('board:snapshot', (m) => m.version === blindOn.result.version),
      ]);

      const participantVote = await dispatch(participant, {
        type: 'vote:change',
        targetType: 'card',
        targetId: cardId,
        delta: 1,
      });
      expect(participantVote.result.events[0]).toMatchObject({
        type: 'vote:updated',
        totalVotes: null,
        myVotes: 1,
        remainingVotes: 4,
      });
      const [participantLiveVote, facilitatorLiveVote] = await Promise.all([
        participantStream.until('board:mutation', (m) => m.version === participantVote.result.version),
        facilitatorStream.until('board:mutation', (m) => m.version === participantVote.result.version),
      ]);
      expect(participantLiveVote.events[0]).toMatchObject({
        type: 'vote:updated',
        totalVotes: null,
        myVotes: 1,
        remainingVotes: 4,
      });
      expect(facilitatorLiveVote.events[0]).toMatchObject({
        type: 'vote:updated',
        totalVotes: null,
        myVotes: 0,
        remainingVotes: 5,
      });

      // Reveal Blind Voting -> aggregate totals become visible
      const blindOff = await dispatch(facilitator, {
        type: 'voting:configure',
        blindVoting: false,
      });
      const [participantBlindOff, facilitatorBlindOff] = await Promise.all([
        participantStream.until('board:snapshot', (m) => m.version === blindOff.result.version),
        facilitatorStream.until('board:snapshot', (m) => m.version === blindOff.result.version),
      ]);
      expect(participantBlindOff.board.cards[0]).toMatchObject({ votes: 1, myVotes: 1 });
      expect(facilitatorBlindOff.board.cards[0]).toMatchObject({ votes: 1, myVotes: 0 });

      // Delete Board via unified command -> broadcasts board:deleted & purges storage
      const deleted = await dispatch(facilitator, { type: 'board:delete' });
      expect(deleted.result).toMatchObject({
        ok: true,
        events: [{ type: 'board:deleted', version: deleted.result.version }],
      });
      const deletedFrames = await Promise.all([
        participantStream.until('board:deleted'),
        facilitatorStream.until('board:deleted'),
      ]);
      expect(deletedFrames).toEqual([
        { type: 'board:deleted', version: deleted.result.version },
        { type: 'board:deleted', version: deleted.result.version },
      ]);

      expect((await read(participant)).result).toBeNull();
    } finally {
      await Promise.all(streams.map((stream) => stream.close()));
    }
  });
});
