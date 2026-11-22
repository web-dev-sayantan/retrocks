import 'server-only';
import { getRequestEvent } from '@solidjs/web';
import * as v from 'valibot';

import type { BoardViewDTO } from '../../lib/board-types';
import { BoardIdSchema } from '../../lib/schemas';
import { getBoardStore } from '../adapters/runtime';
import {
  decryptFacilitatorToken,
  encryptFacilitatorToken,
  generateFacilitatorToken,
  hashTokenWithSalt,
  tokenHashesMatch,
} from '../crypto';
import { projectBoardForViewer } from '../domain/projection';
import {
  getSession,
  getSessionSecrets,
  grantFacilitatorSession,
  isFacilitatorForBoard,
} from '../session';
import { BoardDomainError, executeBoardMutation } from './board-service';

function parseBoardId(input: unknown): string {
  const parsed = v.safeParse(BoardIdSchema, input);
  if (!parsed.success) {
    throw new BoardDomainError('VALIDATION_ERROR', 'Invalid Board ID.');
  }
  return parsed.output;
}

async function requireFacilitator(boardId: string): Promise<void> {
  getRequestEvent()?.response.headers.set('cache-control', 'no-store');

  if (!isFacilitatorForBoard(await getSession(), boardId)) {
    throw new BoardDomainError('FORBIDDEN', 'Facilitator access is required.');
  }
}

function boardNotFound(): BoardDomainError {
  return new BoardDomainError('BOARD_NOT_FOUND', 'Board not found or expired.');
}

export async function getFacilitatorLinkForRequest(
  input: unknown,
): Promise<string> {
  const boardId = parseBoardId(input);
  await requireFacilitator(boardId);

  const store = await getBoardStore();
  const capability = await store.getFacilitatorCapability(boardId);
  if (!capability) throw boardNotFound();

  const secrets = getSessionSecrets();
  const decrypted = await decryptFacilitatorToken(
    capability.facilitatorTokenEncrypted,
    boardId,
    secrets,
  );
  if (!decrypted) {
    throw new BoardDomainError(
      'INTERNAL_ERROR',
      'This Co-Facilitator Link could not be recovered. Rotate Link to create a new one.',
    );
  }
  if (decrypted.needsReencrypt) {
    const reencrypted = await encryptFacilitatorToken(
      decrypted.token,
      boardId,
      secrets,
    );
    await store.updateFacilitatorTokenEncryption(boardId, reencrypted);
  }
  return `/b/${boardId}#f=${decrypted.token}`;
}

const ClaimFacilitatorRoleSchema = v.object({
  boardId: BoardIdSchema,
  token: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/)),
});

function invalidLink(): BoardDomainError {
  return new BoardDomainError(
    'FORBIDDEN',
    'This Co-Facilitator Link is invalid or has expired.',
  );
}

export async function claimFacilitatorRoleForRequest(
  input: unknown,
): Promise<BoardViewDTO> {
  getRequestEvent()?.response.headers.set('cache-control', 'no-store');

  const parsed = v.safeParse(ClaimFacilitatorRoleSchema, input);
  if (!parsed.success) throw invalidLink();
  const { boardId, token } = parsed.output;

  const store = await getBoardStore();
  const tokenSalt = await store.getBoardTokenSalt(boardId);
  if (!tokenSalt) throw invalidLink();

  const candidateHash = await hashTokenWithSalt(token, tokenSalt);
  // Read the current hash after computing the candidate, in case the link rotated.
  const capability = await store.getFacilitatorCapability(boardId);
  if (
    !capability ||
    !tokenHashesMatch(candidateHash, capability.facilitatorTokenHash)
  ) {
    throw invalidLink();
  }

  const rawSnapshot = await store.getBoardSnapshot(boardId);
  if (!rawSnapshot) throw invalidLink();

  const session = await grantFacilitatorSession(boardId);
  const viewerParticipantHash = await hashTokenWithSalt(
    session.participantId,
    rawSnapshot.board.tokenSalt,
  );
  return projectBoardForViewer(rawSnapshot, viewerParticipantHash, true);
}

export async function rotateFacilitatorLinkForRequest(
  input: unknown,
): Promise<string> {
  const boardId = parseBoardId(input);
  await requireFacilitator(boardId);

  const store = await getBoardStore();
  const tokenSalt = await store.getBoardTokenSalt(boardId);
  if (!tokenSalt) throw boardNotFound();

  const token = generateFacilitatorToken();
  const [facilitatorTokenHash, facilitatorTokenEncrypted] = await Promise.all([
    hashTokenWithSalt(token, tokenSalt),
    encryptFacilitatorToken(token, boardId, getSessionSecrets()),
  ]);

  await executeBoardMutation(boardId, {
    type: 'facilitator:rotate',
    capability: { facilitatorTokenHash, facilitatorTokenEncrypted },
  });
  return `/b/${boardId}#f=${token}`;
}
