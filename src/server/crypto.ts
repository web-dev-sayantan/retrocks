import 'server-only';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ENCRYPTION_VERSION = 'v1';
const AES_KEY_DOMAIN = 'retrocks:facilitator-token-aes256gcm-v1:';
const IV_BYTE_LENGTH = 12;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  try {
    const binary = atob(padded + '='.repeat(padLen));
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** 128-bit cryptographic URL-safe Board ID (22 base64url chars). */
export function generateBoardId(): string {
  return randomBase64Url(16);
}

/** 128-bit cryptographic URL-safe entity ID for Columns, Cards, Groups, Comments. */
export function generateEntityId(): string {
  return randomBase64Url(16);
}

/** 128-bit cryptographic URL-safe anonymous Participant token. */
export function generateParticipantId(): string {
  return randomBase64Url(16);
}

/** 128-bit cryptographic URL-safe per-Board token salt. */
export function generateTokenSalt(): string {
  return randomBase64Url(16);
}

/** 256-bit cryptographic URL-safe Facilitator token (43 base64url chars). */
export function generateFacilitatorToken(): string {
  return randomBase64Url(32);
}

/** Unsalted SHA-256 hex digest (used for transient in-memory rate-limit keys). */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(digest);
}

/** Per-Board salted SHA-256 hex digest for Participant and Facilitator tokens. */
export async function hashTokenWithSalt(
  token: string,
  salt: string,
): Promise<string> {
  return sha256Hex(`${salt}:${token}`);
}

async function deriveAesGcmKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${AES_KEY_DOMAIN}${secret}`),
  );
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts a Board's 256-bit `facilitatorToken` with AES-256-GCM using the
 * newest secret (`secrets[0]`) and binds the ciphertext to `boardId` via AAD.
 */
export async function encryptFacilitatorToken(
  token: string,
  boardId: string,
  secrets: readonly string[],
): Promise<string> {
  if (secrets.length === 0) {
    throw new Error('crypto: at least one SESSION_SECRET is required');
  }
  const key = await deriveAesGcmKey(secrets[0]);
  const iv = new Uint8Array(new ArrayBuffer(IV_BYTE_LENGTH));
  crypto.getRandomValues(iv);
  const additionalData = encoder.encode(boardId);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    key,
    encoder.encode(token),
  );
  return `${ENCRYPTION_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export interface DecryptedFacilitatorToken {
  token: string;
  /** True when decrypted with a rotated (non-primary) secret and eligible for re-encryption. */
  needsReencrypt: boolean;
}

/**
 * Decrypts a Board's AES-256-GCM encrypted `facilitatorToken`, trying each
 * configured `SESSION_SECRET` in order to support secret rotation.
 */
export async function decryptFacilitatorToken(
  encrypted: string,
  boardId: string,
  secrets: readonly string[],
): Promise<DecryptedFacilitatorToken | null> {
  const parts = encrypted.split('.');
  if (parts.length !== 3 || parts[0] !== ENCRYPTION_VERSION) {
    return null;
  }
  const iv = fromBase64Url(parts[1]);
  const ciphertext = fromBase64Url(parts[2]);
  if (!iv || iv.byteLength !== IV_BYTE_LENGTH || !ciphertext) {
    return null;
  }

  const additionalData = encoder.encode(boardId);
  for (let i = 0; i < secrets.length; i += 1) {
    try {
      const key = await deriveAesGcmKey(secrets[i]);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData },
        key,
        ciphertext,
      );
      return {
        token: decoder.decode(plaintext),
        needsReencrypt: i > 0,
      };
    } catch {
      // Try next rotated secret.
    }
  }
  return null;
}

export function tokenHashesMatch(candidateHash: string, storedHash: string): boolean {
  if (candidateHash.length !== storedHash.length) return false;

  let difference = 0;
  for (let index = 0; index < candidateHash.length; index += 1) {
    difference |= candidateHash.charCodeAt(index) ^ storedHash.charCodeAt(index);
  }
  return difference === 0;
}
