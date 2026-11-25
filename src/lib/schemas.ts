import * as v from 'valibot';

import {
  BOARD_TEMPLATE_IDS,
  COLUMN_ACCENTS,
  MAX_ACTION_OWNER_LENGTH,
  MAX_BOARD_SUBTITLE_LENGTH,
  MAX_BOARD_TITLE_LENGTH,
  MAX_CARD_CONTENT_LENGTH,
  MAX_COLUMNS_PER_BOARD,
  MAX_COLUMN_TITLE_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_GROUP_TITLE_LENGTH,
  REACTION_EMOJIS,
  RETENTION_DAYS_OPTIONS,
  VOTE_LIMIT_OPTIONS,
} from './board-types';
import { MAX_TIMER_MINUTES, MIN_TIMER_MINUTES } from './timer';

export const BoardIdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{16,32}$/, 'Invalid Board ID'),
);

const EntityIdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid ID'),
);

const ColumnAccentSchema = v.picklist(COLUMN_ACCENTS);

const BoardTemplateIdSchema = v.picklist(BOARD_TEMPLATE_IDS);

const ColumnTitleSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'Column title cannot be empty'),
  v.maxLength(
    MAX_COLUMN_TITLE_LENGTH,
    `Column title must be ${MAX_COLUMN_TITLE_LENGTH} characters or fewer`,
  ),
);

const CreateColumnInputSchema = v.object({
  title: ColumnTitleSchema,
  accent: v.optional(ColumnAccentSchema, 'slate'),
  isActionColumn: v.optional(v.boolean(), false),
});

const CardContentSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'Card text cannot be empty'),
  v.maxLength(
    MAX_CARD_CONTENT_LENGTH,
    `Card text must be ${MAX_CARD_CONTENT_LENGTH} characters or fewer`,
  ),
);

// picklist cannot hold null, so the union is derived from the shared options list.
const VoteLimitSchema = v.union(
  VOTE_LIMIT_OPTIONS.map((option) =>
    option === null ? v.null() : v.literal(option),
  ),
);

const MaxVotesPerCardSchema = v.union([v.literal(1), v.null()]);

const RetentionDaysSchema = v.picklist(RETENTION_DAYS_OPTIONS);

export const CreateBoardInputSchema = v.object({
  title: v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.maxLength(
        MAX_BOARD_TITLE_LENGTH,
        `Board title must be ${MAX_BOARD_TITLE_LENGTH} characters or fewer`,
      ),
    ),
    '',
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
    '',
  ),
  templateId: v.optional(BoardTemplateIdSchema, 'standard'),
  columns: v.optional(
    v.pipe(
      v.array(CreateColumnInputSchema),
      v.minLength(1, 'A Board requires at least 1 Column'),
      v.maxLength(
        MAX_COLUMNS_PER_BOARD,
        `A Board can have at most ${MAX_COLUMNS_PER_BOARD} Columns`,
      ),
    ),
  ),
  voteLimit: v.optional(VoteLimitSchema, 5),
  maxVotesPerCard: v.optional(MaxVotesPerCardSchema, null),
  isBlurred: v.optional(v.boolean(), false),
  retentionDays: v.optional(RetentionDaysSchema, 90),
});

export type CreateBoardInput = v.InferInput<typeof CreateBoardInputSchema>;

const CardGroupTitleSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'Card Group title cannot be empty'),
  v.maxLength(
    MAX_GROUP_TITLE_LENGTH,
    `Card Group title must be ${MAX_GROUP_TITLE_LENGTH} characters or fewer`,
  ),
);

const ActionOwnerSchema = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(
    MAX_ACTION_OWNER_LENGTH,
    `Action owner must be ${MAX_ACTION_OWNER_LENGTH} characters or fewer`,
  ),
);

const StartTimerSchema = v.object({
  action: v.literal('start'),
  minutes: v.pipe(
    v.number(),
    v.integer('Enter a whole number of minutes.'),
    v.minValue(MIN_TIMER_MINUTES, 'Choose at least one minute.'),
    v.maxValue(MAX_TIMER_MINUTES, `Choose at most ${MAX_TIMER_MINUTES} minutes.`),
  ),
});

const TimerChangeSchema = v.variant('action', [
  StartTimerSchema,
  v.object({ action: v.picklist(['pause', 'resume', 'extend', 'dismiss']) }),
]);

export type TimerChange = v.InferInput<typeof TimerChangeSchema>;

const BoardTitleSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'Board title cannot be empty'),
  v.maxLength(
    MAX_BOARD_TITLE_LENGTH,
    `Board title must be ${MAX_BOARD_TITLE_LENGTH} characters or fewer`,
  ),
);

const BoardSubtitleSchema = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(
    MAX_BOARD_SUBTITLE_LENGTH,
    `Board subtitle must be ${MAX_BOARD_SUBTITLE_LENGTH} characters or fewer`,
  ),
);

const CommentContentSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'Comment cannot be empty'),
  v.maxLength(
    MAX_COMMENT_LENGTH,
    `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
  ),
);

const ColumnIdsSchema = v.pipe(
  v.array(EntityIdSchema),
  v.minLength(1, 'A Board requires at least 1 Column'),
  v.maxLength(
    MAX_COLUMNS_PER_BOARD,
    `A Board can have at most ${MAX_COLUMNS_PER_BOARD} Columns`,
  ),
);

const CustomVoteLimitSchema = v.nullable(
  v.pipe(
    v.number(),
    v.safeInteger('Vote limit must be a whole number'),
    v.minValue(1, 'Vote limit must be at least 1'),
  ),
);

export const BoardCommandSchema = v.variant('type', [
  v.object({
    type: v.literal('board:rename'),
    title: BoardTitleSchema,
    subtitle: v.optional(BoardSubtitleSchema),
  }),
  v.object({
    type: v.literal('timer:update'),
    change: TimerChangeSchema,
  }),
  v.object({
    type: v.literal('board:set-private-mode'),
    isBlurred: v.boolean(),
  }),
  v.object({
    type: v.literal('board:set-lock'),
    isLocked: v.boolean(),
  }),
  v.object({
    type: v.literal('board:delete'),
  }),
  v.object({
    type: v.literal('card:create'),
    columnId: EntityIdSchema,
    content: CardContentSchema,
  }),
  v.object({
    type: v.literal('card:update'),
    cardId: EntityIdSchema,
    content: CardContentSchema,
  }),
  v.pipe(
    v.object({
      type: v.literal('card:set-action'),
      cardId: EntityIdSchema,
      isActionItem: v.optional(v.boolean()),
      actionDone: v.optional(v.boolean()),
      actionOwner: v.optional(ActionOwnerSchema),
    }),
    v.check(
      (input) =>
        input.isActionItem !== undefined ||
        input.actionDone !== undefined ||
        input.actionOwner !== undefined,
      'No Action Item changes provided',
    ),
  ),
  v.object({
    type: v.literal('card:move'),
    cardId: EntityIdSchema,
    targetColumnId: EntityIdSchema,
  }),
  v.object({
    type: v.literal('card:delete'),
    cardId: EntityIdSchema,
  }),
  v.object({
    type: v.literal('reaction:toggle'),
    cardId: EntityIdSchema,
    emoji: v.picklist(REACTION_EMOJIS),
  }),
  v.object({
    type: v.literal('comment:create'),
    cardId: EntityIdSchema,
    content: CommentContentSchema,
  }),
  v.object({
    type: v.literal('comment:delete'),
    cardId: EntityIdSchema,
    commentId: EntityIdSchema,
  }),
  v.object({
    type: v.literal('column:add'),
    title: ColumnTitleSchema,
    accent: v.optional(ColumnAccentSchema, 'slate'),
    isActionColumn: v.optional(v.boolean(), false),
  }),
  v.object({
    type: v.literal('column:update'),
    columnId: EntityIdSchema,
    title: v.optional(ColumnTitleSchema),
    accent: v.optional(ColumnAccentSchema),
    isActionColumn: v.optional(v.boolean()),
  }),
  v.object({
    type: v.literal('column:reorder'),
    columnIds: ColumnIdsSchema,
  }),
  v.object({
    type: v.literal('column:delete'),
    columnId: EntityIdSchema,
  }),
  v.object({
    type: v.literal('group:merge'),
    cardId: EntityIdSchema,
    targetType: v.picklist(['card', 'group']),
    targetId: EntityIdSchema,
  }),
  v.object({
    type: v.literal('group:rename'),
    groupId: EntityIdSchema,
    title: CardGroupTitleSchema,
  }),
  v.object({
    type: v.literal('group:ungroup'),
    cardId: EntityIdSchema,
  }),
  v.object({
    type: v.literal('group:dissolve'),
    groupId: EntityIdSchema,
  }),
  v.object({
    type: v.literal('group:move'),
    groupId: EntityIdSchema,
    targetColumnId: EntityIdSchema,
  }),
  v.object({
    type: v.literal('vote:change'),
    targetType: v.picklist(['card', 'group']),
    targetId: EntityIdSchema,
    delta: v.picklist([1, -1]),
  }),
  v.object({
    type: v.literal('voting:configure'),
    voteLimit: v.optional(CustomVoteLimitSchema),
    maxVotesPerCard: v.optional(MaxVotesPerCardSchema),
    blindVoting: v.optional(v.boolean()),
    allowParticipantGroup: v.optional(v.boolean()),
  }),
  v.object({
    type: v.literal('voting:reset'),
  }),
]);

export type BoardCommand = v.InferInput<typeof BoardCommandSchema>;
