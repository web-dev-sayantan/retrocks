export const COLUMN_ACCENTS = [
  'slate',
  'sage',
  'sky',
  'amber',
  'rose',
  'violet',
  'teal',
  'coral',
] as const;

export type ColumnAccent = (typeof COLUMN_ACCENTS)[number];

export const BOARD_TEMPLATE_IDS = [
  'standard',
  'start-stop-continue',
  'mad-sad-glad',
  '4ls',
  'starfish',
  'sailboat',
  'six-thinking-hats',
  'pros-cons',
  'custom',
] as const;

export type BoardTemplateId = (typeof BOARD_TEMPLATE_IDS)[number];

export const VOTE_LIMIT_OPTIONS = [3, 5, 10, null] as const;
export type VoteLimitOption = (typeof VOTE_LIMIT_OPTIONS)[number];

export const MAX_VOTES_PER_CARD_OPTIONS = [null, 1] as const;
export type MaxVotesPerCardOption = (typeof MAX_VOTES_PER_CARD_OPTIONS)[number];

export const RETENTION_DAYS_OPTIONS = [30, 90, 180] as const;
export type RetentionDaysOption = (typeof RETENTION_DAYS_OPTIONS)[number];

export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '🤔', '🔥', '👀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const MAX_COLUMNS_PER_BOARD = 10;
export const MAX_CARDS_PER_BOARD = 500;
export const MAX_COMMENTS_PER_CARD = 50;
export const MAX_COMMENT_LENGTH = 500;
export const MAX_CARD_CONTENT_LENGTH = 1000;
export const MAX_BOARD_TITLE_LENGTH = 120;
export const MAX_BOARD_SUBTITLE_LENGTH = 240;
export const MAX_COLUMN_TITLE_LENGTH = 60;
export const MAX_GROUP_TITLE_LENGTH = 120;

export type BoardErrorCode =
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'BOARD_NOT_FOUND'
  | 'NOT_FOUND'
  | 'LIMIT_EXCEEDED'
  | 'FORBIDDEN'
  | 'BOARD_LOCKED'
  | 'INTERNAL_ERROR';

export type ActionError = {
  ok: false;
  code: BoardErrorCode;
  message: string;
};

export type BoardMutationSuccess = {
  ok: true;
  version: number;
  events: BoardEvent[];
};

export type BoardMutationResponse = BoardMutationSuccess | ActionError;

export interface ColumnDTO {
  id: string;
  title: string;
  accent: ColumnAccent;
  position: number;
  isActionColumn: boolean;
  cardCount: number;
}

export interface CommentViewDTO {
  id: string;
  cardId: string;
  content: string;
  isMine: boolean;
  createdAt: number;
}

export interface CardViewDTO {
  id: string;
  columnId: string;
  groupId: string | null;
  content: string;
  redacted: boolean;
  placeholderLines?: 1 | 2 | 3;
  isMine: boolean;
  isActionItem: boolean;
  actionDone: boolean;
  actionOwner: string;
  votes: number | null;
  myVotes: number;
  reactions: Record<string, number>;
  myReactions: string[];
  commentCount: number;
  comments: CommentViewDTO[];
  createdAt: number;
  updatedAt: number;
}

export interface CardGroupDTO {
  id: string;
  columnId: string;
  title: string;
  cardIds: string[];
  votes: number | null;
  myVotes: number;
  createdAt: number;
}

export interface TimerStateDTO {
  endsAt: number | null;
  remainingMs: number | null;
  durationMs: number | null;
}

export interface BoardSettingsDTO {
  title: string;
  subtitle: string;
  isBlurred: boolean;
  blindVoting: boolean;
  isLocked: boolean;
  allowParticipantGroup: boolean;
  voteLimit: number | null;
  maxVotesPerCard: number | null;
  retentionDays: number;
}

export interface BoardViewDTO {
  id: string;
  title: string;
  subtitle: string;
  templateId: BoardTemplateId;
  isBlurred: boolean;
  blindVoting: boolean;
  isLocked: boolean;
  allowParticipantGroup: boolean;
  voteLimit: number | null;
  maxVotesPerCard: number | null;
  remainingVotes: number | null;
  isFacilitator: boolean;
  timer: TimerStateDTO;
  version: number;
  retentionDays: number;
  createdAt: number;
  lastActiveAt: number;
  columns: ColumnDTO[];
  groups: CardGroupDTO[];
  cards: CardViewDTO[];
}

export type BoardEvent =
  | { type: 'board:snapshot'; version: number; serverNow: number; board: BoardViewDTO }
  | { type: 'board:updated'; version: number; patch: Partial<BoardSettingsDTO> }
  | { type: 'board:deleted'; version: number }
  | { type: 'presence:count'; count: number }
  | { type: 'timer:updated'; version: number; serverNow: number; timer: TimerStateDTO }
  | { type: 'column:upserted'; version: number; column: ColumnDTO }
  | { type: 'column:deleted'; version: number; columnId: string }
  | { type: 'columns:reordered'; version: number; columnIds: string[] }
  | { type: 'card:upserted'; version: number; card: CardViewDTO }
  | { type: 'card:deleted'; version: number; cardId: string }
  | { type: 'group:upserted'; version: number; group: CardGroupDTO }
  | { type: 'group:dissolved'; version: number; groupId: string }
  | {
      type: 'vote:updated';
      version: number;
      targetType: 'card' | 'group';
      targetId: string;
      totalVotes: number | null;
      myVotes: number;
      remainingVotes: number | null;
    }
  | { type: 'vote:balance'; version: number; remainingVotes: number | null }
  | {
      type: 'reaction:updated';
      version: number;
      cardId: string;
      counts: CardViewDTO['reactions'];
      myReactions: CardViewDTO['myReactions'];
    }
  | { type: 'comment:created'; version: number; cardId: string; comment: CommentViewDTO }
  | { type: 'comment:deleted'; version: number; cardId: string; commentId: string };
