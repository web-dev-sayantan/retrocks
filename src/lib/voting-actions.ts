import { respondToBoardMutation } from './action-response';
import type { BoardMutationResponse } from './board-types';
import type { ChangeVoteInput } from './voting-schemas';

export async function changeVote(
  input: ChangeVoteInput,
): Promise<BoardMutationResponse> {
  'use server';
  const { changeVoteForRequest } = await import(
    '../server/services/voting-service'
  );
  return respondToBoardMutation(() => changeVoteForRequest(input));
}
