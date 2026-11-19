import 'server-only';

import {
  DissolveCardGroupInputSchema,
  GroupCardsInputSchema,
  MoveCardGroupInputSchema,
  RenameCardGroupInputSchema,
  UngroupCardInputSchema,
} from '../../lib/schemas';
import { generateEntityId } from '../crypto';
import { executeBoardMutation, parseMutationInput } from './board-service';

export async function groupCardsForRequest(rawInput: unknown) {
  const input = parseMutationInput(GroupCardsInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'group:merge',
    cardId: input.cardId,
    targetType: input.targetType,
    targetId: input.targetId,
    groupId: generateEntityId(),
  });
}

export async function renameCardGroupForRequest(rawInput: unknown) {
  const input = parseMutationInput(RenameCardGroupInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'group:rename',
    groupId: input.groupId,
    title: input.title,
  });
}

export async function ungroupCardForRequest(rawInput: unknown) {
  const input = parseMutationInput(UngroupCardInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'group:ungroup',
    cardId: input.cardId,
  });
}

export async function dissolveCardGroupForRequest(rawInput: unknown) {
  const input = parseMutationInput(DissolveCardGroupInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'group:dissolve',
    groupId: input.groupId,
  });
}

export async function moveCardGroupForRequest(rawInput: unknown) {
  const input = parseMutationInput(MoveCardGroupInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'group:move',
    groupId: input.groupId,
    targetColumnId: input.targetColumnId,
  });
}
