import { DurableObject } from 'cloudflare:workers';

import type { PokerLiveMessage, PokerRoomCommand, PokerRoomView } from '../../lib/poker-types';
import { wrapDurableObjectSql } from '../adapters/cloudflare/sqlite';
import {
  createDurableObjectWebSocketHub,
  type DurableObjectWebSocketHub,
} from '../live/cloudflare-ws-hub';
import { POKER_LIVE_VIEWER_HEADER } from '../live/headers';
import {
  PokerRoomStorage, pokerParticipant, projectPokerRoom,
  type PokerFacilitatorCapability,
} from './room';
import {
  committedPokerDeletion, committedPokerMutation, missingPokerRoom,
  projectPokerPublication, type PokerRoomPublication,
} from './publication';

interface PokerLiveViewer {
  hash: string;
  participantId: string;
}

export class PointingPokerRoom extends DurableObject<Cloudflare.Env> {
  private readonly storage: PokerRoomStorage;
  private readonly live: DurableObjectWebSocketHub<PokerLiveViewer, PokerLiveMessage>;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.storage = new PokerRoomStorage(wrapDurableObjectSql(ctx.storage));
    this.live = createDurableObjectWebSocketHub<string, PokerLiveViewer, PokerLiveMessage>(ctx, {
      parseIdentity(request) {
        const hash = request.headers.get(POKER_LIVE_VIEWER_HEADER)?.trim();
        return hash || null;
      },
      onConnect: (hash) => {
        const id = this.ctx.id.name;
        const room = id ? this.storage.snapshot(id) : null;
        const participant = room && pokerParticipant(room, hash);
        if (room && room.closedAt === undefined && !participant) {
          return { type: 'reject', status: 403 };
        }
        if (!room) {
          return {
            type: 'terminal',
            message: { type: 'room:missing' },
            closeReason: 'Room unavailable',
          };
        }
        const initialMessage: PokerLiveMessage = {
          type: 'room:snapshot',
          room: projectPokerRoom(room, hash),
        };
        if (room.closedAt !== undefined || !participant) {
          return {
            type: 'terminal',
            message: initialMessage,
            closeReason: 'Room closed',
          };
        }
        return {
          type: 'accept',
          viewer: { hash, participantId: participant.id },
          initialMessage,
        };
      },
      shouldBroadcastPresence: () => {
        const id = this.ctx.id.name;
        const room = id ? this.storage.snapshot(id) : null;
        return Boolean(room && room.closedAt === undefined);
      },
      createPresenceMessage(viewers) {
        return {
          type: 'room:presence',
          online: [...new Set(viewers.map((viewer) => viewer.participantId))],
        };
      },
      onPing: (now) => {
        const id = this.ctx.id.name;
        if (!id || !this.storage.isAvailable(id, now)) {
          this.publish(missingPokerRoom);
          return false;
        }
        return true;
      },
    });
  }

  async create(id: string, hash: string, displayName: string, name?: string): Promise<PokerRoomView> {
    const room = this.storage.create(id, hash, displayName, name);
    await this.ctx.storage.setAlarm(room.expiresAt);
    return projectPokerRoom(room, hash);
  }

  async read(id: string, hash: string) {
    return this.storage.read(id, hash);
  }

  async mutate(id: string, hash: string, command: PokerRoomCommand) {
    const result = this.storage.mutate(id, hash, command);
    if (!result.ok) return result;
    const publication = committedPokerMutation(result);
    if (publication) {
      this.publish(publication);
      if (command.type !== 'join') await this.ctx.storage.setAlarm(result.room.expiresAt);
    }
    return { ok: true as const, room: projectPokerRoom(result.room, hash) };
  }

  async delete(id: string, hash: string) {
    const result = this.storage.delete(id, hash);
    const publication = committedPokerDeletion(result);
    if (publication) {
      this.publish(publication);
      await this.ctx.storage.deleteAlarm();
    }
    return result;
  }

  async getFacilitatorCapability(id: string, hash: string) {
    return this.storage.getFacilitatorCapability(id, hash);
  }

  async replaceFacilitatorCapability(id: string, hash: string, revision: number, capability: PokerFacilitatorCapability) {
    const result = this.storage.replaceFacilitatorCapability(id, hash, revision, capability);
    if (!result.ok) return result;
    const publication = committedPokerMutation(result);
    if (publication) this.publish(publication);
    return { ok: true as const, value: null };
  }

  async updateFacilitatorCapabilityEncryption(id: string, hash: string, revision: number, encrypted: string) {
    this.storage.updateFacilitatorCapabilityEncryption(id, hash, revision, encrypted);
  }

  async claimFacilitator(id: string, hash: string, candidate: string) {
    const result = this.storage.claimFacilitator(id, hash, candidate);
    if (!result.ok) return result;
    const publication = committedPokerMutation(result);
    if (publication) this.publish(publication);
    return { ok: true as const, value: projectPokerRoom(result.room, hash) };
  }

  async fetch(request: Request): Promise<Response> {
    return this.live.fetch(request);
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    this.live.webSocketMessage(socket, message);
  }

  webSocketClose(socket: WebSocket): void {
    this.live.webSocketClose(socket);
  }

  webSocketError(socket: WebSocket): void {
    this.live.webSocketError(socket);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.storage.purgeExpired(now);
    const id = this.ctx.id.name;
    const room = id ? this.storage.snapshot(id, now) : null;
    if (room) {
      await this.ctx.storage.setAlarm(room.expiresAt);
      return;
    }
    this.publish(missingPokerRoom);
  }

  private publish(publication: PokerRoomPublication): void {
    if (publication.type === 'missing') {
      this.live.closeAll(publication.frame, 'Room unavailable');
      return;
    }
    this.live.publish(
      (viewer) => projectPokerPublication(publication, viewer.hash),
      { closeReason: publication.terminal ? 'Room closed' : undefined },
    );
  }
}
