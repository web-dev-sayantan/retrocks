import 'server-only';
import { getRequestEvent } from '@solidjs/web';
import { safeParse } from 'valibot';

import { PokerCommand, PokerRoomId } from '../../lib/poker-schemas';
import type { PokerResult, PokerRoomView } from '../../lib/poker-types';
import { generateEntityId, hashTokenWithSalt } from '../crypto';
import { checkBoardCreateRateLimit } from '../rate-limit';
import { ensureParticipantSession, getSessionFromRequest, type RetrocksSession } from '../session';
import { pokerDisplayName } from './room';
import { getPokerRoomAccess } from './runtime';

export function hashPokerParticipant(roomId: string, session: RetrocksSession) {
  return hashTokenWithSalt(session.participantId, `poker:${roomId}`);
}

export async function createPokerRoomForRequest(input: unknown): Promise<PokerResult> {
  const displayName = pokerDisplayName(input);
  if (!displayName) return { ok: false, code: 'INVALID_INPUT', message: 'Enter a valid Display Name.' };
  const request = getRequestEvent()?.request;
  if (!request) throw new Error('A request is required to create a Room.');
  if (!(await checkBoardCreateRateLimit(request)).allowed) {
    return { ok: false, code: 'RATE_LIMITED', message: 'Too many Rooms created recently. Try again shortly.' };
  }

  const session = await ensureParticipantSession({ renew: true });
  const id = generateEntityId();
  const room = await getPokerRoomAccess(id);
  return { ok: true, room: await room.create(await hashPokerParticipant(id, session), displayName) };
}

export async function readPokerRoomForRequest(id: string): Promise<PokerRoomView | null> {
  if (!safeParse(PokerRoomId, id).success) return null;
  const session = await ensureParticipantSession();
  const room = await getPokerRoomAccess(id);
  return room.read(await hashPokerParticipant(id, session));
}

export async function mutatePokerRoomForRequest(id: string, input: unknown): Promise<PokerResult> {
  if (!safeParse(PokerRoomId, id).success) {
    return { ok: false, code: 'ROOM_NOT_FOUND', message: 'This Room is no longer available.' };
  }
  const command = safeParse(PokerCommand, input);
  if (!command.success) return { ok: false, code: 'INVALID_INPUT', message: 'Enter a valid Display Name.' };

  const session = await ensureParticipantSession({ renew: true });
  const room = await getPokerRoomAccess(id);
  return room.mutate(await hashPokerParticipant(id, session), command.output);
}

export async function handlePokerLiveRequest(id: string, request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return new Response(null, { status: 403 });
  }
  if (!safeParse(PokerRoomId, id).success) return new Response(null, { status: 404 });

  const session = await getSessionFromRequest(request);
  if (!session) return new Response(null, { status: 401 });
  const hash = await hashPokerParticipant(id, session);
  const room = await getPokerRoomAccess(id);
  return request.method === 'POST'
    ? room.heartbeat(hash, request)
    : room.connect(hash, request);
}
