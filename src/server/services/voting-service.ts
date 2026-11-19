import 'server-only';

import {
  ChangeVoteInputSchema,
  ResetVotesInputSchema,
  UpdateVotingSettingsInputSchema,
} from '../../lib/voting-schemas';
import { executeBoardMutation, parseMutationInput } from './board-service';

export async function changeVoteForRequest(rawInput: unknown) {
  const { boardId, ...input } = parseMutationInput(ChangeVoteInputSchema, rawInput);
  return executeBoardMutation(boardId, { type: 'vote:change', ...input });
}

export async function updateVotingSettingsForRequest(rawInput: unknown) {
  const { boardId, ...patch } = parseMutationInput(UpdateVotingSettingsInputSchema, rawInput);
  return executeBoardMutation(boardId, { type: 'voting:configure', ...patch });
}

export async function resetVotesForRequest(rawInput: unknown) {
  const { boardId } = parseMutationInput(ResetVotesInputSchema, rawInput);
  return executeBoardMutation(boardId, { type: 'voting:reset' });
}
