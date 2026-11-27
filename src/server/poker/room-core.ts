import 'server-only';

import type { PokerSharingResult } from '../../lib/poker-sharing-types';
import type {
  PokerDeleteResult,
  PokerLiveMessage,
  PokerResult,
  PokerRoomCommand,
  PokerRoomView,
} from '../../lib/poker-types';
import type { SqlRunner } from '../db/sql-runner';
import { createBoardWriteRateLimiter, type BoardWriteRateLimiter } from '../rate-limit';
import {
  PokerRoomStorage,
  pokerParticipant,
  pokerRoomRateLimited,
  projectPokerRoom,
  type PokerFacilitatorCapability,
  type StoredPokerRoom,
} from './room';

export interface PokerLiveViewer {
  readonly hash: string;
  readonly participantId: string;
}

export type PokerRoomPublication =
  | { type: 'snapshot'; room: StoredPokerRoom; terminal: boolean }
  | { type: 'missing'; terminal: true; frame: { type: 'room:missing' } };

export const missingPokerRoom: Extract<PokerRoomPublication, { type: 'missing' }> = {
  type: 'missing',
  terminal: true,
  frame: { type: 'room:missing' },
};

function pokerRoomSnapshot(room: StoredPokerRoom): PokerRoomPublication {
  return { type: 'snapshot', room, terminal: room.closedAt !== undefined };
}

export function projectPokerPublication(
  publication: PokerRoomPublication,
  hash: string,
): PokerLiveMessage {
  if (publication.type === 'missing') return publication.frame;
  return { type: 'room:snapshot', room: projectPokerRoom(publication.room, hash) };
}

export type PokerLiveConnectDecision =
  | { readonly status: 'missing'; readonly message: Extract<PokerLiveMessage, { type: 'room:missing' }> }
  | { readonly status: 'closed'; readonly message: Extract<PokerLiveMessage, { type: 'room:snapshot' }> }
  | { readonly status: 'unjoined'; readonly httpStatus: 403 }
  | { readonly status: 'joined'; readonly viewer: PokerLiveViewer; readonly room: PokerRoomView };

export function evaluatePokerLiveConnect(
  room: StoredPokerRoom | null,
  hash: string,
): PokerLiveConnectDecision {
  if (!room) {
    return { status: 'missing', message: missingPokerRoom.frame };
  }
  if (room.closedAt !== undefined) {
    return {
      status: 'closed',
      message: { type: 'room:snapshot', room: projectPokerRoom(room, hash) },
    };
  }
  const participant = pokerParticipant(room, hash);
  if (!participant) {
    return { status: 'unjoined', httpStatus: 403 };
  }
  return {
    status: 'joined',
    viewer: { hash, participantId: participant.id },
    room: projectPokerRoom(room, hash),
  };
}

export function projectPokerPresence(
  viewers: readonly Pick<PokerLiveViewer, 'participantId'>[],
): Extract<PokerLiveMessage, { type: 'room:presence' }> {
  return {
    type: 'room:presence',
    online: [...new Set(viewers.map((viewer) => viewer.participantId))],
  };
}

/**
 * The eight Pointing Poker Room and Co-Facilitator Link operations shared
 * identically across Cloudflare Durable Objects and Node SQLite.
 */
export interface PokerRoomOperations {
  create(id: string, hash: string, displayName: string, name?: string): Promise<PokerRoomView>;
  read(id: string, hash: string): Promise<PokerRoomView | null>;
  mutate(id: string, hash: string, command: PokerRoomCommand): Promise<PokerResult>;
  delete(id: string, hash: string): Promise<PokerDeleteResult>;
  getFacilitatorCapability(
    id: string,
    hash: string,
  ): Promise<PokerSharingResult<PokerFacilitatorCapability | null>>;
  replaceFacilitatorCapability(
    id: string,
    hash: string,
    expectedRevision: number,
    capability: PokerFacilitatorCapability,
  ): Promise<PokerSharingResult<null>>;
  updateFacilitatorCapabilityEncryption(
    id: string,
    hash: string,
    expectedRevision: number,
    encrypted: string,
  ): Promise<void>;
  claimFacilitator(
    id: string,
    hash: string,
    candidate: string,
  ): Promise<PokerSharingResult<PokerRoomView>>;
}

/**
 * Explicit Pointing Poker Room server runtime seam (ADR-0002):
 * covers all eight Room and Co-Facilitator Link operations plus live-transport handoff.
 */
export interface PokerRoomRuntime extends PokerRoomOperations {
  connect(id: string, hash: string, request: Request): Promise<Response> | Response;
  heartbeat?(id: string, hash: string, connectionId: string): Promise<boolean> | boolean;
}

/**
 * Single-Room bound access view of `PokerRoomRuntime`.
 */
export interface PokerRoomAccess {
  create(hash: string, displayName: string, name?: string): Promise<PokerRoomView>;
  read(hash: string): Promise<PokerRoomView | null>;
  mutate(hash: string, command: PokerRoomCommand): Promise<PokerResult>;
  delete(hash: string): Promise<PokerDeleteResult>;
  getFacilitatorCapability(
    hash: string,
  ): Promise<PokerSharingResult<PokerFacilitatorCapability | null>>;
  replaceFacilitatorCapability(
    hash: string,
    expectedRevision: number,
    capability: PokerFacilitatorCapability,
  ): Promise<PokerSharingResult<null>>;
  updateFacilitatorCapabilityEncryption(
    hash: string,
    expectedRevision: number,
    encrypted: string,
  ): Promise<void>;
  claimFacilitator(hash: string, candidate: string): Promise<PokerSharingResult<PokerRoomView>>;
  connect(hash: string, request: Request): Promise<Response> | Response;
  heartbeat?(hash: string, connectionId: string): Promise<boolean> | boolean;
}

export function bindPokerRoomAccess(runtime: PokerRoomRuntime, id: string): PokerRoomAccess {
  const { heartbeat } = runtime;
  return {
    create: (hash, displayName, name) => runtime.create(id, hash, displayName, name),
    read: (hash) => runtime.read(id, hash),
    mutate: (hash, command) => runtime.mutate(id, hash, command),
    delete: (hash) => runtime.delete(id, hash),
    getFacilitatorCapability: (hash) => runtime.getFacilitatorCapability(id, hash),
    replaceFacilitatorCapability: (hash, expectedRevision, capability) =>
      runtime.replaceFacilitatorCapability(id, hash, expectedRevision, capability),
    updateFacilitatorCapabilityEncryption: (hash, expectedRevision, encrypted) =>
      runtime.updateFacilitatorCapabilityEncryption(id, hash, expectedRevision, encrypted),
    claimFacilitator: (hash, candidate) => runtime.claimFacilitator(id, hash, candidate),
    connect: (hash, request) => runtime.connect(id, hash, request),
    heartbeat: heartbeat
      ? (hash, connectionId) => heartbeat.call(runtime, id, hash, connectionId)
      : undefined,
  };
}

export type PokerWriteRateLimiter = Pick<BoardWriteRateLimiter, 'check'>;

export interface PokerRoomPublisher {
  publish(id: string, publication: PokerRoomPublication): void | Promise<void>;
}

export interface PokerRoomCoreOptions {
  /** Clock returning Unix epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Per-Room write rate limiter; defaults to a fresh `createBoardWriteRateLimiter()`. */
  writeLimiter?: PokerWriteRateLimiter;
  /** Transport-agnostic live publication port for snapshot and terminal Room notifications. */
  publisher?: PokerRoomPublisher;
  /** Schedules or reschedules an adapter expiry alarm for a Room. */
  scheduleExpiry?(id: string, expiresAt: number): void | Promise<void>;
  /**
   * Clears adapter expiry state and wipes storage after deletion or expiry
   * (e.g. Cloudflare DO `deleteAlarm()` + `deleteAll()`).
   */
  clearExpiry?(id: string): void | Promise<void>;
}

export interface PokerRoomCore extends PokerRoomOperations {
  isAvailable(id: string, now?: number): boolean;
  snapshot(id: string, now?: number): StoredPokerRoom | null;
  handleExpiry(id: string): Promise<'active' | 'expired'>;
  purgeExpired(now?: number): void;
  resetSchemaState(): void;
}

export function createPokerRoomCore(
  sql: SqlRunner,
  options: PokerRoomCoreOptions = {},
): PokerRoomCore {
  const storage = new PokerRoomStorage(sql);
  const clock = options.now ?? (() => Date.now());
  const writeLimiter = options.writeLimiter ?? createBoardWriteRateLimiter();

  async function publish(id: string, publication: PokerRoomPublication): Promise<void> {
    await options.publisher?.publish(id, publication);
  }

  async function clearExpiry(id: string): Promise<void> {
    if (!options.clearExpiry) return;
    try {
      await options.clearExpiry(id);
    } finally {
      storage.resetSchemaState();
    }
  }

  async function handleMissingExpiry(id: string): Promise<void> {
    await publish(id, missingPokerRoom);
    await clearExpiry(id);
  }

  async function handleExpiredFailure<Code extends string>(
    id: string,
    result: { ok: false; code: Code; message: string; expired?: boolean },
  ): Promise<{ ok: false; code: Code; message: string }> {
    if (result.expired) {
      await handleMissingExpiry(id);
    }
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    async create(id, hash, displayName, name) {
      const room = storage.create(id, hash, displayName, name, clock());
      await options.scheduleExpiry?.(id, room.expiresAt);
      return projectPokerRoom(room, hash);
    },

    async read(id, hash) {
      const found = storage.lookup(id, clock());
      if (found.status === 'expired') {
        await handleMissingExpiry(id);
        return null;
      }
      if (found.status === 'missing') return null;
      return projectPokerRoom(found.room, hash);
    },

    async mutate(id, hash, command) {
      const now = clock();
      if (!writeLimiter.check(id, hash, now).allowed) return pokerRoomRateLimited;
      const result = storage.mutate(id, hash, command, now);
      if (!result.ok) {
        return handleExpiredFailure(id, result);
      }
      if (result.updated) {
        await publish(id, pokerRoomSnapshot(result.room));
        if (command.type !== 'join') {
          await options.scheduleExpiry?.(id, result.room.expiresAt);
        }
      }
      return { ok: true, room: projectPokerRoom(result.room, hash) };
    },

    async delete(id, hash) {
      const result = storage.delete(id, hash, clock());
      if (!result.ok) {
        return handleExpiredFailure(id, result);
      }
      await handleMissingExpiry(id);
      return { ok: true };
    },

    async getFacilitatorCapability(id, hash) {
      const result = storage.getFacilitatorCapability(id, hash, clock());
      if (!result.ok) {
        return handleExpiredFailure(id, result);
      }
      return result;
    },

    async replaceFacilitatorCapability(id, hash, expectedRevision, capability) {
      const now = clock();
      const result = storage.replaceFacilitatorCapability(
        id,
        hash,
        expectedRevision,
        capability,
        now,
        () => writeLimiter.check(id, hash, now).allowed,
      );
      if (!result.ok) {
        return handleExpiredFailure(id, result);
      }
      if (result.updated) {
        await publish(id, pokerRoomSnapshot(result.room));
      }
      return { ok: true, value: null };
    },

    async updateFacilitatorCapabilityEncryption(id, hash, expectedRevision, encrypted) {
      const result = storage.updateFacilitatorCapabilityEncryption(
        id,
        hash,
        expectedRevision,
        encrypted,
        clock(),
      );
      if (result.expired) {
        await handleMissingExpiry(id);
      }
    },

    async claimFacilitator(id, hash, candidate) {
      const now = clock();
      if (!writeLimiter.check(id, hash, now).allowed) return pokerRoomRateLimited;
      const result = storage.claimFacilitator(id, hash, candidate, now);
      if (!result.ok) {
        return handleExpiredFailure(id, result);
      }
      if (result.updated) {
        await publish(id, pokerRoomSnapshot(result.room));
      }
      return { ok: true, value: projectPokerRoom(result.room, hash) };
    },

    isAvailable(id, now = clock()) {
      return storage.isAvailable(id, now);
    },

    snapshot(id, now = clock()) {
      return storage.snapshot(id, now);
    },

    async handleExpiry(id) {
      const now = clock();
      const found = storage.lookup(id, now);
      if (found.status === 'found') {
        await options.scheduleExpiry?.(id, found.room.expiresAt);
        return 'active';
      }
      storage.purgeExpired(now);
      await handleMissingExpiry(id);
      return 'expired';
    },

    purgeExpired(now = clock()) {
      storage.purgeExpired(now);
    },

    resetSchemaState() {
      storage.resetSchemaState();
    },
  };
}
