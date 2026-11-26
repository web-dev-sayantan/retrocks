import 'server-only';

import type { PokerLiveMessage, PokerRoomCommand } from '../../lib/poker-types';
import { openNodeDatabase, wrapDatabaseSync } from '../adapters/node/sqlite';
import { createNodeSseHub, createSseFrameResponse } from '../live/node-sse-hub';
import {
  missingPokerRoom,
  projectPokerPublication,
  type PokerRoomPublication,
} from './room-core';
import {
  PokerRoomStorage,
  pokerParticipant,
  projectPokerRoom,
  type PokerFacilitatorCapability,
} from './room';

interface PokerSseViewer {
  readonly hash: string;
  readonly participantId: string;
}

export async function openNodePokerRooms(dbPath: string) {
  const db = await openNodeDatabase(dbPath);
  const storage = new PokerRoomStorage(wrapDatabaseSync(db));

  const hub = createNodeSseHub<PokerSseViewer, PokerLiveMessage, string>({
    matchesViewer: (subscribed, hash) => subscribed.hash === hash,
    formatPresence: (viewers) => ({
      type: 'room:presence',
      online: [...new Set(viewers.map((viewer) => viewer.participantId))],
    }),
    checkAvailability: (roomId, now) =>
      storage.isAvailable(roomId, now)
        ? null
        : (viewer) => projectPokerPublication(missingPokerRoom, viewer.hash),
  });

  function publish(id: string, publication: PokerRoomPublication) {
    hub.publish(id, {
      project: (viewer) => projectPokerPublication(publication, viewer.hash),
      terminal: publication.terminal,
    });
  }

  storage.purgeExpired();
  const expirySweep = setInterval(() => storage.purgeExpired(), 24 * 60 * 60 * 1000);
  expirySweep.unref();

  return {
    read: (id: string, hash: string) => storage.read(id, hash),
    create(id: string, hash: string, displayName: string, name?: string) {
      return projectPokerRoom(storage.create(id, hash, displayName, name), hash);
    },
    mutate(id: string, hash: string, command: PokerRoomCommand) {
      const result = storage.mutate(id, hash, command);
      if (!result.ok) return result;
      if (result.updated) {
        publish(id, { type: 'snapshot', room: result.room, terminal: result.room.closedAt !== undefined });
      }
      return { ok: true as const, room: projectPokerRoom(result.room, hash) };
    },
    delete(id: string, hash: string) {
      const result = storage.delete(id, hash);
      if (result.ok) publish(id, missingPokerRoom);
      return result;
    },
    getFacilitatorCapability: (id: string, hash: string) => storage.getFacilitatorCapability(id, hash),
    replaceFacilitatorCapability(id: string, hash: string, revision: number, capability: PokerFacilitatorCapability) {
      const result = storage.replaceFacilitatorCapability(id, hash, revision, capability);
      if (!result.ok) return result;
      if (result.updated) {
        publish(id, { type: 'snapshot', room: result.room, terminal: result.room.closedAt !== undefined });
      }
      return { ok: true as const, value: null };
    },
    updateFacilitatorCapabilityEncryption(id: string, hash: string, revision: number, encrypted: string) {
      storage.updateFacilitatorCapabilityEncryption(id, hash, revision, encrypted);
    },
    claimFacilitator(id: string, hash: string, candidate: string) {
      const result = storage.claimFacilitator(id, hash, candidate);
      if (!result.ok) return result;
      if (result.updated) {
        publish(id, { type: 'snapshot', room: result.room, terminal: result.room.closedAt !== undefined });
      }
      return { ok: true as const, value: projectPokerRoom(result.room, hash) };
    },
    connect(id: string, hash: string, request: Request): Response {
      const room = storage.snapshot(id);
      if (!room) return createSseFrameResponse({ type: 'room:missing' });
      if (room.closedAt !== undefined) {
        return createSseFrameResponse({ type: 'room:snapshot', room: projectPokerRoom(room, hash) });
      }
      const participant = pokerParticipant(room, hash);
      if (!participant) return new Response(null, { status: 403 });

      return hub.connect(
        id,
        request,
        { hash, participantId: participant.id },
        (connectionId) => ({
          initialMessage: {
            type: 'room:snapshot',
            room: projectPokerRoom(room, hash),
            connectionId,
          },
        }),
      );
    },
    heartbeat(id: string, hash: string, connectionId: string): boolean {
      return hub.recordHeartbeat(id, connectionId, hash);
    },
    close() {
      clearInterval(expirySweep);
      hub.close();
      db.close();
    },
  };
}

export type NodePokerRooms = Awaited<ReturnType<typeof openNodePokerRooms>>;
