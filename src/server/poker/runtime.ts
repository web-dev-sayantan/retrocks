import 'server-only';
import { env } from 'virtual:solid-env/server';

import { POKER_LIVE_VIEWER_HEADER, type PokerRoomCommand } from '../../lib/poker-types';
import { getCloudflareEnv } from '../adapters/cloudflare-context';
import { openNodePokerRooms, type NodePokerRooms } from './node';

let nodeRooms: Promise<NodePokerRooms> | undefined;

export async function getPokerRoomAccess(id: string) {
  const namespace = getCloudflareEnv()?.POINTING_POKER_ROOM;
  if (namespace) {
    const room = namespace.getByName(id);
    return {
      read: (hash: string) => room.read(id, hash),
      create: (hash: string, displayName: string) => room.create(id, hash, displayName),
      mutate: (hash: string, command: PokerRoomCommand) => room.mutate(id, hash, command),
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
    connect: (hash: string, request: Request) => rooms.connect(id, hash, request),
    heartbeat: (hash: string, request: Request) => rooms.heartbeat(id, hash, request),
  };
}
