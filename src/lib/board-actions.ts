import { query } from '@solidjs/router';
import { httpStatus, redirect, respond } from '@solidjs/web';

import { changeVote, resetVotes, updateVotingSettings } from './voting-actions';

import type {
  ActionError,
  BoardMutationResponse,
  BoardViewDTO,
} from './board-types';
import type {
  AddColumnInput,
  CreateBoardInput,
  CreateCardInput,
  DeleteCardInput,
  DeleteColumnInput,
  MoveCardInput,
  RenameBoardInput,
  ReorderColumnsInput,
  SetPrivateModeInput,
  UpdateCardInput,
  UpdateColumnInput,
  UpdateTimerInput,
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
      return {
        ok: false,
        code: error.code,
        message: error.message,
      };
    }
    throw error;
  }
}

export async function renameBoard(
  input: RenameBoardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, renameBoardForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await renameBoardForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function updateTimer(
  input: UpdateTimerInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, updateTimerForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await updateTimerForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function setPrivateMode(
  input: SetPrivateModeInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, setPrivateModeForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await setPrivateModeForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function createCard(
  input: CreateCardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, createCardForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await createCardForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function updateCard(
  input: UpdateCardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, updateCardForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await updateCardForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function moveCard(
  input: MoveCardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, moveCardForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await moveCardForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function deleteCard(
  input: DeleteCardInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, deleteCardForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await deleteCardForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function addColumn(
  input: AddColumnInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, addColumnForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await addColumnForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function updateColumn(
  input: UpdateColumnInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, updateColumnForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await updateColumnForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function reorderColumns(
  input: ReorderColumnsInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, reorderColumnsForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await reorderColumnsForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function deleteColumn(
  input: DeleteColumnInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { BoardDomainError, deleteColumnForRequest } = await import(
    '../server/services/board-service'
  );
  try {
    const result = await deleteColumnForRequest(input);
    return respond(result, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message },
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export interface BoardWorkspaceActions {
  changeVote: typeof changeVote;
  updateVotingSettings: typeof updateVotingSettings;
  resetVotes: typeof resetVotes;
  renameBoard: (input: RenameBoardInput) => Promise<BoardMutationResponse>;
  updateTimer: (input: UpdateTimerInput) => Promise<BoardMutationResponse>;
  setPrivateMode: (input: SetPrivateModeInput) => Promise<BoardMutationResponse>;
  createCard: (input: CreateCardInput) => Promise<BoardMutationResponse>;
  updateCard: (input: UpdateCardInput) => Promise<BoardMutationResponse>;
  moveCard: (input: MoveCardInput) => Promise<BoardMutationResponse>;
  deleteCard: (input: DeleteCardInput) => Promise<BoardMutationResponse>;
  addColumn: (input: AddColumnInput) => Promise<BoardMutationResponse>;
  updateColumn: (input: UpdateColumnInput) => Promise<BoardMutationResponse>;
  reorderColumns: (input: ReorderColumnsInput) => Promise<BoardMutationResponse>;
  deleteColumn: (input: DeleteColumnInput) => Promise<BoardMutationResponse>;
}

export const defaultBoardWorkspaceActions: BoardWorkspaceActions = {
  changeVote,
  updateVotingSettings,
  resetVotes,
  renameBoard,
  updateTimer,
  setPrivateMode,
  createCard,
  updateCard,
  moveCard,
  deleteCard,
  addColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
};
