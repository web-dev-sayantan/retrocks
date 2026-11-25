import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  subscribeFacilitatorLinkClaim,
  subscribeFacilitatorLinkScrub,
  takeFacilitatorLinkToken,
} from './facilitator-link';

const roomPath = '/p/abcdefghijklmnopqrstuv';
const validToken = 'A'.repeat(43);
const secondToken = 'B'.repeat(43);

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('takeFacilitatorLinkToken', () => {
  it('scrubs the fragment immediately while preserving history state and query params', () => {
    window.history.replaceState({ key: 'keep' }, '', `${roomPath}?view=all#f=${validToken}`);

    expect(takeFacilitatorLinkToken(roomPath)).toBe(validToken);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe(`${roomPath}?view=all`);
    expect(window.history.state).toEqual({ key: 'keep' });
  });

  it('ignores fragments without a Facilitator token or on a different path', () => {
    window.history.replaceState(null, '', `${roomPath}#notes`);
    expect(takeFacilitatorLinkToken(roomPath)).toBeNull();
    expect(window.location.hash).toBe('#notes');

    window.history.replaceState(null, '', `/b/other#f=${validToken}`);
    expect(takeFacilitatorLinkToken(roomPath)).toBeNull();
    expect(window.location.hash).toBe(`#f=${validToken}`);
  });
});

describe('subscribeFacilitatorLinkClaim', () => {
  it('scrubs the fragment before invoking claim and reports pending and success', async () => {
    window.history.replaceState(null, '', `${roomPath}#f=${validToken}`);
    const pendingStates: boolean[] = [];
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const claim = vi.fn(async (token: string) => {
      expect(window.location.hash).toBe('');
      return { ok: true as const, token };
    });

    const stop = subscribeFacilitatorLinkClaim({
      path: roomPath,
      claim,
      onPendingChange: (pending) => pendingStates.push(pending),
      onSuccess,
      onError,
    });

    try {
      await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ ok: true, token: validToken }));
      expect(claim).toHaveBeenCalledWith(validToken);
      expect(onError).not.toHaveBeenCalled();
      expect(pendingStates).toEqual([true, false]);
    } finally {
      stop();
    }
  });

  it('keeps an invalid token scrubbed and delivers rejected or failed claim outcomes', async () => {
    window.history.replaceState(null, '', `${roomPath}#f=invalid-token`);
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const claim = vi.fn(async () => ({
      ok: false as const,
      code: 'FORBIDDEN' as const,
      message: 'This Co-Facilitator Link is invalid or has expired.',
    }));

    const stop = subscribeFacilitatorLinkClaim({
      path: roomPath,
      claim,
      onSuccess,
      onError,
    });

    try {
      await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith({
        ok: false,
        code: 'FORBIDDEN',
        message: 'This Co-Facilitator Link is invalid or has expired.',
      }));
      expect(window.location.hash).toBe('');
      expect(onError).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('ignores superseded in-flight claim races and preserves pending until the latest finishes', async () => {
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<string>();
    const claim = vi.fn<(token: string) => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const pendingStates: boolean[] = [];
    const onStart = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();

    window.history.replaceState(null, '', `${roomPath}#f=${validToken}`);
    const stop = subscribeFacilitatorLinkClaim({
      path: roomPath,
      claim,
      onStart,
      onPendingChange: (pending) => pendingStates.push(pending),
      onSuccess,
      onError,
    });

    try {
      expect(claim).toHaveBeenCalledTimes(1);
      expect(claim).toHaveBeenLastCalledWith(validToken);
      expect(window.location.hash).toBe('');

      // Trigger a second claim via hashchange while the first is still in flight.
      window.history.replaceState(null, '', `${roomPath}#f=${secondToken}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));

      expect(claim).toHaveBeenCalledTimes(2);
      expect(claim).toHaveBeenLastCalledWith(secondToken);
      expect(onStart).toHaveBeenCalledTimes(2);
      expect(window.location.hash).toBe('');

      // First attempt rejects late — must be ignored and must not clear pending.
      first.reject(new Error('stale failure'));
      await Promise.resolve();
      await Promise.resolve();
      expect(onError).not.toHaveBeenCalled();
      expect(pendingStates).toEqual([true, true]);

      // Latest attempt resolves — delivers result and clears pending.
      second.resolve('claimed-second');
      await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith('claimed-second'));
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(pendingStates).toEqual([true, true, false]);
    } finally {
      stop();
    }
  });

  it('ignores in-flight results after pathname navigation or cleanup', async () => {
    const inflight = Promise.withResolvers<string>();
    const claim = vi.fn(() => inflight.promise);
    const onSuccess = vi.fn();
    const onError = vi.fn();

    window.history.replaceState(null, '', `${roomPath}#f=${validToken}`);
    const stop = subscribeFacilitatorLinkClaim({
      path: roomPath,
      claim,
      onSuccess,
      onError,
    });

    // Navigate away before the claim settles.
    window.history.replaceState(null, '', '/');
    inflight.resolve('late-result');
    await Promise.resolve();
    await Promise.resolve();
    expect(onSuccess).not.toHaveBeenCalled();

    stop();

    // Subsequent hashchange after cleanup does nothing and leaves hash untouched.
    window.history.replaceState(null, '', `${roomPath}#f=${secondToken}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(claim).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe(`#f=${secondToken}`);
  });
});

describe('subscribeFacilitatorLinkScrub', () => {
  it('scrubs matching fragments immediately and on hashchange until stopped', () => {
    window.history.replaceState(null, '', `${roomPath}#f=${validToken}`);
    const stop = subscribeFacilitatorLinkScrub(roomPath);

    expect(window.location.hash).toBe('');

    window.history.replaceState(null, '', `${roomPath}#f=${secondToken}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(window.location.hash).toBe('');

    stop();

    window.history.replaceState(null, '', `${roomPath}#f=${validToken}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(window.location.hash).toBe(`#f=${validToken}`);
  });
});
