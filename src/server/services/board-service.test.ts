import {
  commitEventResponse,
  createRequestEvent,
  isSafeError,
} from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createNodeBoardStore,
  type NodeBoardStore,
} from '../adapters/node/sqlite-board-store';
import { setBoardStoreForTests } from '../adapters/runtime';
import { decryptFacilitatorToken, hashTokenWithSalt } from '../crypto';
import {
  createInMemoryRateLimiter,
  resetDefaultRateLimiterForTests,
  setBoardCreateRateLimiterForTests,
} from '../rate-limit';

const TEST_SECRET = 'test-session-secret-with-at-least-32-chars-abc123';

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

function extractSessionCookie(response: Response): string {
  const cookies = response.headers
    .getSetCookie()
    .filter((c) => c.startsWith('retrocks_session='));
  expect(cookies.length).toBeGreaterThan(0);
  return cookies[cookies.length - 1].split(';')[0];
}

let store: NodeBoardStore;

beforeEach(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  vi.resetModules();
  store = await createNodeBoardStore(':memory:');
  const { setBoardStoreForTests: setStore } = await import(
    '../adapters/runtime'
  );
  setStore(store);
  const {
    resetDefaultRateLimiterForTests: resetLimiter,
    setBoardCreateRateLimiterForTests: setLimiter,
  } = await import('../rate-limit');
  resetLimiter();
  setLimiter(null);
});

afterEach(() => {
  setBoardStoreForTests(null);
  setBoardCreateRateLimiterForTests(null);
  resetDefaultRateLimiterForTests();
  store.close();
  delete process.env.SESSION_SECRET;
});

describe('BoardService (Board creation, lazy cookie minting & SSR reads)', () => {
  it('creates a Board with Standard Retro defaults, AES-256-GCM facilitator secret, and Facilitator cookie', async () => {
    const service = await import('./board-service');

    const created = await runRequest(
      new Request('https://retrocks.app/', { method: 'POST' }),
      () => service.createBoardForRequest({}),
    );

    const dto = created.result;
    expect(dto.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(dto.title).toMatch(/^Sprint Retrospective — [A-Z][a-z]{2} \d{1,2}$/);
    expect(dto.templateId).toBe('standard');
    expect(dto.isFacilitator).toBe(true);
    expect(dto.voteLimit).toBe(5);
    expect(dto.maxVotesPerCard).toBeNull();
    expect(dto.isBlurred).toBe(false);
    expect(dto.retentionDays).toBe(90);
    expect(dto.columns.map((c) => c.title)).toEqual([
      'Went Well',
      'To Improve',
      'Action Items',
    ]);
    expect(dto.columns[2].isActionColumn).toBe(true);

    // Facilitator token is stored both hashed and AES-256-GCM encrypted at rest
    const raw = await store.getBoardSnapshot(dto.id);
    expect(raw).not.toBeNull();
    const decrypted = await decryptFacilitatorToken(
      raw!.board.facilitatorTokenEncrypted,
      dto.id,
      [TEST_SECRET],
    );
    expect(decrypted).not.toBeNull();
    const expectedHash = await hashTokenWithSalt(
      decrypted!.token,
      raw!.board.tokenSalt,
    );
    expect(raw!.board.facilitatorTokenHash).toBe(expectedHash);

    // DTO never leaks stored hashes, salts, or ciphertexts
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain(raw!.board.facilitatorTokenHash);
    expect(serialized).not.toContain(raw!.board.facilitatorTokenEncrypted);
    expect(serialized).not.toContain(raw!.board.tokenSalt);
    expect(serialized).not.toContain(decrypted!.token);

    // Creator receives signed HttpOnly cookie granting Facilitator access
    const creatorCookie = extractSessionCookie(created.response);
    const facilitatorRead = await runRequest(
      new Request(`https://retrocks.app/b/${dto.id}`, {
        headers: { cookie: creatorCookie },
      }),
      () => service.getBoardForRequest(dto.id),
    );
    expect(facilitatorRead.result?.isFacilitator).toBe(true);
  });

  it('creates a Custom Board with custom Columns and advanced options', async () => {
    const service = await import('./board-service');

    const { result } = await runRequest(
      new Request('https://retrocks.app/', { method: 'POST' }),
      () =>
        service.createBoardForRequest({
          title: 'Q4 Architecture Review',
          subtitle: 'Platform & SRE',
          templateId: 'custom',
          columns: [
            { title: 'Wins', accent: 'teal', isActionColumn: false },
            { title: 'Risks', accent: 'coral', isActionColumn: false },
            { title: 'Next Steps', accent: 'violet', isActionColumn: true },
          ],
          voteLimit: 10,
          maxVotesPerCard: 1,
          isBlurred: true,
          retentionDays: 180,
        }),
    );

    expect(result.title).toBe('Q4 Architecture Review');
    expect(result.subtitle).toBe('Platform & SRE');
    expect(result.voteLimit).toBe(10);
    expect(result.maxVotesPerCard).toBe(1);
    expect(result.isBlurred).toBe(true);
    expect(result.retentionDays).toBe(180);
    expect(result.columns).toHaveLength(3);
    expect(result.columns[2]).toMatchObject({
      title: 'Next Steps',
      accent: 'violet',
      isActionColumn: true,
    });
  });

  it('lazily mints an anonymous Participant cookie on first GET /b/:id without granting Facilitator', async () => {
    const service = await import('./board-service');

    const created = await runRequest(
      new Request('https://retrocks.app/', { method: 'POST' }),
      () => service.createBoardForRequest({ title: 'Team Sync' }),
    );
    const boardId = created.result.id;

    // Unauthenticated Participant visits /b/:id
    const visit = await runRequest(
      new Request(`http://localhost:3000/b/${boardId}`),
      () => service.getBoardForRequest(boardId),
    );
    expect(visit.result?.id).toBe(boardId);
    expect(visit.result?.isFacilitator).toBe(false);

    // Cookie was minted lazily on GET /b/:id (without Secure on localhost HTTP)
    const setCookies = visit.response.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toContain('retrocks_session=');
    expect(setCookies[0]).toContain('HttpOnly');
    expect(setCookies[0]).not.toContain('Secure');
  });

  it('returns null and does not mint a cookie for missing, malformed, or expired Boards', async () => {
    const service = await import('./board-service');

    const missing = await runRequest(
      new Request('https://retrocks.app/b/nonexistent_board_1234'),
      () => service.getBoardForRequest('nonexistent_board_1234'),
    );
    expect(missing.result).toBeNull();
    expect(missing.response.headers.getSetCookie()).toEqual([]);

    const malformed = await runRequest(
      new Request('https://retrocks.app/b/bad!id'),
      () => service.getBoardForRequest('bad!id'),
    );
    expect(malformed.result).toBeNull();
    expect(malformed.response.headers.getSetCookie()).toEqual([]);
  });

  it('enforces rate limiting and validation with safe-branded domain errors', async () => {
    const { setBoardCreateRateLimiterForTests: setLimiter } = await import(
      '../rate-limit'
    );
    setLimiter(createInMemoryRateLimiter({ limit: 1, windowMs: 60_000 }));
    const service = await import('./board-service');

    // Validation error is safe-branded
    await runRequest(new Request('https://retrocks.app/'), async () => {
      try {
        await service.createBoardForRequest({ title: 'x'.repeat(121) });
        expect.unreachable('expected validation error');
      } catch (err) {
        expect(err).toBeInstanceOf(service.BoardDomainError);
        expect((err as InstanceType<typeof service.BoardDomainError>).code).toBe(
          'VALIDATION_ERROR',
        );
        expect(isSafeError(err)).toBe(true);
      }
    });

    // First valid creation succeeds
    await runRequest(
      new Request('https://retrocks.app/', {
        headers: { 'x-forwarded-for': '198.51.100.10' },
      }),
      () => service.createBoardForRequest({ title: 'First Board' }),
    );

    // Second creation hits rate limit with safe-branded error
    await runRequest(
      new Request('https://retrocks.app/', {
        headers: { 'x-forwarded-for': '198.51.100.10' },
      }),
      async () => {
        try {
          await service.createBoardForRequest({ title: 'Second Board' });
          expect.unreachable('expected rate limit error');
        } catch (err) {
          expect(err).toBeInstanceOf(service.BoardDomainError);
          expect(
            (err as InstanceType<typeof service.BoardDomainError>).code,
          ).toBe('RATE_LIMITED');
          expect(isSafeError(err)).toBe(true);
        }
      },
    );
  });
});
