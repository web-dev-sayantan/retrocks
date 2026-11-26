import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { LIVE_HEARTBEAT_TIMEOUT_MS } from '../../lib/live-protocol';
import { parsePokerLiveMessage } from '../../lib/poker-schemas';
import { generateEntityId } from '../crypto';
import { POKER_LIVE_VIEWER_HEADER } from '../live/headers';
import { PointingPokerRoom } from './durable-room';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class MockDurableObject {
    constructor(protected readonly ctx: DurableObjectState) {}
  },
}));

const day = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 0, 1);

function liveSocket(hash: string | null, participantId: string | null, lastSeenAt = start) {
  const events: unknown[] = [];
  let attachment: unknown = hash && participantId ? { hash, participantId, lastSeenAt } : null;
  return {
    events,
    readyState: Number(WebSocket.OPEN),
    closedWith: null as { code?: number; reason?: string } | null,
    closeCalls: 0,
    failNextSend: false,
    deserializeAttachment: () => attachment,
    serializeAttachment(value: unknown) {
      attachment = value;
    },
    send(data: string) {
      if (this.failNextSend) {
        this.failNextSend = false;
        throw new Error('Socket send failed');
      }
      events.push(parsePokerLiveMessage(data));
    },
    close(code?: number, reason?: string) {
      this.closeCalls += 1;
      this.closedWith = { code, reason };
      events.push(undefined);
      this.readyState = WebSocket.CLOSED;
    },
  };
}

function stubCloudflareWebSocketUpgrade() {
  const NativeResponse = globalThis.Response;
  class FakeWebSocketPair {
    0: ReturnType<typeof liveSocket>;
    1: ReturnType<typeof liveSocket>;
    constructor() {
      this[0] = liveSocket(null, null);
      this[1] = liveSocket(null, null);
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

function createFakePokerRoom(id = generateEntityId()) {
  let db = new DatabaseSync(':memory:');
  let inTx = false;
  let scheduledAlarm: number | null = null;
  let deleteAllCount = 0;
  const sockets: ReturnType<typeof liveSocket>[] = [];

  const setAlarm = vi.fn(async (expiresAt: number) => {
    scheduledAlarm = expiresAt;
  });
  const deleteAlarm = vi.fn(async () => {
    scheduledAlarm = null;
  });
  const deleteAll = vi.fn(async () => {
    deleteAllCount += 1;
    scheduledAlarm = null;
    // Mirror Cloudflare DO storage.deleteAll(): drop all SQLite tables on the live instance.
    db.close();
    db = new DatabaseSync(':memory:');
  });

  const ctx = {
    id: { name: id },
    getWebSockets: () => sockets,
    acceptWebSocket: (ws: ReturnType<typeof liveSocket>) => {
      sockets.push(ws);
    },
    storage: {
      sql: {
        exec(query: string, ...params: SQLInputValue[]) {
          const trimmed = query.trim().toUpperCase();
          if (trimmed.startsWith('SELECT')) {
            const rows = db.prepare(query).all(...params);
            return { toArray: () => rows, rowsWritten: 0 };
          }
          if (params.length === 0) {
            db.exec(query);
            return { toArray: () => [], rowsWritten: 0 };
          }
          const result = db.prepare(query).run(...params);
          return { toArray: () => [], rowsWritten: Number(result.changes) };
        },
      },
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
      setAlarm,
      deleteAlarm,
      deleteAll,
    },
  } as unknown as DurableObjectState;

  const room = new PointingPokerRoom(ctx, {} as Cloudflare.Env);

  return {
    id,
    room,
    sockets,
    setAlarm,
    deleteAlarm,
    deleteAll,
    getScheduledAlarm: () => scheduledAlarm,
    getDeleteAllCount: () => deleteAllCount,
    hasTables: () =>
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'poker_rooms'")
        .all().length > 0,
    close: () => db.close(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PointingPokerRoom Durable Object lifecycle (alarms, deletion & lazy expiry wipe)', () => {
  test('schedules alarms on actual changes, preserves active Rooms on early alarm, and wipes storage via deleteAll() + schema reset on alarm expiry', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const harness = createFakePokerRoom();
    try {
      const created = await harness.room.create(harness.id, 'facilitator', 'Alex');
      if (created.closed || !created.viewer) throw new Error('Expected open Room');
      expect(harness.setAlarm).toHaveBeenLastCalledWith(start + 90 * day);
      expect(harness.hasTables()).toBe(true);

      harness.setAlarm.mockClear();
      clock.mockReturnValue(start + day);
      await harness.room.mutate(harness.id, 'facilitator', { type: 'add-story', title: 'Estimate the Story' });
      expect(harness.setAlarm).toHaveBeenCalledExactlyOnceWith(start + 91 * day);

      harness.setAlarm.mockClear();
      clock.mockReturnValue(start + 2 * day);
      await harness.room.mutate(harness.id, 'voter', { type: 'join', displayName: 'Sam' });
      await harness.room.mutate(harness.id, 'facilitator', { type: 'set-deck', deck: { type: 'fibonacci' } });
      await harness.room.read(harness.id, 'voter');
      expect(harness.setAlarm).not.toHaveBeenCalled();

      // Early alarm does not wipe; it reschedules to the extended deadline.
      clock.mockReturnValue(start + 90 * day);
      await harness.room.alarm();
      expect(harness.getDeleteAllCount()).toBe(0);
      expect(harness.setAlarm).toHaveBeenLastCalledWith(start + 91 * day);
      expect(await harness.room.read(harness.id, 'voter')).not.toBeNull();

      // Expiry alarm wipes DO storage, cancels alarm, resets schema state, and notifies open sockets.
      const openSocket = liveSocket('facilitator', created.viewer.id, start + 91 * day);
      harness.sockets.push(openSocket);
      clock.mockReturnValue(start + 91 * day);
      await harness.room.alarm();

      expect(harness.deleteAlarm).toHaveBeenCalledOnce();
      expect(harness.getDeleteAllCount()).toBe(1);
      expect(harness.getScheduledAlarm()).toBeNull();
      expect(harness.hasTables()).toBe(false);
      expect(openSocket.events).toEqual([{ type: 'room:missing' }, undefined]);
      expect(openSocket.closedWith).toEqual({ code: 1000, reason: 'Room unavailable' });

      // Subsequent reads return null without recreating tables or throwing "no such table".
      expect(await harness.room.read(harness.id, 'voter')).toBeNull();
      expect(harness.hasTables()).toBe(false);

      // Schema-state reset allows clean re-creation on the same DO instance.
      const recreated = await harness.room.create(harness.id, 'facilitator', 'Alex');
      expect(recreated.closed).toBe(false);
      expect(harness.hasTables()).toBe(true);
    } finally {
      harness.close();
    }
  });

  test('deletes DO storage via deleteAlarm() + deleteAll() + schema reset and publishes terminal room:missing only after Facilitator authorization', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(start);
    const harness = createFakePokerRoom();
    try {
      const created = await harness.room.create(harness.id, 'facilitator', 'Alex');
      if (created.closed || !created.viewer) throw new Error('Expected open Room');
      const openSocket = liveSocket('facilitator', created.viewer.id, start);
      harness.sockets.push(openSocket);

      expect(await harness.room.delete(harness.id, 'voter')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      expect(harness.deleteAlarm).not.toHaveBeenCalled();
      expect(harness.getDeleteAllCount()).toBe(0);
      expect(openSocket.events).toEqual([]);

      expect(await harness.room.delete(harness.id, 'facilitator')).toEqual({ ok: true });
      expect(harness.deleteAlarm).toHaveBeenCalledOnce();
      expect(harness.getDeleteAllCount()).toBe(1);
      expect(harness.getScheduledAlarm()).toBeNull();
      expect(harness.hasTables()).toBe(false);
      expect(openSocket.events).toEqual([{ type: 'room:missing' }, undefined]);
      expect(openSocket.closedWith).toEqual({ code: 1000, reason: 'Room unavailable' });

      // Subsequent reads & writes against the wiped DO return missing cleanly without recreating tables.
      expect(await harness.room.read(harness.id, 'facilitator')).toBeNull();
      expect(await harness.room.mutate(harness.id, 'facilitator', { type: 'add-story', title: 'Gone' }))
        .toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
      expect(await harness.room.delete(harness.id, 'facilitator'))
        .toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
      expect(await harness.room.getFacilitatorCapability(harness.id, 'facilitator'))
        .toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
      expect(harness.hasTables()).toBe(false);

      // Schema-state reset allows clean re-creation on the same DO instance.
      const recreated = await harness.room.create(harness.id, 'facilitator', 'Alex');
      expect(recreated.closed).toBe(false);
      expect(harness.hasTables()).toBe(true);
    } finally {
      harness.close();
    }
  });

  test('reopening a closed Room resets the Durable Object alarm to 90 days from now and wipes storage when the new deadline expires', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const harness = createFakePokerRoom();
    try {
      await harness.room.create(harness.id, 'facilitator', 'Alex');

      clock.mockReturnValue(start + day);
      expect(await harness.room.mutate(harness.id, 'facilitator', { type: 'close-room' }))
        .toMatchObject({ ok: true, room: { closed: true } });
      expect(harness.setAlarm).toHaveBeenLastCalledWith(start + 91 * day);

      harness.setAlarm.mockClear();
      clock.mockReturnValue(start + 30 * day);
      expect(await harness.room.mutate(harness.id, 'facilitator', { type: 'reopen-room' }))
        .toMatchObject({ ok: true, room: { closed: false, viewer: null } });
      expect(harness.setAlarm).toHaveBeenCalledExactlyOnceWith(start + 120 * day);

      clock.mockReturnValue(start + 91 * day);
      await harness.room.alarm();
      expect(harness.getDeleteAllCount()).toBe(0);
      expect(harness.setAlarm).toHaveBeenLastCalledWith(start + 120 * day);
      expect(await harness.room.read(harness.id, 'facilitator')).toMatchObject({ closed: false, viewer: null });

      clock.mockReturnValue(start + 120 * day);
      await harness.room.alarm();
      expect(harness.getDeleteAllCount()).toBe(1);
      expect(harness.hasTables()).toBe(false);
      expect(await harness.room.read(harness.id, 'facilitator')).toBeNull();
    } finally {
      harness.close();
    }
  });

  test.each([
    'read',
    'mutate',
    'delete',
    'getFacilitatorCapability',
    'replaceFacilitatorCapability',
    'updateFacilitatorCapabilityEncryption',
    'claimFacilitator',
  ] as const)('lazy expiry on %s cancels alarm, wipes DO storage via deleteAll() + schema reset, and publishes room:missing', async (operation) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const harness = createFakePokerRoom();
    try {
      const created = await harness.room.create(harness.id, 'facilitator', 'Alex');
      if (created.closed || !created.viewer) throw new Error('Expected open Room');
      const openSocket = liveSocket('facilitator', created.viewer.id, start + 91 * day);
      harness.sockets.push(openSocket);

      // Advance past expiry without invoking alarm().
      clock.mockReturnValue(start + 91 * day);

      switch (operation) {
        case 'read':
          expect(await harness.room.read(harness.id, 'facilitator')).toBeNull();
          break;
        case 'mutate':
          expect(await harness.room.mutate(harness.id, 'facilitator', { type: 'add-story', title: 'Expired' }))
            .toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
          break;
        case 'delete':
          expect(await harness.room.delete(harness.id, 'facilitator'))
            .toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
          break;
        case 'getFacilitatorCapability':
          expect(await harness.room.getFacilitatorCapability(harness.id, 'facilitator'))
            .toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
          break;
        case 'replaceFacilitatorCapability':
          expect(
            await harness.room.replaceFacilitatorCapability(harness.id, 'facilitator', 0, {
              hash: 'h',
              encrypted: 'e',
              revision: 1,
            }),
          ).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
          break;
        case 'updateFacilitatorCapabilityEncryption':
          await harness.room.updateFacilitatorCapabilityEncryption(harness.id, 'facilitator', 1, 'e2');
          break;
        case 'claimFacilitator':
          expect(await harness.room.claimFacilitator(harness.id, 'voter', 'candidate'))
            .toMatchObject({ ok: false, code: 'INVALID_LINK' });
          break;
      }

      expect(harness.deleteAlarm).toHaveBeenCalledOnce();
      expect(harness.getDeleteAllCount()).toBe(1);
      expect(harness.getScheduledAlarm()).toBeNull();
      expect(harness.hasTables()).toBe(false);
      expect(openSocket.events).toEqual([{ type: 'room:missing' }, undefined]);
      expect(openSocket.closedWith).toEqual({ code: 1000, reason: 'Room unavailable' });

      // Subsequent read succeeds cleanly without recreating tables, and re-create works after reset.
      expect(await harness.room.read(harness.id, 'facilitator')).toBeNull();
      expect(harness.hasTables()).toBe(false);
      expect((await harness.room.create(harness.id, 'facilitator', 'Alex')).closed).toBe(false);
      expect(harness.hasTables()).toBe(true);
    } finally {
      harness.close();
    }
  });
});

describe('PointingPokerRoom Durable Object WebSocket live delivery handoff', () => {
  test('enforces 426 Upgrade: websocket, 401 missing identity, 403 unjoined open Room, 101 snapshot + presence, and terminal closed/missing delivery', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(start);
    stubCloudflareWebSocketUpgrade();
    const harness = createFakePokerRoom();
    try {
      await harness.room.create(harness.id, 'facilitator', 'Alex');

      const nonUpgrade = await harness.room.fetch(
        new Request(`https://retrocks.app/api/poker/${harness.id}/live`, {
          headers: { [POKER_LIVE_VIEWER_HEADER]: 'facilitator' },
        }),
      );
      expect(nonUpgrade.status).toBe(426);
      expect(nonUpgrade.headers.get('upgrade')).toBe('websocket');

      const missingIdentity = await harness.room.fetch(
        new Request(`https://retrocks.app/api/poker/${harness.id}/live`, {
          headers: { upgrade: 'websocket' },
        }),
      );
      expect(missingIdentity.status).toBe(401);

      const unjoined = await harness.room.fetch(
        new Request(`https://retrocks.app/api/poker/${harness.id}/live`, {
          headers: { upgrade: 'websocket', [POKER_LIVE_VIEWER_HEADER]: 'stranger' },
        }),
      );
      expect(unjoined.status).toBe(403);

      const joined = await harness.room.fetch(
        new Request(`https://retrocks.app/api/poker/${harness.id}/live`, {
          headers: { upgrade: 'websocket', [POKER_LIVE_VIEWER_HEADER]: 'facilitator' },
        }),
      );
      expect(joined.status).toBe(101);
      expect(harness.sockets).toHaveLength(1);
      const alexView = await harness.room.read(harness.id, 'facilitator');
      if (!alexView || alexView.closed || !alexView.viewer) throw new Error('Expected open Room viewer');
      expect(harness.sockets[0].events).toEqual([
        expect.objectContaining({ type: 'room:snapshot', room: expect.objectContaining({ closed: false }) }),
        { type: 'room:presence', online: [alexView.viewer.id] },
      ]);

      // Close Room -> existing socket gets terminal closed snapshot, and new visitors get closed summary + 1000.
      harness.sockets[0].events.length = 0;
      await harness.room.mutate(harness.id, 'facilitator', { type: 'close-room' });
      expect(harness.sockets[0].events).toEqual([
        expect.objectContaining({
          type: 'room:snapshot',
          room: expect.objectContaining({ closed: true, canDelete: true }),
        }),
        undefined,
      ]);
      expect(harness.sockets[0].closedWith).toEqual({ code: 1000, reason: 'Room closed' });

      const beforeClosedConnect = harness.sockets.length;
      const closedVisit = await harness.room.fetch(
        new Request(`https://retrocks.app/api/poker/${harness.id}/live`, {
          headers: { upgrade: 'websocket', [POKER_LIVE_VIEWER_HEADER]: 'stranger' },
        }),
      );
      expect(closedVisit.status).toBe(101);
      const closedSocket = harness.sockets[beforeClosedConnect];
      expect(closedSocket.events).toEqual([
        expect.objectContaining({
          type: 'room:snapshot',
          room: expect.objectContaining({ closed: true, canDelete: false }),
        }),
        undefined,
      ]);
      expect(closedSocket.closedWith).toEqual({ code: 1000, reason: 'Room closed' });

      // Delete Room -> new connect receives terminal room:missing and closes 1000.
      await harness.room.delete(harness.id, 'facilitator');
      const beforeMissingConnect = harness.sockets.length;
      const missingVisit = await harness.room.fetch(
        new Request(`https://retrocks.app/api/poker/${harness.id}/live`, {
          headers: { upgrade: 'websocket', [POKER_LIVE_VIEWER_HEADER]: 'facilitator' },
        }),
      );
      expect(missingVisit.status).toBe(101);
      const missingSocket = harness.sockets[beforeMissingConnect];
      expect(missingSocket.events).toEqual([{ type: 'room:missing' }, undefined]);
      expect(missingSocket.closedWith).toEqual({ code: 1000, reason: 'Room unavailable' });
    } finally {
      harness.close();
    }
  });

  test('hands off per-viewer snapshot publication, ping/pruning, send failures, CLOSING reciprocation, ping expiry, and closed presence suppression to the WebSocket hub', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const harness = createFakePokerRoom();
    try {
      await harness.room.create(harness.id, 'facilitator', 'Alex');
      await harness.room.mutate(harness.id, 'voter', { type: 'join', displayName: 'Sam' });
      const alexView = await harness.room.read(harness.id, 'facilitator');
      const samView = await harness.room.read(harness.id, 'voter');
      if (!alexView || alexView.closed || !alexView.viewer || !samView || samView.closed || !samView.viewer) {
        throw new Error('Expected open Room Participants');
      }

      const alexSock = liveSocket('facilitator', alexView.viewer.id, start);
      const samSock = liveSocket('voter', samView.viewer.id, start);
      harness.sockets.push(alexSock, samSock);

      // Per-viewer snapshot projection handed off to connected sockets.
      await harness.room.mutate(harness.id, 'facilitator', { type: 'add-story', title: 'Story 1', makeActive: true });
      expect(alexSock.events.at(-1)).toMatchObject({
        type: 'room:snapshot',
        room: { viewer: { displayName: 'Alex' }, stories: [{ title: 'Story 1' }] },
      });
      expect(samSock.events.at(-1)).toMatchObject({
        type: 'room:snapshot',
        room: { viewer: { displayName: 'Sam' }, stories: [{ title: 'Story 1' }] },
      });

      // Ping refreshes Alex; after Sam times out, Alex's ping prunes Sam (1001) and broadcasts presence.
      alexSock.events.length = 0;
      clock.mockReturnValue(start + Math.floor(LIVE_HEARTBEAT_TIMEOUT_MS / 2));
      harness.room.webSocketMessage(alexSock as unknown as WebSocket, 'ping');
      expect(alexSock.events).toEqual([{ type: 'heartbeat' }]);

      clock.mockReturnValue(start + LIVE_HEARTBEAT_TIMEOUT_MS + 1);
      alexSock.events.length = 0;
      harness.room.webSocketMessage(alexSock as unknown as WebSocket, 'ping');
      expect(samSock.closedWith).toEqual({ code: 1001, reason: 'Live connection timed out' });
      expect(alexSock.events).toEqual([
        { type: 'heartbeat' },
        { type: 'room:presence', online: [alexView.viewer.id] },
      ]);

      // Send failure during mutation closes failing socket (1011) and broadcasts updated presence.
      const samFailing = liveSocket('voter', samView.viewer.id, clock());
      samFailing.failNextSend = true;
      harness.sockets.push(samFailing);
      alexSock.events.length = 0;
      await harness.room.mutate(harness.id, 'facilitator', { type: 'add-story', title: 'Story 2' });
      expect(samFailing.closedWith).toEqual({ code: 1011, reason: 'Live delivery failed' });
      expect(alexSock.events).toEqual([
        expect.objectContaining({ type: 'room:snapshot' }),
        { type: 'room:presence', online: [alexView.viewer.id] },
      ]);

      // CLOSING reciprocation in webSocketClose broadcasts updated presence on open Room.
      const samClosing = liveSocket('voter', samView.viewer.id, clock());
      samClosing.readyState = WebSocket.CLOSING;
      harness.sockets.push(samClosing);
      alexSock.events.length = 0;
      harness.room.webSocketClose(samClosing as unknown as WebSocket);
      expect(samClosing.closeCalls).toBe(1);
      expect(alexSock.events).toEqual([{ type: 'room:presence', online: [alexView.viewer.id] }]);

      // Ping after Room expires delivers terminal room:missing and closes open sockets with 1000.
      clock.mockReturnValue(start + 91 * day);
      alexSock.events.length = 0;
      harness.room.webSocketMessage(alexSock as unknown as WebSocket, 'ping');
      expect(alexSock.events).toEqual([{ type: 'room:missing' }, undefined]);
      expect(alexSock.closedWith).toEqual({ code: 1000, reason: 'Room unavailable' });
    } finally {
      harness.close();
    }
  });

  test('suppresses presence broadcasts on webSocketClose after Room is closed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(start);
    const harness = createFakePokerRoom();
    try {
      await harness.room.create(harness.id, 'facilitator', 'Alex');
      await harness.room.mutate(harness.id, 'voter', { type: 'join', displayName: 'Sam' });
      const alexView = await harness.room.read(harness.id, 'facilitator');
      const samView = await harness.room.read(harness.id, 'voter');
      if (!alexView || alexView.closed || !alexView.viewer || !samView || samView.closed || !samView.viewer) {
        throw new Error('Expected open Room Participants');
      }
      const samSock = liveSocket('voter', samView.viewer.id, start);
      harness.sockets.push(samSock);

      await harness.room.mutate(harness.id, 'facilitator', { type: 'close-room' });
      const lingering = liveSocket('facilitator', alexView.viewer.id, start);
      harness.sockets.push(lingering);
      samSock.readyState = WebSocket.CLOSING;
      harness.room.webSocketClose(samSock as unknown as WebSocket);
      expect(samSock.closeCalls).toBe(2);
      expect(lingering.events).toEqual([]);
    } finally {
      harness.close();
    }
  });
});
