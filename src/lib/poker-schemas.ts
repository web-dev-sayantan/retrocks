import * as v from 'valibot';

import { POKER_DISPLAY_NAME_LIMIT } from './poker-types';

export const PokerRoomId = v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{22}$/));
export const PokerDisplayName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(POKER_DISPLAY_NAME_LIMIT));

export const PokerCommand = v.variant('type', [
  v.object({ type: v.literal('join'), displayName: PokerDisplayName }),
]);

const Participant = v.object({
  id: v.string(),
  displayName: PokerDisplayName,
  isFacilitator: v.boolean(),
});

const Room = v.object({
  id: PokerRoomId,
  version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  viewer: v.nullable(Participant),
  participants: v.array(Participant),
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
