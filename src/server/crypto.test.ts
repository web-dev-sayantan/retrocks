import { describe, expect, it } from 'vitest';

import {
  decryptFacilitatorToken,
  encryptFacilitatorToken,
  generateBoardId,
  generateEntityId,
  generateFacilitatorToken,
  generateParticipantId,
  generateTokenSalt,
  hashTokenWithSalt,
} from './crypto';

const URL_SAFE_RE = /^[A-Za-z0-9_-]+$/;

describe('crypto helpers (WebCrypto)', () => {
  it('generates 128-bit cryptographic URL-safe Board IDs and entity IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const id = generateBoardId();
      expect(id).toMatch(URL_SAFE_RE);
      // 16 random bytes in unpadded base64url = 22 characters (128 bits)
      expect(id.length).toBe(22);
      ids.add(id);
    }
    expect(ids.size).toBe(50);

    const entityId = generateEntityId();
    expect(entityId).toMatch(URL_SAFE_RE);
    expect(entityId.length).toBe(22);
  });

  it('generates 256-bit URL-safe facilitator tokens, participant IDs, and salts', () => {
    const token = generateFacilitatorToken();
    expect(token).toMatch(URL_SAFE_RE);
    // 32 random bytes in unpadded base64url = 43 characters (256 bits)
    expect(token.length).toBe(43);

    const participantId = generateParticipantId();
    expect(participantId).toMatch(URL_SAFE_RE);
    expect(participantId.length).toBeGreaterThanOrEqual(22);

    const salt = generateTokenSalt();
    expect(salt).toMatch(URL_SAFE_RE);
    expect(salt.length).toBe(22);
  });

  it('produces per-Board salted SHA-256 hashes that never contain the raw token', async () => {
    const participantId = generateParticipantId();
    const saltA = generateTokenSalt();
    const saltB = generateTokenSalt();

    const hashA1 = await hashTokenWithSalt(participantId, saltA);
    const hashA2 = await hashTokenWithSalt(participantId, saltA);
    const hashB = await hashTokenWithSalt(participantId, saltB);

    expect(hashA1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashA1).toBe(hashA2);
    expect(hashA1).not.toBe(hashB);
    expect(hashA1).not.toContain(participantId);
  });

  it('encrypts and decrypts facilitator tokens with AES-256-GCM bound to boardId', async () => {
    const secret = 'primary-secret-with-at-least-32-characters-12345';
    const boardId = generateBoardId();
    const otherBoardId = generateBoardId();
    const token = generateFacilitatorToken();

    const ciphertext1 = await encryptFacilitatorToken(token, boardId, [secret]);
    const ciphertext2 = await encryptFacilitatorToken(token, boardId, [secret]);

    // Random IV ensures distinct ciphertexts for the same plaintext
    expect(ciphertext1).not.toBe(ciphertext2);
    expect(ciphertext1).not.toContain(token);
    expect(ciphertext1).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const decrypted = await decryptFacilitatorToken(ciphertext1, boardId, [
      secret,
    ]);
    expect(decrypted).toEqual({ token, needsReencrypt: false });

    // AAD mismatch (wrong boardId) fails authentication
    const wrongBoard = await decryptFacilitatorToken(
      ciphertext1,
      otherBoardId,
      [secret],
    );
    expect(wrongBoard).toBeNull();

    // Tampering with ciphertext fails authentication
    const tampered =
      ciphertext1.slice(0, -1) + (ciphertext1.endsWith('A') ? 'B' : 'A');
    expect(
      await decryptFacilitatorToken(tampered, boardId, [secret]),
    ).toBeNull();
  });

  it('supports SESSION_SECRET rotation when decrypting facilitator tokens', async () => {
    const oldSecret = 'old-session-secret-with-at-least-32-characters!!';
    const newSecret = 'new-session-secret-with-at-least-32-characters!!';
    const boardId = generateBoardId();
    const token = generateFacilitatorToken();

    const encryptedUnderOld = await encryptFacilitatorToken(token, boardId, [
      oldSecret,
    ]);

    // Decrypting under [newSecret, oldSecret] succeeds and flags needsReencrypt
    const rotated = await decryptFacilitatorToken(encryptedUnderOld, boardId, [
      newSecret,
      oldSecret,
    ]);
    expect(rotated).toEqual({ token, needsReencrypt: true });

    // Once oldSecret is removed, decryption fails cleanly
    const dropped = await decryptFacilitatorToken(encryptedUnderOld, boardId, [
      newSecret,
    ]);
    expect(dropped).toBeNull();
  });
});
