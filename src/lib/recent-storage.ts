export const DEFAULT_MAX_RECENT_ENTRIES = 20;

export interface RecentStorageItem {
  id: string;
}

export interface RecentStorageOptions<T extends RecentStorageItem> {
  storageKey: string;
  maxEntries?: number;
  parseEntry: (value: unknown) => T | null;
}

export interface RecentStorage<T extends RecentStorageItem> {
  read: () => T[];
  record: (id: string, buildEntry: (existing: T | undefined) => T | null) => T[];
  remove: (id: string) => T[];
}

export function createRecentStorage<T extends RecentStorageItem>(
  options: RecentStorageOptions<T>,
): RecentStorage<T> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_RECENT_ENTRIES;

  function read(): T[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(options.storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const seen = new Set<string>();
      const entries: T[] = [];
      for (const item of parsed) {
        const clean = options.parseEntry(item);
        if (clean && !seen.has(clean.id)) {
          seen.add(clean.id);
          entries.push(clean);
          if (entries.length >= maxEntries) break;
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  function write(entries: T[]): void {
    if (typeof window === 'undefined') return;
    try {
      if (entries.length === 0) {
        window.localStorage.removeItem(options.storageKey);
      } else {
        window.localStorage.setItem(options.storageKey, JSON.stringify(entries));
      }
    } catch {
      // Ignore storage quota or SecurityError in restricted browsing modes.
    }
  }

  return {
    read,
    record(id, buildEntry) {
      const existing = read();
      const current = existing.find((item) => item.id === id);
      const nextEntry = buildEntry(current);
      if (!nextEntry) return existing;
      const updated = [
        nextEntry,
        ...existing.filter((item) => item.id !== id),
      ].slice(0, maxEntries);
      write(updated);
      return updated;
    },
    remove(id) {
      const existing = read();
      const updated = existing.filter((item) => item.id !== id);
      if (updated.length !== existing.length) {
        write(updated);
      }
      return updated;
    },
  };
}
