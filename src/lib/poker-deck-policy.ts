import { unresolvedPokerRoundWithVotesId, type PokerLiveRoomView } from './poker-types';

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
