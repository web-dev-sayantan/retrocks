import 'server-only';

import type {
  BoardMutationActor,
  BoardMutationCommand,
  BoardMutationOutcome,
  CreateBoardRecord,
  FacilitatorCapability,
  RawBoardSnapshot,
} from '../../db/raw-types';
import { LIVE_FACILITATOR_HEADER, LIVE_PARTICIPANT_HEADER } from '../../live/headers';
import type { BoardPublication, BoardRealtime, BoardStore } from '../types';

export interface BoardRoomRpcStub {
  publishLive(publication: BoardPublication): Promise<void>;
  getPresenceCount(): Promise<number>;
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
    getBoardTokenSalt(boardId: string, now?: number): Promise<string | null> {
      return stubFor(boardId).getBoardTokenSalt(boardId, now);
    },
    getFacilitatorCapability(
      boardId: string,
      now?: number,
    ): Promise<FacilitatorCapability | null> {
      return stubFor(boardId).getFacilitatorCapability(boardId, now);
    },
    mutateBoard(
      boardId: string,
      actor: BoardMutationActor,
      command: BoardMutationCommand,
      now?: number,
    ): Promise<BoardMutationOutcome> {
      return stubFor(boardId).mutateBoard(boardId, actor, command, now);
    },
    deleteBoard(boardId: string): Promise<boolean> {
      return stubFor(boardId).deleteBoard(boardId);
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

export function createCloudflareBoardRealtime(namespace: DurableObjectNamespace): BoardRealtime {
  function stubFor(boardId: string) {
    return namespace.get(namespace.idFromName(boardId)) as DurableObjectStub & BoardRoomRpcStub;
  }

  return {
    publish(boardId, publication) {
      return stubFor(boardId).publishLive(publication);
    },
    async handleLiveConnection(boardId, request, viewer) {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response(null, { status: 426, headers: { upgrade: 'websocket' } });
      }
      const headers = new Headers(request.headers);
      headers.delete('cookie');
      headers.set(LIVE_PARTICIPANT_HEADER, viewer.participantHash);
      headers.set(LIVE_FACILITATOR_HEADER, String(viewer.isFacilitator));
      return stubFor(boardId).fetch(new Request(request.url, { headers }));
    },
    getPresenceCount(boardId) {
      return stubFor(boardId).getPresenceCount();
    },
  };
}
