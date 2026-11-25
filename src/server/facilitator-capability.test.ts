import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enforceNoStoreHeader,
  facilitatorTokenHashesMatch,
  hashFacilitatorToken,
  isValidFacilitatorToken,
  mintFacilitatorCapability,
  recoverFacilitatorToken,
} from './facilitator-capability';

const PRIMARY_SECRET = 'primary-capability-secret-with-at-least-32-chars!!';
const ROTATED_SECRET = 'rotated-capability-secret-with-at-least-32-chars!!';

async function runRequest<T>(handler: () => Promise<T> | T) {
  const event = createRequestEvent(
    new Request('https://retrocks.test/_server', { method: 'POST' }),
  );
  return provideRequestEvent(event, async () => {
    const result = await handler();
    const response = commitEventResponse(new Response(), event);
    return { result, response };
  });
}

describe('facilitator-capability', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', PRIMARY_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('mints, hashes, and verifies 43-character base64url capability tokens while rejecting malformed input', async () => {
    const minted = await mintFacilitatorCapability({
      salt: 'board-salt-1',
      aad: 'board-1',
      secrets: [PRIMARY_SECRET],
    });

    expect(isValidFacilitatorToken(minted.token)).toBe(true);
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(minted.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(minted.encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const candidateHash = await hashFacilitatorToken(minted.token, 'board-salt-1');
    expect(candidateHash).toBe(minted.hash);
    expect(facilitatorTokenHashesMatch(candidateHash!, minted.hash)).toBe(true);

    const wrongSaltHash = await hashFacilitatorToken(minted.token, 'board-salt-2');
    expect(facilitatorTokenHashesMatch(wrongSaltHash!, minted.hash)).toBe(false);

    for (const invalid of ['', 'too-short', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}!`, null, 123]) {
      expect(isValidFacilitatorToken(invalid)).toBe(false);
      expect(await hashFacilitatorToken(invalid, 'board-salt-1')).toBeNull();
    }
  });

  it('recovers a valid token under the primary secret with Cache-Control: no-store and without re-encrypting', async () => {
    const minted = await mintFacilitatorCapability({
      salt: 'poker:facilitator:room-1',
      aad: 'poker:facilitator:room-1',
      secrets: [PRIMARY_SECRET],
    });
    const persistReencrypted = vi.fn();

    const { result, response } = await runRequest(() =>
      recoverFacilitatorToken({
        encrypted: minted.encrypted,
        aad: 'poker:facilitator:room-1',
        secrets: [PRIMARY_SECRET],
        persistReencrypted,
      }),
    );

    expect(result).toBe(minted.token);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(persistReencrypted).not.toHaveBeenCalled();
  });

  it('re-encrypts and persists ciphertext on SESSION_SECRET rotation so the token survives old-secret retirement', async () => {
    const storage = new Map<string, string>();
    const aad = 'poker:facilitator:room-rotate';
    const minted = await mintFacilitatorCapability({
      salt: aad,
      aad,
      secrets: [PRIMARY_SECRET],
    });
    storage.set(aad, minted.encrypted);

    const persistReencrypted = vi.fn((reencrypted: string) => {
      storage.set(aad, reencrypted);
    });

    const { result: duringRotation, response } = await runRequest(() =>
      recoverFacilitatorToken({
        encrypted: storage.get(aad)!,
        aad,
        secrets: [ROTATED_SECRET, PRIMARY_SECRET],
        persistReencrypted,
      }),
    );

    expect(duringRotation).toBe(minted.token);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(persistReencrypted).toHaveBeenCalledTimes(1);
    const reencrypted = storage.get(aad)!;
    expect(reencrypted).not.toBe(minted.encrypted);

    const persistAfterRetire = vi.fn();
    const afterRetire = await recoverFacilitatorToken({
      encrypted: reencrypted,
      aad,
      secrets: [ROTATED_SECRET],
      persistReencrypted: persistAfterRetire,
    });

    expect(afterRetire).toBe(minted.token);
    expect(persistAfterRetire).not.toHaveBeenCalled();
  });

  it('returns null and skips persistence when AAD mismatches or ciphertext is tampered', async () => {
    const minted = await mintFacilitatorCapability({
      salt: 'board-salt',
      aad: 'board-a',
      secrets: [PRIMARY_SECRET],
    });
    const persistReencrypted = vi.fn();

    const { result: wrongAad, response } = await runRequest(() =>
      recoverFacilitatorToken({
        encrypted: minted.encrypted,
        aad: 'board-b',
        secrets: [PRIMARY_SECRET],
        persistReencrypted,
      }),
    );

    expect(wrongAad).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(persistReencrypted).not.toHaveBeenCalled();

    const tampered = `${minted.encrypted.slice(0, -1)}${minted.encrypted.endsWith('A') ? 'B' : 'A'}`;
    expect(
      await recoverFacilitatorToken({
        encrypted: tampered,
        aad: 'board-a',
        secrets: [PRIMARY_SECRET],
        persistReencrypted,
      }),
    ).toBeNull();
    expect(persistReencrypted).not.toHaveBeenCalled();
  });

  it('enforces Cache-Control: no-store via enforceNoStoreHeader', async () => {
    const { response } = await runRequest(() => {
      enforceNoStoreHeader();
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
