import { describe, expect, it, vi } from 'vitest';

import type {
  BoardMutationActor,
  BoardMutationCommand,
  CreateBoardRecord,
} from '../db/raw-types';
import {
  checkBoardCreateRateLimit,
  createBoardWriteRateLimiter,
  createInMemoryRateLimiter,
} from '../rate-limit';
import { runWithCloudflareEnv } from './cloudflare-context';
import { createCloudflareBoardStore } from './cloudflare/cloudflare-board-store';
import { createNodeBoardStore } from './node/sqlite-board-store';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeCreateRecord(overrides?: Partial<CreateBoardRecord>): CreateBoardRecord {
  const now = 1_760_000_000_000;
  return {
    id: 'board_abcdef0123456789',
    title: 'Sprint 42 Retro',
    subtitle: 'Checkout Team',
    templateId: 'standard',
    facilitatorTokenHash: 'f_hash_123',
    facilitatorTokenEncrypted: 'v1.iv.ciphertext',
    tokenSalt: 'salt_123',
    isBlurred: true,
    voteLimit: 5,
    maxVotesPerCard: 1,
    retentionDays: 30,
    createdAt: now,
    columns: [
      {
        id: 'col_a',
        title: 'Went Well',
        accent: 'sage',
        position: 0,
        isActionColumn: false,
      },
      {
        id: 'col_b',
        title: 'Action Items',
        accent: 'sky',
        position: 1,
        isActionColumn: true,
      },
    ],
    ...overrides,
  };
}

describe('NodeBoardStore (node:sqlite)', () => {
  it('creates all 7 schema tables, persists a Board + Columns, and reads them back', async () => {
    const store = await createNodeBoardStore(':memory:');
    const record = makeCreateRecord();

    const created = await store.createBoard(record);
    expect(created.board.id).toBe(record.id);
    expect(created.board.title).toBe('Sprint 42 Retro');
    expect(created.board.isBlurred).toBe(true);
    expect(created.board.voteLimit).toBe(5);
    expect(created.board.maxVotesPerCard).toBe(1);
    expect(created.board.retentionDays).toBe(30);
    expect(created.columns).toHaveLength(2);
    expect(created.columns[1]).toMatchObject({
      title: 'Action Items',
      accent: 'sky',
      isActionColumn: true,
    });

    const loaded = await store.getBoardSnapshot(record.id, record.createdAt + 1000);
    expect(loaded).toEqual(created);

    // Re-encryption update works in place
    await store.updateFacilitatorTokenEncryption(record.id, 'v1.newiv.newct');
    const updated = await store.getBoardSnapshot(record.id, record.createdAt + 2000);
    expect(updated?.board.facilitatorTokenEncrypted).toBe('v1.newiv.newct');

    store.close();
  });

  it('returns null for missing or expired Boards and cascades deletes cleanly', async () => {
    const store = await createNodeBoardStore(':memory:');
    const record = makeCreateRecord({ retentionDays: 30 });
    await store.createBoard(record);

    expect(await store.getBoardSnapshot('missing_board_123456')).toBeNull();

    // Touch activity extends expiry
    const day20 = record.createdAt + 20 * MS_PER_DAY;
    await store.touchActivity(record.id, day20);
    expect(
      await store.getBoardSnapshot(record.id, record.createdAt + 35 * MS_PER_DAY),
    ).not.toBeNull();

    // Past 30 days after lastActiveAt (day20 + 31 days) expires and returns null
    const expiredAt = day20 + 31 * MS_PER_DAY;
    expect(await store.getBoardSnapshot(record.id, expiredAt)).toBeNull();

    // Deleting a fresh board removes it permanently
    const record2 = makeCreateRecord({ id: 'board_second_12345678' });
    await store.createBoard(record2);
    expect(await store.deleteBoard(record2.id)).toBe(true);
    expect(await store.deleteBoard(record2.id)).toBe(false);
    expect(await store.getBoardSnapshot(record2.id)).toBeNull();

    store.close();
  });

  it('runs a periodic .unref() inactivity cleanup sweep that purges expired Boards and cascades child rows while preserving active ones', async () => {
    vi.useFakeTimers();
    const realSetInterval = globalThis.setInterval;
    const unrefSpy = vi.fn();
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(((fn: TimerHandler, ms?: number) => {
        const handle = realSetInterval(fn, ms) as unknown as NodeJS.Timeout;
        const wrapped = Object.assign(Object(handle), { unref: unrefSpy });
        return wrapped as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval);
    let currentTime = 1_760_000_000_000;
    const store = await createNodeBoardStore(':memory:', {
      expirySweepIntervalMs: 60_000,
      now: () => currentTime,
    });
    try {
      expect(unrefSpy).toHaveBeenCalledTimes(1);

      const expiredRecord = makeCreateRecord({
        id: 'board_expired_1234567',
        retentionDays: 30,
        createdAt: currentTime,
      });
      const activeRecord = makeCreateRecord({
        id: 'board_active_12345678',
        retentionDays: 30,
        createdAt: currentTime,
        columns: [
          {
            id: 'col_active_a',
            title: 'Went Well',
            accent: 'sage',
            position: 0,
            isActionColumn: false,
          },
        ],
      });
      await store.createBoard(expiredRecord);
      await store.createBoard(activeRecord);

      // Populate child records (Card, Vote, Reaction, Comment) on the Board that will expire.
      await store.mutateBoard(
        expiredRecord.id,
        { participantHash: 'author_1', isFacilitator: true },
        { type: 'card:create', id: 'card_exp_1', columnId: 'col_a', content: 'Old card' },
        currentTime,
      );
      await store.mutateBoard(
        expiredRecord.id,
        { participantHash: 'author_1', isFacilitator: true },
        { type: 'vote:change', targetType: 'card', targetId: 'card_exp_1', delta: 1 },
        currentTime,
      );
      await store.mutateBoard(
        expiredRecord.id,
        { participantHash: 'author_1', isFacilitator: true },
        { type: 'reaction:toggle', cardId: 'card_exp_1', emoji: '👍' },
        currentTime,
      );
      await store.mutateBoard(
        expiredRecord.id,
        { participantHash: 'author_1', isFacilitator: true },
        { type: 'comment:create', id: 'comment_exp_1', cardId: 'card_exp_1', content: 'Old comment' },
        currentTime,
      );

      // Write on activeRecord at day 20 extends its last_active_at.
      currentTime += 20 * MS_PER_DAY;
      await store.mutateBoard(
        activeRecord.id,
        { participantHash: 'author_2', isFacilitator: false },
        { type: 'card:create', id: 'card_act_1', columnId: 'col_active_a', content: 'Fresh card' },
        currentTime,
      );

      // Advance to day 31: expiredRecord is past 30 days, activeRecord has 19 days left.
      currentTime += 11 * MS_PER_DAY;
      await vi.advanceTimersByTimeAsync(60_000);

      // Expired Board was purged by the background sweep (even before any read).
      expect(await store.getBoardSnapshot(expiredRecord.id, 0)).toBeNull();
      expect(await store.getFacilitatorCapability(expiredRecord.id, 0)).toBeNull();
      // Active Board remains intact with its Card.
      const activeSnap = await store.getBoardSnapshot(activeRecord.id, currentTime);
      expect(activeSnap?.cards).toHaveLength(1);
    } finally {
      store.close();
      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('CloudflareBoardStore (Durable Object RPC seam)', () => {
  it('routes BoardStore calls to idFromName(boardId) stub methods', async () => {
    const backingStore = await createNodeBoardStore(':memory:');
    const idFromName = vi.fn((name: string) => ({ name }) as unknown as DurableObjectId);
    const stub = {
      createBoard: vi.fn((r: CreateBoardRecord) => backingStore.createBoard(r)),
      getBoardSnapshot: vi.fn((id: string, now?: number) =>
        backingStore.getBoardSnapshot(id, now),
      ),
      getBoardTokenSalt: vi.fn((id: string, now?: number) =>
        backingStore.getBoardTokenSalt(id, now),
      ),
      mutateBoard: vi.fn(
        (
          id: string,
          actor: BoardMutationActor,
          command: BoardMutationCommand,
          now?: number,
        ) => backingStore.mutateBoard(id, actor, command, now),
      ),
      deleteBoard: vi.fn((id: string) => backingStore.deleteBoard(id)),
      touchActivity: vi.fn((id: string, now?: number) =>
        backingStore.touchActivity(id, now),
      ),
      updateFacilitatorTokenEncryption: vi.fn((id: string, enc: string) =>
        backingStore.updateFacilitatorTokenEncryption(id, enc),
      ),
    };
    const namespace = {
      idFromName,
      get: vi.fn(() => stub),
    } as unknown as DurableObjectNamespace;

    const cfStore = createCloudflareBoardStore(namespace);
    const record = makeCreateRecord();

    const created = await cfStore.createBoard(record);
    expect(idFromName).toHaveBeenCalledWith(record.id);
    expect(created.board.id).toBe(record.id);

    const fetched = await cfStore.getBoardSnapshot(record.id, record.createdAt + 500);
    expect(fetched?.board.title).toBe(record.title);

    const salt = await cfStore.getBoardTokenSalt(record.id, record.createdAt + 600);
    expect(salt).toBe(record.tokenSalt);

    const mutated = await cfStore.mutateBoard(
      record.id,
      { participantHash: 'hash_abc', isFacilitator: true },
      {
        type: 'card:create',
        id: 'card_rpc_1',
        columnId: 'col_a',
        content: 'Created via DO RPC seam',
      },
      record.createdAt + 700,
    );
    expect(mutated.ok).toBe(true);
    expect(stub.mutateBoard).toHaveBeenCalledTimes(1);

    backingStore.close();
  });

  it('enforces per-Board write rate limits keyed by participantHash', () => {
    const limiter = createBoardWriteRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.check('board_1', 'hash_a', 1000).allowed).toBe(true);
    expect(limiter.check('board_1', 'hash_a', 2000).allowed).toBe(true);
    expect(limiter.check('board_1', 'hash_a', 3000).allowed).toBe(false);
    // Different board or different participantHash is allowed
    expect(limiter.check('board_2', 'hash_a', 3000).allowed).toBe(true);
    expect(limiter.check('board_1', 'hash_b', 3000).allowed).toBe(true);
    // After window passes, hash_a is allowed again
    expect(limiter.check('board_1', 'hash_a', 62_000).allowed).toBe(true);
  });
});

describe('Board-creation rate limiter (zero IP persistence)', () => {
  it('enforces sliding-window limits in memory without storing raw IPs', async () => {
    const limiter = createInMemoryRateLimiter({ limit: 2, windowMs: 60_000 });
    const req = () =>
      new Request('https://retrocks.app/', {
        headers: { 'x-forwarded-for': '203.0.113.42' },
      });

    expect((await limiter.check(req())).allowed).toBe(true);
    expect((await limiter.check(req())).allowed).toBe(true);
    expect((await limiter.check(req())).allowed).toBe(false);

    // Distinct client is unaffected
    const otherReq = new Request('https://retrocks.app/', {
      headers: { 'x-forwarded-for': '198.51.100.7' },
    });
    expect((await limiter.check(otherReq)).allowed).toBe(true);

    // Internal keys never contain the raw IP address
    for (const key of limiter.getActiveKeySnapshotForTests()) {
      expect(key).not.toContain('203.0.113.42');
      expect(key).not.toContain('198.51.100.7');
    }
  });

  it('delegates to Cloudflare BOARD_CREATE_LIMITER binding with a hashed transient key', async () => {
    const seenKeys: string[] = [];
    const mockEnv = {
      BOARD_CREATE_LIMITER: {
        limit: vi.fn(async ({ key }: { key: string }) => {
          seenKeys.push(key);
          return { success: false };
        }),
      },
    } as unknown as Cloudflare.Env;

    const result = await runWithCloudflareEnv(mockEnv, () =>
      checkBoardCreateRateLimit(
        new Request('https://retrocks.app/', {
          headers: { 'cf-connecting-ip': '203.0.113.99' },
        }),
      ),
    );

    expect(result.allowed).toBe(false);
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).not.toContain('203.0.113.99');
    expect(seenKeys[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});
