import { createRecentStorage } from './recent-storage';

export const RECENT_BOARDS_STORAGE_KEY = 'retrocks:recent-boards';

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

const recentBoardsStorage = createRecentStorage<RecentBoardEntry>({
  storageKey: RECENT_BOARDS_STORAGE_KEY,
  parseEntry: sanitizeEntry,
});

export function readRecentBoards(): RecentBoardEntry[] {
  return recentBoardsStorage.read();
}

export function recordRecentBoard(
  entry: { id: string; title: string; isFacilitator?: boolean },
  now: number = Date.now(),
): RecentBoardEntry[] {
  return recentBoardsStorage.record(entry.id, () => ({
    id: entry.id,
    title: entry.title,
    lastVisitedAt: now,
    ...(entry.isFacilitator === true ? { isFacilitator: true } : {}),
  }));
}

export function removeRecentBoard(boardId: string): RecentBoardEntry[] {
  return recentBoardsStorage.remove(boardId);
}
