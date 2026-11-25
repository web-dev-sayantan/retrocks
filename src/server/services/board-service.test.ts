import {
  commitEventResponse,
  createRequestEvent,
  isSafeError,
} from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NodeBoardStore } from '../adapters/node/sqlite-board-store';
import { setBoardStoreForTests } from '../adapters/runtime';
import { decryptFacilitatorToken, hashTokenWithSalt } from '../crypto';
import {
  createInMemoryRateLimiter,
  resetDefaultRateLimiterForTests,
  setBoardCreateRateLimiterForTests,
} from '../rate-limit';

const TEST_SECRET = 'test-session-secret-with-at-least-32-chars-abc123';

async function runRequest<T>(
  request: Request,
  handler: () => Promise<T>,
): Promise<{ result: T; response: Response }> {
  const event = createRequestEvent(request);
  return provideRequestEvent(event, async () => {
    const result = await handler();
    const response = commitEventResponse(
      new Response('ok', { status: event.response.status ?? 200 }),
      event,
    );
    return { result, response };
  });
}

function extractSessionCookie(response: Response): string {
  const cookies = response.headers
    .getSetCookie()
    .filter((c) => c.startsWith('retrocks_session='));
  expect(cookies.length).toBeGreaterThan(0);
  return cookies[cookies.length - 1].split(';')[0];
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
  const {
    resetDefaultRateLimiterForTests: resetLimiter,
    resetDefaultWriteRateLimiterForTests: resetWriteLimiter,
    setBoardCreateRateLimiterForTests: setLimiter,
    setBoardWriteRateLimiterForTests: setWriteLimiter,
  } = await import('../rate-limit');
  resetLimiter();
  setLimiter(null);
  resetWriteLimiter();
  setWriteLimiter(null);
});

afterEach(async () => {
  setBoardStoreForTests(null);
  setBoardCreateRateLimiterForTests(null);
  resetDefaultRateLimiterForTests();
  const {
    resetDefaultWriteRateLimiterForTests: resetWriteLimiter,
    setBoardWriteRateLimiterForTests: setWriteLimiter,
  } = await import('../rate-limit');
  setWriteLimiter(null);
  resetWriteLimiter();
  store.close();
  delete process.env.SESSION_SECRET;
});

describe('BoardService (Board creation, lazy cookie minting & SSR reads)', () => {
  it('creates a Board with Standard Retro defaults, AES-256-GCM facilitator secret, and Facilitator cookie', async () => {
    const service = await import('./board-service');

    const created = await runRequest(
      new Request('https://retrocks.app/', { method: 'POST' }),
      () => service.createBoardForRequest({}),
    );

    const dto = created.result;
    expect(dto.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(dto.title).toMatch(/^Sprint Retrospective — [A-Z][a-z]{2} \d{1,2}$/);
    expect(dto.templateId).toBe('standard');
    expect(dto.isFacilitator).toBe(true);
    expect(dto.voteLimit).toBe(5);
    expect(dto.maxVotesPerCard).toBeNull();
    expect(dto.isBlurred).toBe(false);
    expect(dto.retentionDays).toBe(90);
    expect(dto.columns.map((c) => c.title)).toEqual([
      'Went Well',
      'To Improve',
      'Action Items',
    ]);
    expect(dto.columns[2].isActionColumn).toBe(true);

    // Facilitator token is stored both hashed and AES-256-GCM encrypted at rest
    const raw = await store.getBoardSnapshot(dto.id);
    expect(raw).not.toBeNull();
    const decrypted = await decryptFacilitatorToken(
      raw!.board.facilitatorTokenEncrypted,
      dto.id,
      [TEST_SECRET],
    );
    expect(decrypted).not.toBeNull();
    const expectedHash = await hashTokenWithSalt(
      decrypted!.token,
      raw!.board.tokenSalt,
    );
    expect(raw!.board.facilitatorTokenHash).toBe(expectedHash);

    // DTO never leaks stored hashes, salts, or ciphertexts
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain(raw!.board.facilitatorTokenHash);
    expect(serialized).not.toContain(raw!.board.facilitatorTokenEncrypted);
    expect(serialized).not.toContain(raw!.board.tokenSalt);
    expect(serialized).not.toContain(decrypted!.token);

    // Creator receives signed HttpOnly cookie granting Facilitator access
    const creatorCookie = extractSessionCookie(created.response);
    const facilitatorRead = await runRequest(
      new Request(`https://retrocks.app/b/${dto.id}`, {
        headers: { cookie: creatorCookie },
      }),
      () => service.getBoardForRequest(dto.id),
    );
    expect(facilitatorRead.result?.isFacilitator).toBe(true);
  });

  it('creates a Custom Board with custom Columns and advanced options', async () => {
    const service = await import('./board-service');

    const { result } = await runRequest(
      new Request('https://retrocks.app/', { method: 'POST' }),
      () =>
        service.createBoardForRequest({
          title: 'Q4 Architecture Review',
          subtitle: 'Platform & SRE',
          templateId: 'custom',
          columns: [
            { title: 'Wins', accent: 'teal', isActionColumn: false },
            { title: 'Risks', accent: 'coral', isActionColumn: false },
            { title: 'Next Steps', accent: 'violet', isActionColumn: true },
          ],
          voteLimit: 10,
          maxVotesPerCard: 1,
          isBlurred: true,
          retentionDays: 180,
        }),
    );

    expect(result.title).toBe('Q4 Architecture Review');
    expect(result.subtitle).toBe('Platform & SRE');
    expect(result.voteLimit).toBe(10);
    expect(result.maxVotesPerCard).toBe(1);
    expect(result.isBlurred).toBe(true);
    expect(result.retentionDays).toBe(180);
    expect(result.columns).toHaveLength(3);
    expect(result.columns[2]).toMatchObject({
      title: 'Next Steps',
      accent: 'violet',
      isActionColumn: true,
    });
  });

  it('lazily mints an anonymous Participant cookie on first GET /b/:id without granting Facilitator', async () => {
    const service = await import('./board-service');

    const created = await runRequest(
      new Request('https://retrocks.app/', { method: 'POST' }),
      () => service.createBoardForRequest({ title: 'Team Sync' }),
    );
    const boardId = created.result.id;

    // Unauthenticated Participant visits /b/:id
    const visit = await runRequest(
      new Request(`http://localhost:3002/b/${boardId}`),
      () => service.getBoardForRequest(boardId),
    );
    expect(visit.result?.id).toBe(boardId);
    expect(visit.result?.isFacilitator).toBe(false);

    // Cookie was minted lazily on GET /b/:id (without Secure on localhost HTTP)
    const setCookies = visit.response.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toContain('retrocks_session=');
    expect(setCookies[0]).toContain('HttpOnly');
    expect(setCookies[0]).not.toContain('Secure');
  });

  it('returns null and does not mint a cookie for missing, malformed, or expired Boards', async () => {
    const service = await import('./board-service');

    const missing = await runRequest(
      new Request('https://retrocks.app/b/nonexistent_board_1234'),
      () => service.getBoardForRequest('nonexistent_board_1234'),
    );
    expect(missing.result).toBeNull();
    expect(missing.response.headers.getSetCookie()).toEqual([]);

    const malformed = await runRequest(
      new Request('https://retrocks.app/b/bad!id'),
      () => service.getBoardForRequest('bad!id'),
    );
    expect(malformed.result).toBeNull();
    expect(malformed.response.headers.getSetCookie()).toEqual([]);
  });

  it('enforces rate limiting and validation with safe-branded domain errors', async () => {
    const { setBoardCreateRateLimiterForTests: setLimiter } = await import(
      '../rate-limit'
    );
    setLimiter(createInMemoryRateLimiter({ limit: 1, windowMs: 60_000 }));
    const service = await import('./board-service');

    // Validation error is safe-branded
    await runRequest(new Request('https://retrocks.app/'), async () => {
      try {
        await service.createBoardForRequest({ title: 'x'.repeat(121) });
        expect.unreachable('expected validation error');
      } catch (err) {
        expect(err).toBeInstanceOf(service.BoardDomainError);
        expect((err as InstanceType<typeof service.BoardDomainError>).code).toBe(
          'VALIDATION_ERROR',
        );
        expect(isSafeError(err)).toBe(true);
      }
    });

    // First valid creation succeeds
    await runRequest(
      new Request('https://retrocks.app/', {
        headers: { 'x-forwarded-for': '198.51.100.10' },
      }),
      () => service.createBoardForRequest({ title: 'First Board' }),
    );

    // Second creation hits rate limit with safe-branded error
    await runRequest(
      new Request('https://retrocks.app/', {
        headers: { 'x-forwarded-for': '198.51.100.10' },
      }),
      async () => {
        try {
          await service.createBoardForRequest({ title: 'Second Board' });
          expect.unreachable('expected rate limit error');
        } catch (err) {
          expect(err).toBeInstanceOf(service.BoardDomainError);
          expect(
            (err as InstanceType<typeof service.BoardDomainError>).code,
          ).toBe('RATE_LIMITED');
          expect(isSafeError(err)).toBe(true);
        }
      },
    );
  });
});

describe('BoardService (Card & Column authoring, permissions, limits & rate limits)', () => {
  async function createTestBoard(
    service: typeof import('./board-service'),
    input: Record<string, unknown> = {},
  ) {
    const created = await runRequest(
      new Request('https://retrocks.app/', { method: 'POST' }),
      () => service.createBoardForRequest(input),
    );
    const facilitatorCookie = extractSessionCookie(created.response);
    return { board: created.result, facilitatorCookie };
  }

  async function joinAsParticipant(
    service: typeof import('./board-service'),
    boardId: string,
  ) {
    const visited = await runRequest(
      new Request(`https://retrocks.app/b/${boardId}`),
      () => service.getBoardForRequest(boardId),
    );
    return extractSessionCookie(visited.response);
  }

  async function createDiscussionFixture() {
    const service = await import('./board-service');
    const { board, facilitatorCookie } = await createTestBoard(service);
    const author = await joinAsParticipant(service, board.id);
    const reader = await joinAsParticipant(service, board.id);
    const as = <T>(cookie: string, handler: () => Promise<T>) =>
      runRequest(new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie },
      }), handler).then(({ result }) => result);
    const dispatch = (cookie: string, command: unknown) =>
      as(cookie, () => service.dispatchBoardCommandForRequest(board.id, command));
    const created = await dispatch(author, {
      type: 'card:create',
      columnId: board.columns[0].id,
      content: 'Discuss our deployment workflow',
    });
    const event = created.events[0];
    if (event?.type !== 'card:upserted') throw new Error('Expected a Card');
    return {
      service,
      as,
      dispatch,
      author,
      reader,
      facilitatorCookie,
      boardId: board.id,
      cardId: event.card.id,
    };
  }

  it('toggles each Participant’s reaction independently and returns viewer-scoped totals', async () => {
    const { dispatch, author, reader, cardId } = await createDiscussionFixture();
    const command = { type: 'reaction:toggle', cardId, emoji: '🎉' };
    await expect(dispatch(author, command))
      .resolves.toMatchObject({
        events: [{ type: 'reaction:updated', counts: { '🎉': 1 }, myReactions: ['🎉'] }],
      });
    await expect(dispatch(reader, command))
      .resolves.toMatchObject({
        events: [{ type: 'reaction:updated', counts: { '🎉': 2 }, myReactions: ['🎉'] }],
      });
    await expect(dispatch(author, command))
      .resolves.toMatchObject({
        events: [{ type: 'reaction:updated', counts: { '🎉': 1 }, myReactions: [] }],
      });
    await expect(dispatch(reader, command))
      .resolves.toMatchObject({
        events: [{ type: 'reaction:updated', counts: {}, myReactions: [] }],
      });
    await expect(dispatch(author, { type: 'reaction:toggle', cardId, emoji: '🙃' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('limits plain-text comments to 500 characters and 50 comments per Card', async () => {
    const { service, as, dispatch, author, reader, boardId, cardId } = await createDiscussionFixture();
    const { createBoardWriteRateLimiter, setBoardWriteRateLimiterForTests } =
      await import('../rate-limit');
    setBoardWriteRateLimiterForTests(createBoardWriteRateLimiter({ limit: 100, windowMs: 60_000 }));

    for (const content of ['   ', 'a'.repeat(501)]) {
      await expect(dispatch(reader, { type: 'comment:create', cardId, content }))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }

    const plainText = '<b>Discussion</b>'.padEnd(500, '.');
    await expect(dispatch(reader, { type: 'comment:create', cardId, content: plainText }))
      .resolves.toMatchObject({
        events: [{
          type: 'comment:created',
          cardId,
          comment: { content: plainText, isMine: true },
        }],
      });
    for (let number = 2; number <= 50; number++) {
      await dispatch(reader, { type: 'comment:create', cardId, content: `Comment ${number}` });
    }
    await expect(dispatch(author, { type: 'comment:create', cardId, content: 'One more' }))
      .rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    const snapshot = await as(author, () => service.getBoardForRequest(boardId));
    const card = snapshot?.cards[0];
    expect(card?.commentCount).toBe(50);
    expect(card?.comments.map(({ content }) => content)).toEqual([
      plainText,
      ...Array.from({ length: 49 }, (_, index) => `Comment ${index + 2}`),
    ]);
    expect(card?.comments[0]).toEqual({
      id: expect.any(String),
      cardId,
      content: plainText,
      isMine: false,
      createdAt: expect.any(Number),
    });
  });

  it('lets comment authors and Facilitators delete comments only on Cards they can see', async () => {
    const { service, as, dispatch, author, reader, facilitatorCookie, boardId, cardId } =
      await createDiscussionFixture();
    const comment = async (content: string) => {
      const { events: [event] } = await dispatch(reader, {
        type: 'comment:create',
        cardId,
        content,
      });
      if (event?.type !== 'comment:created') throw new Error('Expected a comment');
      return { cardId, commentId: event.comment.id };
    };
    const remove = await comment('Author deletion');
    const moderate = await comment('Facilitator deletion');
    await expect(dispatch(author, { type: 'comment:delete', ...remove }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(dispatch(reader, { type: 'comment:delete', ...remove }))
      .resolves.toMatchObject({
        events: [{ type: 'comment:deleted', cardId, commentId: remove.commentId }],
      });

    await dispatch(facilitatorCookie, {
      type: 'board:set-private-mode',
      isBlurred: true,
    });
    for (const [cookie, command] of [
      [reader, { type: 'comment:delete', ...moderate }],
      [facilitatorCookie, { type: 'comment:delete', ...moderate }],
      [reader, { type: 'reaction:toggle', cardId, emoji: '👍' }],
      [reader, { type: 'comment:create', cardId, content: 'Hidden' }],
    ] as const) {
      await expect(dispatch(cookie, command)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const hidden = await as(reader, () => service.getBoardForRequest(boardId));
    expect(hidden?.cards[0]).toMatchObject({
      redacted: true, reactions: {}, myReactions: [], commentCount: 0, comments: [],
    });
    await expect(dispatch(author, { type: 'comment:create', cardId, content: 'My Card' }))
      .resolves.toMatchObject({ events: [{ type: 'comment:created' }] });
    await expect(dispatch(author, { type: 'reaction:toggle', cardId, emoji: '👍' }))
      .resolves.toMatchObject({ events: [{ type: 'reaction:updated' }] });

    await dispatch(facilitatorCookie, {
      type: 'board:set-private-mode',
      isBlurred: false,
    });
    await expect(dispatch(facilitatorCookie, { type: 'comment:delete', ...moderate }))
      .resolves.toMatchObject({
        events: [{ type: 'comment:deleted', cardId, commentId: moderate.commentId }],
      });
    await expect(dispatch(reader, { type: 'comment:delete', ...remove }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const revealed = await as(reader, () => service.getBoardForRequest(boardId));
    expect(revealed?.cards[0].comments.map(({ content }) => content)).toEqual(['My Card']);
  });

  it('supports Card create, inline edit, cross-Column move, and permanent SQLite hard-delete', async () => {
    const service = await import('./board-service');
    const { board } = await createTestBoard(service, { title: 'Sprint 43' });
    const participantCookie = await joinAsParticipant(service, board.id);
    const col0 = board.columns[0];
    const col1 = board.columns[1];
    const actionCol = board.columns[2];

    // Create a Card in standard Column
    const createdCard = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: participantCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'card:create',
          columnId: col0.id,
          content: 'Great deploy speed\nSee https://example.com and `pnpm test`',
        }),
    );

    const cardEvent = createdCard.result.events[0];
    expect(cardEvent.type).toBe('card:upserted');
    if (cardEvent.type !== 'card:upserted') throw new Error('expected card:upserted');
    const cardId = cardEvent.card.id;
    expect(cardEvent.card.isMine).toBe(true);
    expect(cardEvent.card.isActionItem).toBe(false);
    expect(cardEvent.card.columnId).toBe(col0.id);

    // Card created in Action Items Column is automatically flagged as Action Item
    const createdAction = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: participantCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'card:create',
          columnId: actionCol.id,
          content: 'Automate canary rollback',
        }),
    );
    const actionEvent = createdAction.result.events[0];
    expect(actionEvent.type).toBe('card:upserted');
    if (actionEvent.type === 'card:upserted') {
      expect(actionEvent.card.isActionItem).toBe(true);
    }

    // Author edits own Card
    const edited = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: participantCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'card:update',
          cardId,
          content: 'Updated card text',
        }),
    );
    expect(edited.result.events[0]).toMatchObject({
      type: 'card:upserted',
      card: { id: cardId, content: 'Updated card text', isMine: true },
    });

    // Author moves own Card across Columns
    const moved = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: participantCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'card:move',
          cardId,
          targetColumnId: col1.id,
        }),
    );
    expect(moved.result.events[0]).toMatchObject({
      type: 'card:upserted',
      card: { id: cardId, columnId: col1.id },
    });

    // Author hard-deletes own Card -> permanently removed from SQLite
    const deleted = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: participantCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'card:delete',
          cardId,
        }),
    );
    expect(deleted.result.events).toContainEqual(
      expect.objectContaining({ type: 'card:deleted', cardId }),
    );

    const rawAfter = await store.getBoardSnapshot(board.id);
    expect(rawAfter?.cards.find((c) => c.id === cardId)).toBeUndefined();
  });

  it('enforces author vs Facilitator permissions and Private Mode safety on Card edit/move/delete', async () => {
    const service = await import('./board-service');
    const { board: openBoard, facilitatorCookie: openFac } = await createTestBoard(
      service,
      { isBlurred: false },
    );
    const alice = await joinAsParticipant(service, openBoard.id);
    const bob = await joinAsParticipant(service, openBoard.id);

    // Alice creates a Card
    const aliceCardRes = await runRequest(
      new Request(`https://retrocks.app/b/${openBoard.id}`, {
        method: 'POST',
        headers: { cookie: alice },
      }),
      () =>
        service.dispatchBoardCommandForRequest(openBoard.id, {
          type: 'card:create',
          columnId: openBoard.columns[0].id,
          content: 'Alice feedback',
        }),
    );
    const aliceCardId =
      aliceCardRes.result.events[0].type === 'card:upserted'
        ? aliceCardRes.result.events[0].card.id
        : '';

    // Bob cannot edit, move, or delete Alice's Card
    for (const command of [
      { type: 'card:update', cardId: aliceCardId, content: 'Hijacked' },
      { type: 'card:move', cardId: aliceCardId, targetColumnId: openBoard.columns[1].id },
      { type: 'card:delete', cardId: aliceCardId },
    ]) {
      await runRequest(
        new Request(`https://retrocks.app/b/${openBoard.id}`, {
          method: 'POST',
          headers: { cookie: bob },
        }),
        async () => {
          await expect(
            service.dispatchBoardCommandForRequest(openBoard.id, command),
          ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        },
      );
    }

    // Facilitator CAN edit, move, and delete any revealed Card
    await runRequest(
      new Request(`https://retrocks.app/b/${openBoard.id}`, {
        method: 'POST',
        headers: { cookie: openFac },
      }),
      () =>
        service.dispatchBoardCommandForRequest(openBoard.id, {
          type: 'card:update',
          cardId: aliceCardId,
          content: 'Clarified by facilitator',
        }),
    );
    await runRequest(
      new Request(`https://retrocks.app/b/${openBoard.id}`, {
        method: 'POST',
        headers: { cookie: openFac },
      }),
      () =>
        service.dispatchBoardCommandForRequest(openBoard.id, {
          type: 'card:move',
          cardId: aliceCardId,
          targetColumnId: openBoard.columns[1].id,
        }),
    );
    await runRequest(
      new Request(`https://retrocks.app/b/${openBoard.id}`, {
        method: 'POST',
        headers: { cookie: openFac },
      }),
      () =>
        service.dispatchBoardCommandForRequest(openBoard.id, {
          type: 'card:delete',
          cardId: aliceCardId,
        }),
    );

    // Private Mode ON: Facilitator CANNOT edit, move, or delete another Participant's redacted Card,
    // while the author CAN still manage their own Card.
    const { board: privateBoard, facilitatorCookie: privFac } =
      await createTestBoard(service, { isBlurred: true });
    const carol = await joinAsParticipant(service, privateBoard.id);

    const carolCardRes = await runRequest(
      new Request(`https://retrocks.app/b/${privateBoard.id}`, {
        method: 'POST',
        headers: { cookie: carol },
      }),
      () =>
        service.dispatchBoardCommandForRequest(privateBoard.id, {
          type: 'card:create',
          columnId: privateBoard.columns[0].id,
          content: 'Secret reflection',
        }),
    );
    const carolCardId =
      carolCardRes.result.events[0].type === 'card:upserted'
        ? carolCardRes.result.events[0].card.id
        : '';

    for (const command of [
      { type: 'card:update', cardId: carolCardId, content: 'Facilitator edit attempt' },
      { type: 'card:move', cardId: carolCardId, targetColumnId: privateBoard.columns[1].id },
      { type: 'card:delete', cardId: carolCardId },
    ]) {
      await runRequest(
        new Request(`https://retrocks.app/b/${privateBoard.id}`, {
          method: 'POST',
          headers: { cookie: privFac },
        }),
        async () => {
          await expect(
            service.dispatchBoardCommandForRequest(privateBoard.id, command),
          ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        },
      );
    }

    await runRequest(
      new Request(`https://retrocks.app/b/${privateBoard.id}`, {
        method: 'POST',
        headers: { cookie: privFac },
      }),
      async () => {
        await expect(
          service.dispatchBoardCommandForRequest(privateBoard.id, {
            type: 'column:delete',
            columnId: privateBoard.columns[0].id,
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      },
    );

    // Carol (the author) CAN edit, move, and delete her own Card even while Private Mode is ON
    await runRequest(
      new Request(`https://retrocks.app/b/${privateBoard.id}`, {
        method: 'POST',
        headers: { cookie: carol },
      }),
      () =>
        service.dispatchBoardCommandForRequest(privateBoard.id, {
          type: 'card:update',
          cardId: carolCardId,
          content: 'Carol revised her own card',
        }),
    );
    await runRequest(
      new Request(`https://retrocks.app/b/${privateBoard.id}`, {
        method: 'POST',
        headers: { cookie: carol },
      }),
      () =>
        service.dispatchBoardCommandForRequest(privateBoard.id, {
          type: 'card:move',
          cardId: carolCardId,
          targetColumnId: privateBoard.columns[1].id,
        }),
    );
    await runRequest(
      new Request(`https://retrocks.app/b/${privateBoard.id}`, {
        method: 'POST',
        headers: { cookie: carol },
      }),
      () =>
        service.dispatchBoardCommandForRequest(privateBoard.id, {
          type: 'card:delete',
          cardId: carolCardId,
        }),
    );
  });

  it('allows Facilitators to rename Board and add/edit/reorder/delete Columns while blocking Participants', async () => {
    const service = await import('./board-service');
    const { board, facilitatorCookie } = await createTestBoard(service, {
      title: 'Original Retro',
    });
    const participantCookie = await joinAsParticipant(service, board.id);

    // Participant is forbidden from renaming Board or managing Columns
    await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: participantCookie },
      }),
      async () => {
        await expect(
          service.dispatchBoardCommandForRequest(board.id, {
            type: 'board:rename',
            title: 'Participant Rename',
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(
          service.dispatchBoardCommandForRequest(board.id, {
            type: 'column:add',
            title: 'Sneaky',
            accent: 'amber',
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      },
    );

    // Facilitator renames Board
    const renamed = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: facilitatorCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'board:rename',
          title: 'Sprint 44 — Renamed',
        }),
    );
    expect(renamed.result.events[0]).toMatchObject({
      type: 'board:updated',
      patch: { title: 'Sprint 44 — Renamed' },
    });

    // Facilitator adds a Column
    const added = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: facilitatorCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'column:add',
          title: 'Kudos',
          accent: 'violet',
        }),
    );
    const addedColEvent = added.result.events[0];
    expect(addedColEvent.type).toBe('column:upserted');
    if (addedColEvent.type !== 'column:upserted') throw new Error('expected column:upserted');
    const kudosId = addedColEvent.column.id;
    expect(addedColEvent.column).toMatchObject({
      title: 'Kudos',
      accent: 'violet',
      position: 3,
    });

    // Facilitator updates Column title & accent
    const updatedCol = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: facilitatorCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'column:update',
          columnId: kudosId,
          title: 'Shoutouts',
          accent: 'coral',
        }),
    );
    expect(updatedCol.result.events[0]).toMatchObject({
      type: 'column:upserted',
      column: { id: kudosId, title: 'Shoutouts', accent: 'coral' },
    });

    // Facilitator reorders Columns
    const newOrder = [
      kudosId,
      board.columns[0].id,
      board.columns[1].id,
      board.columns[2].id,
    ];
    const reordered = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: facilitatorCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'column:reorder',
          columnIds: newOrder,
        }),
    );
    expect(reordered.result.events[0]).toMatchObject({
      type: 'columns:reordered',
      columnIds: newOrder,
    });

    // Add a Card inside Shoutouts, then delete Shoutouts -> cascades its Cards
    await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: facilitatorCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'card:create',
          columnId: kudosId,
          content: 'Thanks team!',
        }),
    );

    const deletedCol = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: facilitatorCookie },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'column:delete',
          columnId: kudosId,
        }),
    );
    expect(deletedCol.result.events[0]).toMatchObject({
      type: 'column:deleted',
      columnId: kudosId,
    });

    const loaded = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        headers: { cookie: facilitatorCookie },
      }),
      () => service.getBoardForRequest(board.id),
    );
    expect(loaded.result?.columns).toHaveLength(3);
    expect(loaded.result?.cards).toHaveLength(0);
    expect(loaded.result?.columns.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it('enforces hard limits (10 Columns, min 1 Column, 500 Cards, 1,000 chars/Card) and per-Board write rate limits by participantHash', async () => {
    const service = await import('./board-service');
    const {
      createBoardWriteRateLimiter,
      setBoardWriteRateLimiterForTests: setWriteLimiter,
    } = await import('../rate-limit');

    // Use a generous write limiter for the hard-limits portion
    setWriteLimiter(createBoardWriteRateLimiter({ limit: 1000, windowMs: 60_000 }));

    // 1. 1,000 chars/Card limit
    const { board, facilitatorCookie } = await createTestBoard(service, {
      templateId: 'custom',
      columns: Array.from({ length: 10 }, (_, idx) => ({
        title: `Col ${idx + 1}`,
        accent: 'slate',
      })),
    });

    await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: facilitatorCookie },
      }),
      async () => {
        await expect(
          service.dispatchBoardCommandForRequest(board.id, {
            type: 'card:create',
            columnId: board.columns[0].id,
            content: 'a'.repeat(1001),
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      },
    );

    // 2. 10 Columns/Board limit
    await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: facilitatorCookie },
      }),
      async () => {
        await expect(
          service.dispatchBoardCommandForRequest(board.id, {
            type: 'column:add',
            title: 'Col 11',
            accent: 'sage',
          }),
        ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
      },
    );

    // 3. Cannot delete the last remaining Column
    const { board: singleColBoard, facilitatorCookie: singleFac } =
      await createTestBoard(service, {
        templateId: 'custom',
        columns: [{ title: 'Only Column', accent: 'sky' }],
      });
    await runRequest(
      new Request(`https://retrocks.app/b/${singleColBoard.id}`, {
        method: 'POST',
        headers: { cookie: singleFac },
      }),
      async () => {
        await expect(
          service.dispatchBoardCommandForRequest(singleColBoard.id, {
            type: 'column:delete',
            columnId: singleColBoard.columns[0].id,
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      },
    );

    // 4. 500 Cards/Board limit (insert 500 via store, 501st rejected via service)
    const raw = await store.getBoardSnapshot(singleColBoard.id);
    const facHash = 'test_bulk_author_hash';
    for (let i = 0; i < 500; i += 1) {
      const outcome = await store.mutateBoard(
        singleColBoard.id,
        { participantHash: facHash, isFacilitator: true },
        {
          type: 'card:create',
          id: `card_bulk_${String(i).padStart(4, '0')}`,
          columnId: singleColBoard.columns[0].id,
          content: `Card ${i}`,
        },
        raw!.board.createdAt + i + 1,
      );
      expect(outcome.ok).toBe(true);
    }

    await runRequest(
      new Request(`https://retrocks.app/b/${singleColBoard.id}`, {
        method: 'POST',
        headers: { cookie: singleFac },
      }),
      async () => {
        await expect(
          service.dispatchBoardCommandForRequest(singleColBoard.id, {
            type: 'card:create',
            columnId: singleColBoard.columns[0].id,
            content: 'Card 501',
          }),
        ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
      },
    );

    // 5. Per-Board in-memory write rate limit keyed strictly by participantHash (zero IP persistence)
    const strictLimiter = createBoardWriteRateLimiter({
      limit: 2,
      windowMs: 60_000,
    });
    setWriteLimiter(strictLimiter);

    const p1 = await joinAsParticipant(service, board.id);
    const p2 = await joinAsParticipant(service, board.id);

    for (let i = 0; i < 2; i += 1) {
      await runRequest(
        new Request(`https://retrocks.app/b/${board.id}`, {
          method: 'POST',
          headers: { cookie: p1, 'x-forwarded-for': '203.0.113.77' },
        }),
        () =>
          service.dispatchBoardCommandForRequest(board.id, {
            type: 'card:create',
            columnId: board.columns[0].id,
            content: `Write ${i + 1}`,
          }),
      );
    }

    // 3rd write from p1 hits RATE_LIMITED
    await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: p1, 'x-forwarded-for': '203.0.113.77' },
      }),
      async () => {
        await expect(
          service.dispatchBoardCommandForRequest(board.id, {
            type: 'card:create',
            columnId: board.columns[0].id,
            content: 'Write 3 blocked',
          }),
        ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      },
    );

    // Distinct Participant p2 (even from same IP) is unaffected because keying is by participantHash
    await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: p2, 'x-forwarded-for': '203.0.113.77' },
      }),
      () =>
        service.dispatchBoardCommandForRequest(board.id, {
          type: 'card:create',
          columnId: board.columns[0].id,
          content: 'P2 succeeds',
        }),
    );

    // Rate-limit keys never store raw IP addresses
    const keys = strictLimiter.getActiveKeySnapshotForTests();
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const key of keys) {
      expect(key).not.toContain('203.0.113.77');
    }
  });
});

describe('BoardService (Action Items)', () => {
  async function createActionFixture() {
    const service = await import('./board-service');
    const created = await runRequest(
      new Request('https://retrocks.app/', { method: 'POST' }),
      () => service.createBoardForRequest({}),
    );
    const board = created.result;
    const facilitatorCookie = extractSessionCookie(created.response);
    const join = async () => {
      const visited = await runRequest(
        new Request(`https://retrocks.app/b/${board.id}`),
        () => service.getBoardForRequest(board.id),
      );
      return extractSessionCookie(visited.response);
    };
    const author = await join();
    const reader = await join();
    const as = <T>(cookie: string, handler: () => Promise<T>) =>
      runRequest(
        new Request(`https://retrocks.app/b/${board.id}`, {
          method: 'POST',
          headers: { cookie },
        }),
        handler,
      ).then(({ result }) => result);
    const dispatch = (cookie: string, command: unknown) =>
      as(cookie, () => service.dispatchBoardCommandForRequest(board.id, command));
    const createCard = async (
      cookie: string,
      columnId: string,
      content: string,
    ) => {
      const result = await dispatch(cookie, { type: 'card:create', columnId, content });
      const event = result.events[0];
      if (event?.type !== 'card:upserted') throw new Error('Expected a Card');
      return event.card;
    };
    return {
      service,
      board,
      facilitatorCookie,
      author,
      reader,
      as,
      dispatch,
      createCard,
    };
  }

  it('auto-flags Action Column Cards and lets any Participant flag, complete, tag, and unflag a revealed Card', async () => {
    const { service, board, author, reader, as, dispatch, createCard } =
      await createActionFixture();

    const autoFlagged = await createCard(
      author,
      board.columns[2].id,
      'Automate canary rollback',
    );
    expect(autoFlagged).toMatchObject({
      isActionItem: true,
      actionDone: false,
      actionOwner: '',
    });

    const card = await createCard(
      author,
      board.columns[0].id,
      'Pair on flaky tests',
    );
    expect(card.isActionItem).toBe(false);

    // Any Participant can flag another Participant's revealed Card.
    const flagged = await dispatch(reader, {
      type: 'card:set-action',
      cardId: card.id,
      isActionItem: true,
    });
    expect(flagged.events[0]).toMatchObject({
      type: 'card:upserted',
      card: {
        id: card.id,
        isActionItem: true,
        actionDone: false,
        actionOwner: '',
      },
    });

    const completed = await dispatch(reader, {
      type: 'card:set-action',
      cardId: card.id,
      actionDone: true,
      actionOwner: '  Platform  ',
    });
    expect(completed.events[0]).toMatchObject({
      type: 'card:upserted',
      card: {
        id: card.id,
        isActionItem: true,
        actionDone: true,
        actionOwner: 'Platform',
      },
    });

    const authorView = await as(author, () =>
      service.getBoardForRequest(board.id),
    );
    expect(authorView?.cards.find((item) => item.id === card.id)).toMatchObject({
      isActionItem: true,
      actionDone: true,
      actionOwner: 'Platform',
    });

    const unflagged = await dispatch(reader, {
      type: 'card:set-action',
      cardId: card.id,
      isActionItem: false,
    });
    expect(unflagged.events[0]).toMatchObject({
      type: 'card:upserted',
      card: {
        id: card.id,
        isActionItem: false,
        actionDone: false,
        actionOwner: '',
      },
    });
  });

  it('rejects Action Item changes on another Participant’s redacted Card while Private Mode is ON', async () => {
    const { board, facilitatorCookie, author, reader, dispatch, createCard } =
      await createActionFixture();
    const card = await createCard(
      author,
      board.columns[0].id,
      'Secret reflection',
    );
    await dispatch(facilitatorCookie, {
      type: 'board:set-private-mode',
      isBlurred: true,
    });

    for (const cookie of [reader, facilitatorCookie]) {
      for (const patch of [
        { isActionItem: true },
        { actionDone: true },
        { actionOwner: 'Platform' },
      ]) {
        await expect(
          dispatch(cookie, {
            type: 'card:set-action',
            cardId: card.id,
            ...patch,
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
    }

    // The author can still manage their own Card while Private Mode is ON.
    await expect(
      dispatch(author, {
        type: 'card:set-action',
        cardId: card.id,
        isActionItem: true,
      }),
    ).resolves.toMatchObject({
      events: [
        { type: 'card:upserted', card: { id: card.id, isActionItem: true } },
      ],
    });

    await dispatch(facilitatorCookie, {
      type: 'board:set-private-mode',
      isBlurred: false,
    });
    await expect(
      dispatch(reader, {
        type: 'card:set-action',
        cardId: card.id,
        actionOwner: 'API squad',
      }),
    ).resolves.toMatchObject({
      events: [
        { type: 'card:upserted', card: { actionOwner: 'API squad' } },
      ],
    });
  });

  it('validates owner length and blank owners, and edits action fields only on Action Items', async () => {
    const { board, author, dispatch, createCard } =
      await createActionFixture();
    const card = await createCard(author, board.columns[0].id, 'Follow-up');

    await expect(
      dispatch(author, {
        type: 'card:set-action',
        cardId: card.id,
        isActionItem: true,
        actionOwner: 'a'.repeat(41),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('40'),
    });
    await expect(
      dispatch(author, {
        type: 'card:set-action',
        cardId: card.id,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      dispatch(author, {
        type: 'card:set-action',
        cardId: card.id,
        actionDone: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const flagged = await dispatch(author, {
      type: 'card:set-action',
      cardId: card.id,
      isActionItem: true,
      actionOwner: 'x'.repeat(40),
    });
    expect(flagged.events[0]).toMatchObject({
      card: { actionOwner: 'x'.repeat(40) },
    });

    const blankOwner = await dispatch(author, {
      type: 'card:set-action',
      cardId: card.id,
      actionOwner: '   ',
    });
    expect(blankOwner.events[0]).toMatchObject({
      card: { actionOwner: '' },
    });

    await expect(
      dispatch(author, {
        type: 'card:set-action',
        cardId: 'missing_card',
        isActionItem: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('BoardService (shared Countdown Timer)', () => {
  async function createTimerBoard() {
    const service = await import('./board-service');
    const origin = 'https://retrocks.app/';
    const created = await runRequest(
      new Request(origin, { method: 'POST' }),
      () => service.createBoardForRequest({}),
    );
    const { id: boardId } = created.result;
    const facilitatorCookie = extractSessionCookie(created.response);
    const boardUrl = new URL(`/b/${boardId}`, origin);
    const participant = await runRequest(
      new Request(boardUrl),
      () => service.getBoardForRequest(boardId),
    );
    const participantCookie = extractSessionCookie(participant.response);

    return {
      async changeTimer(change: unknown, cookie = facilitatorCookie) {
        return (await runRequest(
          new Request(boardUrl, { method: 'POST', headers: { cookie } }),
          () => service.dispatchBoardCommandForRequest(boardId, { type: 'timer:update', change }),
        )).result;
      },
      async readTimer() {
        return (await runRequest(
          new Request(boardUrl, { headers: { cookie: participantCookie } }),
          () => service.getBoardForRequest(boardId),
        )).result?.timer;
      },
      participantCookie,
    };
  }

  it('keeps Paused time fixed, resumes from the server clock, extends, and dismisses', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-19T14:00:00Z') });
    try {
      const { changeTimer, readTimer } = await createTimerBoard();
      await changeTimer({ action: 'start', minutes: 5 });

      vi.setSystemTime(new Date('2026-11-19T14:00:45Z'));
      expect((await changeTimer({ action: 'pause' })).events).toEqual([{
        type: 'timer:updated',
        version: 3,
        serverNow: Date.parse('2026-11-19T14:00:45Z'),
        timer: { endsAt: null, remainingMs: 255_000, durationMs: 300_000 },
      }]);

      vi.setSystemTime(new Date('2026-11-19T14:10:00Z'));
      expect(await readTimer()).toEqual({
        endsAt: null, remainingMs: 255_000, durationMs: 300_000,
      });

      await changeTimer({ action: 'extend' });
      expect(await readTimer()).toEqual({
        endsAt: null, remainingMs: 315_000, durationMs: 360_000,
      });

      await changeTimer({ action: 'resume' });
      expect(await readTimer()).toEqual({
        endsAt: Date.parse('2026-11-19T14:15:15Z'),
        remainingMs: null,
        durationMs: 360_000,
      });

      await changeTimer({ action: 'extend' });
      expect(await readTimer()).toEqual({
        endsAt: Date.parse('2026-11-19T14:16:15Z'),
        remainingMs: null,
        durationMs: 420_000,
      });

      await changeTimer({ action: 'dismiss' });
      expect(await readTimer()).toEqual({
        endsAt: null, remainingMs: null, durationMs: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects every timer control for an ordinary Participant', async () => {
    const { changeTimer, readTimer, participantCookie } = await createTimerBoard();
    await changeTimer({ action: 'start', minutes: 15 });
    const originalTimer = await readTimer();

    for (const change of [
      { action: 'start', minutes: 3 },
      { action: 'pause' },
      { action: 'resume' },
      { action: 'extend' },
      { action: 'dismiss' },
    ]) {
      await expect(changeTimer(change, participantCookie)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    expect(await readTimer()).toEqual(originalTimer);
  });

  it('accepts whole custom durations between one and 60 minutes', async () => {
    const { changeTimer, readTimer } = await createTimerBoard();

    for (const minutes of [0, 61, 1.5, '3', Infinity]) {
      await expect(changeTimer({ action: 'start', minutes })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    }
    await changeTimer({ action: 'start', minutes: 1 });
    expect(await readTimer()).toMatchObject({ durationMs: 60_000 });
    await changeTimer({ action: 'start', minutes: 60 });
    expect(await readTimer()).toMatchObject({ durationMs: 3_600_000 });
  });
});

describe('BoardService (Locked Board lifecycle & permanent Delete)', () => {
  async function createLifecycleFixture() {
    const service = await import('./board-service');
    const { createBoardWriteRateLimiter, setBoardWriteRateLimiterForTests } =
      await import('../rate-limit');
    setBoardWriteRateLimiterForTests(
      createBoardWriteRateLimiter({ limit: 1000, windowMs: 60_000 }),
    );

    const created = await runRequest(
      new Request('https://retrocks.app/', { method: 'POST' }),
      () => service.createBoardForRequest({}),
    );
    const board = created.result;
    const facilitatorCookie = extractSessionCookie(created.response);
    const join = async () => {
      const visited = await runRequest(
        new Request(`https://retrocks.app/b/${board.id}`),
        () => service.getBoardForRequest(board.id),
      );
      return extractSessionCookie(visited.response);
    };
    const author = await join();
    const reader = await join();
    const dispatch = (cookie: string, command: unknown) =>
      runRequest(
        new Request(`https://retrocks.app/b/${board.id}`, {
          method: 'POST',
          headers: { cookie },
        }),
        () => service.dispatchBoardCommandForRequest(board.id, command),
      ).then(({ result }) => result);
    const createCard = async (
      cookie: string,
      columnId: string,
      content: string,
    ) => {
      const result = await dispatch(cookie, { type: 'card:create', columnId, content });
      const event = result.events[0];
      if (event?.type !== 'card:upserted') throw new Error('Expected a Card');
      return event.card;
    };

    const actionCard = await createCard(
      author,
      board.columns[2].id,
      'Automate canary rollback',
    );
    const normalCard = await createCard(
      author,
      board.columns[0].id,
      'Pair on flaky tests',
    );
    const secondCard = await createCard(
      author,
      board.columns[0].id,
      'Split slow e2e suite',
    );
    const grouped = await dispatch(facilitatorCookie, {
      type: 'group:merge',
      cardId: secondCard.id,
      targetType: 'card',
      targetId: normalCard.id,
    });
    const groupEvent = grouped.events.find((ev) => ev.type === 'group:upserted');
    if (groupEvent?.type !== 'group:upserted') {
      throw new Error('Expected a Card Group');
    }
    const comment = await dispatch(author, {
      type: 'comment:create',
      cardId: normalCard.id,
      content: 'Existing discussion',
    });
    const commentEvent = comment.events[0];
    if (commentEvent?.type !== 'comment:created') {
      throw new Error('Expected a comment');
    }

    const lock = () =>
      dispatch(facilitatorCookie, { type: 'board:set-lock', isLocked: true });

    return {
      service,
      board,
      facilitatorCookie,
      author,
      reader,
      dispatch,
      actionCard,
      normalCard,
      secondCard,
      groupId: groupEvent.group.id,
      commentId: commentEvent.comment.id,
      lock,
    };
  }

  it('lets only the Facilitator lock and unlock the Board', async () => {
    const { service, board, facilitatorCookie, reader, dispatch } =
      await createLifecycleFixture();

    await expect(
      dispatch(reader, { type: 'board:set-lock', isLocked: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const locked = await dispatch(facilitatorCookie, {
      type: 'board:set-lock',
      isLocked: true,
    });
    expect(locked).toMatchObject({
      ok: true,
      events: [
        {
          type: 'board:updated',
          patch: { isLocked: true },
        },
      ],
    });
    const lockedRead = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        headers: { cookie: reader },
      }),
      () => service.getBoardForRequest(board.id),
    );
    expect(lockedRead.result?.isLocked).toBe(true);

    await expect(
      dispatch(reader, { type: 'board:set-lock', isLocked: false }),
    ).rejects.toMatchObject({ code: 'BOARD_LOCKED' });

    const unlocked = await dispatch(facilitatorCookie, {
      type: 'board:set-lock',
      isLocked: false,
    });
    expect(unlocked).toMatchObject({
      ok: true,
      events: [
        {
          type: 'board:updated',
          patch: { isLocked: false },
        },
      ],
    });
  });

  it('rejects every write while Locked with BOARD_LOCKED except Facilitator Action Item updates and Unlock', async () => {
    const {
      board,
      facilitatorCookie,
      reader,
      dispatch,
      actionCard,
      normalCard,
      groupId,
      commentId,
      lock,
    } = await createLifecycleFixture();
    await lock();

    const col = board.columns[0];
    const participantWrites: unknown[] = [
      { type: 'card:create', columnId: col.id, content: 'Blocked' },
      { type: 'card:update', cardId: normalCard.id, content: 'Blocked edit' },
      { type: 'card:move', cardId: normalCard.id, targetColumnId: board.columns[1].id },
      { type: 'card:delete', cardId: normalCard.id },
      { type: 'vote:change', targetType: 'card', targetId: normalCard.id, delta: 1 },
      { type: 'voting:configure', voteLimit: 3 },
      { type: 'voting:reset' },
      { type: 'board:rename', title: 'Blocked rename' },
      { type: 'timer:update', change: { action: 'start', minutes: 5 } },
      { type: 'board:set-private-mode', isBlurred: true },
      { type: 'column:add', title: 'Blocked column' },
      { type: 'column:update', columnId: col.id, title: 'Blocked column edit' },
      { type: 'column:reorder', columnIds: board.columns.map(({ id }) => id).reverse() },
      { type: 'column:delete', columnId: col.id },
      { type: 'reaction:toggle', cardId: normalCard.id, emoji: '👍' },
      { type: 'comment:create', cardId: normalCard.id, content: 'Blocked comment' },
      { type: 'comment:delete', cardId: normalCard.id, commentId },
      { type: 'card:set-action', cardId: actionCard.id, isActionItem: false },
      { type: 'card:set-action', cardId: actionCard.id, actionDone: true, actionOwner: 'Blocked' },
      { type: 'board:set-lock', isLocked: false },
      { type: 'board:delete' },
    ];

    for (const command of participantWrites) {
      await expect(dispatch(reader, command)).rejects.toMatchObject({
        code: 'BOARD_LOCKED',
        status: 403,
      });
    }

    const facilitatorWrites: unknown[] = [
      { type: 'card:create', columnId: col.id, content: 'Facilitator blocked card' },
      { type: 'card:update', cardId: normalCard.id, content: 'Facilitator blocked edit' },
      { type: 'card:move', cardId: normalCard.id, targetColumnId: board.columns[1].id },
      { type: 'card:delete', cardId: normalCard.id },
      { type: 'vote:change', targetType: 'card', targetId: normalCard.id, delta: 1 },
      { type: 'voting:configure', voteLimit: 3 },
      { type: 'voting:reset' },
      { type: 'board:rename', title: 'Facilitator blocked rename' },
      { type: 'timer:update', change: { action: 'start', minutes: 5 } },
      { type: 'board:set-private-mode', isBlurred: true },
      { type: 'column:add', title: 'Facilitator blocked column' },
      { type: 'column:update', columnId: col.id, title: 'Facilitator blocked column edit' },
      { type: 'column:reorder', columnIds: board.columns.map(({ id }) => id).reverse() },
      { type: 'column:delete', columnId: col.id },
      { type: 'reaction:toggle', cardId: normalCard.id, emoji: '🎉' },
      { type: 'comment:create', cardId: normalCard.id, content: 'Facilitator blocked comment' },
      { type: 'comment:delete', cardId: normalCard.id, commentId },
      { type: 'card:set-action', cardId: actionCard.id, isActionItem: false },
      { type: 'card:set-action', cardId: normalCard.id, isActionItem: true },
      { type: 'group:rename', groupId, title: 'Blocked group rename' },
      { type: 'group:ungroup', cardId: normalCard.id },
      { type: 'group:dissolve', groupId },
      { type: 'group:move', groupId, targetColumnId: board.columns[1].id },
      { type: 'card:set-action', cardId: normalCard.id, actionDone: true },
    ];

    for (const command of facilitatorWrites) {
      await expect(dispatch(facilitatorCookie, command)).rejects.toMatchObject({
        code: 'BOARD_LOCKED',
        status: 403,
      });
    }

    // The three Locked exceptions: Action Item completion/owner and Unlock.
    await expect(
      dispatch(facilitatorCookie, {
        type: 'card:set-action',
        cardId: actionCard.id,
        actionDone: true,
        actionOwner: 'Platform',
      }),
    ).resolves.toMatchObject({
      events: [
        {
          type: 'card:upserted',
          card: {
            id: actionCard.id,
            actionDone: true,
            actionOwner: 'Platform',
          },
        },
      ],
    });

    const unlocked = await dispatch(facilitatorCookie, {
      type: 'board:set-lock',
      isLocked: false,
    });
    expect(unlocked.events[0]).toMatchObject({
      type: 'board:updated',
      patch: { isLocked: false },
    });

    // Once unlocked, ordinary writes work again.
    await expect(
      dispatch(reader, {
        type: 'card:set-action',
        cardId: actionCard.id,
        actionDone: false,
      }),
    ).resolves.toMatchObject({
      events: [{ type: 'card:upserted', card: { id: actionCard.id, actionDone: false } }],
    });
  });

  it('permanently deletes a Locked Board for the Facilitator and erases its storage', async () => {
    const { service, board, facilitatorCookie, reader, dispatch, normalCard, lock } =
      await createLifecycleFixture();

    await expect(
      dispatch(reader, { type: 'board:delete' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.getBoardSnapshot(board.id)).not.toBeNull();

    await lock();
    const deleted = await dispatch(facilitatorCookie, { type: 'board:delete' });
    expect(deleted).toMatchObject({
      ok: true,
      events: [{ type: 'board:deleted' }],
    });

    expect(await store.getBoardSnapshot(board.id)).toBeNull();
    expect(await store.getBoardTokenSalt(board.id)).toBeNull();

    const read = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        headers: { cookie: reader },
      }),
      () => service.getBoardForRequest(board.id),
    );
    expect(read.result).toBeNull();
    expect(normalCard.id).toBeTruthy();

    // Subsequent delete returns BOARD_NOT_FOUND (404)
    await expect(
      dispatch(facilitatorCookie, { type: 'board:delete' }),
    ).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND', status: 404 });
  });

  it('sets HTTP 403 status from server actions on BOARD_LOCKED and allows deleting an unlocked Board', async () => {
    const actions = await import('../../lib/board-actions');
    const { board, facilitatorCookie, reader, normalCard, lock } =
      await createLifecycleFixture();

    await lock();

    const blockedCard = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: reader },
      }),
      () =>
        actions.dispatchBoardCommand(board.id, {
          type: 'card:create',
          columnId: board.columns[0].id,
          content: 'Blocked over server action',
        }),
    );
    expect(blockedCard.response.status).toBe(403);
    expect(blockedCard.result).toMatchObject({
      ok: false,
      code: 'BOARD_LOCKED',
    });

    const blockedVote = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: reader },
      }),
      () =>
        actions.dispatchBoardCommand(board.id, {
          type: 'vote:change',
          targetType: 'card',
          targetId: normalCard.id,
          delta: 1,
        }),
    );
    expect(blockedVote.response.status).toBe(403);
    expect(blockedVote.result).toMatchObject({
      ok: false,
      code: 'BOARD_LOCKED',
    });

    const unlocked = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: facilitatorCookie },
      }),
      () =>
        actions.dispatchBoardCommand(board.id, {
          type: 'board:set-lock',
          isLocked: false,
        }),
    );
    expect(unlocked.response.status).toBe(200);
    expect(unlocked.result).toMatchObject({
      ok: true,
      events: [{ type: 'board:updated', patch: { isLocked: false } }],
    });

    const deleted = await runRequest(
      new Request(`https://retrocks.app/b/${board.id}`, {
        method: 'POST',
        headers: { cookie: facilitatorCookie },
      }),
      () => actions.dispatchBoardCommand(board.id, { type: 'board:delete' }),
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.result).toMatchObject({
      ok: true,
      events: [{ type: 'board:deleted' }],
    });
    expect(await store.getBoardSnapshot(board.id)).toBeNull();
  });
});
