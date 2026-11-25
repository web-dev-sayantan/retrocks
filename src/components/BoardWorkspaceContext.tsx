import { createContext, useContext } from 'solid-js';

import type { BoardMutations, WorkspaceVoting } from '../lib/board-controller';
import type { BoardTransferHandle } from '../lib/board-transfer';
import type { ColumnDTO } from '../lib/board-types';

/**
 * Ambient Board workspace state shared across Column panels, Card Groups,
 * Cards, and drawers. Ambient values are exposed as reactive getters so
 * consumers track fine-grained updates without prop drilling or remounting.
 */
export interface BoardWorkspaceContextValue {
  readonly columns: readonly ColumnDTO[];
  readonly voting: WorkspaceVoting;
  readonly isFacilitator: boolean;
  readonly isLocked: boolean;
  readonly isBlurred: boolean;
  readonly blindVoting: boolean;
  readonly canGroupCards: boolean;
  readonly nowMs: number;
  readonly transfer: BoardTransferHandle;
  readonly actions: BoardMutations;
  readonly openCardDetail: (cardId: string, trigger: HTMLButtonElement) => void;
}

export const BoardWorkspaceContext =
  createContext<BoardWorkspaceContextValue | null>(null);

export function useBoardWorkspace(): BoardWorkspaceContextValue {
  const context = useContext(BoardWorkspaceContext);
  if (!context) {
    throw new Error(
      'useBoardWorkspace must be used within a BoardWorkspaceContext provider.',
    );
  }
  return context;
}
