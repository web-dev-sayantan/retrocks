import 'server-only';

import { safeParse } from 'valibot';

import { pokerRoomPath } from '../../lib/poker-routes';
import { PokerRoomId } from '../../lib/poker-schemas';
import type { PokerFacilitatorLink, PokerSharingResult } from '../../lib/poker-sharing-types';
import type { PokerRoomView } from '../../lib/poker-types';
import {
  enforceNoStoreHeader,
  hashFacilitatorToken,
  mintFacilitatorCapability,
  recoverFacilitatorToken,
} from '../facilitator-capability';
import { ensureParticipantSession, getSession, getSessionSecrets } from '../session';
import { invalidPokerFacilitatorLink, type PokerFacilitatorCapability } from './room';
import { getPokerRoomAccess } from './runtime';
import { hashPokerParticipant } from './service';

const linkUnavailable = {
  ok: false,
  code: 'LINK_UNAVAILABLE',
  message: 'Could not retrieve the Co-Facilitator Link. Replace the link to create a new one.',
} as const;
const forbidden = { ok: false, code: 'FORBIDDEN', message: 'Facilitator access is required.' } as const;
const roomNotFound = { ok: false, code: 'ROOM_NOT_FOUND', message: 'This Room is no longer available.' } as const;

function capabilityScope(id: string) {
  return `poker:facilitator:${id}`;
}

function facilitatorLink(id: string, token: string, revision: number): PokerSharingResult<PokerFacilitatorLink> {
  return { ok: true, value: { href: `${pokerRoomPath(id)}#f=${token}`, revision } };
}

async function issueLink(id: string, hash: string, revision: number) {
  const scope = capabilityScope(id);
  const { token, hash: tokenHash, encrypted } = await mintFacilitatorCapability({
    salt: scope,
    aad: scope,
    secrets: getSessionSecrets(),
  });
  const room = await getPokerRoomAccess(id);
  const result = await room.replaceFacilitatorCapability(hash, revision, {
    hash: tokenHash, encrypted, revision: revision + 1,
  } satisfies PokerFacilitatorCapability);
  return result.ok ? facilitatorLink(id, token, revision + 1) : result;
}

export async function getPokerFacilitatorLinkForRequest(id: string): Promise<PokerSharingResult<PokerFacilitatorLink>> {
  enforceNoStoreHeader();
  if (!safeParse(PokerRoomId, id).success) return roomNotFound;
  const session = await getSession();
  if (!session) return forbidden;
  const hash = await hashPokerParticipant(id, session);
  const room = await getPokerRoomAccess(id);
  let result = await room.getFacilitatorCapability(hash);
  if (!result.ok) return result;
  if (!result.value) {
    const issued = await issueLink(id, hash, 0);
    if (issued.ok || issued.code !== 'LINK_REPLACED') return issued;
    result = await room.getFacilitatorCapability(hash);
    if (!result.ok) return result;
    if (!result.value) return linkUnavailable;
  }

  const { encrypted, revision } = result.value;
  const token = await recoverFacilitatorToken({
    encrypted,
    aad: capabilityScope(id),
    secrets: getSessionSecrets(),
    persistReencrypted: (reencrypted) =>
      room.updateFacilitatorCapabilityEncryption(hash, revision, reencrypted),
  });
  return token ? facilitatorLink(id, token, revision) : linkUnavailable;
}

export async function replacePokerFacilitatorLinkForRequest(
  id: string,
  revision: number,
): Promise<PokerSharingResult<PokerFacilitatorLink>> {
  enforceNoStoreHeader();
  if (!safeParse(PokerRoomId, id).success) return roomNotFound;
  if (!Number.isSafeInteger(revision) || revision <= 0) return invalidPokerFacilitatorLink;
  const session = await getSession();
  if (!session) return forbidden;
  return issueLink(id, await hashPokerParticipant(id, session), revision);
}

export async function claimPokerFacilitatorLinkForRequest(
  id: string,
  token: string,
): Promise<PokerSharingResult<PokerRoomView>> {
  enforceNoStoreHeader();
  if (!safeParse(PokerRoomId, id).success) {
    return invalidPokerFacilitatorLink;
  }
  const candidate = await hashFacilitatorToken(token, capabilityScope(id));
  if (!candidate) {
    return invalidPokerFacilitatorLink;
  }
  const session = await ensureParticipantSession({ renew: true });
  const hash = await hashPokerParticipant(id, session);
  const room = await getPokerRoomAccess(id);
  return room.claimFacilitator(hash, candidate);
}
