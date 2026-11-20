import 'server-only';
import { env } from 'virtual:solid-env/server';

import { POKER_LIVE_VIEWER_HEADER, type PokerRoomCommand } from '../../lib/poker-types';
import { getCloudflareEnv } from '../adapters/cloudflare-context';
import { openNodePokerRooms, type NodePokerRooms } from './node';
import type { PokerFacilitatorCapability } from './room';

let nodeRooms: Promise<NodePokerRooms> | undefined;

export async function getPokerRoomAccess(id: string) {
  const namespace = getCloudflareEnv()?.POINTING_POKER_ROOM;
  if (namespace) {
    const room = namespace.getByName(id);
    return {
      read: (hash: string) => room.read(id, hash),
      create: (hash: string, displayName: string) => room.create(id, hash, displayName),
      mutate: (hash: string, command: PokerRoomCommand) => room.mutate(id, hash, command),
      delete: (hash: string) => room.delete(id, hash),
      getFacilitatorCapability: (hash: string) => room.getFacilitatorCapability(id, hash),
      replaceFacilitatorCapability: (hash: string, revision: number, capability: PokerFacilitatorCapability) =>
        room.replaceFacilitatorCapability(id, hash, revision, capability),
      claimFacilitator: (hash: string, candidate: string) => room.claimFacilitator(id, hash, candidate),
      connect(hash: string, request: Request) {
        const headers = new Headers(request.headers);
        headers.set(POKER_LIVE_VIEWER_HEADER, hash);
        return room.fetch(new Request(request, { headers }));
      },
      heartbeat: () => new Response(null, { status: 405, headers: { allow: 'GET' } }),
    };
  }

  nodeRooms ??= openNodePokerRooms(process.env.VITEST ? ':memory:' : env.DATABASE_URL ?? './data/retrocks.sqlite');
  const rooms = await nodeRooms;
  return {
    read: (hash: string) => rooms.read(id, hash),
    create: (hash: string, displayName: string) => rooms.create(id, hash, displayName),
    mutate: (hash: string, command: PokerRoomCommand) => rooms.mutate(id, hash, command),
    delete: (hash: string) => rooms.delete(id, hash),
    getFacilitatorCapability: (hash: string) => rooms.getFacilitatorCapability(id, hash),
    replaceFacilitatorCapability: (hash: string, revision: number, capability: PokerFacilitatorCapability) =>
      rooms.replaceFacilitatorCapability(id, hash, revision, capability),
    claimFacilitator: (hash: string, candidate: string) => rooms.claimFacilitator(id, hash, candidate),
    connect: (hash: string, request: Request) => rooms.connect(id, hash, request),
    heartbeat: (hash: string, request: Request) => rooms.heartbeat(id, hash, request),
  };
}
