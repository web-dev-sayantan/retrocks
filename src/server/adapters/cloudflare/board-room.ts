import { DurableObject } from 'cloudflare:workers';

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
 * automatic inactivity expiry alarm, and Hibernatable WebSockets (Issue #5).
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

  async fetch(_request: Request): Promise<Response> {
    return new Response('Live WebSocket endpoint not yet enabled', {
      status: 501,
    });
  }
}
