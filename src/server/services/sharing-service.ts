import 'server-only';
import * as v from 'valibot';

import { decideBoardAction } from '../../lib/board-policy';
import type { BoardViewDTO } from '../../lib/board-types';
import { BoardIdSchema } from '../../lib/schemas';
import { getBoardStore } from '../adapters/runtime';
import { hashTokenWithSalt } from '../crypto';
import { projectBoardForViewer } from '../domain/projection';
import {
  enforceNoStoreHeader,
  FacilitatorTokenSchema,
  facilitatorTokenHashesMatch,
  hashFacilitatorToken,
  mintFacilitatorCapability,
  recoverFacilitatorToken,
} from '../facilitator-capability';
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

async function requireFacilitator(
  boardId: string,
  action: 'facilitator:view-link' | 'facilitator:rotate',
): Promise<void> {
  enforceNoStoreHeader();

  const decision = decideBoardAction(
    {
      isFacilitator: isFacilitatorForBoard(await getSession(), boardId),
      isLocked: false,
    },
    action,
  );
  if (!decision.allowed) {
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
  await requireFacilitator(boardId, 'facilitator:view-link');

  const store = await getBoardStore();
  const capability = await store.getFacilitatorCapability(boardId);
  if (!capability) throw boardNotFound();

  const token = await recoverFacilitatorToken({
    encrypted: capability.facilitatorTokenEncrypted,
    aad: boardId,
    secrets: getSessionSecrets(),
    persistReencrypted: (reencrypted) =>
      store.updateFacilitatorTokenEncryption(boardId, reencrypted),
  });
  if (!token) {
    throw new BoardDomainError(
      'INTERNAL_ERROR',
      'This Co-Facilitator Link could not be recovered. Rotate Link to create a new one.',
    );
  }
  return `/b/${boardId}#f=${token}`;
}

const ClaimFacilitatorRoleSchema = v.object({
  boardId: BoardIdSchema,
  token: FacilitatorTokenSchema,
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
  enforceNoStoreHeader();

  const parsed = v.safeParse(ClaimFacilitatorRoleSchema, input);
  if (!parsed.success) throw invalidLink();
  const { boardId, token } = parsed.output;

  const store = await getBoardStore();
  const tokenSalt = await store.getBoardTokenSalt(boardId);
  if (!tokenSalt) throw invalidLink();

  const candidateHash = await hashFacilitatorToken(token, tokenSalt);
  if (!candidateHash) throw invalidLink();
  // Read the current hash after computing the candidate, in case the link rotated.
  const capability = await store.getFacilitatorCapability(boardId);
  if (
    !capability ||
    !facilitatorTokenHashesMatch(candidateHash, capability.facilitatorTokenHash)
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
  await requireFacilitator(boardId, 'facilitator:rotate');

  const store = await getBoardStore();
  const tokenSalt = await store.getBoardTokenSalt(boardId);
  if (!tokenSalt) throw boardNotFound();

  const {
    token,
    hash: facilitatorTokenHash,
    encrypted: facilitatorTokenEncrypted,
  } = await mintFacilitatorCapability({
    salt: tokenSalt,
    aad: boardId,
    secrets: getSessionSecrets(),
  });

  await executeBoardMutation(boardId, {
    type: 'facilitator:rotate',
    capability: { facilitatorTokenHash, facilitatorTokenEncrypted },
  });
  return `/b/${boardId}#f=${token}`;
}
