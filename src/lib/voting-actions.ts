import { respondToBoardMutation } from './action-response';
import type { BoardMutationResponse } from './board-types';
import type {
  ChangeVoteInput,
  ResetVotesInput,
  UpdateVotingSettingsInput,
} from './voting-schemas';

export async function changeVote(
  input: ChangeVoteInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { changeVoteForRequest } = await import(
    '../server/services/voting-service'
  );
  return respondToBoardMutation(() => changeVoteForRequest(input));
}

export async function updateVotingSettings(
  input: UpdateVotingSettingsInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { updateVotingSettingsForRequest } = await import(
    '../server/services/voting-service'
  );
  return respondToBoardMutation(() => updateVotingSettingsForRequest(input));
}

export async function resetVotes(
  input: ResetVotesInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { resetVotesForRequest } = await import(
    '../server/services/voting-service'
  );
  return respondToBoardMutation(() => resetVotesForRequest(input));
}
