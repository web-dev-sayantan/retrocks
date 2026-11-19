import { httpStatus, respond } from '@solidjs/web';

import type { BoardMutationResponse, BoardMutationSuccess } from './board-types';
import type { ChangeVoteInput, ResetVotesInput, UpdateVotingSettingsInput } from './voting-schemas';

async function respondToVotingMutation(
  run: () => Promise<BoardMutationSuccess>,
): Promise<BoardMutationResponse> {
  const { BoardDomainError } = await import('../server/services/board-service');
  try {
    return respond(await run(), { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      httpStatus(error.status);
      return respond(
        { ok: false, code: error.code, message: error.message },
        { status: error.status, revalidate: [] },
      );
    }
    throw error;
  }
}

export async function changeVote(input: ChangeVoteInput): Promise<BoardMutationResponse> {
  'use server';
  const { changeVoteForRequest } = await import('../server/services/voting-service');
  return respondToVotingMutation(() => changeVoteForRequest(input));
}

export async function updateVotingSettings(input: UpdateVotingSettingsInput): Promise<BoardMutationResponse> {
  'use server';
  const { updateVotingSettingsForRequest } = await import('../server/services/voting-service');
  return respondToVotingMutation(() => updateVotingSettingsForRequest(input));
}

export async function resetVotes(input: ResetVotesInput): Promise<BoardMutationResponse> {
  'use server';
  const { resetVotesForRequest } = await import('../server/services/voting-service');
  return respondToVotingMutation(() => resetVotesForRequest(input));
}
