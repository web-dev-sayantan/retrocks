import { DurableObject } from 'cloudflare:workers';

import type { PokerSharingResult } from '../../lib/poker-sharing-types';
import type {
  PokerDeleteResult,
  PokerLiveMessage,
  PokerResult,
  PokerRoomCommand,
  PokerRoomView,
} from '../../lib/poker-types';
import { wrapDurableObjectSql } from '../adapters/cloudflare/sqlite';
import {
  createDurableObjectWebSocketHub,
  type DurableObjectWebSocketHub,
} from '../live/cloudflare-ws-hub';
import { POKER_LIVE_VIEWER_HEADER } from '../live/headers';
import {
  pokerParticipant,
  projectPokerRoom,
  type PokerFacilitatorCapability,
} from './room';
import {
  createPokerRoomCore,
  missingPokerRoom,
  projectPokerPublication,
  type PokerRoomCore,
  type PokerRoomOperations,
  type PokerRoomPublication,
} from './room-core';

interface PokerLiveViewer {
  hash: string;
  participantId: string;
}

export class PointingPokerRoom extends DurableObject<Cloudflare.Env> implements PokerRoomOperations {
  private readonly core: PokerRoomCore;
  private readonly live: DurableObjectWebSocketHub<PokerLiveViewer, PokerLiveMessage>;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.core = createPokerRoomCore(wrapDurableObjectSql(ctx.storage), {
      publisher: {
        publish: (_id, publication) => {
          this.publish(publication);
        },
      },
      scheduleExpiry: async (_id, expiresAt) => {
        await this.ctx.storage.setAlarm(expiresAt);
      },
      clearExpiry: async () => {
        await this.wipeStorage();
      },
    });
    this.live = createDurableObjectWebSocketHub<string, PokerLiveViewer, PokerLiveMessage>(ctx, {
      parseIdentity(request) {
        const hash = request.headers.get(POKER_LIVE_VIEWER_HEADER)?.trim();
        return hash || null;
      },
      onConnect: (hash, now) => {
        const id = this.ctx.id.name;
        const room = id ? this.core.snapshot(id, now) : null;
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
      shouldBroadcastPresence: (now) => {
        const id = this.ctx.id.name;
        const room = id ? this.core.snapshot(id, now) : null;
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
        if (!id || !this.core.isAvailable(id, now)) {
          this.publish(missingPokerRoom);
          return false;
        }
        return true;
      },
    });
  }

  private async wipeStorage(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.core.resetSchemaState();
  }

  create(id: string, hash: string, displayName: string, name?: string): Promise<PokerRoomView> {
    return this.core.create(id, hash, displayName, name);
  }

  read(id: string, hash: string): Promise<PokerRoomView | null> {
    return this.core.read(id, hash);
  }

  mutate(id: string, hash: string, command: PokerRoomCommand): Promise<PokerResult> {
    return this.core.mutate(id, hash, command);
  }

  delete(id: string, hash: string): Promise<PokerDeleteResult> {
    return this.core.delete(id, hash);
  }

  getFacilitatorCapability(
    id: string,
    hash: string,
  ): Promise<PokerSharingResult<PokerFacilitatorCapability | null>> {
    return this.core.getFacilitatorCapability(id, hash);
  }

  replaceFacilitatorCapability(
    id: string,
    hash: string,
    expectedRevision: number,
    capability: PokerFacilitatorCapability,
  ): Promise<PokerSharingResult<null>> {
    return this.core.replaceFacilitatorCapability(id, hash, expectedRevision, capability);
  }

  updateFacilitatorCapabilityEncryption(
    id: string,
    hash: string,
    expectedRevision: number,
    encrypted: string,
  ): Promise<void> {
    return this.core.updateFacilitatorCapabilityEncryption(id, hash, expectedRevision, encrypted);
  }

  claimFacilitator(
    id: string,
    hash: string,
    candidate: string,
  ): Promise<PokerSharingResult<PokerRoomView>> {
    return this.core.claimFacilitator(id, hash, candidate);
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
    const id = this.ctx.id.name;
    if (id) {
      await this.core.handleExpiry(id);
      return;
    }
    this.core.purgeExpired();
    this.publish(missingPokerRoom);
    await this.wipeStorage();
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
