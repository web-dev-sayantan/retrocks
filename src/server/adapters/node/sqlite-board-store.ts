import 'server-only';

import type {
  BoardMutationActor,
  BoardMutationCommand,
  BoardMutationOutcome,
  CreateBoardRecord,
  FacilitatorCapability,
  RawBoardSnapshot,
} from '../../db/raw-types';
import { MS_PER_DAY, SqlBoardOperations } from '../../db/sql-board-operations';
import { checkBoardWriteRateLimit } from '../../rate-limit';
import type { BoardStore } from '../types';
import { openNodeDatabase, wrapDatabaseSync } from './sqlite';

export const DEFAULT_EXPIRY_SWEEP_INTERVAL_MS = MS_PER_DAY;

export interface CreateNodeBoardStoreOptions {
  /** Periodic inactivity cleanup interval in ms; pass `0` to disable. Defaults to 24 hours. */
  expirySweepIntervalMs?: number;
  /** Clock function used by startup and periodic expiry sweeps. */
  now?: () => number;
}

export interface NodeBoardStore extends BoardStore {
  purgeExpiredBoards(now?: number): number;
  close(): void;
}

/**
 * Node SQLite `BoardStore` backed by built-in `node:sqlite` (`DatabaseSync`).
 * Dynamically imports `node:sqlite` at runtime so Cloudflare Workers builds
 * never statically bundle Node-only SQLite bindings.
 */
export async function createNodeBoardStore(
  dbPath: string = ':memory:',
  options: CreateNodeBoardStoreOptions = {},
): Promise<NodeBoardStore> {
  const db = await openNodeDatabase(dbPath);
  const runner = wrapDatabaseSync(db);
  const ops = new SqlBoardOperations(runner);
  ops.ensureSchema();

  const clock = options.now ?? (() => Date.now());
  const sweepIntervalMs =
    options.expirySweepIntervalMs ?? DEFAULT_EXPIRY_SWEEP_INTERVAL_MS;
  ops.purgeExpiredBoards(clock());

  let closed = false;
  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  if (sweepIntervalMs > 0) {
    sweepTimer = setInterval(() => {
      if (closed) return;
      try {
        ops.purgeExpiredBoards(clock());
      } catch {
        // Ignore if the database was closed concurrently.
      }
    }, sweepIntervalMs);
    sweepTimer.unref?.();
  }

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
      if (closed) return;
      closed = true;
      if (sweepTimer !== undefined) {
        clearInterval(sweepTimer);
        sweepTimer = undefined;
      }
      db.close();
    },
  };
}
