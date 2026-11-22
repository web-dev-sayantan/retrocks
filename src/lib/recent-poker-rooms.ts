import { is } from 'valibot';

import { PokerRoomId } from './poker-schemas';

const storageKey = 'retrocks:recent-poker-rooms';
const maxRooms = 20;

interface RecentPokerRoom {
  id: string;
  lastVisitedAt: number;
}

function isRecentPokerRoom(value: unknown): value is RecentPokerRoom {
  return typeof value === 'object' && value !== null
    && 'id' in value && is(PokerRoomId, value.id)
    && 'lastVisitedAt' in value && Number.isFinite(value.lastVisitedAt);
}

export function readRecentPokerRooms(): RecentPokerRoom[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(parsed)) return [];

    const rooms = new Map<string, RecentPokerRoom>();
    for (const entry of parsed) {
      if (isRecentPokerRoom(entry) && !rooms.has(entry.id)) {
        rooms.set(entry.id, { id: entry.id, lastVisitedAt: entry.lastVisitedAt });
        if (rooms.size === maxRooms) break;
      }
    }
    return [...rooms.values()];
  } catch {
    return [];
  }
}

function saveRecentPokerRooms(rooms: RecentPokerRoom[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (rooms.length) window.localStorage.setItem(storageKey, JSON.stringify(rooms));
    else window.localStorage.removeItem(storageKey);
  } catch {
    // Browser policy or storage quota can prevent saving history.
  }
}

export function recordRecentPokerRoom(id: string, { onlyIfSaved = false } = {}): void {
  if (!is(PokerRoomId, id)) return;
  const rooms = readRecentPokerRooms();
  const others = rooms.filter((room) => room.id !== id);
  if (onlyIfSaved && others.length === rooms.length) return;
  saveRecentPokerRooms([{ id, lastVisitedAt: Date.now() }, ...others].slice(0, maxRooms));
}

export function removeRecentPokerRoom(id: string): RecentPokerRoom[] {
  const rooms = readRecentPokerRooms();
  const remaining = rooms.filter((room) => room.id !== id);
  if (remaining.length !== rooms.length) saveRecentPokerRooms(remaining);
  return remaining;
}
