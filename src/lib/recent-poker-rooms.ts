import { is } from 'valibot';

import { PokerRoomId } from './poker-schemas';
import { POKER_DEFAULT_ROOM_NAME } from './poker-types';

const storageKey = 'retrocks:recent-poker-rooms';
const maxRooms = 20;

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

export function readRecentPokerRooms(): RecentPokerRoom[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(parsed)) return [];

    const rooms = new Map<string, RecentPokerRoom>();
    for (const entry of parsed) {
      const clean = parseRecentPokerRoom(entry);
      if (clean && !rooms.has(clean.id)) {
        rooms.set(clean.id, clean);
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

export function recordRecentPokerRoom(
  id: string,
  { name, onlyIfSaved = false }: { name?: string; onlyIfSaved?: boolean } = {},
): void {
  if (!is(PokerRoomId, id)) return;
  const rooms = readRecentPokerRooms();
  const existing = rooms.find((room) => room.id === id);
  const others = rooms.filter((room) => room.id !== id);
  if (onlyIfSaved && !existing) return;
  const resolvedName = name !== undefined ? normalizeName(name) : (existing?.name ?? POKER_DEFAULT_ROOM_NAME);
  saveRecentPokerRooms([{ id, name: resolvedName, lastVisitedAt: Date.now() }, ...others].slice(0, maxRooms));
}

export function removeRecentPokerRoom(id: string): RecentPokerRoom[] {
  const rooms = readRecentPokerRooms();
  const remaining = rooms.filter((room) => room.id !== id);
  if (remaining.length !== rooms.length) saveRecentPokerRooms(remaining);
  return remaining;
}
