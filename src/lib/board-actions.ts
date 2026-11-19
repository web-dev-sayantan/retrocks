import { query } from '@solidjs/router';
import { httpStatus, redirect, respond } from '@solidjs/web';

import { changeVote, resetVotes, updateVotingSettings } from './voting-actions';

import type {
  ActionError,
  BoardMutationResponse,
  BoardMutationSuccess,
  BoardViewDTO,
} from './board-types';
import type {
  AddColumnInput,
  CreateBoardInput,
  CreateCardInput,
  CreateCommentInput,
  DeleteBoardInput,
  DeleteCardInput,
  DeleteColumnInput,
  DeleteCommentInput,
  DissolveCardGroupInput,
  GroupCardsInput,
  MoveCardGroupInput,
  MoveCardInput,
  RenameBoardInput,
  RenameCardGroupInput,
  ReorderColumnsInput,
  SetBoardLockInput,
  SetPrivateModeInput,
  ToggleReactionInput,
  UngroupCardInput,
  UpdateActionItemInput,
  UpdateCardInput,
  UpdateColumnInput,
  UpdateTimerInput,
} from './schemas';

async function respondToBoardMutation(
  run: () => Promise<BoardMutationSuccess>,
): Promise<BoardMutationResponse> {
  const { BoardDomainError } = await import('../server/services/board-service');
  try {
    return respond(await run(), { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      httpStatus(error.status);
      return respond(
        { ok: false, code: error.code, message: error.message },
        { status: error.status, revalidate: [] },
      );
    }
    throw error;
  }
}

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

export async function renameBoard(
  input: RenameBoardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { renameBoardForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => renameBoardForRequest(input));
}

export async function updateTimer(
  input: UpdateTimerInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { updateTimerForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => updateTimerForRequest(input));
}

export async function setPrivateMode(
  input: SetPrivateModeInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { setPrivateModeForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => setPrivateModeForRequest(input));
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

export async function updateCard(
  input: UpdateCardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { updateCardForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => updateCardForRequest(input));
}

export async function updateActionItem(
  input: UpdateActionItemInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { updateActionItemForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => updateActionItemForRequest(input));
}

export async function moveCard(
  input: MoveCardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { moveCardForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => moveCardForRequest(input));
}

export async function deleteCard(
  input: DeleteCardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { deleteCardForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => deleteCardForRequest(input));
}

export async function toggleReaction(
  input: ToggleReactionInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { toggleReactionForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => toggleReactionForRequest(input));
}

export async function createComment(
  input: CreateCommentInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { createCommentForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => createCommentForRequest(input));
}

export async function deleteComment(
  input: DeleteCommentInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { deleteCommentForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => deleteCommentForRequest(input));
}

export async function addColumn(
  input: AddColumnInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { addColumnForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => addColumnForRequest(input));
}

export async function updateColumn(
  input: UpdateColumnInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { updateColumnForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => updateColumnForRequest(input));
}

export async function reorderColumns(
  input: ReorderColumnsInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { reorderColumnsForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => reorderColumnsForRequest(input));
}

export async function deleteColumn(
  input: DeleteColumnInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { deleteColumnForRequest } = await import(
    '../server/services/board-service'
  );
  return respondToBoardMutation(() => deleteColumnForRequest(input));
}

export async function groupCards(
  input: GroupCardsInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { groupCardsForRequest } = await import(
    '../server/services/grouping-service'
  );
  return respondToBoardMutation(() => groupCardsForRequest(input));
}

export async function renameCardGroup(
  input: RenameCardGroupInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { renameCardGroupForRequest } = await import(
    '../server/services/grouping-service'
  );
  return respondToBoardMutation(() => renameCardGroupForRequest(input));
}

export async function ungroupCard(
  input: UngroupCardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { ungroupCardForRequest } = await import(
    '../server/services/grouping-service'
  );
  return respondToBoardMutation(() => ungroupCardForRequest(input));
}

export async function dissolveCardGroup(
  input: DissolveCardGroupInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { dissolveCardGroupForRequest } = await import(
    '../server/services/grouping-service'
  );
  return respondToBoardMutation(() => dissolveCardGroupForRequest(input));
}

export async function moveCardGroup(
  input: MoveCardGroupInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { moveCardGroupForRequest } = await import(
    '../server/services/grouping-service'
  );
  return respondToBoardMutation(() => moveCardGroupForRequest(input));
}

export interface BoardWorkspaceActions {
  changeVote: typeof changeVote;
  updateVotingSettings: typeof updateVotingSettings;
  resetVotes: typeof resetVotes;
  renameBoard: (input: RenameBoardInput) => Promise<BoardMutationResponse>;
  updateTimer: (input: UpdateTimerInput) => Promise<BoardMutationResponse>;
  setPrivateMode: (input: SetPrivateModeInput) => Promise<BoardMutationResponse>;
  setBoardLock: (input: SetBoardLockInput) => Promise<BoardMutationResponse>;
  deleteBoard: (input: DeleteBoardInput) => Promise<BoardMutationResponse>;
  createCard: (input: CreateCardInput) => Promise<BoardMutationResponse>;
  updateCard: (input: UpdateCardInput) => Promise<BoardMutationResponse>;
  updateActionItem: (
    input: UpdateActionItemInput,
  ) => Promise<BoardMutationResponse>;
  moveCard: (input: MoveCardInput) => Promise<BoardMutationResponse>;
  deleteCard: (input: DeleteCardInput) => Promise<BoardMutationResponse>;
  toggleReaction: (input: ToggleReactionInput) => Promise<BoardMutationResponse>;
  createComment: (input: CreateCommentInput) => Promise<BoardMutationResponse>;
  deleteComment: (input: DeleteCommentInput) => Promise<BoardMutationResponse>;
  addColumn: (input: AddColumnInput) => Promise<BoardMutationResponse>;
  updateColumn: (input: UpdateColumnInput) => Promise<BoardMutationResponse>;
  reorderColumns: (input: ReorderColumnsInput) => Promise<BoardMutationResponse>;
  deleteColumn: (input: DeleteColumnInput) => Promise<BoardMutationResponse>;
  groupCards: (input: GroupCardsInput) => Promise<BoardMutationResponse>;
  renameCardGroup: (input: RenameCardGroupInput) => Promise<BoardMutationResponse>;
  ungroupCard: (input: UngroupCardInput) => Promise<BoardMutationResponse>;
  dissolveCardGroup: (input: DissolveCardGroupInput) => Promise<BoardMutationResponse>;
  moveCardGroup: (input: MoveCardGroupInput) => Promise<BoardMutationResponse>;
}

export const defaultBoardWorkspaceActions: BoardWorkspaceActions = {
  changeVote,
  updateVotingSettings,
  resetVotes,
  renameBoard,
  updateTimer,
  setPrivateMode,
  setBoardLock,
  deleteBoard,
  createCard,
  updateCard,
  updateActionItem,
  moveCard,
  deleteCard,
  toggleReaction,
  createComment,
  deleteComment,
  addColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
  groupCards,
  renameCardGroup,
  ungroupCard,
  dissolveCardGroup,
  moveCardGroup,
};
