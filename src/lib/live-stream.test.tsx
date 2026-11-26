import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  boardLivePath,
  type BoardLiveMessage,
} from './board-live-protocol';
import {
  LIVE_CONNECTION_HEADER,
  LIVE_HEARTBEAT_MS,
  LIVE_HEARTBEAT_TIMEOUT_MS,
} from './live-protocol';
import type { BoardViewDTO } from './board-types';
import {
  createLiveStream,
  createSseTransport,
  createWebSocketTransport,
  type LiveTransport,
} from './live-stream';
import { parseBoardLiveMessage } from './wire-schemas';

interface FakeConnection {
  path: string;
  open: boolean;
  closed: boolean;
  failNextPing: boolean;
  pings: Array<string | undefined>;
  emit(data: string): void;
  fail(): void;
}

function createFakeTransport(): { transport: LiveTransport; connections: FakeConnection[] } {
  const connections: FakeConnection[] = [];
  const transport: LiveTransport = {
    connect(path, handlers) {
      const connection: FakeConnection = {
        path,
        open: true,
        closed: false,
        failNextPing: false,
        pings: [],
        emit(data) {
          handlers.onMessage(data);
        },
        fail() {
          handlers.onFailure();
        },
      };
      connections.push(connection);
      return {
        isOpen() {
          return connection.open;
        },
        ping(connectionId) {
          connection.pings.push(connectionId);
          if (connection.failNextPing) {
            connection.failNextPing = false;
            handlers.onFailure();
          }
        },
        close() {
          connection.open = false;
          connection.closed = true;
        },
      };
    },
  };
  return { transport, connections };
}

function makeSnapshot(version: number, connectionId?: string): BoardLiveMessage {
  const board: BoardViewDTO = {
    id: 'board_1',
    title: 'Sprint 42 Retro',
    subtitle: '',
    templateId: 'standard',
    isBlurred: false,
    blindVoting: false,
    isLocked: false,
    allowParticipantGroup: false,
    voteLimit: null,
    maxVotesPerCard: null,
    remainingVotes: null,
    isFacilitator: false,
    timer: { endsAt: null, remainingMs: null, durationMs: null },
    version,
    retentionDays: 90,
    createdAt: 1,
    lastActiveAt: 1,
    columns: [],
    groups: [],
    cards: [],
  };
  return {
    type: 'board:snapshot',
    version,
    serverNow: version * 100,
    board,
    ...(connectionId === undefined ? {} : { connectionId }),
  };
}

function emitMessage(connection: FakeConnection, message: BoardLiveMessage): void {
  connection.emit(JSON.stringify(message));
}

const sessions: Array<{ dispose(): void }> = [];

function startLive(transport: LiveTransport, boardId = 'board_1') {
  const messages: BoardLiveMessage[] = [];
  let disconnects = 0;
  const stream = createLiveStream<BoardLiveMessage>(
    boardLivePath(boardId),
    {
      parse: parseBoardLiveMessage,
      handshake: (message) => (message.type === 'board:snapshot' ? message : undefined),
      isTerminal: (message) => message.type === 'board:deleted',
      onMessage(message) {
        messages.push(message);
      },
      onDisconnect() {
        disconnects += 1;
      },
    },
    transport,
  );
  sessions.push(stream);
  return {
    ...stream,
    messages,
    lastMessage: () => messages.at(-1) ?? null,
    disconnects: () => disconnects,
  };
}

describe('createLiveStream', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    for (const live of sessions) live.dispose();
    sessions.length = 0;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects via the transport, updates status reactively, and delivers messages to onMessage', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport, 'board 42');
    flush();
    expect(connections).toHaveLength(1);
    expect(connections[0].path).toBe('/api/boards/board%2042/live');
    expect(live.status()).toBe('connecting');

    emitMessage(connections[0], makeSnapshot(1, 'conn_1'));
    flush();
    expect(live.status()).toBe('live');
    expect(live.lastMessage()).toMatchObject({ type: 'board:snapshot', version: 1 });

    emitMessage(connections[0], { type: 'presence:count', count: 3 });
    flush();
    expect(live.lastMessage()).toEqual({ type: 'presence:count', count: 3 });
    expect(live.status()).toBe('live');

    emitMessage(connections[0], {
      type: 'board:mutation',
      version: 2,
      events: [{ type: 'board:updated', version: 2, patch: { title: 'Renamed' } }],
    });
    flush();
    expect(live.lastMessage()).toMatchObject({ type: 'board:mutation', version: 2 });
  });

  it('retries with capped backoff after transport failures', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();

    connections[0].fail();
    flush();
    expect(live.status()).toBe('reconnecting');
    expect(connections[0].closed).toBe(true);

    for (const [index, delay] of [500, 1_000, 2_000, 5_000, 10_000, 10_000].entries()) {
      vi.advanceTimersByTime(delay);
      flush();
      expect(connections).toHaveLength(index + 2);
      connections[index + 1].fail();
      flush();
    }
  });

  it('applies jitter to the retry delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { transport, connections } = createFakeTransport();
    startLive(transport);
    flush();

    connections[0].fail();
    vi.advanceTimersByTime(549);
    flush();
    expect(connections).toHaveLength(1);
    vi.advanceTimersByTime(1);
    flush();
    expect(connections).toHaveLength(2);
  });

  it('resets the backoff attempt counter when a handshake arrives', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { transport, connections } = createFakeTransport();
    startLive(transport);
    flush();

    connections[0].fail();
    vi.advanceTimersByTime(500);
    connections[1].fail();
    vi.advanceTimersByTime(1_000);
    expect(connections).toHaveLength(3);
    emitMessage(connections[2], makeSnapshot(1));
    connections[2].fail();
    // The snapshot reset the attempt counter, so the retry is 500ms, not 5s.
    vi.advanceTimersByTime(500);
    flush();
    expect(connections).toHaveLength(4);
  });

  it('reconnects when the heartbeat watchdog expires and re-arms on every message', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1));
    flush();
    expect(live.status()).toBe('live');

    vi.advanceTimersByTime(LIVE_HEARTBEAT_TIMEOUT_MS - 1);
    flush();
    expect(live.status()).toBe('live');
    vi.advanceTimersByTime(1);
    flush();
    expect(live.status()).toBe('reconnecting');
    vi.advanceTimersByTime(500);
    flush();
    expect(connections).toHaveLength(2);
    emitMessage(connections[1], makeSnapshot(2));
    flush();
    expect(live.status()).toBe('live');

    // Any message re-arms the watchdog: an expired clock must not kill a fed stream.
    vi.advanceTimersByTime(LIVE_HEARTBEAT_TIMEOUT_MS - 1);
    emitMessage(connections[1], { type: 'heartbeat' });
    flush();
    vi.advanceTimersByTime(LIVE_HEARTBEAT_TIMEOUT_MS - 1);
    flush();
    expect(connections).toHaveLength(2);
    vi.advanceTimersByTime(1);
    flush();
    expect(live.status()).toBe('reconnecting');
    vi.advanceTimersByTime(500);
    flush();
    expect(connections).toHaveLength(3);
  });

  it('pings the transport on the heartbeat interval with the handshake connection id', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1, 'conn_7'));
    flush();

    vi.advanceTimersByTime(LIVE_HEARTBEAT_MS);
    expect(connections[0].pings).toEqual(['conn_7']);
    vi.advanceTimersByTime(LIVE_HEARTBEAT_MS);
    expect(connections[0].pings).toEqual(['conn_7', 'conn_7']);

    live.reconnect();
    flush();
    expect(connections[0].closed).toBe(true);
    vi.advanceTimersByTime(LIVE_HEARTBEAT_MS);
    expect(connections[0].pings).toHaveLength(2);
    expect(connections[1].pings).toEqual([undefined]);
  });

  it('replaces the stream on reconnect(), notifies onDisconnect, and loads a fresh snapshot', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    const disconnectsBefore = live.disconnects();
    emitMessage(connections[0], makeSnapshot(1));
    flush();
    expect(live.status()).toBe('live');

    // The consumer detected a version gap and asked the transport to resync.
    live.reconnect();
    flush();
    expect(connections[0].closed).toBe(true);
    expect(connections).toHaveLength(2);
    expect(live.status()).toBe('connecting');
    expect(live.disconnects()).toBe(disconnectsBefore + 1);

    emitMessage(connections[1], makeSnapshot(3));
    flush();
    expect(live.status()).toBe('live');
    expect(live.lastMessage()).toMatchObject({ type: 'board:snapshot', version: 3 });
  });

  it('stops reconnecting after a terminal frame but still delivers it to onMessage', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1));
    flush();
    expect(live.status()).toBe('live');

    emitMessage(connections[0], { type: 'board:deleted', version: 2 });
    flush();
    expect(connections[0].closed).toBe(true);
    expect(live.lastMessage()).toMatchObject({ type: 'board:deleted', version: 2 });

    vi.advanceTimersByTime(60_000);
    flush();
    expect(connections).toHaveLength(1);
  });

  it('reconnects when a frame fails wire validation', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1));
    flush();
    expect(live.status()).toBe('live');

    // A drifted card payload must be rejected, not applied with blank fields.
    connections[0].emit(
      JSON.stringify({
        type: 'board:mutation',
        version: 2,
        events: [{ type: 'card:upserted', version: 2, card: { id: 'card_bad' } }],
      }),
    );
    flush();
    expect(live.status()).toBe('reconnecting');
    expect(live.lastMessage()).toMatchObject({ type: 'board:snapshot', version: 1 });

    vi.advanceTimersByTime(500);
    flush();
    expect(connections).toHaveLength(2);
    emitMessage(connections[1], makeSnapshot(2));
    flush();
    expect(live.status()).toBe('live');
  });

  it('ignores failures and messages from a replaced connection', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1));
    flush();
    live.reconnect();
    flush();
    expect(connections).toHaveLength(2);

    const stale = connections[0];
    stale.fail();
    emitMessage(stale, makeSnapshot(9));
    flush();
    expect(live.status()).toBe('connecting');
    expect(live.lastMessage()).toMatchObject({ type: 'board:snapshot', version: 1 });

    vi.advanceTimersByTime(10_000);
    flush();
    expect(connections).toHaveLength(2);
  });

  it('reconnects when the tab becomes visible or the network returns, until disposed', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    expect(connections).toHaveLength(1);

    document.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(connections).toHaveLength(2);
    window.dispatchEvent(new Event('online'));
    flush();
    expect(connections).toHaveLength(3);

    live.dispose();
    expect(connections[2].closed).toBe(true);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(60_000);
    flush();
    expect(connections).toHaveLength(3);
  });

  it('keeps a healthy, recently active connection open on visible tab return and sends a liveness ping', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1, 'conn_1'));
    flush();
    expect(live.status()).toBe('live');

    vi.advanceTimersByTime(10_000);
    document.dispatchEvent(new Event('visibilitychange'));
    flush();

    expect(connections).toHaveLength(1);
    expect(connections[0].closed).toBe(false);
    expect(live.status()).toBe('live');
    expect(connections[0].pings).toEqual(['conn_1']);

    // The liveness probe reset the watchdog, so the stream stays live until a full timeout passes.
    vi.advanceTimersByTime(LIVE_HEARTBEAT_TIMEOUT_MS - 1);
    flush();
    expect(connections).toHaveLength(1);
    expect(live.status()).toBe('live');

    emitMessage(connections[0], { type: 'heartbeat' });
    flush();
    expect(connections).toHaveLength(1);
    expect(live.status()).toBe('live');
  });

  it('ignores visibilitychange when switching away to a hidden tab', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1, 'conn_1'));
    flush();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    flush();

    expect(connections).toHaveLength(1);
    expect(connections[0].closed).toBe(false);
    expect(connections[0].pings).toEqual([]);
    expect(live.status()).toBe('live');
  });

  it('immediately reconnects on visible tab return when reconnecting, closed, or stale past the heartbeat timeout', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1, 'conn_1'));
    flush();

    // Case 1: stream is in reconnecting state waiting for backoff retry.
    connections[0].fail();
    flush();
    expect(live.status()).toBe('reconnecting');
    document.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(connections).toHaveLength(2);
    expect(live.status()).toBe('connecting');
    emitMessage(connections[1], makeSnapshot(2, 'conn_2'));
    flush();
    expect(live.status()).toBe('live');
    expect(live.lastMessage()).toMatchObject({ type: 'board:snapshot', version: 2 });

    // Case 2: underlying transport is no longer open.
    connections[1].open = false;
    document.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(connections[1].closed).toBe(true);
    expect(connections).toHaveLength(3);
    expect(live.status()).toBe('connecting');
    emitMessage(connections[2], makeSnapshot(3, 'conn_3'));
    flush();
    expect(live.status()).toBe('live');
    expect(live.lastMessage()).toMatchObject({ type: 'board:snapshot', version: 3 });

    // Case 3: connection went silent beyond the heartbeat timeout (e.g. after laptop sleep).
    vi.setSystemTime(Date.now() + LIVE_HEARTBEAT_TIMEOUT_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(connections[2].closed).toBe(true);
    expect(connections[2].pings).toEqual([]);
    expect(connections).toHaveLength(4);
    expect(live.status()).toBe('connecting');
    emitMessage(connections[3], makeSnapshot(4, 'conn_4'));
    flush();
    expect(live.status()).toBe('live');
    expect(live.lastMessage()).toMatchObject({ type: 'board:snapshot', version: 4 });
  });

  it('transitions to reconnecting and recovers if the visible-return liveness ping fails or times out', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1, 'conn_1'));
    flush();

    // Case 1: liveness ping immediately reports a failure.
    connections[0].failNextPing = true;
    document.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(connections[0].pings).toEqual(['conn_1']);
    expect(connections[0].closed).toBe(true);
    expect(live.status()).toBe('reconnecting');

    vi.advanceTimersByTime(500);
    flush();
    expect(connections).toHaveLength(2);
    emitMessage(connections[1], makeSnapshot(2, 'conn_2'));
    flush();
    expect(live.status()).toBe('live');

    // Case 2: liveness ping silently times out without any response from the server.
    vi.advanceTimersByTime(10_000);
    document.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(connections[1].pings).toEqual(['conn_2']);
    expect(live.status()).toBe('live');

    vi.advanceTimersByTime(LIVE_HEARTBEAT_TIMEOUT_MS);
    flush();
    expect(connections[1].closed).toBe(true);
    expect(live.status()).toBe('reconnecting');

    vi.advanceTimersByTime(500);
    flush();
    expect(connections).toHaveLength(3);
    emitMessage(connections[2], makeSnapshot(3, 'conn_3'));
    flush();
    expect(live.status()).toBe('live');
  });

  it('still reconnects on online even when the stream is live and recently active', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1, 'conn_1'));
    flush();
    expect(live.status()).toBe('live');

    window.dispatchEvent(new Event('online'));
    flush();
    expect(connections[0].closed).toBe(true);
    expect(connections).toHaveLength(2);
    expect(live.status()).toBe('connecting');

    emitMessage(connections[1], makeSnapshot(2, 'conn_2'));
    flush();
    expect(live.status()).toBe('live');
  });
});

describe('createLiveStream built-in transports', () => {
  const activeStreams: Array<{ dispose(): void }> = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    for (const stream of activeStreams) stream.dispose();
    activeStreams.length = 0;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('handles healthy visibility recovery, closed-socket reconnect, online recovery, and terminal room disposal over WebSocket', () => {
    const sockets: FakeWebSocket[] = [];
    class FakeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = FakeWebSocket.OPEN;
      sent: string[] = [];
      closed = false;
      url: string;
      constructor(url: string | URL) {
        super();
        this.url = String(url);
        sockets.push(this);
      }
      send(data: string): void {
        this.sent.push(data);
      }
      close(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.closed = true;
      }
      emit(payload: unknown): void {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);

    type RoomMsg =
      | { type: 'room:snapshot'; room: { closed: boolean } }
      | { type: 'room:missing' }
      | { type: 'heartbeat' };
    const received: RoomMsg[] = [];
    const stream = createLiveStream<RoomMsg>(
      '/api/poker/room-1/live',
      {
        parse: (raw) => JSON.parse(raw) as RoomMsg,
        handshake: (msg) => (msg.type === 'room:snapshot' ? {} : undefined),
        isTerminal: (msg) => msg.type === 'room:missing' || (msg.type === 'room:snapshot' && msg.room.closed),
        onMessage: (msg) => received.push(msg),
        onDisconnect: () => {},
      },
      createWebSocketTransport(),
    );
    activeStreams.push(stream);
    flush();

    expect(sockets).toHaveLength(1);
    sockets[0].emit({ type: 'room:snapshot', room: { closed: false } });
    flush();
    expect(stream.status()).toBe('live');

    // Healthy tab return keeps socket open and sends ping.
    document.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(false);
    expect(sockets[0].sent).toEqual(['ping']);

    // Closed underlying socket triggers immediate reconnect on visible return.
    sockets[0].readyState = FakeWebSocket.CLOSED;
    document.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(sockets).toHaveLength(2);
    sockets[1].emit({ type: 'room:snapshot', room: { closed: false } });
    flush();
    expect(stream.status()).toBe('live');

    // Online event still reconnects cleanly.
    window.dispatchEvent(new Event('online'));
    flush();
    expect(sockets).toHaveLength(3);
    sockets[2].emit({ type: 'room:snapshot', room: { closed: false } });
    flush();
    expect(stream.status()).toBe('live');

    // Terminal closed-room snapshot disposes the stream and stops further recovery.
    sockets[2].emit({ type: 'room:snapshot', room: { closed: true } });
    flush();
    expect(sockets[2].closed).toBe(true);
    expect(received.at(-1)).toEqual({ type: 'room:snapshot', room: { closed: true } });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    flush();
    expect(sockets).toHaveLength(3);
  });

  it('handles healthy visibility recovery, failed ping recovery, closed-stream reconnect, and terminal disposal over SSE', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const sources: FakeEventSource[] = [];
    class FakeEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readyState = FakeEventSource.OPEN;
      closed = false;
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        sources.push(this);
      }
      close(): void {
        this.readyState = FakeEventSource.CLOSED;
        this.closed = true;
      }
      emit(payload: unknown): void {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const received: BoardLiveMessage[] = [];
    const live = createLiveStream<BoardLiveMessage>(
      boardLivePath('board_sse'),
      {
        parse: parseBoardLiveMessage,
        handshake: (message) => (message.type === 'board:snapshot' ? message : undefined),
        isTerminal: (message) => message.type === 'board:deleted',
        onMessage: (message) => received.push(message),
        onDisconnect: () => {},
      },
      createSseTransport(),
    );
    activeStreams.push(live);
    flush();

    expect(sources).toHaveLength(1);
    sources[0].emit(makeSnapshot(1, 'sse_1'));
    flush();
    expect(live.status()).toBe('live');

    // Healthy tab return keeps EventSource open and sends POST heartbeat with connection header.
    document.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(sources).toHaveLength(1);
    expect(sources[0].closed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/boards/board_sse/live',
      expect.objectContaining({
        method: 'POST',
        headers: { [LIVE_CONNECTION_HEADER]: 'sse_1' },
      }),
    );

    // Failed POST ping (404) transitions to reconnecting and opens a new EventSource on retry.
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(sources[0].closed).toBe(true);
    expect(live.status()).toBe('reconnecting');

    vi.advanceTimersByTime(500);
    flush();
    expect(sources).toHaveLength(2);
    sources[1].emit(makeSnapshot(2, 'sse_2'));
    flush();
    expect(live.status()).toBe('live');

    // Closed EventSource triggers immediate reconnect on visible return.
    sources[1].readyState = FakeEventSource.CLOSED;
    document.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(sources).toHaveLength(3);
    sources[2].emit(makeSnapshot(3, 'sse_3'));
    flush();
    expect(live.status()).toBe('live');

    // Terminal board:deleted disposes the EventSource and prevents further recovery.
    sources[2].emit({ type: 'board:deleted', version: 4 });
    flush();
    expect(sources[2].closed).toBe(true);
    expect(received.at(-1)).toEqual({ type: 'board:deleted', version: 4 });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    flush();
    expect(sources).toHaveLength(3);
  });
});
