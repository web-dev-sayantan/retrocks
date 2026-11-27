import { DurableObject } from 'cloudflare:workers';

import type { BoardLiveMessage } from '../../../lib/board-live-protocol';

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
import {
  createBoardWriteRateLimiter,
  type BoardWriteRateLimiter,
} from '../../rate-limit';

import { projectLivePublication, projectLiveSnapshot } from '../../domain/live-projection';
import {
  createDurableObjectWebSocketHub,
  type DurableObjectWebSocketHub,
} from '../../live/cloudflare-ws-hub';
import { LIVE_FACILITATOR_HEADER, LIVE_PARTICIPANT_HEADER } from '../../live/headers';
import type { BoardPublication, LiveViewerContext } from '../types';

import { wrapDurableObjectSql } from './sqlite';

/**
 * SQLite-backed Cloudflare Durable Object managing one Board's serialized state,
 * automatic inactivity expiry alarm, and Hibernatable WebSockets.
 */
export class BoardRoom extends DurableObject<Cloudflare.Env> {
  private readonly ops: SqlBoardOperations;
  private readonly writeLimiter: BoardWriteRateLimiter;
  private readonly live: DurableObjectWebSocketHub<LiveViewerContext, BoardLiveMessage>;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ops = new SqlBoardOperations(wrapDurableObjectSql(ctx.storage));
    this.writeLimiter = createBoardWriteRateLimiter();
    this.live = createDurableObjectWebSocketHub<
      LiveViewerContext,
      LiveViewerContext,
      BoardLiveMessage
    >(ctx, {
      parseIdentity(request) {
        // The Worker seals identity at the cookie-authenticated public entry point.
        const participantHash = request.headers.get(LIVE_PARTICIPANT_HEADER)?.trim();
        if (!participantHash) return null;
        return {
          participantHash,
          isFacilitator: request.headers.get(LIVE_FACILITATOR_HEADER) === 'true',
        };
      },
      onConnect: (viewer) => {
        const boardId = this.ctx.id.name;
        const snapshot = boardId ? this.ops.getBoardSnapshot(boardId) : null;
        if (!snapshot) return { type: 'reject', status: 404 };
        return {
          type: 'accept',
          viewer,
          initialMessage: projectLiveSnapshot(snapshot, viewer),
        };
      },
      createPresenceMessage(viewers) {
        return {
          type: 'presence:count',
          count: new Set(viewers.map((viewer) => viewer.participantHash)).size,
        };
      },
    });
  }

  private async wipeStorage(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.ops.resetSchemaState();
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
    const hadTable = this.ops.hasBoardsTable();
    const snapshot = this.ops.getBoardSnapshot(boardId, now);
    if (!snapshot) {
      if (hadTable) {
        await this.wipeStorage();
      }
      return null;
    }
    return snapshot;
  }

  async getBoardTokenSalt(
    boardId: string,
    now?: number,
  ): Promise<string | null> {
    const hadTable = this.ops.hasBoardsTable();
    const salt = this.ops.getBoardTokenSalt(boardId, now);
    if (salt === null && hadTable) {
      await this.wipeStorage();
    }
    return salt;
  }

  async getFacilitatorCapability(
    boardId: string,
    now?: number,
  ): Promise<FacilitatorCapability | null> {
    const hadTable = this.ops.hasBoardsTable();
    const capability = this.ops.getFacilitatorCapability(boardId, now);
    if (!capability && hadTable) {
      await this.wipeStorage();
    }
    return capability;
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

    const hadTable = this.ops.hasBoardsTable();
    const outcome = this.ops.mutateBoard(boardId, actor, command, now);
    if (outcome.ok) {
      await this.ctx.storage.setAlarm(
        computeBoardExpiryAt(outcome.lastActiveAt, outcome.retentionDays),
      );
    } else if (outcome.code === 'BOARD_NOT_FOUND' && hadTable) {
      await this.wipeStorage();
    }
    return outcome;
  }

  async deleteBoard(boardId: string): Promise<boolean> {
    const deleted = this.ops.deleteBoard(boardId);
    if (deleted) {
      await this.wipeStorage();
    }
    return deleted;
  }

  async updateFacilitatorTokenEncryption(
    boardId: string,
    encryptedToken: string,
  ): Promise<void> {
    this.ops.updateFacilitatorTokenEncryption(boardId, encryptedToken);
  }

  async alarm(): Promise<void> {
    if (!this.ops.hasBoardsTable()) {
      return;
    }
    const row = this.ctx.storage.sql
      .exec('SELECT id, version, last_active_at, retention_days FROM boards LIMIT 1')
      .toArray()[0] as
      | { id: string; version: number; last_active_at: number; retention_days: number }
      | undefined;

    if (!row) {
      await this.wipeStorage();
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
      this.live.closeAll({ type: 'board:deleted', version: row.version + 1 }, 'Board expired');
      await this.wipeStorage();
    } else {
      await this.ctx.storage.setAlarm(
        computeBoardExpiryAt(row.last_active_at, row.retention_days),
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    return this.live.fetch(request);
  }

  async publishLive(publication: BoardPublication): Promise<void> {
    const isDeleted = !('snapshot' in publication) && publication.type === 'board:deleted';
    this.live.publish(
      (viewer) => projectLivePublication(publication, viewer),
      {
        shouldPublish: 'snapshot' in publication
          ? () => {
              const { id, version } = publication.snapshot.board;
              // Concurrent RPCs can arrive after a newer write, including a privacy change.
              return this.ops.getBoardVersion(id) === version;
            }
          : undefined,
        closeReason: isDeleted ? 'Board deleted' : undefined,
      },
    );
  }

  async getPresenceCount(): Promise<number> {
    return new Set(this.live.getActiveViewers().map((viewer) => viewer.participantHash)).size;
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
}
