import { afterEach, describe, expect, it, vi } from 'vitest';

import { runWithCloudflareEnv } from './adapters/cloudflare-context';
import {
  checkBoardCreateRateLimit,
  checkPokerCreateRateLimit,
  createInMemoryRateLimiter,
  resetDefaultRateLimiterForTests,
  setBoardCreateRateLimiterForTests,
} from './rate-limit';

describe('rate-limit module scope', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('generates no random values while the module is evaluated', async () => {
    // Workers rejects uploads whose global scope calls crypto.getRandomValues
    // (error 10021), so the salt must stay lazy.
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');

    await import('./rate-limit');

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('create rate-limit overrides and Board/Room budget independence', () => {
  afterEach(() => {
    setBoardCreateRateLimiterForTests(null);
    resetDefaultRateLimiterForTests();
  });

  it('honors test rate-limiter overrides for Pointing Poker while keeping Board and Room budgets independent', async () => {
    const request = new Request('https://retrocks.test', {
      headers: { 'cf-connecting-ip': '198.51.100.77' },
    });

    const override = createInMemoryRateLimiter({ limit: 2, windowMs: 60_000 });
    setBoardCreateRateLimiterForTests(override);

    expect(await checkBoardCreateRateLimit(request)).toEqual({ allowed: true });
    expect(await checkBoardCreateRateLimit(request)).toEqual({ allowed: true });
    expect(await checkBoardCreateRateLimit(request)).toEqual({ allowed: false });

    // Exhausting the Board budget must not consume the Pointing Poker Room budget.
    expect(await checkPokerCreateRateLimit(request)).toEqual({ allowed: true });
    expect(await checkPokerCreateRateLimit(request)).toEqual({ allowed: true });
    expect(await checkPokerCreateRateLimit(request)).toEqual({ allowed: false });

    // Custom mock overrides apply to Pointing Poker creation checks too.
    setBoardCreateRateLimiterForTests({ check: async () => ({ allowed: true }) });
    expect(await checkPokerCreateRateLimit(request)).toEqual({ allowed: true });
    setBoardCreateRateLimiterForTests({ check: async () => ({ allowed: false }) });
    expect(await checkPokerCreateRateLimit(request)).toEqual({ allowed: false });
  });

  it('resets both Board and Pointing Poker default in-memory buckets and preserves Cloudflare budget independence', async () => {
    const request = new Request('https://retrocks.test', {
      headers: { 'cf-connecting-ip': '198.51.100.78' },
    });

    for (let i = 0; i < 10; i++) {
      expect(await checkPokerCreateRateLimit(request)).toEqual({ allowed: true });
    }
    expect(await checkPokerCreateRateLimit(request)).toEqual({ allowed: false });
    expect(await checkBoardCreateRateLimit(request)).toEqual({ allowed: true });

    resetDefaultRateLimiterForTests();
    expect(await checkPokerCreateRateLimit(request)).toEqual({ allowed: true });

    const seenKeys: string[] = [];
    const cfEnv = {
      BOARD_CREATE_LIMITER: {
        async limit({ key }: { key: string }) {
          seenKeys.push(key);
          return { success: true };
        },
      },
    } as unknown as Cloudflare.Env;

    await runWithCloudflareEnv(cfEnv, async () => {
      expect(await checkBoardCreateRateLimit(request)).toEqual({ allowed: true });
      expect(await checkPokerCreateRateLimit(request)).toEqual({ allowed: true });
    });

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(seenKeys[1]).toBe(`poker:${seenKeys[0]}`);
  });
});
