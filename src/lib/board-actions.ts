import { query } from '@solidjs/router';
import { httpStatus, redirect, respond } from '@solidjs/web';

import { respondToBoardMutation } from './action-response';

import type {
  ActionError,
  BoardMutationResponse,
  BoardViewDTO,
} from './board-types';
import type {
  BoardCommand,
  CreateBoardInput,
  CreateCardInput,
  DeleteBoardInput,
  SetBoardLockInput,
} from './schemas';

/**
 * Loads a viewer-projected Board snapshot for `/b/:id`.
 * Lazily mints the anonymous Participant cookie if absent; sets HTTP 404
 * when the Board does not exist or has expired.
 */
export const getBoard = query(
  async (boardId: string): Promise<BoardViewDTO | null> => {
    'use server';
    const { getBoardForRequest } = await import(
      '../server/services/board-service'
    );
    const board = await getBoardForRequest(boardId);
    if (!board) {
      httpStatus(404);
      return null;
    }
    return board;
  },
  'board',
);

/**
 * Creates a Board, persists its Columns, grants the signed `HttpOnly`
 * Facilitator cookie, and redirects to `/b/:boardId`.
 * Returns a typed `ActionError` on validation or rate-limit failures.
 */
export async function createBoard(
  input: CreateBoardInput,
): Promise<ActionError> {
  'use server';
  const { BoardDomainError, createBoardForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const board = await createBoardForRequest(input);
    return redirect(`/b/${board.id}`);
  } catch (error) {
    if (error instanceof BoardDomainError) {
      httpStatus(error.status);
      return respond(
        {
          ok: false,
          code: error.code,
          message: error.message,
        },
        { status: error.status },
      );
    }
    throw error;
  }
}

export async function dispatchBoardCommand(
  boardId: string,
  command: BoardCommand,
): Promise<BoardMutationResponse> {
  'use server';
  const { dispatchBoardCommandForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() =>
    dispatchBoardCommandForRequest(boardId, command),
  );
}

export async function setBoardLock(
  input: SetBoardLockInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { setBoardLockForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => setBoardLockForRequest(input));
}

export async function deleteBoard(
  input: DeleteBoardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { deleteBoardForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => deleteBoardForRequest(input));
}

export async function createCard(
  input: CreateCardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { createCardForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => createCardForRequest(input));
}
