import { projectedPokerDiscardDecision } from './poker-discard-policy';
import type { PokerDeckType, PokerLiveRoomView } from './poker-types';

export function projectedDeckRoundChange(
  room: Pick<PokerLiveRoomView, 'activeStoryId' | 'round'>,
  confirmedRoundId?: string,
) {
  return projectedPokerDiscardDecision(
    'set-deck',
    room.activeStoryId !== null,
    room.round,
    confirmedRoundId,
  );
}

export function isSamePokerDeck(
  room: Pick<PokerLiveRoomView, 'deckType' | 'deck'>,
  type: PokerDeckType,
  choices: readonly string[],
): boolean {
  return room.deckType === type
    && room.deck.length === choices.length
    && room.deck.every((choice, index) => choice === choices[index]);
}
