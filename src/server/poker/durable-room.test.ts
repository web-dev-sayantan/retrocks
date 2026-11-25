import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { parsePokerLiveMessage } from '../../lib/poker-schemas';
import { wrapDatabaseSync } from '../adapters/node/sqlite';
import { generateEntityId } from '../crypto';
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


function liveSocket(hash: string, participantId: string) {
  const events: unknown[] = [];
  return {
    events,
    readyState: Number(WebSocket.OPEN),
    deserializeAttachment: () => ({ hash, participantId, lastSeenAt: start }),
    serializeAttachment() {},
    send(data: string) {
      events.push(JSON.parse(data));
    },
    close() {
      events.push(undefined);
      this.readyState = WebSocket.CLOSED;
    },
  };
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
  } finally {
    node?.close();
  }
});
