import { afterEach, describe, expect, it, vi } from 'vitest';

import { runWithCloudflareEnv } from '../adapters/cloudflare-context';
import { POKER_LIVE_VIEWER_HEADER } from '../live/headers';
import type { PokerRoomRuntime } from './room-core';
import { getPokerRoomAccess, setPokerRoomRuntimeForTests } from './runtime';

afterEach(() => {
  setPokerRoomRuntimeForTests(null);
});

describe('getPokerRoomAccess & PokerRoomRuntime seam', () => {
  it('binds a custom PokerRoomRuntime test override across all operations and restores defaults on null', async () => {
    const calls: unknown[][] = [];
    const customRuntime: PokerRoomRuntime = {
      async create(id, hash, displayName, name) {
        calls.push(['create', id, hash, displayName, name]);
        return {
          closed: false,
          id,
          name: name ?? 'Poker Room',
          version: 1,
          viewer: { id: 'p1', displayName, isFacilitator: true },
          participants: [{ id: 'p1', displayName, isFacilitator: true }],
          stories: [],
          activeStoryId: null,
          deck: ['1', '2'],
          deckType: 'custom',
          round: null,
        };
      },
      async read(id, hash) {
        calls.push(['read', id, hash]);
        return null;
      },
      async mutate(id, hash, command) {
        calls.push(['mutate', id, hash, command]);
        return { ok: false, code: 'ROOM_NOT_FOUND', message: 'missing' };
      },
      async delete(id, hash) {
        calls.push(['delete', id, hash]);
        return { ok: true };
      },
      async getFacilitatorCapability(id, hash) {
        calls.push(['getFacilitatorCapability', id, hash]);
        return { ok: true, value: null };
      },
      async replaceFacilitatorCapability(id, hash, expectedRevision, capability) {
        calls.push(['replaceFacilitatorCapability', id, hash, expectedRevision, capability]);
        return { ok: true, value: null };
      },
      async updateFacilitatorCapabilityEncryption(id, hash, expectedRevision, encrypted) {
        calls.push(['updateFacilitatorCapabilityEncryption', id, hash, expectedRevision, encrypted]);
      },
      async claimFacilitator(id, hash, candidate) {
        calls.push(['claimFacilitator', id, hash, candidate]);
        return { ok: false, code: 'INVALID_LINK', message: 'invalid' };
      },
      connect(id, hash, request) {
        calls.push(['connect', id, hash, request.url]);
        return new Response('ok');
      },
      heartbeat(id, hash, connectionId) {
        calls.push(['heartbeat', id, hash, connectionId]);
        return true;
      },
    };

    setPokerRoomRuntimeForTests(customRuntime);
    const access = await getPokerRoomAccess('room-override');

    await access.create('h1', 'Alex', 'Sprint 1');
    await access.read('h1');
    await access.mutate('h1', { type: 'close-room' });
    await access.delete('h1');
    await access.getFacilitatorCapability('h1');
    await access.replaceFacilitatorCapability('h1', 0, { hash: 'ch', encrypted: 'ce', revision: 1 });
    await access.updateFacilitatorCapabilityEncryption('h1', 1, 'ce2');
    await access.claimFacilitator('h1', 'cand');
    await access.connect('h1', new Request('https://retrocks.test/live'));
    expect(access.heartbeat?.('h1', 'conn-1')).toBe(true);

    expect(calls).toEqual([
      ['create', 'room-override', 'h1', 'Alex', 'Sprint 1'],
      ['read', 'room-override', 'h1'],
      ['mutate', 'room-override', 'h1', { type: 'close-room' }],
      ['delete', 'room-override', 'h1'],
      ['getFacilitatorCapability', 'room-override', 'h1'],
      ['replaceFacilitatorCapability', 'room-override', 'h1', 0, { hash: 'ch', encrypted: 'ce', revision: 1 }],
      ['updateFacilitatorCapabilityEncryption', 'room-override', 'h1', 1, 'ce2'],
      ['claimFacilitator', 'room-override', 'h1', 'cand'],
      ['connect', 'room-override', 'h1', 'https://retrocks.test/live'],
      ['heartbeat', 'room-override', 'h1', 'conn-1'],
    ]);

    // Clearing the override falls back to Node runtime.
    setPokerRoomRuntimeForTests(null);
    const nodeAccess = await getPokerRoomAccess('room-node-fallback');
    expect(nodeAccess.heartbeat).toBeTypeOf('function');
    expect(await nodeAccess.read('h1')).toBeNull();
  });

  it('wires Cloudflare POINTING_POKER_ROOM through the declared seam with WebSocket header stamping and no heartbeat', async () => {
    const stub = {
      create: vi.fn(async () => ({ closed: true, id: 'cf-room', name: 'Poker Room', version: 1, stories: [], canDelete: true })),
      read: vi.fn(async () => null),
      mutate: vi.fn(async () => ({ ok: false as const, code: 'ROOM_NOT_FOUND' as const, message: 'missing' })),
      delete: vi.fn(async () => ({ ok: true as const })),
      getFacilitatorCapability: vi.fn(async () => ({ ok: true as const, value: null })),
      replaceFacilitatorCapability: vi.fn(async () => ({ ok: true as const, value: null })),
      updateFacilitatorCapabilityEncryption: vi.fn(async () => undefined),
      claimFacilitator: vi.fn(async () => ({ ok: false as const, code: 'INVALID_LINK' as const, message: 'invalid' })),
      fetch: vi.fn(async (req: Request) => new Response(req.headers.get(POKER_LIVE_VIEWER_HEADER))),
    };
    const getByName = vi.fn(() => stub);
    const cfEnv = {
      POINTING_POKER_ROOM: { getByName },
    } as unknown as Cloudflare.Env;

    await runWithCloudflareEnv(cfEnv, async () => {
      const access = await getPokerRoomAccess('cf-room');
      expect(access.heartbeat).toBeUndefined();

      await access.read('viewer-hash');
      expect(getByName).toHaveBeenCalledWith('cf-room');
      expect(stub.read).toHaveBeenCalledWith('cf-room', 'viewer-hash');

      await access.delete('viewer-hash');
      expect(stub.delete).toHaveBeenCalledWith('cf-room', 'viewer-hash');

      const wsRes = await access.connect(
        'viewer-hash',
        new Request('https://retrocks.test/api/poker/cf-room/live', {
          headers: {
            upgrade: 'websocket',
            cookie: 'retrocks_session=secret',
            [POKER_LIVE_VIEWER_HEADER]: 'spoofed',
          },
        }),
      );
      expect(await wsRes.text()).toBe('viewer-hash');
      const forwardedReq = stub.fetch.mock.calls[0]?.[0];
      expect(forwardedReq?.headers.get('cookie')).toBeNull();
      expect(forwardedReq?.headers.get(POKER_LIVE_VIEWER_HEADER)).toBe('viewer-hash');
    });
  });
});
