import 'server-only';

import type { PokerLiveMessage } from '../../lib/poker-types';
import { openNodeDatabase, wrapDatabaseSync } from '../adapters/node/sqlite';
import { createNodeSseHub, createSseFrameResponse } from '../live/node-sse-hub';
import { pokerParticipant, projectPokerRoom } from './room';
import {
  createPokerRoomCore,
  missingPokerRoom,
  projectPokerPublication,
  type PokerRoomRuntime,
  type PokerWriteRateLimiter,
} from './room-core';

const DEFAULT_EXPIRY_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface PokerSseViewer {
  readonly hash: string;
  readonly participantId: string;
}

export interface OpenNodePokerRoomsOptions {
  /** Clock returning Unix epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Periodic inactivity cleanup interval in ms; pass `0` to disable. Defaults to 24 hours. */
  expirySweepIntervalMs?: number;
  /** Optional per-Room write rate limiter; defaults to a fresh `createBoardWriteRateLimiter()`. */
  writeLimiter?: PokerWriteRateLimiter;
}

export interface NodePokerRooms extends PokerRoomRuntime {
  connect(id: string, hash: string, request: Request): Response;
  heartbeat(id: string, hash: string, connectionId: string): boolean;
  close(): void;
}

export async function openNodePokerRooms(
  dbPath: string,
  options: OpenNodePokerRoomsOptions = {},
): Promise<NodePokerRooms> {
  const db = await openNodeDatabase(dbPath);
  const clock = options.now ?? (() => Date.now());

  const hub = createNodeSseHub<PokerSseViewer, PokerLiveMessage, string>({
    matchesViewer: (subscribed, hash) => subscribed.hash === hash,
    formatPresence: (viewers) => ({
      type: 'room:presence',
      online: [...new Set(viewers.map((viewer) => viewer.participantId))],
    }),
    checkAvailability: (roomId, now) =>
      core.isAvailable(roomId, options.now ? clock() : now)
        ? null
        : (viewer) => projectPokerPublication(missingPokerRoom, viewer.hash),
  });

  const core = createPokerRoomCore(wrapDatabaseSync(db), {
    now: clock,
    writeLimiter: options.writeLimiter,
    publisher: {
      publish(id, publication) {
        hub.publish(id, {
          project: (viewer) => projectPokerPublication(publication, viewer.hash),
          terminal: publication.terminal,
        });
      },
    },
  });

  const sweepIntervalMs =
    options.expirySweepIntervalMs ?? DEFAULT_EXPIRY_SWEEP_INTERVAL_MS;
  core.purgeExpired(clock());

  let closed = false;
  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  if (sweepIntervalMs > 0) {
    sweepTimer = setInterval(() => {
      if (closed) return;
      try {
        core.purgeExpired(clock());
      } catch {
        // Ignore if the database was closed concurrently.
      }
    }, sweepIntervalMs);
    sweepTimer.unref?.();
  }

  return {
    create: (id, hash, displayName, name) => core.create(id, hash, displayName, name),
    read: (id, hash) => core.read(id, hash),
    mutate: (id, hash, command) => core.mutate(id, hash, command),
    delete: (id, hash) => core.delete(id, hash),
    getFacilitatorCapability: (id, hash) => core.getFacilitatorCapability(id, hash),
    replaceFacilitatorCapability: (id, hash, expectedRevision, capability) =>
      core.replaceFacilitatorCapability(id, hash, expectedRevision, capability),
    updateFacilitatorCapabilityEncryption: (id, hash, expectedRevision, encrypted) =>
      core.updateFacilitatorCapabilityEncryption(id, hash, expectedRevision, encrypted),
    claimFacilitator: (id, hash, candidate) => core.claimFacilitator(id, hash, candidate),
    connect(id: string, hash: string, request: Request): Response {
      const room = core.snapshot(id, clock());
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
    close(): void {
      if (closed) return;
      closed = true;
      if (sweepTimer !== undefined) {
        clearInterval(sweepTimer);
        sweepTimer = undefined;
      }
      hub.close();
      db.close();
    },
  };
}
