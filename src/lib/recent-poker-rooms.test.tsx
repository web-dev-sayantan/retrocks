import { afterEach, expect, it, vi } from 'vitest';

import { readRecentPokerRooms, recordRecentPokerRoom } from './recent-poker-rooms';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('keeps the 20 most recently visited Rooms with one entry per Room', () => {
  const ids = Array.from({ length: 21 }, (_, index) => String(index).padStart(22, '0'));
  for (const id of ids) recordRecentPokerRoom(id);

  expect(readRecentPokerRooms().map(({ id }) => id)).toEqual(ids.slice(1).reverse());
  recordRecentPokerRoom(ids[1]);
  expect(readRecentPokerRooms().map(({ id }) => id)).toEqual([ids[1], ...ids.slice(2).reverse()]);
});

it('works when browser policy denies access to storage', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Storage unavailable', 'SecurityError');
  });

  expect(() => recordRecentPokerRoom('a'.repeat(22))).not.toThrow();
  expect(readRecentPokerRooms()).toEqual([]);
});
