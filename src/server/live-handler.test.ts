import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { expect, it, vi } from 'vitest';

import type { BoardLiveMessage } from '../lib/board-live-protocol';
import { LIVE_CONNECTION_HEADER, LIVE_HEARTBEAT_MS } from '../lib/live-protocol';
import { parsePokerLiveMessage } from '../lib/poker-schemas';
import { runWithCloudflareEnv } from './adapters/cloudflare-context';

async function withSession<T>(request: Request, run: () => Promise<T>) {
  const event = createRequestEvent(request);
  return provideRequestEvent(event, async () => {
    const result = await run();
    const response = commitEventResponse(new Response(), event);
    const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
    return { result, cookie };
  });
}

function readLiveStream(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';

  return {
    close: () => reader.cancel(),
    async until<T extends BoardLiveMessage['type']>(type: T, matches: (message: Extract<BoardLiveMessage, { type: T }>) => boolean = () => true) {
      while (true) {
        const end = pending.indexOf('\n\n');
        if (end >= 0) {
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          const message = JSON.parse(frame.slice('data: '.length)) as Extract<BoardLiveMessage, { type: T }>;
          if (message.type === type && matches(message)) return message;
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Live stream ended before the event');
        pending += chunk.value;
      }
    },
  };
}

it('fans out a private Card over concurrent streams and counts tabs from one cookie once', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-live-session-secret-with-at-least-32-chars');
  const streams: ReturnType<typeof readLiveStream>[] = [];
  try {
    const { createBoardForRequest, dispatchBoardCommandForRequest, getBoardForRequest } =
      await import('./services/board-service');
    const { handleLiveRequest } = await import('./live-handler');
    const origin = 'https://retrocks.app';
    const { result: board, cookie: creatorCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => createBoardForRequest({ isBlurred: true }),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    const liveUrl = `${origin}/api/boards/${board.id}/live`;
    const { cookie: authorCookie } = await withSession(
      new Request(boardUrl),
      () => getBoardForRequest(board.id),
    );
    expect(authorCookie).toBeTruthy();
    expect(creatorCookie).toBeTruthy();
    expect((await handleLiveRequest(board.id, new Request(liveUrl))).status).toBe(401);

    async function open(cookie: string) {
      const stream = readLiveStream(await handleLiveRequest(
        board.id,
        new Request(liveUrl, { headers: { cookie } }),
      ));
      streams.push(stream);
      return stream;
    }

    const [author, authorSecondTab, facilitator] = await Promise.all([
      open(authorCookie!),
      open(authorCookie!),
      open(creatorCookie!),
    ]);
    const subscribers = [author, authorSecondTab, facilitator];
    const snapshots = await Promise.all(subscribers.map((stream) =>
      stream.until('board:snapshot'),
    ));
    expect(snapshots.map(({ board }) => board.isFacilitator))
      .toEqual([false, false, true]);
    await Promise.all(subscribers.map((stream) =>
      stream.until('presence:count', (message) => message.count === 2),
    ));

    const content = 'Private checkout feedback';
    await withSession(
      new Request(boardUrl, { method: 'POST', headers: { cookie: authorCookie! } }),
      () => dispatchBoardCommandForRequest(board.id, { type: 'card:create', columnId: board.columns[0].id, content }),
    );
    const mutations = await Promise.all(subscribers.map((stream) =>
      stream.until('board:mutation'),
    ));
    const ownedCard = { content, isMine: true, redacted: false };
    for (const mutation of mutations.slice(0, 2)) {
      expect(mutation).toMatchObject({ version: 2, events: [{ type: 'card:upserted', card: ownedCard }] });
    }
    expect(mutations[2]).toMatchObject({
      version: 2,
      events: [{ type: 'card:upserted', card: { content: '', isMine: false, redacted: true } }],
    });
    expect(JSON.stringify(mutations)).not.toMatch(/participantHash|authorTokenHash|tokenSalt/);

    await author.close();
    await authorSecondTab.close();
    expect(await facilitator.until('presence:count', (message) => message.count === 1)).toEqual({ type: 'presence:count', count: 1 });
  } finally {
    await Promise.all(streams.map((stream) => stream.close()));
    vi.unstubAllEnvs();
  }
});

it('atomically projects Private Mode and Reveal All over HTTP and every live stream', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-live-session-secret-with-at-least-32-chars');
  const streams: ReturnType<typeof readLiveStream>[] = [];
  try {
    const service = await import('./services/board-service');
    const { handleLiveRequest } = await import('./live-handler');
    const origin = 'https://retrocks.app';
    const { result: board, cookie: facilitatorCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => service.createBoardForRequest({}),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    const liveUrl = `${origin}/api/boards/${board.id}/live`;
    const { cookie: participantCookie } = await withSession(
      new Request(boardUrl),
      () => service.getBoardForRequest(board.id),
    );
    async function post<T>(cookie: string, run: () => Promise<T>) {
      return (await withSession(new Request(boardUrl, {
        method: 'POST',
        headers: { cookie },
      }), run)).result;
    }

    const participantText = 'Only its author can read this in Private Mode.';
    const facilitatorText = 'Facilitator feedback is equally private.';
    for (const [cookie, content] of [
      [participantCookie!, participantText],
      [facilitatorCookie!, facilitatorText],
    ]) {
      await post(cookie, () => service.dispatchBoardCommandForRequest(board.id, {
        type: 'card:create', columnId: board.columns[0].id, content,
      }));
      streams.push(readLiveStream(await handleLiveRequest(
        board.id,
        new Request(liveUrl, { headers: { cookie } }),
      )));
      await streams.at(-1)!.until('board:snapshot');
    }

    const setPrivateMode = (cookie: string, isBlurred: boolean) =>
      post(cookie, () => service.dispatchBoardCommandForRequest(board.id, { type: 'board:set-private-mode', isBlurred }));
    await expect(setPrivateMode(participantCookie!, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const enabled = await setPrivateMode(facilitatorCookie!, true);
    const privateFrame = streams.map((stream) =>
      stream.until('board:snapshot', (message) => message.version === enabled.version),
    );
    const [participantFrame, facilitatorFrame] = await Promise.all(privateFrame);
    expect(enabled.events).toEqual([{ ...facilitatorFrame, serverNow: expect.any(Number) }]);
    expect(facilitatorFrame.board).toMatchObject({ isBlurred: true, isFacilitator: true });
    expect(participantFrame.board).toMatchObject({ isBlurred: true, isFacilitator: false });

    for (const [frame, ownText, privateText] of [
      [facilitatorFrame, facilitatorText, participantText],
      [participantFrame, participantText, facilitatorText],
    ] as const) {
      expect(frame.board.cards).toEqual(expect.arrayContaining([
        expect.objectContaining({ content: ownText, isMine: true, redacted: false }),
        expect.objectContaining({ content: '', comments: [], isMine: false, redacted: true, placeholderLines: 1 }),
      ]));
      expect(JSON.stringify(frame)).not.toContain(privateText);
    }

    const { result: privateRead } = await withSession(
      new Request(boardUrl, { headers: { cookie: facilitatorCookie! } }),
      () => service.getBoardForRequest(board.id),
    );
    expect(privateRead).toEqual(facilitatorFrame.board);

    const revealed = await setPrivateMode(facilitatorCookie!, false);
    expect(revealed.version).toBe(enabled.version + 1);
    const revealFrames = await Promise.all(streams.map((stream) =>
      stream.until('board:snapshot', (message) => message.version === revealed.version),
    ));
    expect(revealed.events).toEqual([{ ...revealFrames[1], serverNow: expect.any(Number) }]);
    for (const { board: revealedBoard } of revealFrames) {
      expect(revealedBoard.isBlurred).toBe(false);
      expect(revealedBoard.cards).toEqual(expect.arrayContaining([
        expect.objectContaining({ content: participantText, redacted: false }),
        expect.objectContaining({ content: facilitatorText, redacted: false }),
      ]));
    }
  } finally {
    await Promise.all(streams.map((stream) => stream.close()));
    vi.unstubAllEnvs();
  }
});

it('prunes an SSE subscriber that stops sending heartbeats', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-live-session-secret-with-at-least-32-chars');
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  const streams: ReturnType<typeof readLiveStream>[] = [];
  try {
    const { createBoardForRequest, getBoardForRequest } = await import('./services/board-service');
    const { handleLiveRequest } = await import('./live-handler');
    const origin = 'https://retrocks.app';
    const { result: board, cookie: activeCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => createBoardForRequest({}),
    );
    const { cookie: staleCookie } = await withSession(
      new Request(`${origin}/b/${board.id}`),
      () => getBoardForRequest(board.id),
    );
    const liveUrl = `${origin}/api/boards/${board.id}/live`;
    for (const cookie of [activeCookie!, staleCookie!]) {
      streams.push(readLiveStream(await handleLiveRequest(
        board.id,
        new Request(liveUrl, { headers: { cookie } }),
      )));
    }
    const [active, stale] = streams;
    const { connectionId } = await active.until('board:snapshot');
    const { connectionId: staleConnectionId } = await stale.until('board:snapshot');
    await active.until('presence:count', (message) => message.count === 2);
    expect(connectionId).toBeTruthy();
    expect(staleConnectionId).not.toBe(connectionId);

    const ping = (id: string) => handleLiveRequest(board.id, new Request(liveUrl, {
      method: 'POST',
      headers: { cookie: activeCookie!, 'x-retrocks-live-connection': id },
    }));
    expect((await ping(staleConnectionId!)).status).toBe(404);
    for (let elapsed = 0; elapsed < 2 * LIVE_HEARTBEAT_MS; elapsed += LIVE_HEARTBEAT_MS) {
      vi.advanceTimersByTime(LIVE_HEARTBEAT_MS);
      expect((await ping(connectionId!)).status).toBe(204);
      expect(await active.until('heartbeat')).toEqual({ type: 'heartbeat' });
    }
    vi.advanceTimersByTime(LIVE_HEARTBEAT_MS);
    expect(await active.until('presence:count', (message) => message.count === 1))
      .toEqual({ type: 'presence:count', count: 1 });
  } finally {
    await Promise.all(streams.map((stream) => stream.close()));
    vi.useRealTimers();
    vi.unstubAllEnvs();
  }
});

it('broadcasts a Facilitator’s timer deadline and server time to Participants', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-live-session-secret-with-at-least-32-chars');
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-19T14:00:00Z') });
  let stream: ReturnType<typeof readLiveStream> | undefined;
  try {
    const { createBoardForRequest, dispatchBoardCommandForRequest, getBoardForRequest } =
      await import('./services/board-service');
    const { handleLiveRequest } = await import('./live-handler');
    const origin = 'https://retrocks.app';
    const { result: board, cookie: facilitatorCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => createBoardForRequest({}),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    const { cookie: participantCookie } = await withSession(
      new Request(boardUrl),
      () => getBoardForRequest(board.id),
    );
    const makeLiveRequest = () => handleLiveRequest(
      board.id,
      new Request(`${origin}/api/boards/${board.id}/live`, {
        headers: { cookie: participantCookie! },
      }),
    );
    stream = readLiveStream(await makeLiveRequest());
    expect((await stream.until('board:snapshot')).board.timer).toEqual({
      endsAt: null, remainingMs: null, durationMs: null,
    });

    const { result } = await withSession(
      new Request(boardUrl, { method: 'POST', headers: { cookie: facilitatorCookie! } }),
      () => dispatchBoardCommandForRequest(board.id, { type: 'timer:update', change: { action: 'start', minutes: 3 } }),
    );
    const timer = {
      endsAt: Date.parse('2026-11-19T14:03:00Z'),
      remainingMs: null,
      durationMs: 180_000,
    };
    const event = {
      type: 'timer:updated',
      version: 2,
      serverNow: Date.parse('2026-11-19T14:00:00Z'),
      timer,
    };
    expect(result.events).toEqual([event]);
    expect(result.lastActiveAt).toBe(event.serverNow);
    expect(await stream.until('board:mutation')).toEqual({
      type: 'board:mutation', version: 2, lastActiveAt: event.serverNow, events: [event],
    });

    await stream.close();
    stream = readLiveStream(await makeLiveRequest());
    expect((await stream.until('board:snapshot')).board.timer).toEqual(timer);
  } finally {
    await stream?.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  }
});

it('redacts Blind Voting totals in HTTP and both live streams, then reveals and resets everyone together', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-live-session-secret-with-at-least-32-chars');
  const streams: ReturnType<typeof readLiveStream>[] = [];

  try {
    const { createBoardForRequest, dispatchBoardCommandForRequest, getBoardForRequest } =
      await import('./services/board-service');
    const { handleLiveRequest } = await import('./live-handler');
    const origin = 'https://retrocks.app';
    const { result: board, cookie: facilitatorCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => createBoardForRequest({}),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    const liveUrl = `${origin}/api/boards/${board.id}/live`;
    const { cookie: participantCookie } = await withSession(
      new Request(boardUrl),
      () => getBoardForRequest(board.id),
    );

    const write = <T>(cookie: string, handler: () => Promise<T>) =>
      withSession(new Request(boardUrl, { method: 'POST', headers: { cookie } }), handler);

    const { result: created } = await write(facilitatorCookie!, () =>
      dispatchBoardCommandForRequest(board.id, { type: 'card:create', columnId: board.columns[0].id, content: 'Keep pairing' }));
    const cardEvent = created.events[0];
    if (cardEvent.type !== 'card:upserted') throw new Error('Expected a new Card');

    const voteCommand = { type: 'vote:change', targetType: 'card', targetId: cardEvent.card.id, delta: 1 } as const;
    await write(participantCookie!, () => dispatchBoardCommandForRequest(board.id, voteCommand));
    await write(participantCookie!, () => dispatchBoardCommandForRequest(board.id, voteCommand));

    for (const cookie of [participantCookie!, facilitatorCookie!]) {
      streams.push(readLiveStream(await handleLiveRequest(board.id, new Request(liveUrl, { headers: { cookie } }))));
    }
    const initial = await Promise.all(streams.map((stream) => stream.until('board:snapshot')));
    expect(initial.map(({ board }) => board.cards[0].votes)).toEqual([2, 2]);

    const setBlind = (blindVoting: boolean) => write(facilitatorCookie!, () =>
      dispatchBoardCommandForRequest(board.id, { type: 'voting:configure', blindVoting }));
    const { result: enabled } = await setBlind(true);
    expect(enabled.events).toEqual([expect.objectContaining({
      type: 'board:snapshot',
      board: expect.objectContaining({
        blindVoting: true,
        cards: [expect.objectContaining({ votes: null, myVotes: 0 })],
      }),
    })]);
    const enabledOnStreams = await Promise.all(streams.map((stream) => stream.until('board:snapshot')));
    expect(enabledOnStreams).toMatchObject([
      { version: enabled.version, board: { blindVoting: true, cards: [{ votes: null, myVotes: 2 }], remainingVotes: 3 } },
      { version: enabled.version, board: { blindVoting: true, cards: [{ votes: null, myVotes: 0 }], remainingVotes: 5 } },
    ]);

    const { result: blindVote } = await write(facilitatorCookie!, () => dispatchBoardCommandForRequest(board.id, voteCommand));
    expect(blindVote.events).toMatchObject([{ type: 'vote:updated', totalVotes: null, myVotes: 1, remainingVotes: 4 }]);
    const blindDeltas = await Promise.all(streams.map((stream) => stream.until('board:mutation')));
    expect(blindDeltas).toMatchObject([
      { version: blindVote.version, events: [{ type: 'vote:updated', totalVotes: null, myVotes: 2, remainingVotes: 3 }] },
      { version: blindVote.version, events: [{ type: 'vote:updated', totalVotes: null, myVotes: 1, remainingVotes: 4 }] },
    ]);
    const { result: httpRead } = await withSession(
      new Request(boardUrl, { headers: { cookie: participantCookie! } }),
      () => getBoardForRequest(board.id),
    );
    expect(httpRead).toMatchObject({ blindVoting: true, cards: [{ votes: null, myVotes: 2 }] });

    const { result: revealed } = await setBlind(false);
    const facilitatorReveal = { blindVoting: false, cards: [{ votes: 3, myVotes: 1 }], remainingVotes: 4 };
    expect(revealed.events).toMatchObject([{ type: 'board:snapshot', board: facilitatorReveal }]);
    const revealedOnStreams = await Promise.all(streams.map((stream) => stream.until('board:snapshot')));
    expect(revealedOnStreams).toMatchObject([
      { version: revealed.version, board: { blindVoting: false, cards: [{ votes: 3, myVotes: 2 }], remainingVotes: 3 } },
      { version: revealed.version, board: facilitatorReveal },
    ]);

    const { result: reset } = await write(facilitatorCookie!, () => dispatchBoardCommandForRequest(board.id, { type: 'voting:reset' }));
    const resetOnStreams = await Promise.all(streams.map((stream) => stream.until('board:snapshot')));
    expect(resetOnStreams).toMatchObject(streams.map(() => ({
      version: reset.version,
      board: { cards: [{ votes: 0, myVotes: 0 }], remainingVotes: 5 },
    })));
  } finally {
    await Promise.all(streams.map((stream) => stream.close()));
    vi.unstubAllEnvs();
  }
});

it('broadcasts board:deleted to all live clients and immediately returns 404 on subsequent reads', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-live-session-secret-with-at-least-32-chars');
  const streams: ReturnType<typeof readLiveStream>[] = [];
  try {
    const service = await import('./services/board-service');
    const { handleLiveRequest } = await import('./live-handler');
    const { getBoardRealtime } = await import('./adapters/runtime');
    const origin = 'https://retrocks.app';
    const { result: board, cookie: facilitatorCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => service.createBoardForRequest({}),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    const liveUrl = `${origin}/api/boards/${board.id}/live`;
    const { cookie: participantCookie } = await withSession(
      new Request(boardUrl),
      () => service.getBoardForRequest(board.id),
    );

    const [participantStream, facilitatorStream] = await Promise.all(
      [participantCookie!, facilitatorCookie!].map(async (cookie) => {
        const stream = readLiveStream(
          await handleLiveRequest(board.id, new Request(liveUrl, { headers: { cookie } })),
        );
        streams.push(stream);
        await stream.until('board:snapshot');
        return stream;
      }),
    );

    // Lock then permanently delete the Board.
    await withSession(
      new Request(boardUrl, { method: 'POST', headers: { cookie: facilitatorCookie! } }),
      () => service.dispatchBoardCommandForRequest(board.id, { type: 'board:set-lock', isLocked: true }),
    );
    const lockFrames = await Promise.all([
      participantStream.until('board:mutation'),
      facilitatorStream.until('board:mutation'),
    ]);
    expect(lockFrames[0]).toMatchObject({
      events: [{ type: 'board:updated', patch: { isLocked: true } }],
    });

    const { result: deleted } = await withSession(
      new Request(boardUrl, { method: 'POST', headers: { cookie: facilitatorCookie! } }),
      () => service.dispatchBoardCommandForRequest(board.id, { type: 'board:delete' }),
    );
    expect(deleted).toMatchObject({
      ok: true,
      events: [{ type: 'board:deleted', version: deleted.version }],
    });

    const deletedFrames = await Promise.all([
      participantStream.until('board:deleted'),
      facilitatorStream.until('board:deleted'),
    ]);
    expect(deletedFrames).toEqual([
      { type: 'board:deleted', version: deleted.version },
      { type: 'board:deleted', version: deleted.version },
    ]);

    // Presence is cleared once subscribers disconnect after board:deleted.
    expect(await getBoardRealtime().getPresenceCount(board.id)).toBe(0);

    // Subsequent HTTP reads return null (404) and live endpoint rejects with 404.
    const { result: afterDeleteRead } = await withSession(
      new Request(boardUrl, { headers: { cookie: participantCookie! } }),
      () => service.getBoardForRequest(board.id),
    );
    expect(afterDeleteRead).toBeNull();
    const afterDeleteLive = await handleLiveRequest(
      board.id,
      new Request(liveUrl, { headers: { cookie: participantCookie! } }),
    );
    expect(afterDeleteLive.status).toBe(404);
  } finally {
    await Promise.all(streams.map((stream) => stream.close()));
    vi.unstubAllEnvs();
  }
});

it('rejects unsupported HTTP methods with 405, Allow: GET, POST, and Cache-Control: no-store on Board and Room live endpoints', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-live-session-secret-with-at-least-32-chars');
  try {
    const { handleLiveRequest } = await import('./live-handler');
    const { handlePokerLiveRequest } = await import('./poker/service');
    const origin = 'https://retrocks.app';
    const validId = 'AbCdEfGhIjKlMnOpQrStUv';

    for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD'] as const) {
      const boardResponse = await handleLiveRequest(
        validId,
        new Request(`${origin}/api/boards/${validId}/live`, { method }),
      );
      expect(boardResponse.status).toBe(405);
      expect(boardResponse.headers.get('allow')).toBe('GET, POST');
      expect(boardResponse.headers.get('cache-control')).toBe('no-store');

      const roomResponse = await handlePokerLiveRequest(
        validId,
        new Request(`${origin}/api/poker/${validId}/live`, { method }),
      );
      expect(roomResponse.status).toBe(405);
      expect(roomResponse.headers.get('allow')).toBe('GET, POST');
      expect(roomResponse.headers.get('cache-control')).toBe('no-store');
    }
  } finally {
    vi.unstubAllEnvs();
  }
});

it('enforces origin, ID, session, non-stream no-store, and SSE cache-control parity across Boards and Rooms', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-live-session-secret-with-at-least-32-chars');
  const { openNodePokerRooms } = await import('./poker/node');
  const { setNodePokerRoomsForTests } = await import('./poker/runtime');
  const rooms = await openNodePokerRooms(':memory:');
  setNodePokerRoomsForTests(rooms);
  const streams: ReturnType<typeof readLiveStream>[] = [];
  let roomReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const { createBoardForRequest } = await import('./services/board-service');
    const { handleLiveRequest } = await import('./live-handler');
    const { createPokerRoomForRequest, handlePokerLiveRequest, readPokerRoomForRequest } =
      await import('./poker/service');
    const origin = 'https://retrocks.app';

    const { result: board, cookie: boardCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => createBoardForRequest({}),
    );
    const { result: createdRoom, cookie: roomFacilitatorCookie } = await withSession(
      new Request(origin, { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.10' } }),
      () => createPokerRoomForRequest('Alex'),
    );
    if (!createdRoom.ok || !roomFacilitatorCookie || !boardCookie) {
      throw new Error('Expected Board and Room fixtures to be created.');
    }
    const roomId = createdRoom.room.id;
    const { cookie: unjoinedVisitorCookie } = await withSession(
      new Request(`${origin}/p/${roomId}`),
      () => readPokerRoomForRequest(roomId),
    );
    expect(unjoinedVisitorCookie).toBeTruthy();

    const boardLiveUrl = `${origin}/api/boards/${board.id}/live`;
    const roomLiveUrl = `${origin}/api/poker/${roomId}/live`;

    // Cross-origin -> 403 + Cache-Control: no-store
    for (const [handler, id, url, cookie] of [
      [handleLiveRequest, board.id, boardLiveUrl, boardCookie],
      [handlePokerLiveRequest, roomId, roomLiveUrl, roomFacilitatorCookie],
    ] as const) {
      const crossOrigin = await handler(id, new Request(url, {
        headers: { origin: 'https://evil.example', cookie },
      }));
      expect(crossOrigin.status).toBe(403);
      expect(crossOrigin.headers.get('cache-control')).toBe('no-store');

      // Invalid identifier -> 404 + Cache-Control: no-store
      const invalidId = await handler('not-a-valid-id', new Request(`${origin}/api/live`, {
        headers: { origin, cookie },
      }));
      expect(invalidId.status).toBe(404);
      expect(invalidId.headers.get('cache-control')).toBe('no-store');

      // Unauthenticated -> 401 + Cache-Control: no-store
      const unauth = await handler(id, new Request(url, { headers: { origin } }));
      expect(unauth.status).toBe(401);
      expect(unauth.headers.get('cache-control')).toBe('no-store');

      // Aborted signal -> 408 + Cache-Control: no-store
      const aborted = new AbortController();
      aborted.abort();
      const abortedResponse = await handler(id, new Request(url, {
        headers: { origin, cookie },
        signal: aborted.signal,
      }));
      expect(abortedResponse.status).toBe(408);
      expect(abortedResponse.headers.get('cache-control')).toBe('no-store');
    }

    // Missing Board (valid ID format) -> 404 + Cache-Control: no-store
    const missingBoardId = 'AbCdEfGhIjKlMnOpQrStUv';
    const missingBoard = await handleLiveRequest(
      missingBoardId,
      new Request(`${origin}/api/boards/${missingBoardId}/live`, { headers: { cookie: boardCookie } }),
    );
    expect(missingBoard.status).toBe(404);
    expect(missingBoard.headers.get('cache-control')).toBe('no-store');

    // Unjoined Participant on open Room -> 403 + Cache-Control: no-store
    const unjoinedRoom = await handlePokerLiveRequest(
      roomId,
      new Request(roomLiveUrl, { headers: { cookie: unjoinedVisitorCookie! } }),
    );
    expect(unjoinedRoom.status).toBe(403);
    expect(unjoinedRoom.headers.get('cache-control')).toBe('no-store');

    // Same-origin SSE streams succeed and preserve `no-store, no-transform`.
    const boardStreamResponse = await handleLiveRequest(
      board.id,
      new Request(boardLiveUrl, { headers: { origin, cookie: boardCookie } }),
    );
    expect(boardStreamResponse.headers.get('cache-control')).toBe('no-store, no-transform');
    streams.push(readLiveStream(boardStreamResponse));

    const roomStreamResponse = await handlePokerLiveRequest(
      roomId,
      new Request(roomLiveUrl, { headers: { origin, cookie: roomFacilitatorCookie } }),
    );
    expect(roomStreamResponse.status).toBe(200);
    expect(roomStreamResponse.headers.get('content-type')).toBe('text/event-stream');
    expect(roomStreamResponse.headers.get('cache-control')).toBe('no-store, no-transform');
    roomReader = roomStreamResponse.body!.getReader();
  } finally {
    await roomReader?.cancel();
    await Promise.all(streams.map((stream) => stream.close()));
    setNodePokerRoomsForTests(null);
    rooms.close();
    vi.unstubAllEnvs();
  }
});

it('enforces POST heartbeat header validation and Cache-Control: no-store parity on Node SSE for Boards and Rooms', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-live-session-secret-with-at-least-32-chars');
  const { openNodePokerRooms } = await import('./poker/node');
  const { setNodePokerRoomsForTests } = await import('./poker/runtime');
  const rooms = await openNodePokerRooms(':memory:');
  setNodePokerRoomsForTests(rooms);
  const boardStreams: ReturnType<typeof readLiveStream>[] = [];
  let roomReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const { createBoardForRequest, getBoardForRequest } = await import('./services/board-service');
    const { handleLiveRequest } = await import('./live-handler');
    const { createPokerRoomForRequest, handlePokerLiveRequest, mutatePokerRoomForRequest } =
      await import('./poker/service');
    const origin = 'https://retrocks.app';

    const { result: board, cookie: boardCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => createBoardForRequest({}),
    );
    const { cookie: otherBoardCookie } = await withSession(
      new Request(`${origin}/b/${board.id}`),
      () => getBoardForRequest(board.id),
    );
    const { result: createdRoom, cookie: roomCookie } = await withSession(
      new Request(origin, { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.11' } }),
      () => createPokerRoomForRequest('Alex'),
    );
    if (!createdRoom.ok || !boardCookie || !otherBoardCookie || !roomCookie) {
      throw new Error('Expected Board and Room fixtures to be created.');
    }
    const roomId = createdRoom.room.id;
    const { cookie: otherRoomCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => mutatePokerRoomForRequest(roomId, { type: 'join', displayName: 'Sam' }),
    );
    expect(otherRoomCookie).toBeTruthy();

    const boardLiveUrl = `${origin}/api/boards/${board.id}/live`;
    const roomLiveUrl = `${origin}/api/poker/${roomId}/live`;

    const boardStream = readLiveStream(
      await handleLiveRequest(board.id, new Request(boardLiveUrl, { headers: { cookie: boardCookie } })),
    );
    boardStreams.push(boardStream);
    const boardSnapshot = await boardStream.until('board:snapshot');
    expect(boardSnapshot.connectionId).toBeTruthy();

    const roomResponse = await handlePokerLiveRequest(
      roomId,
      new Request(roomLiveUrl, { headers: { cookie: roomCookie } }),
    );
    expect(roomResponse.status).toBe(200);
    roomReader = roomResponse.body!.getReader();
    const decoder = new TextDecoder();
    let roomPending = '';
    const nextRoomFrame = async () => {
      while (true) {
        const end = roomPending.indexOf('\n\n');
        if (end >= 0) {
          const frame = roomPending.slice(0, end);
          roomPending = roomPending.slice(end + 2);
          return parsePokerLiveMessage(frame.slice('data: '.length));
        }
        const chunk = await roomReader!.read();
        if (chunk.done) throw new Error('Room live stream ended unexpectedly');
        roomPending += decoder.decode(chunk.value, { stream: true });
      }
    };
    const roomSnapshot = await nextRoomFrame();
    if (roomSnapshot.type !== 'room:snapshot' || !roomSnapshot.connectionId) {
      throw new Error('Expected Room snapshot with connectionId');
    }
    await nextRoomFrame(); // initial room:presence

    for (const [handler, id, url, cookie, otherCookie, connectionId] of [
      [handleLiveRequest, board.id, boardLiveUrl, boardCookie, otherBoardCookie, boardSnapshot.connectionId!],
      [handlePokerLiveRequest, roomId, roomLiveUrl, roomCookie, otherRoomCookie!, roomSnapshot.connectionId],
    ] as const) {
      // Missing header -> 400 + Cache-Control: no-store
      const missingHeader = await handler(id, new Request(url, {
        method: 'POST',
        headers: { cookie },
      }));
      expect(missingHeader.status).toBe(400);
      expect(missingHeader.headers.get('cache-control')).toBe('no-store');

      // Blank header -> 400 + Cache-Control: no-store
      const blankHeader = await handler(id, new Request(url, {
        method: 'POST',
        headers: { cookie, [LIVE_CONNECTION_HEADER]: '   ' },
      }));
      expect(blankHeader.status).toBe(400);
      expect(blankHeader.headers.get('cache-control')).toBe('no-store');

      // Wrong Participant -> 404 + Cache-Control: no-store
      const wrongParticipant = await handler(id, new Request(url, {
        method: 'POST',
        headers: { cookie: otherCookie, [LIVE_CONNECTION_HEADER]: connectionId },
      }));
      expect(wrongParticipant.status).toBe(404);
      expect(wrongParticipant.headers.get('cache-control')).toBe('no-store');

      // Valid heartbeat -> 204 + Cache-Control: no-store
      const ok = await handler(id, new Request(url, {
        method: 'POST',
        headers: { cookie, [LIVE_CONNECTION_HEADER]: connectionId },
      }));
      expect(ok.status).toBe(204);
      expect(ok.headers.get('cache-control')).toBe('no-store');
    }

    expect(await boardStream.until('heartbeat')).toEqual({ type: 'heartbeat' });
    expect(await nextRoomFrame()).toEqual({ type: 'heartbeat' });
  } finally {
    await roomReader?.cancel();
    await Promise.all(boardStreams.map((stream) => stream.close()));
    setNodePokerRoomsForTests(null);
    rooms.close();
    vi.unstubAllEnvs();
  }
});

it('rejects POST heartbeats with 405 Allow: GET without waking Durable Objects and leaves 101 upgrades untouched on Cloudflare', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-live-session-secret-with-at-least-32-chars');
  try {
    const { createBoardForRequest } = await import('./services/board-service');
    const { handleLiveRequest } = await import('./live-handler');
    const { handlePokerLiveRequest } = await import('./poker/service');
    const origin = 'https://retrocks.app';
    const { result: board, cookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => createBoardForRequest({}),
    );
    expect(cookie).toBeTruthy();

    const boardDoFetch = vi.fn<() => Promise<Response>>();
    const boardGetSalt = vi.fn(async () => 'board-salt');
    const pokerDoFetch = vi.fn<() => Promise<Response>>();

    const fakeEnv = {
      BOARD_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          getBoardTokenSalt: boardGetSalt,
          fetch: boardDoFetch,
        }),
      },
      POINTING_POKER_ROOM: {
        getByName: () => ({
          fetch: pokerDoFetch,
        }),
      },
    } as unknown as Cloudflare.Env;

    await runWithCloudflareEnv(fakeEnv, async () => {
      const boardUrl = `${origin}/api/boards/${board.id}/live`;
      const roomId = 'AbCdEfGhIjKlMnOpQrStUv';
      const roomUrl = `${origin}/api/poker/${roomId}/live`;

      // POST heartbeats (with or without connection header) -> 405 Allow: GET + no-store, without invoking DO.
      const postHeaderVariants: Record<string, string>[] = [
        { cookie: cookie! },
        { cookie: cookie!, [LIVE_CONNECTION_HEADER]: 'conn-1' },
      ];
      for (const headers of postHeaderVariants) {
        const boardPost = await handleLiveRequest(board.id, new Request(boardUrl, { method: 'POST', headers }));
        expect(boardPost.status).toBe(405);
        expect(boardPost.headers.get('allow')).toBe('GET');
        expect(boardPost.headers.get('cache-control')).toBe('no-store');

        const roomPost = await handlePokerLiveRequest(roomId, new Request(roomUrl, { method: 'POST', headers }));
        expect(roomPost.status).toBe(405);
        expect(roomPost.headers.get('allow')).toBe('GET');
        expect(roomPost.headers.get('cache-control')).toBe('no-store');
      }
      expect(boardGetSalt).not.toHaveBeenCalled();
      expect(boardDoFetch).not.toHaveBeenCalled();
      expect(pokerDoFetch).not.toHaveBeenCalled();

      // Non-WebSocket GET on Board returns 426 with Upgrade: websocket and Cache-Control: no-store.
      const nonUpgrade = await handleLiveRequest(board.id, new Request(boardUrl, {
        headers: { cookie: cookie! },
      }));
      expect(nonUpgrade.status).toBe(426);
      expect(nonUpgrade.headers.get('upgrade')).toBe('websocket');
      expect(nonUpgrade.headers.get('cache-control')).toBe('no-store');
      expect(boardDoFetch).not.toHaveBeenCalled();

      // WebSocket 101 responses pass through untouched so Cloudflare `.webSocket` stays intact.
      const makeUpgradeSentinel = () => {
        const sentinel = new Response(null, { status: 200 });
        Object.defineProperty(sentinel, 'status', { value: 101 });
        return sentinel;
      };
      const board101 = makeUpgradeSentinel();
      const poker101 = makeUpgradeSentinel();
      boardDoFetch.mockResolvedValueOnce(board101);
      pokerDoFetch.mockResolvedValueOnce(poker101);

      const boardUpgrade = await handleLiveRequest(board.id, new Request(boardUrl, {
        headers: { cookie: cookie!, upgrade: 'websocket' },
      }));
      expect(boardUpgrade).toBe(board101);
      expect(boardUpgrade.status).toBe(101);

      const roomUpgrade = await handlePokerLiveRequest(roomId, new Request(roomUrl, {
        headers: { cookie: cookie!, upgrade: 'websocket' },
      }));
      expect(roomUpgrade).toBe(poker101);
      expect(roomUpgrade.status).toBe(101);
    });
  } finally {
    vi.unstubAllEnvs();
  }
});
