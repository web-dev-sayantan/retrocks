import * as v from 'valibot';

import {
  BOARD_TEMPLATE_IDS,
  COLUMN_ACCENTS,
  REACTION_EMOJIS,
} from './board-types';
import type {
  BoardLiveMessage,
} from './board-live-protocol';
import type {
  BoardViewDTO,
} from './board-types';

/**
 * Wire-boundary schemas for the Board output DTOs and live stream messages.
 * `board-types.ts` stays the shared client/server type source of truth; the
 * schemas' `v.InferOutput`s are compile-time checked against those interfaces
 * (see `wire-schemas.test.tsx`). Parsed once where payloads enter the client —
 * never per render.
 */

export const ColumnDTOSchema = v.object({
  id: v.string(),
  title: v.string(),
  accent: v.picklist(COLUMN_ACCENTS),
  position: v.number(),
  isActionColumn: v.boolean(),
  cardCount: v.number(),
});

export const CommentViewDTOSchema = v.object({
  id: v.string(),
  cardId: v.string(),
  content: v.string(),
  isMine: v.boolean(),
  createdAt: v.number(),
});

export const CardViewDTOSchema = v.object({
  id: v.string(),
  columnId: v.string(),
  groupId: v.nullable(v.string()),
  content: v.string(),
  redacted: v.boolean(),
  placeholderLines: v.optional(v.picklist([1, 2, 3])),
  pending: v.optional(v.boolean()),
  isMine: v.boolean(),
  isActionItem: v.boolean(),
  actionDone: v.boolean(),
  actionOwner: v.string(),
  votes: v.nullable(v.number()),
  myVotes: v.number(),
  reactions: v.record(v.picklist(REACTION_EMOJIS), v.number()),
  myReactions: v.array(v.picklist(REACTION_EMOJIS)),
  commentCount: v.number(),
  comments: v.array(CommentViewDTOSchema),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const CardGroupDTOSchema = v.object({
  id: v.string(),
  columnId: v.string(),
  title: v.string(),
  redacted: v.optional(v.boolean()),
  cardIds: v.array(v.string()),
  votes: v.nullable(v.number()),
  myVotes: v.number(),
  createdAt: v.number(),
});

export const TimerStateDTOSchema = v.object({
  endsAt: v.nullable(v.number()),
  remainingMs: v.nullable(v.number()),
  durationMs: v.nullable(v.number()),
});

const BoardSettingsDTOSchema = v.object({
  title: v.string(),
  subtitle: v.string(),
  isBlurred: v.boolean(),
  blindVoting: v.boolean(),
  isLocked: v.boolean(),
  allowParticipantGroup: v.boolean(),
  voteLimit: v.nullable(v.number()),
  maxVotesPerCard: v.nullable(v.number()),
  retentionDays: v.number(),
});

export const BoardViewDTOSchema = v.object({
  ...BoardSettingsDTOSchema.entries,
  id: v.string(),
  templateId: v.picklist(BOARD_TEMPLATE_IDS),
  remainingVotes: v.nullable(v.number()),
  isFacilitator: v.boolean(),
  timer: TimerStateDTOSchema,
  version: v.number(),
  createdAt: v.number(),
  lastActiveAt: v.number(),
  columns: v.array(ColumnDTOSchema),
  groups: v.array(CardGroupDTOSchema),
  cards: v.array(CardViewDTOSchema),
});

const ReactionCountsSchema = v.record(v.picklist(REACTION_EMOJIS), v.number());
const MyReactionsSchema = v.array(v.picklist(REACTION_EMOJIS));

export const BoardEventSchema = v.variant('type', [
  v.object({
    type: v.literal('board:snapshot'),
    version: v.number(),
    serverNow: v.number(),
    board: BoardViewDTOSchema,
  }),
  v.object({
    type: v.literal('board:updated'),
    version: v.number(),
    patch: v.partial(BoardSettingsDTOSchema),
  }),
  v.object({ type: v.literal('board:deleted'), version: v.number() }),
  v.object({ type: v.literal('presence:count'), count: v.number() }),
  v.object({
    type: v.literal('timer:updated'),
    version: v.number(),
    serverNow: v.number(),
    timer: TimerStateDTOSchema,
  }),
  v.object({
    type: v.literal('column:upserted'),
    version: v.number(),
    column: ColumnDTOSchema,
  }),
  v.object({ type: v.literal('column:deleted'), version: v.number(), columnId: v.string() }),
  v.object({
    type: v.literal('columns:reordered'),
    version: v.number(),
    columnIds: v.array(v.string()),
  }),
  v.object({ type: v.literal('card:upserted'), version: v.number(), card: CardViewDTOSchema }),
  v.object({ type: v.literal('card:deleted'), version: v.number(), cardId: v.string() }),
  v.object({ type: v.literal('group:upserted'), version: v.number(), group: CardGroupDTOSchema }),
  v.object({ type: v.literal('group:dissolved'), version: v.number(), groupId: v.string() }),
  v.object({
    type: v.literal('vote:updated'),
    version: v.number(),
    targetType: v.picklist(['card', 'group']),
    targetId: v.string(),
    totalVotes: v.nullable(v.number()),
    myVotes: v.number(),
    remainingVotes: v.nullable(v.number()),
  }),
  v.object({
    type: v.literal('vote:balance'),
    version: v.number(),
    remainingVotes: v.nullable(v.number()),
  }),
  v.object({
    type: v.literal('reaction:updated'),
    version: v.number(),
    cardId: v.string(),
    counts: ReactionCountsSchema,
    myReactions: MyReactionsSchema,
  }),
  v.object({
    type: v.literal('comment:created'),
    version: v.number(),
    cardId: v.string(),
    comment: CommentViewDTOSchema,
  }),
  v.object({
    type: v.literal('comment:deleted'),
    version: v.number(),
    cardId: v.string(),
    commentId: v.string(),
  }),
]);

export const BoardLiveMessageSchema = v.variant('type', [
  v.object({
    type: v.literal('board:snapshot'),
    version: v.number(),
    serverNow: v.number(),
    board: BoardViewDTOSchema,
    connectionId: v.optional(v.string()),
  }),
  v.object({ type: v.literal('board:deleted'), version: v.number() }),
  v.object({ type: v.literal('presence:count'), count: v.number() }),
  v.object({
    type: v.literal('board:mutation'),
    version: v.number(),
    lastActiveAt: v.optional(v.number()),
    events: v.array(BoardEventSchema),
  }),
  v.object({ type: v.literal('heartbeat') }),
]);

/** Validates a `getBoard` response at the client wire boundary; throws on drift. */
export function parseBoardView(input: unknown): BoardViewDTO {
  return v.parse(BoardViewDTOSchema, input);
}

/** Validates one live WebSocket/SSE frame; throws on malformed or drifted payloads. */
export function parseBoardLiveMessage(frame: string): BoardLiveMessage {
  return v.parse(BoardLiveMessageSchema, JSON.parse(frame));
}
