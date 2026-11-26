import 'server-only';
import { getRequestEvent } from '@solidjs/web';
import { safeParse } from 'valibot';

import { PokerCommand, PokerRoomId } from '../../lib/poker-schemas';
import { POKER_ROOM_NAME_LIMIT, type PokerDeleteResult, type PokerResult, type PokerRoomView } from '../../lib/poker-types';
import { generateEntityId, hashTokenWithSalt } from '../crypto';
import { createLiveHttpHandler } from '../live/http-guard';
import { checkPokerCreateRateLimit } from '../rate-limit';
import { ensureParticipantSession, type RetrocksSession } from '../session';
import { pokerDisplayName, pokerRoomName } from './room';
import { getPokerRoomAccess } from './runtime';

export function hashPokerParticipant(roomId: string, session: RetrocksSession) {
  return hashTokenWithSalt(session.participantId, `poker:${roomId}`);
}

export async function createPokerRoomForRequest(input: unknown, roomNameInput?: unknown): Promise<PokerResult> {
  const displayName = pokerDisplayName(input);
  if (!displayName) return { ok: false, code: 'INVALID_INPUT', message: 'Enter a valid Display Name.' };
  const roomName = pokerRoomName(roomNameInput);
  if (!roomName) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `Enter a Room name of ${POKER_ROOM_NAME_LIMIT} characters or fewer.`,
    };
  }
  const request = getRequestEvent()?.request;
  if (!request) throw new Error('A request is required to create a Room.');
  if (!(await checkPokerCreateRateLimit(request)).allowed) {
    return { ok: false, code: 'RATE_LIMITED', message: 'Too many Rooms created recently. Try again shortly.' };
  }

  const session = await ensureParticipantSession({ renew: true });
  const id = generateEntityId();
  const room = await getPokerRoomAccess(id);
  return { ok: true, room: await room.create(await hashPokerParticipant(id, session), displayName, roomName) };
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
  if (!command.success) {
    const type = input && typeof input === 'object' && 'type' in input ? input.type : undefined;
    const message = type === 'set-deck' ? 'Enter at least two different, nonblank Deck choices.'
      : type === 'join' ? 'Enter a valid Display Name.'
      : type === 'rename-room' ? `Enter a Room name of ${POKER_ROOM_NAME_LIMIT} characters or fewer.`
      : 'Check the Room details and try again.';
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message,
    };
  }

  const session = await ensureParticipantSession({ renew: true });
  const room = await getPokerRoomAccess(id);
  return room.mutate(await hashPokerParticipant(id, session), command.output);
}

export async function deletePokerRoomForRequest(id: string): Promise<PokerDeleteResult> {
  if (!safeParse(PokerRoomId, id).success) {
    return { ok: false, code: 'ROOM_NOT_FOUND', message: 'This Room is no longer available.' };
  }

  const session = await ensureParticipantSession({ renew: true });
  const room = await getPokerRoomAccess(id);
  return room.delete(await hashPokerParticipant(id, session));
}

export const handlePokerLiveRequest = createLiveHttpHandler<string>({
  isValidId: (id) => safeParse(PokerRoomId, id).success,
  async resolveTransport(id) {
    const room = await getPokerRoomAccess(id);
    const recordHeartbeat = room.heartbeat;
    return {
      connect: (_id, request, hash) => room.connect(hash, request),
      heartbeat: recordHeartbeat
        ? (_id, connectionId, hash) => recordHeartbeat(hash, connectionId)
        : undefined,
    };
  },
  resolveViewer: (id, session) => hashPokerParticipant(id, session),
});
