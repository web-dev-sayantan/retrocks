import { httpStatus, respond } from '@solidjs/web';

import type {
  ActionError,
  BoardMutationResponse,
  BoardMutationSuccess,
} from './board-types';

export async function respondToServerAction<T extends { ok: true }>(
  run: () => Promise<T>,
): Promise<T | ActionError> {
  const { BoardDomainError } = await import('../server/services/board-service');
  try {
    return respond(await run(), { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      httpStatus(error.status);
      return respond(
        { ok: false, code: error.code, message: error.message } as const,
        { status: error.status, revalidate: [] },
      );
    }
    throw error;
  }
}

export function respondToBoardMutation(
  run: () => Promise<BoardMutationSuccess>,
): Promise<BoardMutationResponse> {
  return respondToServerAction(run);
}
