import type { PokerRoomView, PokerRoundView } from './poker-schemas';

export {
  FIBONACCI_DECK,
  POKER_DECK_PRESETS,
  POKER_DEFAULT_ROOM_NAME,
  POKER_DISPLAY_NAME_LIMIT,
  POKER_ROOM_NAME_LIMIT,
  POKER_STORY_TITLE_LIMIT,
  type PokerClosedRoomView,
  type PokerDeckCommand,
  type PokerDeckType,
  type PokerLiveMessage,
  type PokerLiveRoomView,
  type PokerParticipant,
  type PokerRoomChange,
  type PokerRoomCommand,
  type PokerRoomView,
  type PokerRoundView,
  type PokerStory,
  type PokerStoryCommand,
  type PokerVotingCommand,
} from './poker-schemas';

export function unresolvedPokerRoundId(round: Pick<PokerRoundView, 'id' | 'phase'> | null) {
  return round?.phase === 'open' || round?.phase === 'revealed' ? round.id : undefined;
}

type PokerFailure = {
  ok: false;
  code: 'ROOM_NOT_FOUND' | 'INVALID_INPUT' | 'FORBIDDEN' | 'RATE_LIMITED' | 'ROUND_CHANGED' | 'STORY_LOCKED' | 'ROOM_CLOSED';
  message: string;
};

export type PokerResult<T = PokerRoomView> = { ok: true; room: T } | PokerFailure;
export type PokerDeleteResult = { ok: true } | PokerFailure;
