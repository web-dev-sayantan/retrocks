import { unresolvedPokerRoundWithVotesId, type PokerDeckType, type PokerLiveRoomView } from './poker-types';

type DeckRoundChange =
  | { type: 'keep' | 'restart' | 'stale' }
  | { type: 'confirm'; roundId: string };

export function deckRoundChange(
  activeRoundId: string | undefined,
  unresolvedRoundWithVotesId: string | undefined,
  confirmedRoundId?: string,
): DeckRoundChange {
  if (confirmedRoundId !== undefined && confirmedRoundId !== activeRoundId) {
    return { type: 'stale' };
  }
  if (activeRoundId === undefined || unresolvedRoundWithVotesId !== activeRoundId) {
    return { type: 'keep' };
  }
  return confirmedRoundId === undefined
    ? { type: 'confirm', roundId: activeRoundId }
    : { type: 'restart' };
}

export function projectedDeckRoundChange(
  room: Pick<PokerLiveRoomView, 'activeStoryId' | 'round'>,
  confirmedRoundId?: string,
): DeckRoundChange {
  return deckRoundChange(
    room.activeStoryId === null ? undefined : room.round?.id,
    unresolvedPokerRoundWithVotesId(room.round),
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
