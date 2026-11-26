import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const ssrFetchMock = vi.hoisted(() =>
  vi.fn<(request: Request) => Promise<Response>>(async () => new Response('ssr', { status: 200 })),
);

vi.mock('virtual:solid-ssr-handler', () => ({
  default: { fetch: ssrFetchMock },
}));

vi.mock('cloudflare:workers', () => ({
  DurableObject: class MockDurableObject<Env = unknown> {
    constructor(
      protected readonly ctx: DurableObjectState,
      protected readonly env: Env,
    ) {}
  },
}));

import { runWithCloudflareEnv } from '../adapters/cloudflare-context';
import {
  LIVE_FACILITATOR_HEADER,
  LIVE_PARTICIPANT_HEADER,
  POKER_LIVE_VIEWER_HEADER,
} from './headers';

async function withSession<T>(request: Request, run: () => Promise<T>) {
  const event = createRequestEvent(request);
  return provideRequestEvent(event, async () => {
    const result = await run();
    const response = commitEventResponse(new Response(), event);
    const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
    return { result, cookie };
  });
}

function makeUpgradeSentinel(): Response {
  const sentinel = new Response(null, { status: 200 });
  Object.defineProperty(sentinel, 'status', { value: 101 });
  return sentinel;
}

const origin = 'https://retrocks.app';
const boardId = 'AbCdEfGhIjKlMnOpQrStUv';
const roomId = 'ZxYwVuTsRqPoNmLkJiHgFe';

let handleLiveRequest: typeof import('../live-handler').handleLiveRequest;
let handlePokerLiveRequest: typeof import('../poker/service').handlePokerLiveRequest;
let worker: typeof import('../../worker').default;
let cookie: string;

beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', 'test-cf-ws-hub-session-secret-at-least-32-chars');
  const session = await import('../session');
  ({ handleLiveRequest } = await import('../live-handler'));
  ({ handlePokerLiveRequest } = await import('../poker/service'));
  ({ default: worker } = await import('../../worker'));
  const minted = await withSession(
    new Request(origin, { method: 'POST' }),
    () => session.grantFacilitatorSession(boardId),
  );
  if (!minted.cookie) throw new Error('Expected signed session cookie');
  cookie = minted.cookie;
});

afterEach(() => {
  ssrFetchMock.mockClear();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('Cloudflare Worker WebSocket upgrade forwarding', () => {
  it('returns 426 with Upgrade: websocket before waking the Durable Object on both Boards and Rooms', async () => {
    const boardDoFetch = vi.fn<(request: Request) => Promise<Response>>(
      async () => new Response(null, { status: 426 }),
    );
    const pokerDoFetch = vi.fn<(request: Request) => Promise<Response>>(
      async () => new Response(null, { status: 426 }),
    );

    const fakeEnv = {
      BOARD_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          getBoardTokenSalt: async () => 'board-salt',
          fetch: boardDoFetch,
        }),
      },
      POINTING_POKER_ROOM: {
        getByName: () => ({
          fetch: pokerDoFetch,
        }),
      },
    } as unknown as Cloudflare.Env;

    await runWithCloudflareEnv(fakeEnv, async () => {
      const boardNonUpgrade = await handleLiveRequest(
        boardId,
        new Request(`${origin}/api/boards/${boardId}/live`, {
          headers: { cookie },
        }),
      );
      expect(boardNonUpgrade.status).toBe(426);
      expect(boardNonUpgrade.headers.get('upgrade')).toBe('websocket');
      expect(boardNonUpgrade.headers.get('cache-control')).toBe('no-store');

      const roomNonUpgrade = await handlePokerLiveRequest(
        roomId,
        new Request(`${origin}/api/poker/${roomId}/live`, {
          headers: { cookie },
        }),
      );
      expect(roomNonUpgrade.status).toBe(426);
      expect(roomNonUpgrade.headers.get('upgrade')).toBe('websocket');
      expect(roomNonUpgrade.headers.get('cache-control')).toBe('no-store');
    });

    expect(boardDoFetch).not.toHaveBeenCalled();
    expect(pokerDoFetch).not.toHaveBeenCalled();
  });

  it('strips cookie headers and overwrites spoofed internal viewer headers before forwarding to Board and Room DOs', async () => {
    let capturedBoardRequest: Request | undefined;
    let capturedPokerRequest: Request | undefined;
    const board101 = makeUpgradeSentinel();
    const poker101 = makeUpgradeSentinel();

    const fakeEnv = {
      BOARD_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          getBoardTokenSalt: async () => 'board-salt',
          fetch: vi.fn(async (request: Request) => {
            capturedBoardRequest = request;
            return board101;
          }),
        }),
      },
      POINTING_POKER_ROOM: {
        getByName: () => ({
          fetch: vi.fn(async (request: Request) => {
            capturedPokerRequest = request;
            return poker101;
          }),
        }),
      },
    } as unknown as Cloudflare.Env;

    await runWithCloudflareEnv(fakeEnv, async () => {
      const boardResponse = await handleLiveRequest(
        boardId,
        new Request(`${origin}/api/boards/${boardId}/live`, {
          headers: {
            cookie,
            upgrade: 'WebSocket',
            [LIVE_PARTICIPANT_HEADER]: 'spoofed-participant',
            [LIVE_FACILITATOR_HEADER]: 'false',
            [POKER_LIVE_VIEWER_HEADER]: 'spoofed-poker-viewer',
          },
        }),
      );
      expect(boardResponse).toBe(board101);
      expect(capturedBoardRequest).toBeDefined();
      expect(capturedBoardRequest!.headers.get('cookie')).toBeNull();
      expect(capturedBoardRequest!.headers.get('upgrade')).toBe('WebSocket');
      expect(capturedBoardRequest!.headers.get(LIVE_PARTICIPANT_HEADER)).toBeTruthy();
      expect(capturedBoardRequest!.headers.get(LIVE_PARTICIPANT_HEADER)).not.toBe('spoofed-participant');
      expect(capturedBoardRequest!.headers.get(LIVE_FACILITATOR_HEADER)).toBe('true');
      expect(capturedBoardRequest!.headers.get(POKER_LIVE_VIEWER_HEADER)).toBeNull();

      const roomResponse = await handlePokerLiveRequest(
        roomId,
        new Request(`${origin}/api/poker/${roomId}/live`, {
          headers: {
            cookie,
            upgrade: 'websocket',
            [POKER_LIVE_VIEWER_HEADER]: 'spoofed-poker-viewer',
            [LIVE_PARTICIPANT_HEADER]: 'spoofed-board-participant',
            [LIVE_FACILITATOR_HEADER]: 'true',
          },
        }),
      );
      expect(roomResponse).toBe(poker101);
      expect(capturedPokerRequest).toBeDefined();
      expect(capturedPokerRequest!.headers.get('cookie')).toBeNull();
      expect(capturedPokerRequest!.headers.get('upgrade')).toBe('websocket');
      expect(capturedPokerRequest!.headers.get(POKER_LIVE_VIEWER_HEADER)).toBeTruthy();
      expect(capturedPokerRequest!.headers.get(POKER_LIVE_VIEWER_HEADER)).not.toBe('spoofed-poker-viewer');
      expect(capturedPokerRequest!.headers.get(LIVE_PARTICIPANT_HEADER)).toBeNull();
      expect(capturedPokerRequest!.headers.get(LIVE_FACILITATOR_HEADER)).toBeNull();
    });
  });

  it('bypasses SSR response wrapping in worker.fetch for Board and Room WebSocket upgrades only', async () => {
    const board101 = makeUpgradeSentinel();
    const poker101 = makeUpgradeSentinel();
    const fakeEnv = {
      BOARD_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          getBoardTokenSalt: async () => 'board-salt',
          fetch: vi.fn(async () => board101),
        }),
      },
      POINTING_POKER_ROOM: {
        getByName: () => ({
          fetch: vi.fn(async () => poker101),
        }),
      },
    } as unknown as Cloudflare.Env;

    const boardUpgrade = await worker.fetch(
      new Request(`${origin}/api/boards/${boardId}/live`, {
        headers: { cookie, upgrade: 'websocket' },
      }),
      fakeEnv,
      {} as ExecutionContext,
    );
    expect(boardUpgrade).toBe(board101);

    const roomUpgrade = await worker.fetch(
      new Request(`${origin}/api/poker/${roomId}/live`, {
        headers: { cookie, upgrade: 'websocket' },
      }),
      fakeEnv,
      {} as ExecutionContext,
    );
    expect(roomUpgrade).toBe(poker101);
    expect(ssrFetchMock).not.toHaveBeenCalled();

    const nonUpgrade = await worker.fetch(
      new Request(`${origin}/api/poker/${roomId}/live`, {
        headers: { cookie },
      }),
      fakeEnv,
      {} as ExecutionContext,
    );
    expect(nonUpgrade.status).toBe(200);
    expect(ssrFetchMock).toHaveBeenCalledOnce();
  });
});
