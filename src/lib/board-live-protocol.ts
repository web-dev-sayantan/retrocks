import type { BoardEvent } from './board-types';

// Several deltas can share one transaction version. Deliver and apply them together.
// The mapped type flattens the intersection so wire-schema output stays exactly comparable.
type SnapshotLiveMessage = Extract<BoardEvent, { type: 'board:snapshot' }> & {
  connectionId?: string;
};

export type BoardLiveMessage =
  | { [K in keyof SnapshotLiveMessage]: SnapshotLiveMessage[K] }
  | Extract<BoardEvent, { type: 'board:deleted' | 'presence:count' }>
  | { type: 'board:mutation'; version: number; events: BoardEvent[] }
  | { type: 'heartbeat' };

export const LIVE_CONNECTION_HEADER = 'x-retrocks-live-connection';
export const LIVE_HEARTBEAT_MS = 30_000;
export const LIVE_HEARTBEAT_TIMEOUT_MS = 2 * LIVE_HEARTBEAT_MS + 5_000;

export function boardLivePath(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/live`;
}
