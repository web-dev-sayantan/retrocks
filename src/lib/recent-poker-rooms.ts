import { is } from 'valibot';

import { PokerRoomId } from './poker-schemas';
import { POKER_DEFAULT_ROOM_NAME } from './poker-types';
import { createRecentStorage } from './recent-storage';

const storageKey = 'retrocks:recent-poker-rooms';

interface RecentPokerRoom {
  id: string;
  name: string;
  lastVisitedAt: number;
}

function normalizeName(name: unknown): string {
  return typeof name === 'string' && name.trim() ? name.trim() : POKER_DEFAULT_ROOM_NAME;
}

function parseRecentPokerRoom(value: unknown): RecentPokerRoom | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('id' in value) || !is(PokerRoomId, value.id)) return null;
  if (!('lastVisitedAt' in value) || !Number.isFinite(value.lastVisitedAt)) return null;
  const name = 'name' in value ? normalizeName(value.name) : POKER_DEFAULT_ROOM_NAME;
  return { id: value.id, name, lastVisitedAt: value.lastVisitedAt as number };
}

const recentPokerRoomsStorage = createRecentStorage<RecentPokerRoom>({
  storageKey,
  parseEntry: parseRecentPokerRoom,
});

export function readRecentPokerRooms(): RecentPokerRoom[] {
  return recentPokerRoomsStorage.read();
}

export function recordRecentPokerRoom(
  id: string,
  { name, onlyIfSaved = false }: { name?: string; onlyIfSaved?: boolean } = {},
): void {
  if (!is(PokerRoomId, id)) return;
  recentPokerRoomsStorage.record(id, (existing) => {
    if (onlyIfSaved && !existing) return null;
    const resolvedName = name !== undefined ? normalizeName(name) : (existing?.name ?? POKER_DEFAULT_ROOM_NAME);
    return { id, name: resolvedName, lastVisitedAt: Date.now() };
  });
}

export function removeRecentPokerRoom(id: string): RecentPokerRoom[] {
  return recentPokerRoomsStorage.remove(id);
}
