import { respond } from '@solidjs/web';

import type { ActionError } from './board-types';

export type FacilitatorClaimInput = { boardId: string; token: string };
export type FacilitatorClaimResponse = { ok: true } | ActionError;
export type FacilitatorLinkResponse = { ok: true; link: string } | ActionError;

export async function claimFacilitatorRole(
  input: FacilitatorClaimInput,
): Promise<FacilitatorClaimResponse> {
  'use server';
  const { BoardDomainError } = await import('../server/services/board-service');
  const { claimFacilitatorRoleForRequest } = await import(
    '../server/services/sharing-service'
  );
  try {
    await claimFacilitatorRoleForRequest(input);
    return respond({ ok: true } as const, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message } as const,
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function getFacilitatorLink(
  boardId: string,
): Promise<FacilitatorLinkResponse> {
  'use server';
  const { BoardDomainError } = await import('../server/services/board-service');
  const { getFacilitatorLinkForRequest } = await import(
    '../server/services/sharing-service'
  );
  try {
    const link = await getFacilitatorLinkForRequest(boardId);
    return respond({ ok: true, link } as const, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message } as const,
        { revalidate: [] },
      );
    }
    throw error;
  }
}

export async function rotateFacilitatorLink(
  boardId: string,
): Promise<FacilitatorLinkResponse> {
  'use server';
  const { BoardDomainError } = await import('../server/services/board-service');
  const { rotateFacilitatorLinkForRequest } = await import(
    '../server/services/sharing-service'
  );
  try {
    const link = await rotateFacilitatorLinkForRequest(boardId);
    return respond({ ok: true, link } as const, { revalidate: [] });
  } catch (error) {
    if (error instanceof BoardDomainError) {
      return respond(
        { ok: false, code: error.code, message: error.message } as const,
        { revalidate: [] },
      );
    }
    throw error;
  }
}
