import 'server-only';

import type { BoardEvent } from '../../lib/board-types';
import type {
  BoardMutationActor,
  BoardMutationCommand,
  BoardMutationOutcome,
  CreateBoardRecord,
  FacilitatorCapability,
  RawBoardMutationEvent,
  RawBoardSnapshot,
} from '../db/raw-types';

/**
 * Runtime-agnostic persistence seam (ADR-0002).
 * Implemented by Cloudflare SQLite Durable Objects (`CloudflareBoardStore` / `BoardRoom`)
 * and local Node SQLite (`NodeBoardStore`).
 */
export interface BoardStore {
  createBoard(record: CreateBoardRecord): Promise<RawBoardSnapshot>;
  getBoardSnapshot(
    boardId: string,
    now?: number,
  ): Promise<RawBoardSnapshot | null>;
  getBoardTokenSalt(boardId: string, now?: number): Promise<string | null>;
  getFacilitatorCapability(
    boardId: string,
    now?: number,
  ): Promise<FacilitatorCapability | null>;
  mutateBoard(
    boardId: string,
    actor: BoardMutationActor,
    command: BoardMutationCommand,
    now?: number,
  ): Promise<BoardMutationOutcome>;
  deleteBoard(boardId: string): Promise<boolean>;
  touchActivity(boardId: string, now?: number): Promise<void>;
  updateFacilitatorTokenEncryption(
    boardId: string,
    encryptedToken: string,
  ): Promise<void>;
}

export interface LiveViewerContext {
  participantHash: string;
  isFacilitator: boolean;
}

export type BoardPublication =
  | { snapshot: RawBoardSnapshot; events: readonly RawBoardMutationEvent[] }
  | Extract<BoardEvent, { type: 'board:deleted' }>;

/**
 * Runtime-agnostic live fan-out and presence seam (ADR-0002).
 * Implemented by Cloudflare Hibernatable WebSockets (`BoardRoom`) and Node SSE.
 */
export interface BoardRealtime {
  publish(boardId: string, publication: BoardPublication): Promise<void>;
  handleLiveConnection(
    boardId: string,
    request: Request,
    viewer: LiveViewerContext,
  ): Promise<Response>;
  getPresenceCount(boardId: string): Promise<number>;
  recordHeartbeat?(
    boardId: string,
    connectionId: string,
    viewer: LiveViewerContext,
  ): boolean;
}
