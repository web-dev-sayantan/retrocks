import * as v from 'valibot';

import {
  BOARD_TEMPLATE_IDS,
  COLUMN_ACCENTS,
  MAX_BOARD_SUBTITLE_LENGTH,
  MAX_BOARD_TITLE_LENGTH,
  MAX_CARD_CONTENT_LENGTH,
  MAX_COLUMNS_PER_BOARD,
  MAX_COLUMN_TITLE_LENGTH,
  MAX_COMMENT_LENGTH,
  REACTION_EMOJIS,
  RETENTION_DAYS_OPTIONS,
} from './board-types';
import { MAX_TIMER_MINUTES, MIN_TIMER_MINUTES } from './timer';

export const BoardIdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{16,32}$/, 'Invalid Board ID'),
);

export const EntityIdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid ID'),
);

export const ColumnAccentSchema = v.picklist(COLUMN_ACCENTS);

export const BoardTemplateIdSchema = v.picklist(BOARD_TEMPLATE_IDS);

export const ColumnTitleSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'Column title cannot be empty'),
  v.maxLength(
    MAX_COLUMN_TITLE_LENGTH,
    `Column title must be ${MAX_COLUMN_TITLE_LENGTH} characters or fewer`,
  ),
);

export const CreateColumnInputSchema = v.object({
  title: ColumnTitleSchema,
  accent: v.optional(ColumnAccentSchema, 'slate'),
  isActionColumn: v.optional(v.boolean(), false),
});

export const CardContentSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'Card text cannot be empty'),
  v.maxLength(
    MAX_CARD_CONTENT_LENGTH,
    `Card text must be ${MAX_CARD_CONTENT_LENGTH} characters or fewer`,
  ),
);

export const VoteLimitSchema = v.union([
  v.literal(3),
  v.literal(5),
  v.literal(10),
  v.null(),
]);

export const MaxVotesPerCardSchema = v.union([v.literal(1), v.null()]);

export const RetentionDaysSchema = v.picklist(RETENTION_DAYS_OPTIONS);

export const CreateBoardInputSchema = v.object({
  title: v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.maxLength(120, 'Board title must be 120 characters or fewer'),
    ),
    '',
  ),
  subtitle: v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.maxLength(240, 'Board subtitle must be 240 characters or fewer'),
    ),
    '',
  ),
  templateId: v.optional(BoardTemplateIdSchema, 'standard'),
  columns: v.optional(
    v.pipe(
      v.array(CreateColumnInputSchema),
      v.minLength(1, 'A Board requires at least 1 Column'),
      v.maxLength(10, 'A Board can have at most 10 Columns'),
    ),
  ),
  voteLimit: v.optional(VoteLimitSchema, 5),
  maxVotesPerCard: v.optional(MaxVotesPerCardSchema, null),
  isBlurred: v.optional(v.boolean(), false),
  retentionDays: v.optional(RetentionDaysSchema, 90),
});

export type CreateBoardInput = v.InferInput<typeof CreateBoardInputSchema>;
export type ValidatedCreateBoardInput = v.InferOutput<
  typeof CreateBoardInputSchema
>;

export const RenameBoardInputSchema = v.object({
  boardId: BoardIdSchema,
  title: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, 'Board title cannot be empty'),
    v.maxLength(
      MAX_BOARD_TITLE_LENGTH,
      `Board title must be ${MAX_BOARD_TITLE_LENGTH} characters or fewer`,
    ),
  ),
  subtitle: v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.maxLength(
        MAX_BOARD_SUBTITLE_LENGTH,
        `Board subtitle must be ${MAX_BOARD_SUBTITLE_LENGTH} characters or fewer`,
      ),
    ),
  ),
});

export type RenameBoardInput = v.InferInput<typeof RenameBoardInputSchema>;

export const SetPrivateModeInputSchema = v.object({
  boardId: BoardIdSchema,
  isBlurred: v.boolean(),
});

export type SetPrivateModeInput = v.InferInput<typeof SetPrivateModeInputSchema>;

export const CreateCardInputSchema = v.object({
  boardId: BoardIdSchema,
  columnId: EntityIdSchema,
  content: CardContentSchema,
});

export type CreateCardInput = v.InferInput<typeof CreateCardInputSchema>;

export const UpdateCardInputSchema = v.object({
  boardId: BoardIdSchema,
  cardId: EntityIdSchema,
  content: CardContentSchema,
});

export type UpdateCardInput = v.InferInput<typeof UpdateCardInputSchema>;

export const MoveCardInputSchema = v.object({
  boardId: BoardIdSchema,
  cardId: EntityIdSchema,
  targetColumnId: EntityIdSchema,
});

export type MoveCardInput = v.InferInput<typeof MoveCardInputSchema>;

export const DeleteCardInputSchema = v.object({
  boardId: BoardIdSchema,
  cardId: EntityIdSchema,
});

export type DeleteCardInput = v.InferInput<typeof DeleteCardInputSchema>;

export const ToggleReactionInputSchema = v.object({
  boardId: BoardIdSchema,
  cardId: EntityIdSchema,
  emoji: v.picklist(REACTION_EMOJIS),
});

export type ToggleReactionInput = v.InferInput<typeof ToggleReactionInputSchema>;

export const CreateCommentInputSchema = v.object({
  boardId: BoardIdSchema,
  cardId: EntityIdSchema,
  content: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, 'Comment cannot be empty'),
    v.maxLength(
      MAX_COMMENT_LENGTH,
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
    ),
  ),
});

export type CreateCommentInput = v.InferInput<typeof CreateCommentInputSchema>;

export const DeleteCommentInputSchema = v.object({
  boardId: BoardIdSchema,
  cardId: EntityIdSchema,
  commentId: EntityIdSchema,
});

export type DeleteCommentInput = v.InferInput<typeof DeleteCommentInputSchema>;

export const AddColumnInputSchema = v.object({
  boardId: BoardIdSchema,
  title: ColumnTitleSchema,
  accent: v.optional(ColumnAccentSchema, 'slate'),
  isActionColumn: v.optional(v.boolean(), false),
});

export type AddColumnInput = v.InferInput<typeof AddColumnInputSchema>;

export const UpdateColumnInputSchema = v.object({
  boardId: BoardIdSchema,
  columnId: EntityIdSchema,
  title: v.optional(ColumnTitleSchema),
  accent: v.optional(ColumnAccentSchema),
  isActionColumn: v.optional(v.boolean()),
});

export type UpdateColumnInput = v.InferInput<typeof UpdateColumnInputSchema>;

export const ReorderColumnsInputSchema = v.object({
  boardId: BoardIdSchema,
  columnIds: v.pipe(
    v.array(EntityIdSchema),
    v.minLength(1, 'A Board requires at least 1 Column'),
    v.maxLength(
      MAX_COLUMNS_PER_BOARD,
      `A Board can have at most ${MAX_COLUMNS_PER_BOARD} Columns`,
    ),
  ),
});

export type ReorderColumnsInput = v.InferInput<
  typeof ReorderColumnsInputSchema
>;

export const DeleteColumnInputSchema = v.object({
  boardId: BoardIdSchema,
  columnId: EntityIdSchema,
});

export type DeleteColumnInput = v.InferInput<typeof DeleteColumnInputSchema>;

const StartTimerSchema = v.object({
  action: v.literal('start'),
  minutes: v.pipe(
    v.number(),
    v.integer('Enter a whole number of minutes.'),
    v.minValue(MIN_TIMER_MINUTES, 'Choose at least one minute.'),
    v.maxValue(MAX_TIMER_MINUTES, 'Choose at most 60 minutes.'),
  ),
});

export const UpdateTimerInputSchema = v.object({
  boardId: BoardIdSchema,
  change: v.variant('action', [
    StartTimerSchema,
    v.object({ action: v.picklist(['pause', 'resume', 'extend', 'dismiss']) }),
  ]),
});

export type UpdateTimerInput = v.InferInput<typeof UpdateTimerInputSchema>;
export type TimerChange = UpdateTimerInput['change'];
