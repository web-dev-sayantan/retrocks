import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LIVE_HEARTBEAT_MS,
  LIVE_HEARTBEAT_TIMEOUT_MS,
  type BoardLiveMessage,
} from './board-live-protocol';
import { createBoardLive, type BoardLive, type BoardLiveTransport } from './board-live';
import type { BoardViewDTO } from './board-types';

interface FakeConnection {
  path: string;
  closed: boolean;
  pings: Array<string | undefined>;
  emit(data: string): void;
  fail(): void;
}

function createFakeTransport(): { transport: BoardLiveTransport; connections: FakeConnection[] } {
  const connections: FakeConnection[] = [];
  const transport: BoardLiveTransport = {
    connect(path, handlers) {
      const connection: FakeConnection = {
        path,
        closed: false,
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
        ping(connectionId) {
          connection.pings.push(connectionId);
        },
        close() {
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

const sessions: BoardLive[] = [];

function startLive(transport: BoardLiveTransport, boardId = 'board_1'): BoardLive {
  const live = createBoardLive(boardId, transport);
  sessions.push(live);
  return live;
}

describe('createBoardLive', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    for (const live of sessions) live.dispose();
    sessions.length = 0;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects via the transport and exposes status, lastEvent, and onlineCount reactively', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport, 'board 42');
    flush();
    expect(connections).toHaveLength(1);
    expect(connections[0].path).toBe('/api/boards/board%2042/live');
    expect(live.status()).toBe('connecting');

    emitMessage(connections[0], makeSnapshot(1, 'conn_1'));
    flush();
    expect(live.status()).toBe('live');
    expect(live.lastEvent()).toMatchObject({ type: 'board:snapshot', version: 1 });
    expect(live.onlineCount()).toBeNull();

    emitMessage(connections[0], { type: 'presence:count', count: 3 });
    flush();
    expect(live.onlineCount()).toBe(3);
    expect(live.status()).toBe('live');

    emitMessage(connections[0], {
      type: 'board:mutation',
      version: 2,
      events: [{ type: 'board:updated', version: 2, patch: { title: 'Renamed' } }],
    });
    flush();
    expect(live.lastEvent()).toMatchObject({ type: 'board:mutation', version: 2 });
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

  it('resets the backoff attempt counter when a snapshot arrives', () => {
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

  it('pings the transport on the heartbeat interval with the snapshot connection id', () => {
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

  it('replaces the stream on reconnect() so a version gap resync loads a fresh snapshot', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1));
    emitMessage(connections[0], { type: 'presence:count', count: 4 });
    flush();
    expect(live.status()).toBe('live');
    expect(live.onlineCount()).toBe(4);

    // The consumer detected a version gap and asked the transport to resync.
    live.reconnect();
    flush();
    expect(connections[0].closed).toBe(true);
    expect(connections).toHaveLength(2);
    expect(live.status()).toBe('connecting');
    expect(live.onlineCount()).toBeNull();

    emitMessage(connections[1], makeSnapshot(3));
    flush();
    expect(live.status()).toBe('live');
    expect(live.lastEvent()).toMatchObject({ type: 'board:snapshot', version: 3 });
  });

  it('stops reconnecting after board:deleted but still reports the event', () => {
    const { transport, connections } = createFakeTransport();
    const live = startLive(transport);
    flush();
    emitMessage(connections[0], makeSnapshot(1));
    flush();
    expect(live.status()).toBe('live');

    emitMessage(connections[0], { type: 'board:deleted', version: 2 });
    flush();
    expect(connections[0].closed).toBe(true);
    expect(live.lastEvent()).toMatchObject({ type: 'board:deleted', version: 2 });

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
    expect(live.lastEvent()).toMatchObject({ type: 'board:snapshot', version: 1 });

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
    expect(live.lastEvent()).toMatchObject({ type: 'board:snapshot', version: 1 });

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
});
