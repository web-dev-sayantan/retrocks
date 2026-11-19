import { DurableObject } from 'cloudflare:workers';

import { LIVE_HEARTBEAT_TIMEOUT_MS, type BoardLiveMessage } from '../../../lib/board-live-protocol';

import type {
  BoardMutationActor,
  BoardMutationCommand,
  BoardMutationOutcome,
  CreateBoardRecord,
  FacilitatorCapability,
  RawBoardSnapshot,
} from '../../db/raw-types';
import {
  SqlBoardOperations,
  computeBoardExpiryAt,
  isBoardExpired,
} from '../../db/sql-board-operations';
import type { SqlParam, SqlRunResult, SqlRunner } from '../../db/sql-runner';
import {
  createBoardWriteRateLimiter,
  type BoardWriteRateLimiter,
} from '../../rate-limit';

import { projectLivePublication, projectLiveSnapshot } from '../../domain/live-projection';
import type { BoardPublication, LiveViewerContext } from '../types';
import { LIVE_FACILITATOR_HEADER, LIVE_PARTICIPANT_HEADER } from './cloudflare-board-store';

interface LiveAttachment extends LiveViewerContext {
  lastSeenAt: number;
}

function wrapDurableObjectSql(storage: DurableObjectStorage): SqlRunner {
  const sql = storage.sql;

  return {
    exec(query: string): void {
      sql.exec(query);
    },
    run(query: string, ...params: SqlParam[]): SqlRunResult {
      const cursor = sql.exec(query, ...params);
      return { changes: cursor.rowsWritten };
    },
    get<T extends Record<string, unknown>>(
      query: string,
      ...params: SqlParam[]
    ): T | undefined {
      const rows = sql.exec(query, ...params).toArray();
      return rows[0] as T | undefined;
    },
    all<T extends Record<string, unknown>>(
      query: string,
      ...params: SqlParam[]
    ): T[] {
      return sql.exec(query, ...params).toArray() as T[];
    },
    transaction<T>(fn: () => T): T {
      return storage.transactionSync(fn);
    },
  };
}

/**
 * SQLite-backed Cloudflare Durable Object managing one Board's serialized state,
 * automatic inactivity expiry alarm, and Hibernatable WebSockets.
 */
export class BoardRoom extends DurableObject<Cloudflare.Env> {
  private readonly ops: SqlBoardOperations;
  private readonly writeLimiter: BoardWriteRateLimiter;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ops = new SqlBoardOperations(wrapDurableObjectSql(ctx.storage));
    this.writeLimiter = createBoardWriteRateLimiter();
  }

  async createBoard(record: CreateBoardRecord): Promise<RawBoardSnapshot> {
    const snapshot = this.ops.createBoard(record);
    await this.ctx.storage.setAlarm(
      computeBoardExpiryAt(snapshot.board.lastActiveAt, snapshot.board.retentionDays),
    );
    return snapshot;
  }

  async getBoardSnapshot(
    boardId: string,
    now?: number,
  ): Promise<RawBoardSnapshot | null> {
    const snapshot = this.ops.getBoardSnapshot(boardId, now);
    if (!snapshot) {
      return null;
    }
    return snapshot;
  }

  async getBoardTokenSalt(
    boardId: string,
    now?: number,
  ): Promise<string | null> {
    return this.ops.getBoardTokenSalt(boardId, now);
  }

  async getFacilitatorCapability(
    boardId: string,
    now?: number,
  ): Promise<FacilitatorCapability | null> {
    return this.ops.getFacilitatorCapability(boardId, now);
  }

  async mutateBoard(
    boardId: string,
    actor: BoardMutationActor,
    command: BoardMutationCommand,
    now: number = Date.now(),
  ): Promise<BoardMutationOutcome> {
    const limit = this.writeLimiter.check(boardId, actor.participantHash, now);
    if (!limit.allowed) {
      return {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many changes in a short period. Please slow down.',
      };
    }

    const outcome = this.ops.mutateBoard(boardId, actor, command, now);
    if (outcome.ok) {
      await this.ctx.storage.setAlarm(
        computeBoardExpiryAt(outcome.lastActiveAt, outcome.retentionDays),
      );
    }
    return outcome;
  }

  async deleteBoard(boardId: string): Promise<boolean> {
    const deleted = this.ops.deleteBoard(boardId);
    if (deleted) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
    }
    return deleted;
  }

  async touchActivity(boardId: string, now: number = Date.now()): Promise<void> {
    const updated = this.ops.touchActivity(boardId, now);
    if (updated) {
      await this.ctx.storage.setAlarm(
        computeBoardExpiryAt(updated.lastActiveAt, updated.retentionDays),
      );
    }
  }

  async updateFacilitatorTokenEncryption(
    boardId: string,
    encryptedToken: string,
  ): Promise<void> {
    this.ops.updateFacilitatorTokenEncryption(boardId, encryptedToken);
  }

  async alarm(): Promise<void> {
    this.ops.ensureSchema();
    const row = this.ctx.storage.sql
      .exec('SELECT id, last_active_at, retention_days FROM boards LIMIT 1')
      .toArray()[0] as
      | { id: string; last_active_at: number; retention_days: number }
      | undefined;

    if (!row) {
      return;
    }

    const now = Date.now();
    if (
      isBoardExpired(
        {
          lastActiveAt: row.last_active_at,
          retentionDays: row.retention_days,
        },
        now,
      )
    ) {
      await this.ctx.storage.deleteAll();
    } else {
      await this.ctx.storage.setAlarm(
        computeBoardExpiryAt(row.last_active_at, row.retention_days),
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 426 });
    }
    // The Worker seals identity at the cookie-authenticated public entry point.
    const participantHash = request.headers.get(LIVE_PARTICIPANT_HEADER);
    if (!participantHash) return new Response(null, { status: 401 });

    const boardId = this.ctx.id.name;
    const snapshot = boardId ? this.ops.getBoardSnapshot(boardId) : null;
    if (!snapshot) return new Response(null, { status: 404 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const viewer: LiveAttachment = {
      participantHash,
      isFacilitator: request.headers.get(LIVE_FACILITATOR_HEADER) === 'true',
      lastSeenAt: Date.now(),
    };
    server.serializeAttachment(viewer);
    this.sendLive(server, projectLiveSnapshot(snapshot, viewer));
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async publishLive(publication: BoardPublication): Promise<void> {
    const connections = this.liveConnections();
    if (connections.length === 0) return;
    if ('snapshot' in publication) {
      const { id, version } = publication.snapshot.board;
      // Concurrent RPCs can arrive after a newer write, including a privacy change.
      if (this.ops.getBoardVersion(id) !== version) return;
    }
    for (const { socket, viewer } of connections) {
      this.sendLive(socket, projectLivePublication(publication, viewer));
    }
  }

  async getPresenceCount(): Promise<number> {
    return new Set(this.liveConnections().map(({ viewer }) => viewer.participantHash)).size;
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message !== 'ping') return;
    const viewer = socket.deserializeAttachment() as LiveAttachment;
    const now = Date.now();
    if (now - viewer.lastSeenAt > LIVE_HEARTBEAT_TIMEOUT_MS) {
      socket.close(1001, 'Live connection timed out');
      this.broadcastPresence(socket);
      return;
    }
    socket.serializeAttachment({ ...viewer, lastSeenAt: now });
    this.sendLive(socket, { type: 'heartbeat' });
    // Active Clients' heartbeats prune stale peers, including after hibernation.
    this.liveConnections();
  }

  webSocketClose(socket: WebSocket): void {
    this.broadcastPresence(socket);
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, 'Live connection failed');
    this.broadcastPresence(socket);
  }

  private liveConnections(excluded?: WebSocket) {
    const active = [];
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excluded || socket.readyState !== WebSocket.OPEN) continue;
      const viewer = socket.deserializeAttachment() as LiveAttachment;
      if (now - viewer.lastSeenAt > LIVE_HEARTBEAT_TIMEOUT_MS) {
        socket.close(1001, 'Live connection timed out');
        continue;
      }
      active.push({ socket, viewer });
    }
    return active;
  }

  private broadcastPresence(excluded?: WebSocket): void {
    const active = this.liveConnections(excluded);
    const count = new Set(active.map(({ viewer }) => viewer.participantHash)).size;
    for (const { socket } of active) this.sendLive(socket, { type: 'presence:count', count });
  }

  private sendLive(socket: WebSocket, message: BoardLiveMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      socket.close(1011, 'Live delivery failed');
    }
  }
}
