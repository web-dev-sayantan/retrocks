import { DurableObject } from 'cloudflare:workers';

import { LIVE_HEARTBEAT_TIMEOUT_MS } from '../../lib/board-live-protocol';
import { POKER_LIVE_VIEWER_HEADER, type PokerLiveMessage, type PokerRoomCommand, type PokerRoomView } from '../../lib/poker-types';
import { wrapDurableObjectSql } from '../adapters/cloudflare/sqlite';
import {
  PokerRoomStorage, pokerParticipant, projectPokerRoom,
  type PokerFacilitatorCapability, type StoredPokerRoom,
} from './room';


interface Attachment {
  hash: string;
  participantId: string;
  lastSeenAt: number;
}

export class PointingPokerRoom extends DurableObject<Cloudflare.Env> {
  private readonly storage: PokerRoomStorage;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.storage = new PokerRoomStorage(wrapDurableObjectSql(ctx.storage));
  }

  async create(id: string, hash: string, displayName: string): Promise<PokerRoomView> {
    const room = this.storage.create(id, hash, displayName);
    await this.ctx.storage.setAlarm(room.expiresAt);
    return projectPokerRoom(room, hash);
  }

  async read(id: string, hash: string) {
    return this.storage.read(id, hash);
  }

  async mutate(id: string, hash: string, command: PokerRoomCommand) {
    const result = this.storage.mutate(id, hash, command);
    if (!result.ok) return result;
    this.broadcastRoom(result.room);
    if (result.room.closedAt !== undefined) await this.ctx.storage.setAlarm(result.room.expiresAt);
    return { ok: true as const, room: projectPokerRoom(result.room, hash) };
  }

  async getFacilitatorCapability(id: string, hash: string) {
    return this.storage.getFacilitatorCapability(id, hash);
  }

  async replaceFacilitatorCapability(id: string, hash: string, revision: number, capability: PokerFacilitatorCapability) {
    const result = this.storage.replaceFacilitatorCapability(id, hash, revision, capability);
    if (!result.ok) return result;
    this.broadcastRoom(result.value);
    return { ok: true as const, value: null };
  }

  async claimFacilitator(id: string, hash: string, candidate: string) {
    const result = this.storage.claimFacilitator(id, hash, candidate);
    if (!result.ok) return result;
    this.broadcastRoom(result.value);
    return { ok: true as const, value: projectPokerRoom(result.value, hash) };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 426 });
    }
    const id = this.ctx.id.name;
    const room = id ? this.storage.snapshot(id) : null;
    if (!room) return new Response(null, { status: 404 });

    const hash = request.headers.get(POKER_LIVE_VIEWER_HEADER);
    if (!hash) return new Response(null, { status: 403 });
    const participant = pokerParticipant(room, hash);
    if (room.closedAt === undefined && !participant) return new Response(null, { status: 403 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    if (participant) {
      server.serializeAttachment({ hash, participantId: participant.id, lastSeenAt: Date.now() } satisfies Attachment);
    }
    this.send(server, { type: 'room:snapshot', room: projectPokerRoom(room, hash) });
    if (room.closedAt !== undefined) server.close(1000, 'Room closed');
    else this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message !== 'ping') return;
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    const now = Date.now();
    if (now - attachment.lastSeenAt > LIVE_HEARTBEAT_TIMEOUT_MS) {
      socket.close(1001, 'Live connection timed out');
      this.broadcastPresence(socket);
      return;
    }
    socket.serializeAttachment({ ...attachment, lastSeenAt: now });
    this.send(socket, { type: 'heartbeat' });
    this.connections();
  }

  webSocketClose(socket: WebSocket): void {
    if (socket.readyState === WebSocket.CLOSING) socket.close();
    this.broadcastPresence(socket);
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, 'Live connection failed');
    this.broadcastPresence(socket);
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
    for (const { socket } of this.connections()) {
      this.send(socket, { type: 'room:missing' });
      socket.close(1000, 'Room expired');
    }
  }

  private connections(excluded?: WebSocket) {
    const active = [];
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excluded || socket.readyState !== WebSocket.OPEN) continue;
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (!attachment) continue;
      if (now - attachment.lastSeenAt > LIVE_HEARTBEAT_TIMEOUT_MS) {
        socket.close(1001, 'Live connection timed out');
        continue;
      }
      active.push({ socket, attachment });
    }
    return active;
  }

  private broadcastRoom(room: StoredPokerRoom): void {
    for (const { socket, attachment } of this.connections()) {
      this.send(socket, { type: 'room:snapshot', room: projectPokerRoom(room, attachment.hash) });
      if (room.closedAt !== undefined) {
        socket.serializeAttachment(null);
        socket.close(1000, 'Room closed');
      }
    }
  }

  private broadcastPresence(excluded?: WebSocket): void {
    const id = this.ctx.id.name;
    const room = id ? this.storage.snapshot(id) : null;
    if (!room || room.closedAt !== undefined) return;
    const active = this.connections(excluded);
    const online = [...new Set(active.map(({ attachment }) => attachment.participantId))];
    for (const { socket } of active) this.send(socket, { type: 'room:presence', online });
  }

  private send(socket: WebSocket, message: PokerLiveMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      socket.close(1011, 'Live delivery failed');
    }
  }
}
