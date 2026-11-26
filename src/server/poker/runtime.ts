import 'server-only';
import { env } from 'virtual:solid-env/server';

import { getCloudflareEnv } from '../adapters/cloudflare-context';
import { forwardWebSocketUpgrade } from '../live/cloudflare-ws-hub';
import { POKER_LIVE_VIEWER_HEADER } from '../live/headers';
import { openNodePokerRooms, type NodePokerRooms } from './node';
import {
  bindPokerRoomAccess,
  type PokerRoomAccess,
  type PokerRoomRuntime,
} from './room-core';

let testRuntimeOverride: PokerRoomRuntime | null = null;
let nodeRooms: Promise<NodePokerRooms> | undefined;

/** Replaces the active Pointing Poker Room runtime in server tests; pass `null` to restore default resolution. */
export function setPokerRoomRuntimeForTests(runtime: PokerRoomRuntime | null): void {
  testRuntimeOverride = runtime;
}

function createCloudflarePokerRoomRuntime(
  namespace: Cloudflare.Env['POINTING_POKER_ROOM'],
): PokerRoomRuntime {
  const stubFor = (id: string) => namespace.getByName(id);
  return {
    create: (id, hash, displayName, name) => stubFor(id).create(id, hash, displayName, name),
    read: (id, hash) => stubFor(id).read(id, hash),
    mutate: (id, hash, command) => stubFor(id).mutate(id, hash, command),
    delete: (id, hash) => stubFor(id).delete(id, hash),
    getFacilitatorCapability: (id, hash) => stubFor(id).getFacilitatorCapability(id, hash),
    replaceFacilitatorCapability: (id, hash, expectedRevision, capability) =>
      stubFor(id).replaceFacilitatorCapability(id, hash, expectedRevision, capability),
    updateFacilitatorCapabilityEncryption: (id, hash, expectedRevision, encrypted) =>
      stubFor(id).updateFacilitatorCapabilityEncryption(id, hash, expectedRevision, encrypted),
    claimFacilitator: (id, hash, candidate) => stubFor(id).claimFacilitator(id, hash, candidate),
    connect: (id, hash, request) =>
      forwardWebSocketUpgrade(stubFor(id), request, { [POKER_LIVE_VIEWER_HEADER]: hash }),
  };
}

async function getPokerRoomRuntime(): Promise<PokerRoomRuntime> {
  if (testRuntimeOverride) {
    return testRuntimeOverride;
  }

  const namespace = getCloudflareEnv()?.POINTING_POKER_ROOM;
  if (namespace) {
    return createCloudflarePokerRoomRuntime(namespace);
  }

  return (nodeRooms ??= openNodePokerRooms(
    process.env.VITEST ? ':memory:' : env.DATABASE_URL ?? './data/retrocks.sqlite',
  ));
}

export async function getPokerRoomAccess(id: string): Promise<PokerRoomAccess> {
  return bindPokerRoomAccess(await getPokerRoomRuntime(), id);
}
