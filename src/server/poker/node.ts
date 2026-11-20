import 'server-only';

import { LIVE_CONNECTION_HEADER, LIVE_HEARTBEAT_MS, LIVE_HEARTBEAT_TIMEOUT_MS } from '../../lib/board-live-protocol';
import type { PokerLiveMessage, PokerRoomCommand } from '../../lib/poker-types';
import { openNodeDatabase, wrapDatabaseSync } from '../adapters/node/sqlite';
import {
  PokerRoomStorage, pokerParticipant, projectPokerRoom,
  type PokerFacilitatorCapability, type StoredPokerRoom,
} from './room';

interface Connection {
  id: string;
  hash: string;
  participantId: string;
  lastSeenAt: number;
  send(message: PokerLiveMessage): void;
  close(): void;
}

const encoder = new TextEncoder();

export async function openNodePokerRooms(dbPath: string) {
  const db = await openNodeDatabase(dbPath);
  const storage = new PokerRoomStorage(wrapDatabaseSync(db));
  const streams = new Map<string, Set<Connection>>();

  function sendPresence(connections: Set<Connection>) {
    const online = [...new Set(Array.from(connections, (connection) => connection.participantId))];
    for (const connection of connections) connection.send({ type: 'room:presence', online });
  }

  function broadcastRoom(room: StoredPokerRoom) {
    for (const connection of streams.get(room.id) ?? []) {
      connection.send({ type: 'room:snapshot', room: projectPokerRoom(room, connection.hash) });
    }
  }

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [id, connections] of streams) {
      const expired = storage.snapshot(id, now) === null;
      for (const connection of connections) {
        if (expired) connection.send({ type: 'room:missing' });
        if (expired || now - connection.lastSeenAt > LIVE_HEARTBEAT_TIMEOUT_MS) connection.close();
      }
    }
  }, LIVE_HEARTBEAT_MS);
  heartbeat.unref();
  storage.purgeExpired();
  const expirySweep = setInterval(() => storage.purgeExpired(), 24 * 60 * 60 * 1000);
  expirySweep.unref();

  return {
    read: (id: string, hash: string) => storage.read(id, hash),
    create(id: string, hash: string, displayName: string) {
      return projectPokerRoom(storage.create(id, hash, displayName), hash);
    },
    mutate(id: string, hash: string, command: PokerRoomCommand) {
      const result = storage.mutate(id, hash, command);
      if (!result.ok) return result;
      broadcastRoom(result.room);
      return { ok: true as const, room: projectPokerRoom(result.room, hash) };
    },
    getFacilitatorCapability: (id: string, hash: string) => storage.getFacilitatorCapability(id, hash),
    replaceFacilitatorCapability(id: string, hash: string, revision: number, capability: PokerFacilitatorCapability) {
      const result = storage.replaceFacilitatorCapability(id, hash, revision, capability);
      if (!result.ok) return result;
      broadcastRoom(result.value);
      return { ok: true as const, value: null };
    },
    claimFacilitator(id: string, hash: string, candidate: string) {
      const result = storage.claimFacilitator(id, hash, candidate);
      if (!result.ok) return result;
      broadcastRoom(result.value);
      return { ok: true as const, value: projectPokerRoom(result.value, hash) };
    },
    connect(id: string, hash: string, request: Request): Response {
      const room = storage.snapshot(id);
      if (!room) return new Response(null, { status: 404 });
      const participant = pokerParticipant(room, hash);
      if (!participant) return new Response(null, { status: 403 });
      if (request.signal.aborted) return new Response(null, { status: 408 });
      const connections = streams.get(id) ?? new Set<Connection>();
      streams.set(id, connections);
      const connectionId = crypto.randomUUID();
      let unsubscribe: () => void;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const connection: Connection = {
            id: connectionId,
            hash,
            participantId: participant.id,
            lastSeenAt: Date.now(),
            send(message) {
              if ((controller.desiredSize ?? 0) <= -128) {
                queueMicrotask(connection.close);
                return;
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
            },
            close() {
              if (!connections.has(connection)) return;
              unsubscribe();
              controller.close();
            },
          };
          unsubscribe = () => {
            request.signal.removeEventListener('abort', connection.close);
            if (!connections.delete(connection)) return;
            if (connections.size === 0) streams.delete(id);
            else sendPresence(connections);
          };
          connections.add(connection);
          request.signal.addEventListener('abort', connection.close, { once: true });
          connection.send({ type: 'room:snapshot', room: projectPokerRoom(room, hash), connectionId });
          sendPresence(connections);
        },
        cancel() {
          unsubscribe();
        },
      });
      return new Response(body, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store, no-transform',
          'x-accel-buffering': 'no',
        },
      });
    },
    heartbeat(id: string, hash: string, request: Request): Response {
      const connectionId = request.headers.get(LIVE_CONNECTION_HEADER);
      for (const connection of streams.get(id) ?? []) {
        if (connection.hash !== hash || connection.id !== connectionId) continue;
        const now = Date.now();
        if (now - connection.lastSeenAt > LIVE_HEARTBEAT_TIMEOUT_MS) {
          connection.close();
          break;
        }
        connection.lastSeenAt = now;
        connection.send({ type: 'heartbeat' });
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    },
    close() {
      clearInterval(heartbeat);
      clearInterval(expirySweep);
      for (const connections of streams.values()) {
        for (const connection of connections) connection.close();
      }
      db.close();
    },
  };
}

export type NodePokerRooms = Awaited<ReturnType<typeof openNodePokerRooms>>;
