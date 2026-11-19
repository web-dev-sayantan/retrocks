import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { expect, it, vi } from 'vitest';

import { LIVE_HEARTBEAT_MS, type BoardLiveMessage } from '../lib/board-live-protocol';

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
    const { createBoardForRequest, createCardForRequest, getBoardForRequest } =
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
      () => createCardForRequest({ boardId: board.id, columnId: board.columns[0].id, content }),
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
