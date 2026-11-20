import * as v from 'valibot';

import { POKER_DISPLAY_NAME_LIMIT, POKER_STORY_TITLE_LIMIT } from './poker-types';

const PokerEntityId = v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{22}$/));
export const PokerRoomId = PokerEntityId;
export const PokerDisplayName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(POKER_DISPLAY_NAME_LIMIT));

const PokerStoryTitle = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(POKER_STORY_TITLE_LIMIT));

export const PokerCommand = v.variant('type', [
  v.object({ type: v.literal('join'), displayName: PokerDisplayName }),
  v.object({ type: v.literal('add-story'), title: PokerStoryTitle }),
  v.object({ type: v.literal('edit-story'), storyId: PokerEntityId, title: PokerStoryTitle }),
  v.object({
    type: v.literal('move-story'),
    storyId: PokerEntityId,
    targetId: PokerEntityId,
    placement: v.picklist(['before', 'after']),
  }),
  v.object({ type: v.literal('select-story'), storyId: PokerEntityId }),
]);

const Participant = v.object({
  id: v.string(),
  displayName: PokerDisplayName,
  isFacilitator: v.boolean(),
});

const Story = v.object({
  id: PokerEntityId,
  title: PokerStoryTitle,
  status: v.picklist(['pending', 'estimated', 'skipped']),
  acceptedEstimate: v.optional(v.string()),
});

const Room = v.object({
  id: PokerRoomId,
  version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  viewer: v.nullable(Participant),
  facilitatorLinkRevision: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
  participants: v.array(Participant),
  stories: v.array(Story),
  activeStoryId: v.nullable(PokerEntityId),
});

const PokerLiveFrame = v.variant('type', [
  v.object({ type: v.literal('room:snapshot'), room: Room, connectionId: v.optional(v.string()) }),
  v.object({ type: v.literal('room:missing') }),
  v.object({ type: v.literal('room:presence'), online: v.array(v.string()) }),
  v.object({ type: v.literal('heartbeat') }),
]);

export function parsePokerLiveMessage(data: string) {
  return v.parse(PokerLiveFrame, JSON.parse(data) as unknown);
}
