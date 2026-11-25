import type { PokerDeleteResult } from '../../lib/poker-types';
import { projectPokerRoom, type StoredPokerRoom } from './room';

export type PokerRoomPublication =
  | { type: 'snapshot'; room: StoredPokerRoom; terminal: boolean }
  | { type: 'missing'; terminal: true; frame: { type: 'room:missing' } };

export const missingPokerRoom: PokerRoomPublication = { type: 'missing', terminal: true, frame: { type: 'room:missing' } };

function pokerRoomSnapshot(room: StoredPokerRoom): PokerRoomPublication {
  return { type: 'snapshot', room, terminal: room.closedAt !== undefined };
}

export function committedPokerMutation(result: { ok: false } | { ok: true; room: StoredPokerRoom; updated?: true }) {
  return result.ok && result.updated ? pokerRoomSnapshot(result.room) : undefined;
}

export function committedPokerDeletion(result: PokerDeleteResult) {
  return result.ok ? missingPokerRoom : undefined;
}

export function projectPokerPublication(publication: PokerRoomPublication, hash: string) {
  if (publication.type === 'missing') return publication.frame;
  return { type: 'room:snapshot' as const, room: projectPokerRoom(publication.room, hash) };
}
