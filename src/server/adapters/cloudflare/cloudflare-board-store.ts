import 'server-only';

import type { CreateBoardRecord, RawBoardSnapshot } from '../../db/raw-types';
import type { BoardStore } from '../types';

export interface BoardRoomRpcStub {
  createBoard(record: CreateBoardRecord): Promise<RawBoardSnapshot>;
  getBoardSnapshot(
    boardId: string,
    now?: number,
  ): Promise<RawBoardSnapshot | null>;
  deleteBoard(boardId: string): Promise<boolean>;
  touchActivity(boardId: string, now?: number): Promise<void>;
  updateFacilitatorTokenEncryption(
    boardId: string,
    encryptedToken: string,
  ): Promise<void>;
}

/**
 * Worker-side `BoardStore` delegating each Board's persistence calls to its
 * dedicated `BoardRoom` SQLite Durable Object via `idFromName(boardId)`.
 */
export function createCloudflareBoardStore(
  namespace: DurableObjectNamespace,
): BoardStore {
  function stubFor(boardId: string): BoardRoomRpcStub {
    const id = namespace.idFromName(boardId);
    return namespace.get(id) as unknown as BoardRoomRpcStub;
  }

  return {
    createBoard(record: CreateBoardRecord): Promise<RawBoardSnapshot> {
      return stubFor(record.id).createBoard(record);
    },
    getBoardSnapshot(
      boardId: string,
      now?: number,
    ): Promise<RawBoardSnapshot | null> {
      return stubFor(boardId).getBoardSnapshot(boardId, now);
    },
    deleteBoard(boardId: string): Promise<boolean> {
      return stubFor(boardId).deleteBoard(boardId);
    },
    touchActivity(boardId: string, now?: number): Promise<void> {
      return stubFor(boardId).touchActivity(boardId, now);
    },
    updateFacilitatorTokenEncryption(
      boardId: string,
      encryptedToken: string,
    ): Promise<void> {
      return stubFor(boardId).updateFacilitatorTokenEncryption(
        boardId,
        encryptedToken,
      );
    },
  };
}
