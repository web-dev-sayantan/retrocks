import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class MockDurableObject<Env = unknown> {
    constructor(
      protected readonly ctx: DurableObjectState,
      protected readonly env: Env,
    ) {}
  },
}));

import type { CreateBoardRecord } from '../../db/raw-types';
import { MS_PER_DAY } from '../../db/sql-board-operations';
import { LIVE_HEARTBEAT_TIMEOUT_MS } from '../../../lib/live-protocol';
import { LIVE_FACILITATOR_HEADER, LIVE_PARTICIPANT_HEADER } from '../../live/headers';
import { BoardRoom } from './board-room';

interface FakeSocket {
  readyState: number;
  sent: string[];
  closedWith: { code?: number; reason?: string } | null;
  closeCalls: number;
  attachment: unknown;
  failNextSend?: boolean;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

function createFakeSocket(attachment: unknown = null): FakeSocket {
  return {
    readyState: WebSocket.OPEN,
    sent: [],
    closedWith: null,
    closeCalls: 0,
    attachment,
    send(data: string) {
      if (this.failNextSend) {
        this.failNextSend = false;
        throw new Error('Socket send failed');
      }
      this.sent.push(data);
    },
    close(code?: number, reason?: string) {
      this.closeCalls += 1;
      this.readyState = WebSocket.CLOSED;
      this.closedWith = { code, reason };
    },
    serializeAttachment(value: unknown) {
      this.attachment = value;
    },
    deserializeAttachment() {
      return this.attachment;
    },
  };
}

function stubCloudflareWebSocketUpgrade() {
  const NativeResponse = globalThis.Response;
  class FakeWebSocketPair {
    0: FakeSocket;
    1: FakeSocket;
    constructor() {
      this[0] = createFakeSocket();
      this[1] = createFakeSocket();
    }
  }
  const PatchedResponse = new Proxy(NativeResponse, {
    construct(target, args: [BodyInit | null | undefined, ResponseInit & { webSocket?: unknown }]) {
      const [body, init] = args;
      if (init?.status === 101) {
        const res = new target(body, { ...init, status: 200 });
        Object.defineProperty(res, 'status', { value: 101 });
        Object.defineProperty(res, 'webSocket', { value: init.webSocket });
        return res;
      }
      return new target(body, init);
    },
  });
  vi.stubGlobal('WebSocketPair', FakeWebSocketPair);
  vi.stubGlobal('Response', PatchedResponse);
}

function createFakeBoardRoom(boardId: string) {
  let db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  let scheduledAlarm: number | null = null;
  const sockets: FakeSocket[] = [];
  let deleteAllCount = 0;

  const sql = {
    exec(query: string, ...params: unknown[]) {
      if (params.length === 0) {
        const trimmed = query.trim().toUpperCase();
        if (
          trimmed.startsWith('SELECT') ||
          trimmed.startsWith('PRAGMA')
        ) {
          const rows = db.prepare(query).all();
          return { toArray: () => rows, rowsWritten: 0 };
        }
        db.exec(query);
        return { toArray: () => [], rowsWritten: 0 };
      }
      const stmt = db.prepare(query);
      const trimmed = query.trim().toUpperCase();
      if (trimmed.startsWith('SELECT')) {
        const rows = stmt.all(...(params as never[]));
        return { toArray: () => rows, rowsWritten: 0 };
      }
      const res = stmt.run(...(params as never[]));
      return { toArray: () => [], rowsWritten: Number(res.changes) };
    },
  };

  let inTx = false;
  const storage = {
    sql,
    transactionSync<T>(fn: () => T): T {
      if (inTx) return fn();
      inTx = true;
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        inTx = false;
      }
    },
    async setAlarm(time: number | Date): Promise<void> {
      scheduledAlarm = time instanceof Date ? time.getTime() : time;
    },
    async deleteAlarm(): Promise<void> {
      scheduledAlarm = null;
    },
    async deleteAll(): Promise<void> {
      deleteAllCount += 1;
      scheduledAlarm = null;
      // Mirror Cloudflare DO storage.deleteAll(): drop all SQLite tables on the live instance.
      db.close();
      db = new DatabaseSync(':memory:');
      db.exec('PRAGMA foreign_keys = ON');
    },
  };

  const ctx = {
    id: { name: boardId },
    storage,
    getWebSockets: () => sockets,
    acceptWebSocket: (socket: FakeSocket) => {
      sockets.push(socket);
    },
  } as unknown as DurableObjectState;

  const room = new BoardRoom(ctx, {} as Cloudflare.Env);

  return {
    room,
    sockets,
    getScheduledAlarm: () => scheduledAlarm,
    getDeleteAllCount: () => deleteAllCount,
    hasTables: () =>
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'boards'")
        .all().length > 0,
    close: () => db.close(),
  };
}

function makeRecord(overrides?: Partial<CreateBoardRecord>): CreateBoardRecord {
  const now = 1_760_000_000_000;
  return {
    id: 'board_cf_do_123456789',
    title: 'CF DO Retro',
    subtitle: '',
    templateId: 'standard',
    facilitatorTokenHash: 'hash_f',
    facilitatorTokenEncrypted: 'v1.iv.ct',
    tokenSalt: 'salt_cf',
    isBlurred: false,
    voteLimit: 5,
    maxVotesPerCard: null,
    retentionDays: 30,
    createdAt: now,
    columns: [
      {
        id: 'col_1',
        title: 'Went Well',
        accent: 'sage',
        position: 0,
        isActionColumn: false,
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BoardRoom Durable Object lifecycle (delete & DO Alarm expiry)', () => {
  it('returns null (404) on subsequent reads after deleteBoard wipes DO storage via deleteAll()', async () => {
    const record = makeRecord();
    const harness = createFakeBoardRoom(record.id);
    try {
      await harness.room.createBoard(record);
      expect(harness.getScheduledAlarm()).toBe(
        record.createdAt + 30 * MS_PER_DAY,
      );

      const liveSocket = createFakeSocket({
        participantHash: 'viewer_1',
        isFacilitator: false,
        lastSeenAt: Date.now(),
      });
      harness.sockets.push(liveSocket);

      expect(await harness.room.deleteBoard(record.id)).toBe(true);
      expect(harness.getDeleteAllCount()).toBe(1);
      expect(harness.getScheduledAlarm()).toBeNull();
      expect(harness.hasTables()).toBe(false);

      await harness.room.publishLive({ type: 'board:deleted', version: 2 });
      expect(liveSocket.sent.map((frame) => JSON.parse(frame))).toEqual([
        { type: 'board:deleted', version: 2 },
      ]);
      expect(liveSocket.closedWith).toEqual({ code: 1000, reason: 'Board deleted' });

      // Subsequent reads & mutations against the live DO instance MUST return null / 404 without recreating tables or throwing.
      expect(await harness.room.getBoardSnapshot(record.id)).toBeNull();
      expect(await harness.room.getBoardTokenSalt(record.id)).toBeNull();
      expect(await harness.room.getFacilitatorCapability(record.id)).toBeNull();
      expect(
        await harness.room.mutateBoard(
          record.id,
          { participantHash: 'viewer_1', isFacilitator: true },
          { type: 'board:set-lock', isLocked: true },
        ),
      ).toMatchObject({ ok: false, code: 'BOARD_NOT_FOUND' });
      const wsAttempt = await harness.room.fetch(
        new Request(`https://retrocks.app/api/boards/${record.id}/live`, {
          headers: {
            upgrade: 'websocket',
            [LIVE_PARTICIPANT_HEADER]: 'viewer_1',
            [LIVE_FACILITATOR_HEADER]: 'false',
          },
        }),
      );
      expect(wsAttempt.status).toBe(404);
      expect(harness.hasTables()).toBe(false);
    } finally {
      harness.close();
    }
  });

  it('reschedules DO Alarm on writes, preserves active Boards, and wipes expired Boards cleanly in alarm()', async () => {
    vi.useFakeTimers();
    const t0 = 1_760_000_000_000;
    vi.setSystemTime(t0);

    const record = makeRecord({ createdAt: t0, retentionDays: 30 });
    const harness = createFakeBoardRoom(record.id);
    try {
      await harness.room.createBoard(record);
      expect(harness.getScheduledAlarm()).toBe(t0 + 30 * MS_PER_DAY);

      // Write at day 10 extends last_active_at and reschedules DO Alarm to day 40.
      const day10 = t0 + 10 * MS_PER_DAY;
      const mutated = await harness.room.mutateBoard(
        record.id,
        { participantHash: 'author_1', isFacilitator: false },
        {
          type: 'card:create',
          id: 'card_1',
          columnId: 'col_1',
          content: 'Keep board active',
        },
        day10,
      );
      expect(mutated.ok).toBe(true);
      expect(harness.getScheduledAlarm()).toBe(day10 + 30 * MS_PER_DAY);

      // If alarm fires early (at day 30), board is not expired yet -> reschedules to day 40 & keeps board.
      vi.setSystemTime(t0 + 30 * MS_PER_DAY);
      await harness.room.alarm();
      expect(harness.getDeleteAllCount()).toBe(0);
      expect(harness.getScheduledAlarm()).toBe(day10 + 30 * MS_PER_DAY);
      expect(
        await harness.room.getBoardSnapshot(record.id, t0 + 30 * MS_PER_DAY),
      ).not.toBeNull();

      // Connect a live socket, then advance to day 40 so alarm() expires and wipes the DO.
      const day40 = day10 + 30 * MS_PER_DAY;
      vi.setSystemTime(day40);
      const liveSocket = createFakeSocket({
        participantHash: 'viewer_1',
        isFacilitator: false,
        lastSeenAt: day40,
      });
      harness.sockets.push(liveSocket);

      await harness.room.alarm();
      expect(harness.getDeleteAllCount()).toBe(1);
      expect(harness.getScheduledAlarm()).toBeNull();
      expect(harness.hasTables()).toBe(false);
      expect(liveSocket.sent.map((frame) => JSON.parse(frame))).toEqual([
        { type: 'board:deleted', version: 3 },
      ]);
      expect(liveSocket.closedWith).toEqual({ code: 1000, reason: 'Board expired' });

      // Subsequent reads return null (404) without throwing.
      expect(await harness.room.getBoardSnapshot(record.id, day40)).toBeNull();
      expect(await harness.room.getBoardTokenSalt(record.id, day40)).toBeNull();
      expect(await harness.room.getFacilitatorCapability(record.id, day40)).toBeNull();
      expect(harness.hasTables()).toBe(false);
    } finally {
      harness.close();
    }
  });
});

describe('BoardRoom Durable Object WebSocket hibernation hub', () => {
  it('enforces fallback 426 with Upgrade: websocket, 401 on missing identity, and per-viewer Private Mode + Blind Voting projection on connect', async () => {
    stubCloudflareWebSocketUpgrade();
    vi.useFakeTimers();
    const t0 = 1_760_000_000_000;
    vi.setSystemTime(t0);

    const record = makeRecord({ createdAt: t0, isBlurred: true });
    const harness = createFakeBoardRoom(record.id);
    try {
      await harness.room.createBoard(record);
      await harness.room.mutateBoard(
        record.id,
        { participantHash: 'author_1', isFacilitator: false },
        { type: 'card:create', id: 'card_1', columnId: 'col_1', content: 'Secret note' },
        t0,
      );
      await harness.room.mutateBoard(
        record.id,
        { participantHash: 'facilitator_1', isFacilitator: true },
        { type: 'voting:configure', blindVoting: true },
        t0,
      );
      await harness.room.mutateBoard(
        record.id,
        { participantHash: 'author_1', isFacilitator: false },
        { type: 'vote:change', targetType: 'card', targetId: 'card_1', delta: 1 },
        t0,
      );

      // Fallback 426 includes Upgrade: websocket
      const nonUpgrade = await harness.room.fetch(
        new Request(`https://retrocks.app/api/boards/${record.id}/live`, {
          headers: { [LIVE_PARTICIPANT_HEADER]: 'author_1' },
        }),
      );
      expect(nonUpgrade.status).toBe(426);
      expect(nonUpgrade.headers.get('upgrade')).toBe('websocket');

      // Missing internal identity -> 401
      const missingIdentity = await harness.room.fetch(
        new Request(`https://retrocks.app/api/boards/${record.id}/live`, {
          headers: { upgrade: 'websocket' },
        }),
      );
      expect(missingIdentity.status).toBe(401);

      // Valid upgrade delivers viewer-projected snapshot and presence:count
      const authorUpgrade = await harness.room.fetch(
        new Request(`https://retrocks.app/api/boards/${record.id}/live`, {
          headers: {
            upgrade: 'websocket',
            [LIVE_PARTICIPANT_HEADER]: 'author_1',
            [LIVE_FACILITATOR_HEADER]: 'false',
          },
        }),
      );
      expect(authorUpgrade.status).toBe(101);
      expect(harness.sockets).toHaveLength(1);
      expect(harness.sockets[0].attachment).toEqual({
        participantHash: 'author_1',
        isFacilitator: false,
        lastSeenAt: t0,
      });
      const authorFrames = harness.sockets[0].sent.map((frame) => JSON.parse(frame));
      expect(authorFrames[0]).toMatchObject({
        type: 'board:snapshot',
        board: {
          isBlurred: true,
          blindVoting: true,
          isFacilitator: false,
          cards: [{ id: 'card_1', content: 'Secret note', isMine: true, redacted: false, votes: null, myVotes: 1 }],
        },
      });
      expect(authorFrames[1]).toEqual({ type: 'presence:count', count: 1 });

      const peerUpgrade = await harness.room.fetch(
        new Request(`https://retrocks.app/api/boards/${record.id}/live`, {
          headers: {
            upgrade: 'websocket',
            [LIVE_PARTICIPANT_HEADER]: 'facilitator_1',
            [LIVE_FACILITATOR_HEADER]: 'true',
          },
        }),
      );
      expect(peerUpgrade.status).toBe(101);
      const peerFrames = harness.sockets[1].sent.map((frame) => JSON.parse(frame));
      expect(peerFrames[0]).toMatchObject({
        type: 'board:snapshot',
        board: {
          isBlurred: true,
          blindVoting: true,
          isFacilitator: true,
          cards: [{ id: 'card_1', content: '', isMine: false, redacted: true, votes: null, myVotes: 0 }],
        },
      });
      expect(peerFrames[1]).toEqual({ type: 'presence:count', count: 2 });
      expect(JSON.parse(harness.sockets[0].sent.at(-1)!)).toEqual({ type: 'presence:count', count: 2 });
    } finally {
      harness.close();
    }
  });

  it('guards null attachments, answers pings, reciprocates WebSocket.CLOSING, and broadcasts presence when pruning stale peers or closing failed sockets', async () => {
    vi.useFakeTimers();
    const t0 = 1_760_000_000_000;
    vi.setSystemTime(t0);

    const record = makeRecord({ createdAt: t0 });
    const harness = createFakeBoardRoom(record.id);
    try {
      await harness.room.createBoard(record);

      const active = createFakeSocket({ participantHash: 'p1', isFacilitator: false, lastSeenAt: t0 });
      const stale = createFakeSocket({ participantHash: 'p2', isFacilitator: false, lastSeenAt: t0 });
      const unattached = createFakeSocket(null);
      harness.sockets.push(active, stale, unattached);

      // Null attachment on ping does not throw
      expect(() => harness.room.webSocketMessage(unattached as unknown as WebSocket, 'ping')).not.toThrow();
      expect(unattached.sent).toEqual([]);

      // Active peer pings at half-timeout -> updates lastSeenAt & replies heartbeat
      const mid = t0 + Math.floor(LIVE_HEARTBEAT_TIMEOUT_MS / 2);
      vi.setSystemTime(mid);
      harness.room.webSocketMessage(active as unknown as WebSocket, 'ping');
      expect(active.sent.map((f) => JSON.parse(f))).toEqual([{ type: 'heartbeat' }]);
      expect(active.attachment).toEqual({ participantHash: 'p1', isFacilitator: false, lastSeenAt: mid });

      // Advance past stale peer's timeout; active peer pings -> prunes stale peer (1001) AND broadcasts updated presence!
      const afterTimeout = t0 + LIVE_HEARTBEAT_TIMEOUT_MS + 1;
      vi.setSystemTime(afterTimeout);
      active.sent.length = 0;
      harness.room.webSocketMessage(active as unknown as WebSocket, 'ping');
      expect(stale.closedWith).toEqual({ code: 1001, reason: 'Live connection timed out' });
      expect(active.sent.map((f) => JSON.parse(f))).toEqual([
        { type: 'heartbeat' },
        { type: 'presence:count', count: 1 },
      ]);

      // Add a third peer and verify CLOSING reciprocation in webSocketClose
      const closingPeer = createFakeSocket({ participantHash: 'p3', isFacilitator: false, lastSeenAt: afterTimeout });
      harness.sockets.push(closingPeer);
      closingPeer.readyState = WebSocket.CLOSING;
      active.sent.length = 0;
      harness.room.webSocketClose(closingPeer as unknown as WebSocket);
      expect(closingPeer.closeCalls).toBe(1);
      expect(closingPeer.readyState).toBe(WebSocket.CLOSED);
      expect(active.sent.map((f) => JSON.parse(f))).toEqual([{ type: 'presence:count', count: 1 }]);

      // Send failure during publishLive closes the failing socket (1011) and broadcasts updated presence to surviving peers
      const failingPeer = createFakeSocket({ participantHash: 'p4', isFacilitator: false, lastSeenAt: afterTimeout });
      failingPeer.failNextSend = true;
      harness.sockets.push(failingPeer);
      active.sent.length = 0;

      const snapshot = await harness.room.getBoardSnapshot(record.id, afterTimeout);
      expect(snapshot).not.toBeNull();
      await harness.room.publishLive({ snapshot: snapshot!, events: [] });
      expect(failingPeer.closedWith).toEqual({ code: 1011, reason: 'Live delivery failed' });
      expect(active.sent.map((f) => JSON.parse(f))).toEqual([
        { type: 'board:mutation', version: 1, lastActiveAt: t0, events: [] },
        { type: 'presence:count', count: 1 },
      ]);

      // webSocketError closes socket (1011) and broadcasts updated presence
      const errorPeer = createFakeSocket({ participantHash: 'p5', isFacilitator: false, lastSeenAt: afterTimeout });
      harness.sockets.push(errorPeer);
      active.sent.length = 0;
      harness.room.webSocketError(errorPeer as unknown as WebSocket);
      expect(errorPeer.closedWith).toEqual({ code: 1011, reason: 'Live connection failed' });
      expect(active.sent.map((f) => JSON.parse(f))).toEqual([{ type: 'presence:count', count: 1 }]);

      // Send failure during presence broadcast closes the failing socket (1011) and re-broadcasts updated presence
      const presenceFailingPeer = createFakeSocket({ participantHash: 'p6', isFacilitator: false, lastSeenAt: afterTimeout });
      presenceFailingPeer.failNextSend = true;
      const leavingPeer = createFakeSocket({ participantHash: 'p7', isFacilitator: false, lastSeenAt: afterTimeout });
      leavingPeer.readyState = WebSocket.CLOSING;
      harness.sockets.push(presenceFailingPeer, leavingPeer);
      active.sent.length = 0;
      harness.room.webSocketClose(leavingPeer as unknown as WebSocket);
      expect(presenceFailingPeer.closedWith).toEqual({ code: 1011, reason: 'Live delivery failed' });
      expect(active.sent.map((f) => JSON.parse(f))).toEqual([
        { type: 'presence:count', count: 2 },
        { type: 'presence:count', count: 1 },
      ]);

      // Timed-out pinging socket evicts itself (1001) and broadcasts updated presence to surviving peers
      const secondTab = createFakeSocket({ participantHash: 'p1', isFacilitator: false, lastSeenAt: afterTimeout });
      const latePinger = createFakeSocket({ participantHash: 'p8', isFacilitator: false, lastSeenAt: t0 });
      harness.sockets.push(secondTab, latePinger);
      active.sent.length = 0;
      harness.room.webSocketMessage(latePinger as unknown as WebSocket, 'ping');
      expect(latePinger.closedWith).toEqual({ code: 1001, reason: 'Live connection timed out' });
      expect(active.sent.map((f) => JSON.parse(f))).toEqual([{ type: 'presence:count', count: 1 }]);
      expect(await harness.room.getPresenceCount()).toBe(1);
    } finally {
      harness.close();
    }
  });

  it('drops stale out-of-order snapshot publications when Board version has already advanced', async () => {
    vi.useFakeTimers();
    const t0 = 1_760_000_000_000;
    vi.setSystemTime(t0);

    const record = makeRecord({ createdAt: t0 });
    const harness = createFakeBoardRoom(record.id);
    try {
      const initial = await harness.room.createBoard(record);
      const mutated = await harness.room.mutateBoard(
        record.id,
        { participantHash: 'facilitator_1', isFacilitator: true },
        { type: 'board:set-private-mode', isBlurred: true },
        t0,
      );
      expect(mutated.ok).toBe(true);

      const viewerSocket = createFakeSocket({
        participantHash: 'viewer_1',
        isFacilitator: false,
        lastSeenAt: t0,
      });
      harness.sockets.push(viewerSocket);

      // Publish stale version 1 snapshot after board is already at version 2 -> dropped
      await harness.room.publishLive({ snapshot: initial, events: [] });
      expect(viewerSocket.sent).toEqual([]);
    } finally {
      harness.close();
    }
  });
});
