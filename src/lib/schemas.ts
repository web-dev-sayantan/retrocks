import * as v from 'valibot';

import {
  BOARD_TEMPLATE_IDS,
  COLUMN_ACCENTS,
  RETENTION_DAYS_OPTIONS,
} from './board-types';

export const BoardIdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{16,32}$/, 'Invalid Board ID'),
);

export const ColumnAccentSchema = v.picklist(COLUMN_ACCENTS);

export const BoardTemplateIdSchema = v.picklist(BOARD_TEMPLATE_IDS);

export const CreateColumnInputSchema = v.object({
  title: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, 'Column title cannot be empty'),
    v.maxLength(60, 'Column title must be 60 characters or fewer'),
  ),
  accent: v.optional(ColumnAccentSchema, 'slate'),
  isActionColumn: v.optional(v.boolean(), false),
});

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
