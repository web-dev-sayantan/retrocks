import 'server-only';
import { createCookie } from '@remix-run/cookie';
import { getRequestEvent } from '@solidjs/web';
import type { RequestEvent, ResponseStub } from '@solidjs/web';
import { env } from 'virtual:solid-env/server';

import { generateParticipantId } from './crypto';

/**
 * Anonymous capability session stored in a signed `HttpOnly` cookie (ADR-0001).
 * Contains zero PII: only an opaque `participantId` and a bounded list of
 * facilitated Board IDs (newest first).
 */
export interface RetrocksSession {
  participantId: string;
  facilitatorBoards: string[];
}

interface SignedSessionPayload {
  p: string;
  f: string[];
  exp: number;
}

export const SESSION_COOKIE_NAME = 'retrocks_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days
const SLIDING_RENEWAL_THRESHOLD_SECONDS = 60 * 60 * 24 * 45; // renew when < 45 days left
export const MAX_FACILITATOR_BOARDS = 35;

// Rotation: SESSION_SECRET is comma-separated, newest first — the first
// entry signs/encrypts, every entry verifies/decrypts.
const secrets = (env.SESSION_SECRET ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (secrets.length === 0) {
  throw new Error(
    'session: SESSION_SECRET is not set — generate one with `openssl rand -base64 32`',
  );
}

const sessionCookie = createCookie(SESSION_COOKIE_NAME, {
  secrets,
  httpOnly: true,
  sameSite: 'Lax',
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
});

const requestSessionCache = new WeakMap<
  Request,
  { session: RetrocksSession; exp: number }
>();

export function getSessionSecrets(): readonly string[] {
  return secrets;
}

function requireRequestEvent(): RequestEvent & { response: ResponseStub } {
  const e = getRequestEvent();
  if (!e) {
    throw new Error(
      'session: no request event — call within a server function, SSR handler, or middleware',
    );
  }
  return e as RequestEvent & { response: ResponseStub };
}

function isHttpsRequest(request: Request): boolean {
  try {
    if (new URL(request.url).protocol === 'https:') {
      return true;
    }
  } catch {
    // Fall back to forwarded header check.
  }
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  return forwardedProto === 'https';
}

function normalizeFacilitatorBoards(boards: unknown): string[] {
  if (!Array.isArray(boards)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of boards) {
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      result.push(id);
      if (result.length >= MAX_FACILITATOR_BOARDS) break;
    }
  }
  return result;
}

async function readSessionWithMeta(
  request: Request,
): Promise<{ session: RetrocksSession; exp: number } | null> {
  const cached = requestSessionCache.get(request);
  if (cached) {
    return cached;
  }

  const raw = await sessionCookie.parse(request.headers.get('cookie'));
  if (!raw || typeof raw !== 'string') return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SignedSessionPayload>;
    if (
      typeof parsed.p !== 'string' ||
      parsed.p.length === 0 ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (Date.now() >= parsed.exp * 1000) {
      return null;
    }
    const entry = {
      session: {
        participantId: parsed.p,
        facilitatorBoards: normalizeFacilitatorBoards(parsed.f),
      },
      exp: parsed.exp,
    };
    requestSessionCache.set(request, entry);
    return entry;
  } catch {
    return null;
  }
}

async function writeSessionCookie(
  event: RequestEvent & { response: ResponseStub },
  session: RetrocksSession,
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + SESSION_MAX_AGE_SECONDS;
  const payload: SignedSessionPayload = {
    p: session.participantId,
    f: normalizeFacilitatorBoards(session.facilitatorBoards),
    exp,
  };
  requestSessionCache.set(event.request, {
    session: {
      participantId: payload.p,
      facilitatorBoards: payload.f,
    },
    exp,
  });
  event.response.headers.append(
    'set-cookie',
    await sessionCookie.serialize(JSON.stringify(payload), {
      secure: isHttpsRequest(event.request),
      maxAge: SESSION_MAX_AGE_SECONDS,
    }),
  );
}

/**
 * Reads the current anonymous session from the incoming request without
 * minting a new cookie. Returns `null` if absent, tampered, rotated out, or expired.
 */
export async function getSession(): Promise<RetrocksSession | null> {
  const event = requireRequestEvent();
  const entry = await readSessionWithMeta(event.request);
  return entry ? entry.session : null;
}

/**
 * Reads a session directly from a standalone `Request` (for WebSocket/SSE
 * handshake endpoints where Solid's request-event storage may not be active).
 */
export async function getSessionFromRequest(
  request: Request,
): Promise<RetrocksSession | null> {
  const entry = await readSessionWithMeta(request);
  return entry ? entry.session : null;
}

/**
 * Lazily mints an anonymous Participant cookie if absent, or slides its
 * 90-day TTL when near expiry (or when `options.renew` is true on writes).
 */
export async function ensureParticipantSession(options?: {
  renew?: boolean;
}): Promise<RetrocksSession> {
  const event = requireRequestEvent();
  const existing = await readSessionWithMeta(event.request);
  const nowSec = Math.floor(Date.now() / 1000);

  if (existing) {
    const remainingSec = existing.exp - nowSec;
    if (options?.renew || remainingSec < SLIDING_RENEWAL_THRESHOLD_SECONDS) {
      await writeSessionCookie(event, existing.session);
    }
    return existing.session;
  }

  const fresh: RetrocksSession = {
    participantId: generateParticipantId(),
    facilitatorBoards: [],
  };
  await writeSessionCookie(event, fresh);
  return fresh;
}

/**
 * Grants the Facilitator role for `boardId` in the signed `HttpOnly` cookie,
 * lazily minting a `participantId` if absent and bounding the list to the
 * most recent `MAX_FACILITATOR_BOARDS` (35) Board IDs.
 */
export async function grantFacilitatorSession(
  boardId: string,
): Promise<RetrocksSession> {
  const event = requireRequestEvent();
  const existing = await readSessionWithMeta(event.request);

  const participantId =
    existing?.session.participantId ?? generateParticipantId();
  const previousBoards = existing?.session.facilitatorBoards ?? [];
  const nextBoards = [
    boardId,
    ...previousBoards.filter((id) => id !== boardId),
  ].slice(0, MAX_FACILITATOR_BOARDS);

  const updated: RetrocksSession = {
    participantId,
    facilitatorBoards: nextBoards,
  };
  await writeSessionCookie(event, updated);
  return updated;
}

/** Returns true if the session carries a Facilitator grant for `boardId`. */
export function isFacilitatorForBoard(
  session: RetrocksSession | null,
  boardId: string,
): boolean {
  return session !== null && session.facilitatorBoards.includes(boardId);
}

/** Expires the session cookie on the outgoing response. */
export async function clearSession(): Promise<void> {
  const event = requireRequestEvent();
  requestSessionCache.delete(event.request);
  event.response.headers.append(
    'set-cookie',
    await sessionCookie.serialize('', {
      secure: isHttpsRequest(event.request),
      maxAge: 0,
    }),
  );
}
