import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRecentStorage } from './recent-storage';
import { formatRelativeTime } from './relative-time';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('createRecentStorage', () => {
  const storage = createRecentStorage<{ id: string; label: string }>({
    storageKey: 'retrocks:test-recent',
    maxEntries: 20,
    parseEntry: (value) => {
      if (!value || typeof value !== 'object') return null;
      const candidate = value as Record<string, unknown>;
      if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') return null;
      return { id: candidate.id, label: candidate.label };
    },
  });

  it('bounds history to 20 unique entries in most-recently-recorded order', () => {
    const ids = Array.from({ length: 22 }, (_, index) => `item-${index}`);
    for (const id of ids) {
      storage.record(id, () => ({ id, label: `Label ${id}` }));
    }

    expect(storage.read().map((entry) => entry.id)).toEqual(ids.slice(2).reverse());

    // Re-recording an existing entry promotes it to the front without duplicating it.
    storage.record('item-5', (existing) => ({
      id: 'item-5',
      label: existing ? `${existing.label} updated` : 'missing',
    }));
    const entries = storage.read();
    expect(entries).toHaveLength(20);
    expect(entries[0]).toEqual({ id: 'item-5', label: 'Label item-5 updated' });
  });

  it('supports conditional recording, removal, and storage errors safely', () => {
    expect(storage.record('missing', (existing) => (existing ? existing : null))).toEqual([]);

    storage.record('one', () => ({ id: 'one', label: 'One' }));
    expect(storage.remove('one')).toEqual([]);
    expect(localStorage.getItem('retrocks:test-recent')).toBeNull();

    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    expect(() => storage.record('two', () => ({ id: 'two', label: 'Two' }))).not.toThrow();
    expect(storage.read()).toEqual([]);
  });
});

describe('formatRelativeTime', () => {
  it('formats seconds, minutes, hours, and days cleanly', () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(now + 5_000, now)).toBe('Just now');
    expect(formatRelativeTime(now - 30_000, now)).toBe('Just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});
