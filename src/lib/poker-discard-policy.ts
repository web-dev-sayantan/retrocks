import { unresolvedPokerRoundId, type PokerRoundView } from './poker-types';

export type PokerDiscardIntent =
  | 'select-story'
  | 'close-room'
  | 'add-story'
  | 'edit-story'
  | 'set-story-lock'
  | 'delete-story'
  | 'set-deck';

type DiscardRound = Pick<PokerRoundView, 'id' | 'phase'> & { hasVotes: boolean };

export function pokerDiscardDecision(
  intent: PokerDiscardIntent,
  targetsActiveRound: boolean,
  round: DiscardRound | null,
  confirmedRoundId?: string,
) {
  const unresolvedId = targetsActiveRound ? unresolvedPokerRoundId(round) : undefined;
  const currentId = targetsActiveRound ? round?.id : undefined;
  const matchingId = intent === 'close-room' ? unresolvedId : currentId;
  if (confirmedRoundId !== undefined && confirmedRoundId !== matchingId) {
    return { type: 'stale' } as const;
  }
  if (unresolvedId !== undefined && (
    intent === 'select-story' || intent === 'close-room' || round?.hasVotes
  )) {
    return confirmedRoundId === undefined
      ? { type: 'confirm', roundId: unresolvedId } as const
      : { type: 'discard' } as const;
  }
  return { type: 'proceed' } as const;
}

export function projectedPokerDiscardDecision(
  intent: PokerDiscardIntent,
  targetsActiveRound: boolean,
  round: PokerRoundView | null,
  confirmedRoundId?: string,
) {
  return pokerDiscardDecision(intent, targetsActiveRound, round && {
    id: round.id,
    phase: round.phase,
    hasVotes: round.phase === 'open' ? round.submittedParticipantIds.length > 0 : round.ballots.length > 0,
  }, confirmedRoundId);
}

export function projectedPokerDiscardPrompt(
  intent: PokerDiscardIntent,
  targetsActiveRound: boolean,
  round: PokerRoundView | null,
) {
  const decision = projectedPokerDiscardDecision(intent, targetsActiveRound, round);
  return decision.type === 'confirm' ? decision.roundId : undefined;
}
