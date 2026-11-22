import { respondToServerAction } from './action-response';
import type { ActionError, BoardViewDTO } from './board-types';

export type FacilitatorClaimInput = { boardId: string; token: string };
export type FacilitatorClaimResponse =
  | { ok: true; board: BoardViewDTO }
  | ActionError;
export type FacilitatorLinkResponse = { ok: true; link: string } | ActionError;

export async function claimFacilitatorRole(
  input: FacilitatorClaimInput,
): Promise<FacilitatorClaimResponse> {
  'use server';
  const { claimFacilitatorRoleForRequest } = await import(
    '../server/services/sharing-service'
  );
  return respondToServerAction(async () => ({
    ok: true as const,
    board: await claimFacilitatorRoleForRequest(input),
  }));
}

export async function getFacilitatorLink(
  boardId: string,
): Promise<FacilitatorLinkResponse> {
  'use server';
  const { getFacilitatorLinkForRequest } = await import(
    '../server/services/sharing-service'
  );
  return respondToServerAction(async () => ({
    ok: true as const,
    link: await getFacilitatorLinkForRequest(boardId),
  }));
}

export async function rotateFacilitatorLink(
  boardId: string,
): Promise<FacilitatorLinkResponse> {
  'use server';
  const { rotateFacilitatorLinkForRequest } = await import(
    '../server/services/sharing-service'
  );
  return respondToServerAction(async () => ({
    ok: true as const,
    link: await rotateFacilitatorLinkForRequest(boardId),
  }));
}
