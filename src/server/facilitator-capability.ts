import 'server-only';
import { getRequestEvent } from '@solidjs/web';
import * as v from 'valibot';

import {
  decryptFacilitatorToken,
  encryptFacilitatorToken,
  generateFacilitatorToken,
  hashTokenWithSalt,
  tokenHashesMatch,
} from './crypto';

const FACILITATOR_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

/** Valibot schema for a 256-bit (43-character base64url) Co-Facilitator Link token (ADR-0001). */
export const FacilitatorTokenSchema = v.pipe(
  v.string(),
  v.regex(FACILITATOR_TOKEN_REGEX),
);

/** Returns true when `token` is a well-formed 43-character base64url capability token. */
export function isValidFacilitatorToken(token: unknown): token is string {
  return typeof token === 'string' && FACILITATOR_TOKEN_REGEX.test(token);
}

/**
 * Enforces `Cache-Control: no-store` on the active server response so
 * Co-Facilitator Link capability responses are never cached by intermediaries.
 */
export function enforceNoStoreHeader(): void {
  getRequestEvent()?.response.headers.set('cache-control', 'no-store');
}

export interface FacilitatorCapabilityScope {
  /** Salt used for salted SHA-256 hashing of the capability token. */
  salt: string;
  /** Associated Authenticated Data (AAD) binding the AES-256-GCM ciphertext to this workspace. */
  aad: string;
  /** Ordered `SESSION_SECRET` list (newest first). */
  secrets: readonly string[];
}

export interface MintedFacilitatorCapability {
  token: string;
  hash: string;
  encrypted: string;
}

/**
 * Mints a fresh 256-bit Co-Facilitator Link capability token, its salted
 * SHA-256 verification hash, and its AES-256-GCM encrypted payload (ADR-0001).
 */
export async function mintFacilitatorCapability(
  scope: FacilitatorCapabilityScope,
): Promise<MintedFacilitatorCapability> {
  const token = generateFacilitatorToken();
  const [hash, encrypted] = await Promise.all([
    hashTokenWithSalt(token, scope.salt),
    encryptFacilitatorToken(token, scope.aad, scope.secrets),
  ]);
  return { token, hash, encrypted };
}

/**
 * Validates the 43-character base64url Facilitator token format and computes
 * its salted SHA-256 hex digest. Returns `null` when the format is invalid.
 */
export async function hashFacilitatorToken(
  token: unknown,
  salt: string,
): Promise<string | null> {
  if (!isValidFacilitatorToken(token)) {
    return null;
  }
  return hashTokenWithSalt(token, salt);
}

/** Constant-time comparison for salted Facilitator token SHA-256 digests. */
export function facilitatorTokenHashesMatch(
  candidateHash: string,
  storedHash: string,
): boolean {
  return tokenHashesMatch(candidateHash, storedHash);
}

export interface RecoverFacilitatorTokenOptions {
  encrypted: string;
  aad: string;
  /** Ordered `SESSION_SECRET` list (newest first). */
  secrets: readonly string[];
  /**
   * Mandatory callback invoked whenever decryption succeeded using a rotated
   * (non-primary) `SESSION_SECRET`. Must persist the re-encrypted ciphertext so
   * the Co-Facilitator Link survives retirement of the older secret.
   */
  persistReencrypted: (reencrypted: string) => Promise<void> | void;
}

/**
 * Decrypts a stored Co-Facilitator Link capability token with AES-256-GCM,
 * enforces `Cache-Control: no-store`, and re-encrypts + persists under the
 * primary `SESSION_SECRET` whenever a rotated secret was used.
 */
export async function recoverFacilitatorToken(
  options: RecoverFacilitatorTokenOptions,
): Promise<string | null> {
  enforceNoStoreHeader();
  const decrypted = await decryptFacilitatorToken(
    options.encrypted,
    options.aad,
    options.secrets,
  );
  if (!decrypted || !isValidFacilitatorToken(decrypted.token)) {
    return null;
  }
  if (decrypted.needsReencrypt) {
    const reencrypted = await encryptFacilitatorToken(
      decrypted.token,
      options.aad,
      options.secrets,
    );
    await options.persistReencrypted(reencrypted);
  }
  return decrypted.token;
}
