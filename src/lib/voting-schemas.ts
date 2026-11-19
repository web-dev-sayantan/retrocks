import * as v from 'valibot';

import { BoardIdSchema, EntityIdSchema, MaxVotesPerCardSchema } from './schemas';

export const ChangeVoteInputSchema = v.object({
  boardId: BoardIdSchema,
  targetType: v.picklist(['card', 'group']),
  targetId: EntityIdSchema,
  delta: v.picklist([1, -1]),
});

export type ChangeVoteInput = v.InferInput<typeof ChangeVoteInputSchema>;

export const UpdateVotingSettingsInputSchema = v.object({
  boardId: BoardIdSchema,
  voteLimit: v.optional(v.nullable(v.pipe(
    v.number(),
    v.safeInteger('Vote limit must be a whole number'),
    v.minValue(1, 'Vote limit must be at least 1'),
  ))),
  maxVotesPerCard: v.optional(MaxVotesPerCardSchema),
  blindVoting: v.optional(v.boolean()),
  allowParticipantGroup: v.optional(v.boolean()),
});

export type UpdateVotingSettingsInput = v.InferInput<typeof UpdateVotingSettingsInputSchema>;

export const ResetVotesInputSchema = v.object({ boardId: BoardIdSchema });

export type ResetVotesInput = v.InferInput<typeof ResetVotesInputSchema>;
