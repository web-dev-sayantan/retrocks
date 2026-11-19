import 'server-only';

import type { BoardMutationActor, RawBoardRow } from '../db/raw-types';

export function checkPrivateCardPermission(
  board: Pick<RawBoardRow, 'isBlurred'>,
  actor: Pick<BoardMutationActor, 'participantHash'>,
  authorTokenHash: string,
): { ok: true } | { ok: false; code: 'FORBIDDEN'; message: string } {
  if (board.isBlurred && actor.participantHash !== authorTokenHash) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Cannot change another Participant\'s Card while Private Mode is active.',
    };
  }
  return { ok: true };
}
