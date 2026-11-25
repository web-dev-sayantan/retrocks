import * as v from 'valibot';

export const POKER_DEFAULT_ROOM_NAME = 'Poker Room';
export const POKER_ROOM_NAME_LIMIT = 120;
export const POKER_DISPLAY_NAME_LIMIT = 60;
export const POKER_STORY_TITLE_LIMIT = 200;
export const FIBONACCI_DECK = ['0', '1', '2', '3', '5', '8', '13', '21'] as const;

export const POKER_DECK_PRESETS = {
  fibonacci: FIBONACCI_DECK,
  't-shirt': ['XS', 'S', 'M', 'L', 'XL'],
} as const;

const PokerEntityId = v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{22}$/));
export const PokerRoomId = PokerEntityId;
export const PokerDisplayName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(POKER_DISPLAY_NAME_LIMIT));
export const PokerRoomName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(POKER_ROOM_NAME_LIMIT));
export const PokerRoomNameInput = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(POKER_ROOM_NAME_LIMIT),
  v.transform((name) => name || POKER_DEFAULT_ROOM_NAME),
);

const PokerStoryTitle = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(POKER_STORY_TITLE_LIMIT));

export const PokerDeckChoice = v.pipe(
  v.union([v.string(), v.pipe(v.number(), v.finite())]),
  v.transform((choice) => String(choice).trim()),
  v.nonEmpty('Enter a value for each Deck choice.'),
);

const CustomDeckChoices = v.pipe(
  v.array(PokerDeckChoice),
  v.minLength(2, 'Enter at least two Deck choices.'),
  v.check((choices) => new Set(choices).size === choices.length, 'Give each Deck choice a different value.'),
);

const PokerDeckPresetSchema = v.picklist(['fibonacci', 't-shirt']);
const PokerDeckTypeSchema = v.picklist(['fibonacci', 't-shirt', 'custom']);

const PokerStoryCommandSchema = v.variant('type', [
  v.object({
    type: v.literal('add-story'),
    title: PokerStoryTitle,
    makeActive: v.optional(v.boolean()),
    discardRoundId: v.optional(PokerEntityId),
  }),
  v.object({
    type: v.literal('correct-estimate'),
    storyId: PokerEntityId,
    expectedEstimate: PokerDeckChoice,
    choice: PokerDeckChoice,
  }),
  v.object({ type: v.literal('return-story'), storyId: PokerEntityId }),
  v.object({
    type: v.literal('edit-story'),
    storyId: PokerEntityId,
    title: PokerStoryTitle,
    discardRoundId: v.optional(PokerEntityId),
  }),
  v.object({
    type: v.literal('move-story'),
    storyId: PokerEntityId,
    targetId: PokerEntityId,
    placement: v.picklist(['before', 'after']),
  }),
  v.object({
    type: v.literal('select-story'),
    storyId: PokerEntityId,
    discardRoundId: v.optional(PokerEntityId),
  }),
  v.object({
    type: v.literal('set-story-lock'),
    storyId: PokerEntityId,
    locked: v.boolean(),
    discardRoundId: v.optional(PokerEntityId),
  }),
  v.object({
    type: v.literal('delete-story'),
    storyId: PokerEntityId,
    discardRoundId: v.optional(PokerEntityId),
  }),
]);

const PokerVotingCommandSchema = v.variant('type', [
  v.object({ type: v.literal('vote'), roundId: PokerEntityId, choice: v.nullable(PokerDeckChoice) }),
  v.object({ type: v.literal('reveal'), roundId: PokerEntityId }),
  v.object({ type: v.literal('restart-round'), roundId: PokerEntityId }),
  v.object({ type: v.literal('skip-story'), roundId: PokerEntityId }),
  v.object({ type: v.literal('confirm-estimate'), roundId: PokerEntityId, choice: PokerDeckChoice }),
]);

const PokerDeckCommandSchema = v.object({
  type: v.literal('set-deck'),
  deck: v.variant('type', [
    v.object({ type: PokerDeckPresetSchema }),
    v.object({ type: v.literal('custom'), choices: CustomDeckChoices }),
  ]),
  discardRoundId: v.optional(PokerEntityId),
});

const PokerRoomChangeSchema = v.variant('type', [
  ...PokerStoryCommandSchema.options,
  ...PokerVotingCommandSchema.options,
  PokerDeckCommandSchema,
  v.object({ type: v.literal('rename-room'), name: PokerRoomNameInput }),
  v.object({ type: v.literal('close-room'), discardRoundId: v.optional(PokerEntityId) }),
  v.object({ type: v.literal('reopen-room') }),
]);

export const PokerCommand = v.variant('type', [
  v.object({ type: v.literal('join'), displayName: PokerDisplayName }),
  ...PokerRoomChangeSchema.options,
]);

const ParticipantSchema = v.object({
  id: v.string(),
  displayName: PokerDisplayName,
  isFacilitator: v.boolean(),
});

const StorySummarySchema = v.object({
  title: PokerStoryTitle,
  status: v.picklist(['pending', 'estimated', 'skipped']),
  acceptedEstimate: v.optional(v.string()),
});

const StorySchema = v.object({ id: PokerEntityId, ...StorySummarySchema.entries, locked: v.optional(v.boolean()) });

const RoundSchema = v.variant('phase', [
  v.object({
    id: PokerEntityId,
    phase: v.literal('open'),
    submittedParticipantIds: v.array(PokerEntityId),
    ownChoice: v.nullable(v.string()),
  }),
  v.object({
    id: PokerEntityId,
    phase: v.picklist(['revealed', 'accepted']),
    ballots: v.array(v.object({
      participantId: PokerEntityId,
      displayName: PokerDisplayName,
      choice: v.string(),
    })),
  }),
]);

const RoomVersion = v.pipe(v.number(), v.safeInteger(), v.minValue(1));

const LiveRoomSchema = v.object({
  closed: v.literal(false),
  id: PokerRoomId,
  name: PokerRoomName,
  version: RoomVersion,
  viewer: v.nullable(ParticipantSchema),
  facilitatorLinkRevision: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
  participants: v.array(ParticipantSchema),
  stories: v.array(StorySchema),
  activeStoryId: v.nullable(PokerEntityId),
  deck: v.pipe(v.array(v.string()), v.transform((deck): readonly string[] => deck)),
  deckType: PokerDeckTypeSchema,
  round: v.nullable(RoundSchema),
});

const ClosedRoomSchema = v.object({
  closed: v.literal(true),
  id: PokerRoomId,
  name: PokerRoomName,
  version: RoomVersion,
  canDelete: v.boolean(),
  stories: v.array(StorySummarySchema),
});

const RoomSchema = v.variant('closed', [LiveRoomSchema, ClosedRoomSchema]);

const PokerLiveFrameSchema = v.variant('type', [
  v.object({ type: v.literal('room:snapshot'), room: RoomSchema, connectionId: v.optional(v.string()) }),
  v.object({ type: v.literal('room:missing') }),
  v.object({ type: v.literal('room:presence'), online: v.array(v.string()) }),
  v.object({ type: v.literal('heartbeat') }),
]);

export type PokerDeckType = v.InferOutput<typeof PokerDeckTypeSchema>;
export type PokerDeckCommand = v.InferOutput<typeof PokerDeckCommandSchema>;
export type PokerParticipant = v.InferOutput<typeof ParticipantSchema>;
export type PokerStory = v.InferOutput<typeof StorySchema>;
export type PokerRoundView = v.InferOutput<typeof RoundSchema>;
export type PokerLiveRoomView = v.InferOutput<typeof LiveRoomSchema>;
export type PokerClosedRoomView = v.InferOutput<typeof ClosedRoomSchema>;
export type PokerRoomView = v.InferOutput<typeof RoomSchema>;
export type PokerStoryCommand = v.InferOutput<typeof PokerStoryCommandSchema>;
export type PokerVotingCommand = v.InferOutput<typeof PokerVotingCommandSchema>;
export type PokerRoomChange = v.InferOutput<typeof PokerRoomChangeSchema>;
export type PokerRoomCommand = v.InferOutput<typeof PokerCommand>;
export type PokerLiveMessage = v.InferOutput<typeof PokerLiveFrameSchema>;

export function parsePokerLiveMessage(data: string): PokerLiveMessage {
  return v.parse(PokerLiveFrameSchema, JSON.parse(data) as unknown);
}
