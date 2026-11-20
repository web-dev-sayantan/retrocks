import { respond } from '@solidjs/web';

import type { PokerFacilitatorLink, PokerSharingResult } from './poker-sharing-types';
import type { PokerRoomView } from './poker-types';

const errorStatus = {
  ROOM_NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_LINK: 403,
  LINK_REPLACED: 409,
  RATE_LIMITED: 429,
  LINK_UNAVAILABLE: 500,
};

function sharingResponse<T>(result: PokerSharingResult<T>): PokerSharingResult<T> {
  return respond(result, { status: result.ok ? 200 : errorStatus[result.code], revalidate: [] });
}

export async function getPokerFacilitatorLink(id: string): Promise<PokerSharingResult<PokerFacilitatorLink>> {
  'use server';
  const { getPokerFacilitatorLinkForRequest } = await import('../server/poker/sharing');
  return sharingResponse(await getPokerFacilitatorLinkForRequest(id));
}

export async function replacePokerFacilitatorLink(
  id: string,
  revision: number,
): Promise<PokerSharingResult<PokerFacilitatorLink>> {
  'use server';
  const { replacePokerFacilitatorLinkForRequest } = await import('../server/poker/sharing');
  return sharingResponse(await replacePokerFacilitatorLinkForRequest(id, revision));
}

export async function claimPokerFacilitatorLink(id: string, token: string): Promise<PokerSharingResult<PokerRoomView>> {
  'use server';
  const { claimPokerFacilitatorLinkForRequest } = await import('../server/poker/sharing');
  return sharingResponse(await claimPokerFacilitatorLinkForRequest(id, token));
}
