import 'server-only';

import type { BoardTemplateId, ColumnAccent } from '../../lib/board-types';

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
