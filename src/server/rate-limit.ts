import 'server-only';

import { getCloudflareEnv } from './adapters/cloudflare-context';
import { generateTokenSalt, sha256Hex } from './crypto';

export interface RateLimitResult {
  allowed: boolean;
}

export interface BoardCreateRateLimiter {
  check(request: Request): Promise<RateLimitResult>;
}

export interface InMemoryRateLimiter extends BoardCreateRateLimiter {
  reset(): void;
  getActiveKeySnapshotForTests(): string[];
}

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 5_000;

// Ephemeral per-process salt ensures transient hashed client keys are never
// reversible and never persisted anywhere on disk or in the database.
// Workers forbids random values in global scope, so it is created on first use.
let ephemeralSalt: string | undefined;

function getEphemeralSalt(): string {
  return (ephemeralSalt ??= generateTokenSalt());
}

function extractTransientClientAddress(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;

  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const firstHop = xff.split(',')[0]?.trim();
    if (firstHop) return firstHop;
  }

  return 'local';
}

async function deriveTransientRateLimitKey(request: Request): Promise<string> {
  const address = extractTransientClientAddress(request);
  return sha256Hex(`${getEphemeralSalt()}:${address}`);
}

function createSlidingWindowLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, number[]>();

  function pruneStale(now: number): void {
    const cutoff = now - windowMs;
    for (const [key, timestamps] of buckets) {
      const fresh = timestamps.filter((ts) => ts > cutoff);
      if (fresh.length === 0) {
        buckets.delete(key);
      } else {
        buckets.set(key, fresh);
      }
    }
  }

  return {
    checkKey(key: string, now: number = Date.now()): RateLimitResult {
      const cutoff = now - windowMs;
      if (buckets.size >= MAX_TRACKED_KEYS) {
        pruneStale(now);
      }

      const timestamps = (buckets.get(key) ?? []).filter((ts) => ts > cutoff);
      if (timestamps.length >= limit) {
        buckets.set(key, timestamps);
        return { allowed: false };
      }

      timestamps.push(now);
      buckets.set(key, timestamps);
      return { allowed: true };
    },
    reset(): void {
      buckets.clear();
    },
    getActiveKeySnapshotForTests(): string[] {
      return [...buckets.keys()];
    },
  };
}

/**
 * In-memory sliding-window rate limiter used in Node deployments and Vitest.
 * Keys are salted SHA-256 hashes held strictly in RAM — never persisted.
 */
export function createInMemoryRateLimiter(options?: {
  limit?: number;
  windowMs?: number;
}): InMemoryRateLimiter {
  const windowLimiter = createSlidingWindowLimiter(
    options?.limit ?? DEFAULT_LIMIT,
    options?.windowMs ?? DEFAULT_WINDOW_MS,
  );

  return {
    async check(request: Request): Promise<RateLimitResult> {
      const key = await deriveTransientRateLimitKey(request);
      return windowLimiter.checkKey(key, Date.now());
    },
    reset(): void {
      windowLimiter.reset();
    },
    getActiveKeySnapshotForTests(): string[] {
      return windowLimiter.getActiveKeySnapshotForTests();
    },
  };
}

const defaultInMemoryLimiter = createInMemoryRateLimiter();
let testLimiterOverride: BoardCreateRateLimiter | null = null;

export function setBoardCreateRateLimiterForTests(
  limiter: BoardCreateRateLimiter | null,
): void {
  testLimiterOverride = limiter;
}

export function resetDefaultRateLimiterForTests(): void {
  defaultInMemoryLimiter.reset();
}

/**
 * Enforces Board-creation rate limiting using Cloudflare's `BOARD_CREATE_LIMITER`
 * binding when running on Workers, or the in-memory sliding-window limiter on Node.
 */
export async function checkBoardCreateRateLimit(
  request: Request,
): Promise<RateLimitResult> {
  if (testLimiterOverride) {
    return testLimiterOverride.check(request);
  }

  const cfEnv = getCloudflareEnv();
  if (cfEnv?.BOARD_CREATE_LIMITER) {
    const key = await deriveTransientRateLimitKey(request);
    const { success } = await cfEnv.BOARD_CREATE_LIMITER.limit({ key });
    return { allowed: success };
  }

  return defaultInMemoryLimiter.check(request);
}

export interface BoardWriteRateLimiter {
  check(boardId: string, participantHash: string, now?: number): RateLimitResult;
  reset(): void;
  getActiveKeySnapshotForTests(): string[];
}

const DEFAULT_BOARD_WRITE_LIMIT = 60;
const DEFAULT_BOARD_WRITE_WINDOW_MS = 60_000;

/**
 * In-memory per-Board write rate limiter keyed strictly by `participantHash`
 * (zero IP addresses, zero persistence — SPEC §8).
 * Held per-DO inside `BoardRoom` on Cloudflare Workers and per-store on Node.
 */
export function createBoardWriteRateLimiter(options?: {
  limit?: number;
  windowMs?: number;
}): BoardWriteRateLimiter {
  const windowLimiter = createSlidingWindowLimiter(
    options?.limit ?? DEFAULT_BOARD_WRITE_LIMIT,
    options?.windowMs ?? DEFAULT_BOARD_WRITE_WINDOW_MS,
  );

  return {
    check(
      boardId: string,
      participantHash: string,
      now: number = Date.now(),
    ): RateLimitResult {
      return windowLimiter.checkKey(`${boardId}:${participantHash}`, now);
    },
    reset(): void {
      windowLimiter.reset();
    },
    getActiveKeySnapshotForTests(): string[] {
      return windowLimiter.getActiveKeySnapshotForTests();
    },
  };
}

const defaultWriteLimiter = createBoardWriteRateLimiter();
let testWriteLimiterOverride: BoardWriteRateLimiter | null = null;

export function setBoardWriteRateLimiterForTests(
  limiter: BoardWriteRateLimiter | null,
): void {
  testWriteLimiterOverride = limiter;
}

export function resetDefaultWriteRateLimiterForTests(): void {
  defaultWriteLimiter.reset();
}

export function checkBoardWriteRateLimit(
  boardId: string,
  participantHash: string,
  now?: number,
): RateLimitResult {
  if (testWriteLimiterOverride) {
    return testWriteLimiterOverride.check(boardId, participantHash, now);
  }
  return defaultWriteLimiter.check(boardId, participantHash, now);
}
