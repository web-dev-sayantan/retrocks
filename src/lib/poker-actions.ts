import { formAction, query } from '@solidjs/router';
import { httpStatus, redirect, respond } from '@solidjs/web';

import { pokerRoomPath } from './poker-routes';
import type { PokerDeleteResult, PokerResult, PokerRoomView, PokerRoomChange } from './poker-types';

export const getPokerRoom = query(async (id: string): Promise<PokerRoomView | null> => {
  'use server';
  const { readPokerRoomForRequest } = await import('../server/poker/service');
  const room = await readPokerRoomForRequest(id);
  if (!room) httpStatus(404);
  return room;
}, 'poker-room');

export const createPokerRoom = formAction(async (form: FormData) => {
  'use server';
  const { createPokerRoomForRequest } = await import('../server/poker/service');
  const result = await createPokerRoomForRequest(form.get('displayName'), form.get('roomName'));
  if (result.ok) return redirect(pokerRoomPath(result.room.id));
  return pokerResponse(result);
});

export const joinPokerRoom = formAction(submitPokerRoomJoin);

export async function submitPokerRoomJoin(id: string, form: FormData) {
  'use server';
  const { mutatePokerRoomForRequest } = await import('../server/poker/service');
  const result = await mutatePokerRoomForRequest(id, {
    type: 'join', displayName: form.get('displayName'),
  });
  if (result.ok || result.code === 'ROOM_CLOSED') return redirect(pokerRoomPath(id));
  return pokerResponse(result);
}

export async function changePokerRoom(id: string, command: PokerRoomChange): Promise<PokerResult> {
  'use server';
  const { mutatePokerRoomForRequest } = await import('../server/poker/service');
  return pokerResponse(await mutatePokerRoomForRequest(id, command));
}

export async function deletePokerRoom(id: string): Promise<PokerDeleteResult> {
  'use server';
  const { deletePokerRoomForRequest } = await import('../server/poker/service');
  return pokerResponse(await deletePokerRoomForRequest(id));
}

function pokerResponse<T extends PokerResult | PokerDeleteResult>(result: T) {
  const status = result.ok ? 200 : {
    ROOM_NOT_FOUND: 404,
    INVALID_INPUT: 400,
    FORBIDDEN: 403,
    RATE_LIMITED: 429,
    ROUND_CHANGED: 409,
    DECK_LOCKED: 409,
    STORY_LOCKED: 409,
    ROOM_CLOSED: 409,
  }[result.code];
  return respond(result, { status, revalidate: [] });
}
