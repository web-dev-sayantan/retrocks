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
import { LIVE_FACILITATOR_HEADER, LIVE_PARTICIPANT_HEADER } from '../../live/headers';
import { BoardRoom } from './board-room';

interface FakeSocket {
  readyState: number;
  sent: string[];
  closedWith: { code?: number; reason?: string } | null;
  attachment: unknown;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

function createFakeSocket(attachment: unknown): FakeSocket {
  return {
    readyState: WebSocket.OPEN,
    sent: [],
    closedWith: null,
    attachment,
    send(data: string) {
      this.sent.push(data);
    },
    close(code?: number, reason?: string) {
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
