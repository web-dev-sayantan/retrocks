export const RECENT_BOARDS_STORAGE_KEY = 'retrocks:recent-boards';
const MAX_RECENT_BOARDS = 20;

/**
 * Client-side only history entry stored in `localStorage`.
 * Strictly contains only Board ID, title, last visited timestamp, and a
 * non-sensitive boolean display hint — never raw tokens or secrets.
 */
export interface RecentBoardEntry {
  id: string;
  title: string;
  lastVisitedAt: number;
  isFacilitator?: boolean;
}

function isStorageAvailable(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  );
}

function sanitizeEntry(value: unknown): RecentBoardEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length === 0 ||
    typeof candidate.title !== 'string' ||
    candidate.title.length === 0 ||
    typeof candidate.lastVisitedAt !== 'number' ||
    !Number.isFinite(candidate.lastVisitedAt)
  ) {
    return null;
  }
  return {
    id: candidate.id,
    title: candidate.title,
    lastVisitedAt: candidate.lastVisitedAt,
    ...(candidate.isFacilitator === true ? { isFacilitator: true } : {}),
  };
}

export function readRecentBoards(): RecentBoardEntry[] {
  if (!isStorageAvailable()) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_BOARDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const entries: RecentBoardEntry[] = [];
    for (const item of parsed) {
      const clean = sanitizeEntry(item);
      if (clean && !seen.has(clean.id)) {
        seen.add(clean.id);
        entries.push(clean);
        if (entries.length >= MAX_RECENT_BOARDS) break;
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function writeRecentBoards(entries: RecentBoardEntry[]): void {
  if (!isStorageAvailable()) return;
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(RECENT_BOARDS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        RECENT_BOARDS_STORAGE_KEY,
        JSON.stringify(entries),
      );
    }
  } catch {
    // Ignore storage quota or SecurityError in restricted browsing modes.
  }
}

export function recordRecentBoard(
  entry: { id: string; title: string; isFacilitator?: boolean },
  now: number = Date.now(),
): RecentBoardEntry[] {
  const existing = readRecentBoards();
  const nextEntry: RecentBoardEntry = {
    id: entry.id,
    title: entry.title,
    lastVisitedAt: now,
    ...(entry.isFacilitator === true ? { isFacilitator: true } : {}),
  };
  const updated = [
    nextEntry,
    ...existing.filter((item) => item.id !== entry.id),
  ].slice(0, MAX_RECENT_BOARDS);
  writeRecentBoards(updated);
  return updated;
}

export function removeRecentBoard(boardId: string): RecentBoardEntry[] {
  const existing = readRecentBoards();
  const updated = existing.filter((item) => item.id !== boardId);
  if (updated.length !== existing.length) {
    writeRecentBoards(updated);
  }
  return updated;
}

export function formatRelativeTime(
  timestampMs: number,
  nowMs: number = Date.now(),
): string {
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
