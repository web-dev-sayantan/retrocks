import 'server-only';

import type {
  BoardMutationActor,
  BoardMutationCommand,
  BoardMutationOutcome,
  CreateBoardRecord,
  FacilitatorCapability,
  RawBoardSnapshot,
} from '../../db/raw-types';
import { SqlBoardOperations } from '../../db/sql-board-operations';
import type { SqlParam, SqlRunResult, SqlRunner } from '../../db/sql-runner';
import { checkBoardWriteRateLimit } from '../../rate-limit';
import type { BoardStore } from '../types';

interface NodeStatementSync {
  run(...params: SqlParam[]): { changes: number | bigint };
  get(...params: SqlParam[]): Record<string, unknown> | undefined;
  all(...params: SqlParam[]): Record<string, unknown>[];
}

interface NodeDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): NodeStatementSync;
  close(): void;
}

export interface NodeBoardStore extends BoardStore {
  purgeExpiredBoards(now?: number): number;
  close(): void;
}

function wrapDatabaseSync(db: NodeDatabaseSync): SqlRunner {
  let inTransaction = false;

  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    run(sql: string, ...params: SqlParam[]): SqlRunResult {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    get<T extends Record<string, unknown>>(
      sql: string,
      ...params: SqlParam[]
    ): T | undefined {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    all<T extends Record<string, unknown>>(
      sql: string,
      ...params: SqlParam[]
    ): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    transaction<T>(fn: () => T): T {
      if (inTransaction) {
        return fn();
      }
      inTransaction = true;
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  };
}

/**
 * Node SQLite `BoardStore` backed by built-in `node:sqlite` (`DatabaseSync`).
 * Dynamically imports `node:sqlite` at runtime so Cloudflare Workers builds
 * never statically bundle Node-only SQLite bindings.
 */
export async function createNodeBoardStore(
  dbPath: string = ':memory:',
): Promise<NodeBoardStore> {
  if (dbPath !== ':memory:') {
    const fsSpecifier = 'node:fs';
    const pathSpecifier = 'node:path';
    const [{ mkdirSync }, { dirname }] = (await Promise.all([
      import(/* @vite-ignore */ fsSpecifier),
      import(/* @vite-ignore */ pathSpecifier),
    ])) as [
      { mkdirSync: (path: string, opts: { recursive: boolean }) => void },
      { dirname: (path: string) => string },
    ];
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqliteSpecifier = 'node:sqlite';
  const { DatabaseSync } = (await import(
    /* @vite-ignore */ sqliteSpecifier
  )) as {
    DatabaseSync: new (location: string) => NodeDatabaseSync;
  };

  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA foreign_keys = ON');

  const runner = wrapDatabaseSync(db);
  const ops = new SqlBoardOperations(runner);
  ops.ensureSchema();

  return {
    async createBoard(record: CreateBoardRecord): Promise<RawBoardSnapshot> {
      return ops.createBoard(record);
    },
    async getBoardSnapshot(
      boardId: string,
      now?: number,
    ): Promise<RawBoardSnapshot | null> {
      return ops.getBoardSnapshot(boardId, now);
    },
    async getBoardTokenSalt(
      boardId: string,
      now?: number,
    ): Promise<string | null> {
      return ops.getBoardTokenSalt(boardId, now);
    },
    async getFacilitatorCapability(
      boardId: string,
      now?: number,
    ): Promise<FacilitatorCapability | null> {
      return ops.getFacilitatorCapability(boardId, now);
    },
    async mutateBoard(
      boardId: string,
      actor: BoardMutationActor,
      command: BoardMutationCommand,
      now: number = Date.now(),
    ): Promise<BoardMutationOutcome> {
      const limit = checkBoardWriteRateLimit(
        boardId,
        actor.participantHash,
        now,
      );
      if (!limit.allowed) {
        return {
          ok: false,
          code: 'RATE_LIMITED',
          message: 'Too many changes in a short period. Please slow down.',
        };
      }
      return ops.mutateBoard(boardId, actor, command, now);
    },
    async deleteBoard(boardId: string): Promise<boolean> {
      return ops.deleteBoard(boardId);
    },
    async touchActivity(boardId: string, now?: number): Promise<void> {
      ops.touchActivity(boardId, now);
    },
    async updateFacilitatorTokenEncryption(
      boardId: string,
      encryptedToken: string,
    ): Promise<void> {
      ops.updateFacilitatorTokenEncryption(boardId, encryptedToken);
    },
    purgeExpiredBoards(now?: number): number {
      return ops.purgeExpiredBoards(now);
    },
    close(): void {
      db.close();
    },
  };
}
