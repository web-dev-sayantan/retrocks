import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { parsePokerLiveMessage } from '../../lib/poker-schemas';
import { wrapDatabaseSync } from '../adapters/node/sqlite';
import { generateEntityId } from '../crypto';
import { PointingPokerRoom } from './durable-room';

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
  const sqlRunner = wrapDatabaseSync(db);
  const ctx = {
    id: { name: id },
    getWebSockets: () => [socket],
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
