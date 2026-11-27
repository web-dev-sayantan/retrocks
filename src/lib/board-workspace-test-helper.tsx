import type { JSX } from '@solidjs/web';
import { usePrimitive } from '@ui-sdk/solid/primitive';
import type { Accessor } from 'solid-js';
import { vi } from 'vitest';

import {
  BoardWorkspaceContext,
  type BoardWorkspaceContextValue,
} from '../components/BoardWorkspaceContext';
import type { BoardMutations, WorkspaceVoting } from './board-controller';
import { makeBoardView } from './board-fixtures';
import { boardTransfer } from './board-transfer';
import type { BoardViewDTO, ColumnDTO } from './board-types';

type MaybeAccessor<T> = T | Accessor<T>;

function unwrap<T>(value: MaybeAccessor<T>): T {
  return typeof value === 'function' ? (value as Accessor<T>)() : value;
}

export type TestBoardMutations = {
  [K in keyof BoardMutations]: ReturnType<typeof vi.fn<BoardMutations[K]>>;
};

export function createTestBoardMutations(
  overrides?: Partial<BoardMutations>,
): TestBoardMutations {
  const ok = async () => ({ ok: true as const });
  const base: TestBoardMutations = {
    createCard: vi.fn<BoardMutations['createCard']>(ok),
    updateCard: vi.fn<BoardMutations['updateCard']>(ok),
    updateActionItem: vi.fn<BoardMutations['updateActionItem']>(ok),
    moveCard: vi.fn<BoardMutations['moveCard']>(ok),
    deleteCard: vi.fn<BoardMutations['deleteCard']>(ok),
    toggleReaction: vi.fn<BoardMutations['toggleReaction']>(ok),
    createComment: vi.fn<BoardMutations['createComment']>(ok),
    deleteComment: vi.fn<BoardMutations['deleteComment']>(ok),
    groupCard: vi.fn<BoardMutations['groupCard']>(ok),
    ungroupCard: vi.fn<BoardMutations['ungroupCard']>(ok),
    renameCardGroup: vi.fn<BoardMutations['renameCardGroup']>(ok),
    dissolveCardGroup: vi.fn<BoardMutations['dissolveCardGroup']>(ok),
    moveCardGroup: vi.fn<BoardMutations['moveCardGroup']>(ok),
    updateColumn: vi.fn<BoardMutations['updateColumn']>(ok),
    moveColumn: vi.fn<BoardMutations['moveColumn']>(ok),
    deleteColumn: vi.fn<BoardMutations['deleteColumn']>(ok),
    isActionItemPending: vi.fn<BoardMutations['isActionItemPending']>(() => false),
    isCardPending: vi.fn<BoardMutations['isCardPending']>(() => false),
    isGroupPending: vi.fn<BoardMutations['isGroupPending']>(() => false),
    isColumnPending: vi.fn<BoardMutations['isColumnPending']>(() => false),
    isCommentPending: vi.fn<BoardMutations['isCommentPending']>(() => false),
  };

  if (overrides) {
    Object.assign(base, overrides);
  }
  return base;
}

export interface TestBoardWorkspaceProps {
  children: JSX.Element;
  board?: MaybeAccessor<BoardViewDTO>;
  columns?: MaybeAccessor<readonly ColumnDTO[]>;
  voting?: MaybeAccessor<Partial<WorkspaceVoting>>;
  isFacilitator?: MaybeAccessor<boolean>;
  isLocked?: MaybeAccessor<boolean>;
  isBlurred?: MaybeAccessor<boolean>;
  blindVoting?: MaybeAccessor<boolean>;
  allowParticipantGroup?: MaybeAccessor<boolean>;
  nowMs?: MaybeAccessor<number>;
  actions?: Partial<BoardMutations>;
  openCardDetail?: (cardId: string, trigger: HTMLButtonElement) => void;
}

export function TestBoardWorkspace(props: TestBoardWorkspaceProps) {
  const fallbackBoard = makeBoardView();
  const fallbackActions = createTestBoardMutations();
  const fallbackVoteChange = vi.fn<WorkspaceVoting['onChange']>();
  const fallbackOpenCardDetail =
    vi.fn<(cardId: string, trigger: HTMLButtonElement) => void>();

  const resolveBoard = (): BoardViewDTO =>
    props.board !== undefined ? unwrap(props.board) : fallbackBoard;

  const transfer = usePrimitive(boardTransfer, () => ({
    lists: {},
    board: resolveBoard,
    commit: () => {},
    onRejectedDrop: () => {},
  }));

  const contextValue: BoardWorkspaceContextValue = {
    get columns() {
      return props.columns !== undefined
        ? unwrap(props.columns)
        : resolveBoard().columns;
    },
    get voting() {
      const board = resolveBoard();
      const override = props.voting !== undefined ? unwrap(props.voting) : undefined;
      return {
        remainingVotes:
          override?.remainingVotes !== undefined
            ? override.remainingVotes
            : board.remainingVotes,
        maxVotesPerCard:
          override?.maxVotesPerCard !== undefined
            ? override.maxVotesPerCard
            : board.maxVotesPerCard,
        pending: override?.pending ?? false,
        onChange: override?.onChange ?? fallbackVoteChange,
      };
    },
    get isFacilitator() {
      return props.isFacilitator !== undefined
        ? unwrap(props.isFacilitator)
        : resolveBoard().isFacilitator;
    },
    get isLocked() {
      return props.isLocked !== undefined
        ? unwrap(props.isLocked)
        : resolveBoard().isLocked;
    },
    get isBlurred() {
      return props.isBlurred !== undefined
        ? unwrap(props.isBlurred)
        : resolveBoard().isBlurred;
    },
    get blindVoting() {
      return props.blindVoting !== undefined
        ? unwrap(props.blindVoting)
        : resolveBoard().blindVoting;
    },
    get allowParticipantGroup() {
      return props.allowParticipantGroup !== undefined
        ? unwrap(props.allowParticipantGroup)
        : resolveBoard().allowParticipantGroup;
    },
    get nowMs() {
      return props.nowMs !== undefined ? unwrap(props.nowMs) : Date.now();
    },
    transfer,
    get actions() {
      return props.actions
        ? { ...fallbackActions, ...props.actions }
        : fallbackActions;
    },
    openCardDetail(cardId, trigger) {
      (props.openCardDetail ?? fallbackOpenCardDetail)(cardId, trigger);
    },
  };

  return (
    <BoardWorkspaceContext value={contextValue}>
      {props.children}
    </BoardWorkspaceContext>
  );
}
