import { query } from '@solidjs/router';
import { httpStatus, redirect } from '@solidjs/web';

import type { ActionError, BoardViewDTO } from './board-types';
import type { CreateBoardInput } from './schemas';

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
      return {
        ok: false,
        code: error.code,
        message: error.message,
      };
    }
    throw error;
  }
}
