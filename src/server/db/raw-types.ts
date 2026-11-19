import 'server-only';

import type {
  BoardErrorCode,
  BoardSettingsDTO,
  BoardTemplateId,
  ColumnAccent,
} from '../../lib/board-types';
import type { TimerChange } from '../../lib/schemas';

export interface RawBoardRow {
  id: string;
  title: string;
  subtitle: string;
  templateId: BoardTemplateId;
  facilitatorTokenHash: string;
  facilitatorTokenEncrypted: string;
  tokenSalt: string;
  isBlurred: boolean;
  blindVoting: boolean;
  isLocked: boolean;
  allowParticipantGroup: boolean;
  voteLimit: number | null;
  maxVotesPerCard: number | null;
  timerEndsAt: number | null;
  timerRemainingMs: number | null;
  timerDurationMs: number | null;
  version: number;
  retentionDays: number;
  createdAt: number;
  lastActiveAt: number;
}

export type FacilitatorCapability = Pick<
  RawBoardRow,
  'facilitatorTokenHash' | 'facilitatorTokenEncrypted'
>;

export interface RawColumnRow {
  id: string;
  boardId: string;
  title: string;
  accent: ColumnAccent;
  position: number;
  isActionColumn: boolean;
}

export interface RawCardGroupRow {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  createdAt: number;
}

export interface RawCardRow {
  id: string;
  boardId: string;
  columnId: string;
  groupId: string | null;
  content: string;
  authorTokenHash: string;
  isActionItem: boolean;
  actionDone: boolean;
  actionOwner: string;
  createdAt: number;
  updatedAt: number;
}

export interface RawVoteRow {
  boardId: string;
  targetType: 'card' | 'group';
  targetId: string;
  voterTokenHash: string;
  count: number;
  updatedAt: number;
}

export interface RawReactionRow {
  boardId: string;
  cardId: string;
  emoji: string;
  reactorTokenHash: string;
  createdAt: number;
}

export interface RawCommentRow {
  id: string;
  boardId: string;
  cardId: string;
  content: string;
  authorTokenHash: string;
  createdAt: number;
}

export interface RawBoardSnapshot {
  board: RawBoardRow;
  columns: RawColumnRow[];
  groups: RawCardGroupRow[];
  cards: RawCardRow[];
  votes: RawVoteRow[];
  reactions: RawReactionRow[];
  comments: RawCommentRow[];
}

export interface CreateBoardColumnRecord {
  id: string;
  title: string;
  accent: ColumnAccent;
  position: number;
  isActionColumn: boolean;
}

export interface CreateBoardRecord {
  id: string;
  title: string;
  subtitle: string;
  templateId: BoardTemplateId;
  facilitatorTokenHash: string;
  facilitatorTokenEncrypted: string;
  tokenSalt: string;
  isBlurred: boolean;
  voteLimit: number | null;
  maxVotesPerCard: number | null;
  retentionDays: number;
  createdAt: number;
  columns: CreateBoardColumnRecord[];
}

export interface BoardMutationActor {
  participantHash: string;
  isFacilitator: boolean;
}

export type BoardMutationCommand =
  | { type: 'facilitator:rotate'; capability: FacilitatorCapability }
  | { type: 'board:rename'; title: string; subtitle?: string }
  | { type: 'timer:update'; change: TimerChange }
  | { type: 'card:create'; id: string; columnId: string; content: string }
  | { type: 'card:update'; cardId: string; content: string }
  | { type: 'card:move'; cardId: string; targetColumnId: string }
  | { type: 'card:delete'; cardId: string }
  | {
      type: 'column:add';
      id: string;
      title: string;
      accent: ColumnAccent;
      isActionColumn: boolean;
    }
  | {
      type: 'column:update';
      columnId: string;
      title?: string;
      accent?: ColumnAccent;
      isActionColumn?: boolean;
    }
  | { type: 'column:reorder'; columnIds: string[] }
  | { type: 'column:delete'; columnId: string };

export type RawBoardMutationEvent =
  | { type: 'timer:updated'; version: number; serverNow: number }
  | {
      type: 'board:updated';
      version: number;
      patch: Partial<BoardSettingsDTO>;
    }
  | { type: 'card:upserted'; version: number; cardId: string }
  | { type: 'card:deleted'; version: number; cardId: string }
  | { type: 'column:upserted'; version: number; columnId: string }
  | { type: 'column:deleted'; version: number; columnId: string }
  | { type: 'columns:reordered'; version: number; columnIds: string[] }
  | { type: 'group:dissolved'; version: number; groupId: string };

export type BoardMutationOutcome =
  | {
      ok: true;
      version: number;
      lastActiveAt: number;
      retentionDays: number;
      snapshot: RawBoardSnapshot;
      rawEvents: RawBoardMutationEvent[];
    }
  | {
      ok: false;
      code: BoardErrorCode;
      message: string;
    };
