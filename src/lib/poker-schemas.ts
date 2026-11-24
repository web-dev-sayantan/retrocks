import * as v from 'valibot';

import { POKER_DISPLAY_NAME_LIMIT, POKER_STORY_TITLE_LIMIT } from './poker-types';

const PokerEntityId = v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{22}$/));
export const PokerRoomId = PokerEntityId;
export const PokerDisplayName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(POKER_DISPLAY_NAME_LIMIT));

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

export const PokerCommand = v.variant('type', [
  v.object({ type: v.literal('join'), displayName: PokerDisplayName }),
  v.object({ type: v.literal('close-room'), discardRoundId: v.optional(PokerEntityId) }),
  v.object({ type: v.literal('add-story'), title: PokerStoryTitle }),
  v.object({
    type: v.literal('correct-estimate'),
    storyId: PokerEntityId,
    expectedEstimate: PokerDeckChoice,
    choice: PokerDeckChoice,
  }),
  v.object({ type: v.literal('return-story'), storyId: PokerEntityId }),
  v.object({ type: v.literal('edit-story'), storyId: PokerEntityId, title: PokerStoryTitle }),
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
  v.object({ type: v.literal('vote'), roundId: PokerEntityId, choice: v.nullable(PokerDeckChoice) }),
  v.object({ type: v.literal('reveal'), roundId: PokerEntityId }),
  v.object({ type: v.literal('restart-round'), roundId: PokerEntityId }),
  v.object({ type: v.literal('skip-story'), roundId: PokerEntityId }),
  v.object({ type: v.literal('confirm-estimate'), roundId: PokerEntityId, choice: PokerDeckChoice }),
  v.object({
    type: v.literal('set-deck'),
    deck: v.variant('type', [
      v.object({ type: v.literal('fibonacci') }),
      v.object({ type: v.literal('t-shirt') }),
      v.object({ type: v.literal('custom'), choices: CustomDeckChoices }),
    ]),
  }),
]);

const Participant = v.object({
  id: v.string(),
  displayName: PokerDisplayName,
  isFacilitator: v.boolean(),
});

const StorySummary = v.object({
  title: PokerStoryTitle,
  status: v.picklist(['pending', 'estimated', 'skipped']),
  acceptedEstimate: v.optional(v.string()),
});

const Story = v.object({ id: PokerEntityId, ...StorySummary.entries, locked: v.optional(v.boolean()) });

const Round = v.variant('phase', [
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

const LiveRoom = v.object({
  closed: v.literal(false),
  id: PokerRoomId,
  version: RoomVersion,
  viewer: v.nullable(Participant),
  facilitatorLinkRevision: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
  participants: v.array(Participant),
  stories: v.array(Story),
  activeStoryId: v.nullable(PokerEntityId),
  deck: v.array(v.string()),
  deckType: v.picklist(['fibonacci', 't-shirt', 'custom']),
  deckLocked: v.boolean(),
  round: v.nullable(Round),
});

const ClosedRoom = v.object({
  closed: v.literal(true),
  id: PokerRoomId,
  version: RoomVersion,
  canDelete: v.boolean(),
  stories: v.array(StorySummary),
});

const Room = v.variant('closed', [LiveRoom, ClosedRoom]);

const PokerLiveFrame = v.variant('type', [
  v.object({ type: v.literal('room:snapshot'), room: Room, connectionId: v.optional(v.string()) }),
  v.object({ type: v.literal('room:missing') }),
  v.object({ type: v.literal('room:presence'), online: v.array(v.string()) }),
  v.object({ type: v.literal('heartbeat') }),
]);

export function parsePokerLiveMessage(data: string) {
  return v.parse(PokerLiveFrame, JSON.parse(data) as unknown);
}
