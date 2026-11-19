import 'server-only';
import { getRequestEvent } from '@solidjs/web';
import * as v from 'valibot';

import { BoardIdSchema } from '../../lib/schemas';
import { getBoardStore } from '../adapters/runtime';
import {
  decryptFacilitatorToken,
  encryptFacilitatorToken,
  generateFacilitatorToken,
  hashTokenWithSalt,
} from '../crypto';
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

  const decrypted = await decryptFacilitatorToken(
    capability.facilitatorTokenEncrypted,
    boardId,
    getSessionSecrets(),
  );
  if (!decrypted) {
    throw new BoardDomainError(
      'INTERNAL_ERROR',
      'This Co-Facilitator Link could not be recovered. Rotate Link to create a new one.',
    );
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

function tokenHashesMatch(candidateHash: string, storedHash: string): boolean {
  if (candidateHash.length !== storedHash.length) return false;

  let difference = 0;
  for (let index = 0; index < candidateHash.length; index += 1) {
    difference |= candidateHash.charCodeAt(index) ^ storedHash.charCodeAt(index);
  }
  return difference === 0;
}

export async function claimFacilitatorRoleForRequest(
  input: unknown,
): Promise<void> {
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

  await grantFacilitatorSession(boardId);
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
