import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { LIVE_HEARTBEAT_TIMEOUT_MS } from '../../lib/live-protocol';
import { parsePokerLiveMessage } from '../../lib/poker-schemas';
import { wrapDatabaseSync } from '../adapters/node/sqlite';
import { generateEntityId } from '../crypto';
import { POKER_LIVE_VIEWER_HEADER } from '../live/headers';
import { PointingPokerRoom } from './durable-room';
import { openNodePokerRooms } from './node';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class MockDurableObject {
    constructor(protected readonly ctx: DurableObjectState) {}
  },
}));

const day = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 0, 1);
const id = generateEntityId();

let db: DatabaseSync;
let room: PointingPokerRoom;
let socket: { readyState: number; send: ReturnType<typeof vi.fn<(data: string) => void>>; deserializeAttachment: () => null; close: ReturnType<typeof vi.fn> };
let sockets: ReturnType<typeof liveSocket>[];
let setAlarm: ReturnType<typeof vi.fn<(expiresAt: number) => void>>;
let deleteAlarm: ReturnType<typeof vi.fn>;
let clock: ReturnType<typeof vi.fn<() => number>>;

beforeEach(async () => {
  clock = vi.fn(() => start);
  vi.spyOn(Date, 'now').mockImplementation(clock);
  db = new DatabaseSync(':memory:');
  setAlarm = vi.fn<(expiresAt: number) => void>();
  deleteAlarm = vi.fn();
  socket = {
    readyState: WebSocket.OPEN,
    send: vi.fn<(data: string) => void>(),
    deserializeAttachment: () => null,
    close: vi.fn(() => { socket.readyState = WebSocket.CLOSED; }),
  };
  sockets = [];
  const sqlRunner = wrapDatabaseSync(db);
  const ctx = {
    id: { name: id },
    getWebSockets: () => [socket, ...sockets],
    acceptWebSocket: (ws: ReturnType<typeof liveSocket>) => {
      sockets.push(ws);
    },
    storage: {
      sql: {
        exec(query: string, ...params: SQLInputValue[]) {
          if (query.startsWith('SELECT')) {
            const rows = db.prepare(query).all(...params);
            return { toArray: () => rows, rowsWritten: 0 };
          }
          const result = db.prepare(query).run(...params);
          return { rowsWritten: Number(result.changes) };
        },
      },
      transactionSync: sqlRunner.transaction,
      setAlarm,
      deleteAlarm,
    },
  } as unknown as DurableObjectState;
  room = new PointingPokerRoom(ctx, {} as Cloudflare.Env);
  await room.create(id, 'facilitator', 'Alex');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  db.close();
});

test('alarms follow actual changes and an old alarm cannot purge an extended Room', async () => {
  expect(setAlarm).toHaveBeenLastCalledWith(start + 90 * day);
  setAlarm.mockClear();
  clock.mockReturnValue(start + day);
  await room.mutate(id, 'facilitator', { type: 'add-story', title: 'Estimate the Story' });
  expect(setAlarm).toHaveBeenCalledExactlyOnceWith(start + 91 * day);

  setAlarm.mockClear();
  clock.mockReturnValue(start + 2 * day);
  await room.mutate(id, 'voter', { type: 'join', displayName: 'Sam' });
  await room.mutate(id, 'facilitator', { type: 'set-deck', deck: { type: 'fibonacci' } });
  await room.read(id, 'voter');
  expect(setAlarm).not.toHaveBeenCalled();

  clock.mockReturnValue(start + 90 * day);
  await room.alarm();
  expect(setAlarm).toHaveBeenLastCalledWith(start + 91 * day);
  expect(await room.read(id, 'voter')).not.toBeNull();

  clock.mockReturnValue(start + 91 * day);
  await room.alarm();
  expect(db.prepare('SELECT id FROM poker_rooms').all()).toEqual([]);
  expect(await room.read(id, 'voter')).toBeNull();
  expect(socket.send.mock.calls.map(([data]) => parsePokerLiveMessage(data))).toEqual([{ type: 'room:missing' }]);
  expect(socket.close).toHaveBeenCalledOnce();
});

test('deletion clears the Room alarm and publishes a terminal frame only after authorization', async () => {
  expect(await room.delete(id, 'voter')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(deleteAlarm).not.toHaveBeenCalled();
  expect(socket.send).not.toHaveBeenCalled();
  expect(await room.delete(id, 'facilitator')).toEqual({ ok: true });
  expect(deleteAlarm).toHaveBeenCalledOnce();
  expect(db.prepare('SELECT id FROM poker_rooms').all()).toEqual([]);
  expect(socket.send.mock.calls.map(([data]) => parsePokerLiveMessage(data))).toEqual([{ type: 'room:missing' }]);
  expect(socket.close).toHaveBeenCalledOnce();
});

test('reopening a closed Room resets the Durable Object alarm to 90 days from now', async () => {
  clock.mockReturnValue(start + day);
  expect(await room.mutate(id, 'facilitator', { type: 'close-room' })).toMatchObject({ ok: true, room: { closed: true } });
  expect(setAlarm).toHaveBeenLastCalledWith(start + 91 * day);

  setAlarm.mockClear();
  clock.mockReturnValue(start + 30 * day);
  expect(await room.mutate(id, 'facilitator', { type: 'reopen-room' })).toMatchObject({
    ok: true,
    room: { closed: false, viewer: null },
  });
  expect(setAlarm).toHaveBeenCalledExactlyOnceWith(start + 120 * day);

  clock.mockReturnValue(start + 91 * day);
  await room.alarm();
  expect(setAlarm).toHaveBeenLastCalledWith(start + 120 * day);
  expect(await room.read(id, 'facilitator')).toMatchObject({ closed: false, viewer: null });

  clock.mockReturnValue(start + 120 * day);
  await room.alarm();
  expect(await room.read(id, 'facilitator')).toBeNull();
});


function liveSocket(hash: string | null, participantId: string | null) {
  const events: unknown[] = [];
  let attachment: unknown = hash && participantId ? { hash, participantId, lastSeenAt: start } : null;
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
      events.push(JSON.parse(data));
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

async function connectViewers(
  adapter: PointingPokerRoom | Awaited<ReturnType<typeof openNodePokerRooms>>,
  node: Awaited<ReturnType<typeof openNodePokerRooms>> | null,
) {
  const viewers = await Promise.all(['facilitator', 'voter'].map(async (hash) => {
    const view = await adapter.read(id, hash);
    if (!view || view.closed || !view.viewer) throw new Error('Expected a Participant.');
    if (node) {
      const reader = node.connect(id, hash, new Request('https://retrocks.test/live')).body!.getReader();
      return async () => {
        const { value, done } = await reader.read();
        return done ? undefined : JSON.parse(new TextDecoder().decode(value).slice(6)) as unknown;
      };
    }
    const peer = liveSocket(hash, view.viewer.id);
    sockets.push(peer);
    return async () => {
      expect(peer.events.length).toBeGreaterThan(0);
      return peer.events.shift();
    };
  }));
  if (node) {
    for (const [index, next] of viewers.entries()) {
      expect(await next()).toMatchObject({ type: 'room:snapshot' });
      expect(await next()).toMatchObject({ type: 'room:presence' });
      if (index === 0) expect(await next()).toMatchObject({ type: 'room:presence' });
    }
  }
  return viewers;
}

test.each([
  ['Node', 'close'],
  ['Durable Object', 'close'],
  ['Node', 'delete'],
  ['Durable Object', 'delete'],
] as const)('%s delivers Participant projections followed by the %s terminal frame', async (runtime, terminal) => {
  const node = runtime === 'Node' ? await openNodePokerRooms(':memory:') : null;
  const adapter = node ?? room;
  try {
    if (node) node.create(id, 'facilitator', 'Alex');
    expect(await adapter.mutate(id, 'voter', { type: 'join', displayName: 'Sam' })).toMatchObject({ ok: true });
    const added = await adapter.mutate(id, 'facilitator', { type: 'add-story', title: 'Estimate', makeActive: true });
    if (!added.ok || added.room.closed || !added.room.round) throw new Error('Expected an open Voting Round.');
    const roundId = added.room.round.id;

    const viewers = await connectViewers(adapter, node);

    expect(await adapter.mutate(id, 'voter', { type: 'set-deck', deck: { type: 'fibonacci' } })).toMatchObject({ ok: false });
    expect(await adapter.mutate(id, 'facilitator', { type: 'set-deck', deck: { type: 'fibonacci' } })).toMatchObject({ ok: true });
    expect(await adapter.delete(id, 'voter')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await adapter.mutate(id, 'voter', { type: 'vote', roundId, choice: '3' })).toMatchObject({ ok: true });

    for (const [index, next] of viewers.entries()) {
      const frame = await next();
      expect(frame).toMatchObject({
        type: 'room:snapshot',
        room: {
          viewer: { displayName: index === 0 ? 'Alex' : 'Sam' },
          round: {
            id: roundId,
            phase: 'open',
            ownChoice: index === 0 ? null : '3',
            submittedParticipantIds: [added.room.participants.find(({ displayName }) => displayName === 'Sam')!.id],
          },
        },
      });
      expect(frame).not.toHaveProperty('room.round.ballots');
    }

    if (terminal === 'close') {
      expect(await adapter.mutate(id, 'facilitator', { type: 'close-room', discardRoundId: roundId })).toMatchObject({ ok: true });
    } else {
      expect(await adapter.delete(id, 'facilitator')).toEqual({ ok: true });
    }
    for (const [index, next] of viewers.entries()) {
      if (terminal === 'close') {
        expect(await next()).toMatchObject({
          type: 'room:snapshot',
          room: { closed: true, canDelete: index === 0, stories: [{ title: 'Estimate' }] },
        });
      } else {
        expect(await next()).toEqual({ type: 'room:missing' });
      }
      expect(await next()).toBeUndefined();
    }
  } finally {
    node?.close();
  }
});

test.each(['Node', 'Durable Object'])('%s publishes effective Co-Facilitator Link changes only', async (runtime) => {
  const node = runtime === 'Node' ? await openNodePokerRooms(':memory:') : null;
  const adapter = node ?? room;
  try {
    if (node) node.create(id, 'facilitator', 'Alex');
    await adapter.mutate(id, 'voter', { type: 'join', displayName: 'Sam' });
    await adapter.replaceFacilitatorCapability(id, 'facilitator', 0, {
      hash: 'first-hash', encrypted: 'first-secret', revision: 1,
    });
    const [alex, sam] = await connectViewers(adapter, node);

    const claim = await adapter.claimFacilitator(id, 'voter', 'first-hash');
    expect(claim).toMatchObject({ ok: true, value: { viewer: { displayName: 'Sam', isFacilitator: true } } });
    expect(await alex()).toMatchObject({
      type: 'room:snapshot',
      room: { viewer: { displayName: 'Alex' }, participants: expect.arrayContaining([
        expect.objectContaining({ displayName: 'Sam', isFacilitator: true }),
      ]) },
    });
    expect(await sam()).toMatchObject({
      type: 'room:snapshot',
      room: { viewer: { displayName: 'Sam', isFacilitator: true }, facilitatorLinkRevision: 1 },
    });
    expect(await adapter.claimFacilitator(id, 'voter', 'first-hash')).toEqual(claim);
    expect(await adapter.claimFacilitator(id, 'voter', 'wrong-hash')).toMatchObject({
      ok: false, code: 'INVALID_LINK',
    });

    expect(await adapter.replaceFacilitatorCapability(id, 'facilitator', 1, {
      hash: 'second-hash', encrypted: 'second-secret', revision: 2,
    })).toEqual({ ok: true, value: null });
    for (const [next, displayName] of [[alex, 'Alex'], [sam, 'Sam']] as const) {
      const frame = await next();
      expect(frame).toMatchObject({
        type: 'room:snapshot',
        room: { viewer: { displayName, isFacilitator: true }, facilitatorLinkRevision: 2 },
      });
      expect(JSON.stringify(frame)).not.toMatch(/"(?:hash|encrypted|facilitatorCapability)"|second-hash|second-secret/);
    }

    // Re-encrypting the current revision persists updated ciphertext without publishing a snapshot,
    // and stale-revision re-encryption writes are ignored.
    await adapter.updateFacilitatorCapabilityEncryption(id, 'facilitator', 1, 'stale-reencrypted');
    expect(await adapter.getFacilitatorCapability(id, 'facilitator')).toEqual({
      ok: true,
      value: { hash: 'second-hash', encrypted: 'second-secret', revision: 2 },
    });
    await adapter.updateFacilitatorCapabilityEncryption(id, 'facilitator', 2, 'rotated-reencrypted');
    expect(await adapter.getFacilitatorCapability(id, 'facilitator')).toEqual({
      ok: true,
      value: { hash: 'second-hash', encrypted: 'rotated-reencrypted', revision: 2 },
    });
    expect(await adapter.replaceFacilitatorCapability(id, 'facilitator', 2, {
      hash: 'third-hash', encrypted: 'third-secret', revision: 3,
    })).toEqual({ ok: true, value: null });
    for (const [next, displayName] of [[alex, 'Alex'], [sam, 'Sam']] as const) {
      expect(await next()).toMatchObject({
        type: 'room:snapshot',
        room: { viewer: { displayName, isFacilitator: true }, facilitatorLinkRevision: 3 },
      });
    }
  } finally {
    node?.close();
  }
});

test('PointingPokerRoom.fetch enforces fallback 426 with Upgrade: websocket, 401 on missing identity, open-Room 403, and terminal closed/missing delivery', async () => {
  stubCloudflareWebSocketUpgrade();

  // Fallback 426 includes Upgrade: websocket
  const nonUpgrade = await room.fetch(
    new Request(`https://retrocks.app/api/poker/${id}/live`, {
      headers: { [POKER_LIVE_VIEWER_HEADER]: 'facilitator' },
    }),
  );
  expect(nonUpgrade.status).toBe(426);
  expect(nonUpgrade.headers.get('upgrade')).toBe('websocket');

  // Missing internal identity header -> 401 (not 403)
  const missingIdentity = await room.fetch(
    new Request(`https://retrocks.app/api/poker/${id}/live`, {
      headers: { upgrade: 'websocket' },
    }),
  );
  expect(missingIdentity.status).toBe(401);

  // Unjoined visitor on open Room -> 403
  const unjoined = await room.fetch(
    new Request(`https://retrocks.app/api/poker/${id}/live`, {
      headers: { upgrade: 'websocket', [POKER_LIVE_VIEWER_HEADER]: 'stranger' },
    }),
  );
  expect(unjoined.status).toBe(403);

  // Joined Participant on open Room -> 101 + snapshot + room:presence
  const joined = await room.fetch(
    new Request(`https://retrocks.app/api/poker/${id}/live`, {
      headers: { upgrade: 'websocket', [POKER_LIVE_VIEWER_HEADER]: 'facilitator' },
    }),
  );
  expect(joined.status).toBe(101);
  expect(sockets).toHaveLength(1);
  const alexView = await room.read(id, 'facilitator');
  if (!alexView || alexView.closed || !alexView.viewer) throw new Error('Expected open Room viewer');
  expect(sockets[0].events).toEqual([
    expect.objectContaining({ type: 'room:snapshot', room: expect.objectContaining({ closed: false }) }),
    { type: 'room:presence', online: [alexView.viewer.id] },
  ]);

  // Close the Room -> new visitor receives terminal closed summary (canDelete: false) and closes 1000 without presence
  await room.mutate(id, 'facilitator', { type: 'close-room' });
  const beforeClosedConnect = sockets.length;
  const closedVisit = await room.fetch(
    new Request(`https://retrocks.app/api/poker/${id}/live`, {
      headers: { upgrade: 'websocket', [POKER_LIVE_VIEWER_HEADER]: 'stranger' },
    }),
  );
  expect(closedVisit.status).toBe(101);
  const closedSocket = sockets[beforeClosedConnect];
  expect(closedSocket.events).toEqual([
    expect.objectContaining({
      type: 'room:snapshot',
      room: expect.objectContaining({ closed: true, canDelete: false }),
    }),
    undefined,
  ]);
  expect(closedSocket.closedWith).toEqual({ code: 1000, reason: 'Room closed' });

  // Delete the Room -> new connect receives terminal room:missing and closes 1000
  await room.delete(id, 'facilitator');
  const beforeMissingConnect = sockets.length;
  const missingVisit = await room.fetch(
    new Request(`https://retrocks.app/api/poker/${id}/live`, {
      headers: { upgrade: 'websocket', [POKER_LIVE_VIEWER_HEADER]: 'facilitator' },
    }),
  );
  expect(missingVisit.status).toBe(101);
  const missingSocket = sockets[beforeMissingConnect];
  expect(missingSocket.events).toEqual([{ type: 'room:missing' }, undefined]);
  expect(missingSocket.closedWith).toEqual({ code: 1000, reason: 'Room unavailable' });
});

test('PointingPokerRoom reciprocates CLOSING, broadcasts presence on stale-peer pruning and send failure, suppresses presence when closed, and delivers room:missing on ping expiry', async () => {
  await room.mutate(id, 'voter', { type: 'join', displayName: 'Sam' });
  const alexView = await room.read(id, 'facilitator');
  const samView = await room.read(id, 'voter');
  if (!alexView || alexView.closed || !alexView.viewer || !samView || samView.closed || !samView.viewer) {
    throw new Error('Expected open Room Participants');
  }

  const alexSock = liveSocket('facilitator', alexView.viewer.id);
  const samSock = liveSocket('voter', samView.viewer.id);
  sockets.push(alexSock, samSock);

  // Alex pings midway to stay fresh; then after Sam times out, Alex's ping prunes Sam (1001) and broadcasts updated presence!
  clock.mockReturnValue(start + Math.floor(LIVE_HEARTBEAT_TIMEOUT_MS / 2));
  room.webSocketMessage(alexSock as unknown as WebSocket, 'ping');
  expect(alexSock.events).toEqual([{ type: 'heartbeat' }]);

  clock.mockReturnValue(start + LIVE_HEARTBEAT_TIMEOUT_MS + 1);
  alexSock.events.length = 0;
  room.webSocketMessage(alexSock as unknown as WebSocket, 'ping');
  expect(samSock.closedWith).toEqual({ code: 1001, reason: 'Live connection timed out' });
  expect(alexSock.events).toEqual([
    { type: 'heartbeat' },
    { type: 'room:presence', online: [alexView.viewer.id] },
  ]);

  // Re-add Sam; send failure during mutation closes Sam (1011) and broadcasts updated presence to Alex!
  const samFailing = liveSocket('voter', samView.viewer.id);
  samFailing.serializeAttachment({ hash: 'voter', participantId: samView.viewer.id, lastSeenAt: clock() });
  samFailing.failNextSend = true;
  sockets.push(samFailing);
  alexSock.events.length = 0;
  await room.mutate(id, 'facilitator', { type: 'add-story', title: 'New Story' });
  expect(samFailing.closedWith).toEqual({ code: 1011, reason: 'Live delivery failed' });
  expect(alexSock.events).toEqual([
    expect.objectContaining({ type: 'room:snapshot' }),
    { type: 'room:presence', online: [alexView.viewer.id] },
  ]);

  // CLOSING reciprocation in webSocketClose broadcasts updated presence on open Room
  const samClosing = liveSocket('voter', samView.viewer.id);
  samClosing.serializeAttachment({ hash: 'voter', participantId: samView.viewer.id, lastSeenAt: clock() });
  samClosing.readyState = WebSocket.CLOSING;
  sockets.push(samClosing);
  alexSock.events.length = 0;
  room.webSocketClose(samClosing as unknown as WebSocket);
  expect(samClosing.closeCalls).toBe(1);
  expect(alexSock.events).toEqual([{ type: 'room:presence', online: [alexView.viewer.id] }]);

  // Ping after Room expires pushes terminal room:missing and closes open sockets with 1000
  clock.mockReturnValue(start + 91 * day);
  alexSock.events.length = 0;
  room.webSocketMessage(alexSock as unknown as WebSocket, 'ping');
  expect(alexSock.events).toEqual([{ type: 'room:missing' }, undefined]);
  expect(alexSock.closedWith).toEqual({ code: 1000, reason: 'Room unavailable' });
});

test('PointingPokerRoom suppresses presence broadcasts on webSocketClose after Room is closed', async () => {
  await room.mutate(id, 'voter', { type: 'join', displayName: 'Sam' });
  const alexView = await room.read(id, 'facilitator');
  const samView = await room.read(id, 'voter');
  if (!alexView || alexView.closed || !alexView.viewer || !samView || samView.closed || !samView.viewer) {
    throw new Error('Expected open Room Participants');
  }
  const alexSock = liveSocket('facilitator', alexView.viewer.id);
  const samSock = liveSocket('voter', samView.viewer.id);
  sockets.push(alexSock, samSock);

  await room.mutate(id, 'facilitator', { type: 'close-room' });
  // Simulate a lingering open peer and a closing peer on a closed Room: no room:presence frame may be emitted.
  const lingering = liveSocket('facilitator', alexView.viewer.id);
  sockets.push(lingering);
  samSock.readyState = WebSocket.CLOSING;
  room.webSocketClose(samSock as unknown as WebSocket);
  expect(samSock.closeCalls).toBe(2); // once on close-room, once reciprocating CLOSING
  expect(lingering.events).toEqual([]);
});
