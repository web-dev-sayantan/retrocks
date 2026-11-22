import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';

type SessionModule = typeof import('./session');

const SECRET_ONE = 'secret-one-with-at-least-32-characters-000000';
const SECRET_TWO = 'secret-two-with-at-least-32-characters-111111';
const NINETY_DAYS_SECONDS = 60 * 60 * 24 * 90;

async function loadSession(secret: string): Promise<SessionModule> {
  process.env.SESSION_SECRET = secret;
  vi.resetModules();
  return import('./session');
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.SESSION_SECRET;
});

async function runRequest<T>(
  request: Request,
  handler: () => Promise<T>,
): Promise<{ result: T; response: Response }> {
  const event = createRequestEvent(request);
  return provideRequestEvent(event, async () => {
    const result = await handler();
    const response = commitEventResponse(new Response('ok'), event);
    return { result, response };
  });
}

function sessionPair(response: Response): string {
  const entries = response.headers
    .getSetCookie()
    .filter((c) => c.startsWith('retrocks_session='));
  expect(entries.length).toBeGreaterThan(0);
  return entries[entries.length - 1].split(';')[0];
}

describe('anonymous capability session (ADR-0001)', () => {
  it('never mints a cookie when only reading getSession() on an unauthenticated request', async () => {
    const session = await loadSession(SECRET_ONE);
    const { result, response } = await runRequest(
      new Request('http://localhost/'),
      () => session.getSession(),
    );

    expect(result).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('lazily mints an HttpOnly SameSite=Lax 90-day cookie with conditional Secure flag', async () => {
    const session = await loadSession(SECRET_ONE);

    // Local HTTP request omits Secure so http://localhost works seamlessly
    const httpCycle = await runRequest(
      new Request('http://localhost:3002/b/board-1'),
      () => session.ensureParticipantSession(),
    );
    const [httpCookie] = httpCycle.response.headers.getSetCookie();
    expect(httpCookie).toMatch(/^retrocks_session=[^;]+\.[^;.]+;/);
    expect(httpCookie).toContain('HttpOnly');
    expect(httpCookie).toContain('SameSite=Lax');
    expect(httpCookie).toContain('Path=/');
    expect(httpCookie).toContain(`Max-Age=${NINETY_DAYS_SECONDS}`);
    expect(httpCookie).not.toContain('Secure');
    expect(httpCycle.result.participantId.length).toBeGreaterThanOrEqual(22);
    expect(httpCycle.result.facilitatorBoards).toEqual([]);

    // HTTPS request includes Secure
    const httpsCycle = await runRequest(
      new Request('https://retrocks.app/b/board-1'),
      () => session.ensureParticipantSession(),
    );
    const [httpsCookie] = httpsCycle.response.headers.getSetCookie();
    expect(httpsCookie).toContain('Secure');
  });

  it('reads back participantId and Facilitator grants on subsequent requests without re-minting', async () => {
    const session = await loadSession(SECRET_ONE);
    const created = await runRequest(
      new Request('https://retrocks.app/'),
      () => session.grantFacilitatorSession('board_alpha'),
    );
    const pair = sessionPair(created.response);

    const followUp = await runRequest(
      new Request('https://retrocks.app/b/board_alpha', {
        headers: { cookie: pair },
      }),
      () => session.ensureParticipantSession(),
    );

    expect(followUp.result.participantId).toBe(created.result.participantId);
    expect(followUp.result.facilitatorBoards).toEqual(['board_alpha']);
    expect(
      session.isFacilitatorForBoard(followUp.result, 'board_alpha'),
    ).toBe(true);
    expect(
      session.isFacilitatorForBoard(followUp.result, 'board_other'),
    ).toBe(false);
    // Fresh cookie (well within sliding renewal window) does not re-issue Set-Cookie on read
    expect(followUp.response.headers.getSetCookie()).toEqual([]);
  });

  it('renews the 90-day sliding window when near expiry or explicitly renewed on writes', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-11-01T00:00:00Z').getTime();
    vi.setSystemTime(start);

    const session = await loadSession(SECRET_ONE);
    const initial = await runRequest(
      new Request('https://retrocks.app/b/board_1'),
      () => session.ensureParticipantSession(),
    );
    const pair = sessionPair(initial.response);

    // Advance 50 days (past the 45-day half-TTL sliding renewal threshold)
    vi.setSystemTime(start + 50 * 24 * 60 * 60 * 1000);
    const renewed = await runRequest(
      new Request('https://retrocks.app/b/board_1', {
        headers: { cookie: pair },
      }),
      () => session.ensureParticipantSession(),
    );
    expect(renewed.result.participantId).toBe(initial.result.participantId);
    expect(renewed.response.headers.getSetCookie().length).toBe(1);

    // Renewed cookie remains valid 60 days later (110 days after original mint)
    const renewedPair = sessionPair(renewed.response);
    vi.setSystemTime(start + 110 * 24 * 60 * 60 * 1000);
    const stillValid = await runRequest(
      new Request('https://retrocks.app/b/board_1', {
        headers: { cookie: renewedPair },
      }),
      () => session.getSession(),
    );
    expect(stillValid.result?.participantId).toBe(initial.result.participantId);
  });

  it('bounds Facilitator grants to the most recent 35 Board IDs well under the 4KB cookie ceiling', async () => {
    const session = await loadSession(SECRET_ONE);
    let cookieHeader = '';
    let latestSession: Awaited<
      ReturnType<typeof session.grantFacilitatorSession>
    > | null = null;
    let lastSetCookie = '';

    for (let i = 1; i <= 42; i += 1) {
      const boardId = `board_${String(i).padStart(16, '0')}`;
      const cycle = await runRequest(
        new Request('https://retrocks.app/', {
          headers: cookieHeader ? { cookie: cookieHeader } : undefined,
        }),
        () => session.grantFacilitatorSession(boardId),
      );
      latestSession = cycle.result;
      lastSetCookie = cycle.response.headers.getSetCookie()[0];
      cookieHeader = sessionPair(cycle.response);
    }

    expect(latestSession?.facilitatorBoards.length).toBe(35);
    expect(latestSession?.facilitatorBoards[0]).toBe('board_0000000000000042');
    expect(latestSession?.facilitatorBoards[34]).toBe('board_0000000000000008');
    expect(
      session.isFacilitatorForBoard(latestSession, 'board_0000000000000001'),
    ).toBe(false);
    expect(lastSetCookie.length).toBeLessThan(3500);
  });

  it('rejects absent, foreign, tampered, and server-side expired cookies', async () => {
    const session = await loadSession(SECRET_ONE);
    const minted = await runRequest(
      new Request('https://retrocks.app/b/board_1'),
      () => session.ensureParticipantSession(),
    );
    const pair = sessionPair(minted.response);
    const tampered = pair.replace(
      /^retrocks_session=(.)/,
      (_, c) => `retrocks_session=${c === 'A' ? 'B' : 'A'}`,
    );

    for (const headers of [
      undefined,
      { cookie: 'theme=dark; other=1' },
      { cookie: tampered },
    ] as const) {
      const { result } = await runRequest(
        new Request('https://retrocks.app/b/board_1', { headers }),
        () => session.getSession(),
      );
      expect(result).toBeNull();
    }

    // Server-side expiry after 90 days
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (NINETY_DAYS_SECONDS + 60) * 1000);
    const expired = await runRequest(
      new Request('https://retrocks.app/b/board_1', {
        headers: { cookie: pair },
      }),
      () => session.getSession(),
    );
    expect(expired.result).toBeNull();
  });

  it('supports SESSION_SECRET rotation (newest signs, all verify)', async () => {
    const oldDeploy = await loadSession(SECRET_ONE);
    const minted = await runRequest(
      new Request('https://retrocks.app/b/board_1'),
      () => oldDeploy.grantFacilitatorSession('board_1'),
    );
    const pair = sessionPair(minted.response);

    const rotated = await loadSession(`${SECRET_TWO},${SECRET_ONE}`);
    const verified = await runRequest(
      new Request('https://retrocks.app/b/board_1', {
        headers: { cookie: pair },
      }),
      () => rotated.getSession(),
    );
    expect(verified.result?.participantId).toBe(minted.result.participantId);
    expect(verified.result?.facilitatorBoards).toEqual(['board_1']);

    const dropped = await loadSession(SECRET_TWO);
    const gone = await runRequest(
      new Request('https://retrocks.app/b/board_1', {
        headers: { cookie: pair },
      }),
      () => dropped.getSession(),
    );
    expect(gone.result).toBeNull();
  });

  it('expires the cookie on clearSession() and fails loudly without SESSION_SECRET or request scope', async () => {
    const session = await loadSession(SECRET_ONE);
    const cleared = await runRequest(
      new Request('https://retrocks.app/'),
      () => session.clearSession(),
    );
    const [cookie] = cleared.response.headers.getSetCookie();
    expect(cookie).toMatch(/^retrocks_session=;/);
    expect(cookie).toContain('Max-Age=0');

    await expect(session.getSession()).rejects.toThrow(/no request event/);

    delete process.env.SESSION_SECRET;
    vi.resetModules();
    await expect(import('./session')).rejects.toThrow(
      /SESSION_SECRET is not set/,
    );
  });
});
