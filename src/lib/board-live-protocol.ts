import type { BoardEvent, BoardMutationUpdate } from './board-types';
import type { LiveHeartbeatMessage } from './live-protocol';

// Several deltas can share one transaction version. Deliver and apply them together.
// The mapped type flattens the intersection so wire-schema output stays exactly comparable.
type SnapshotLiveMessage = Extract<BoardEvent, { type: 'board:snapshot' }> & {
  connectionId?: string;
};
type MutationLiveMessage = { type: 'board:mutation' } & BoardMutationUpdate;

export type BoardLiveMessage =
  | { [K in keyof SnapshotLiveMessage]: SnapshotLiveMessage[K] }
  | Extract<BoardEvent, { type: 'board:deleted' | 'presence:count' }>
  | { [K in keyof MutationLiveMessage]: MutationLiveMessage[K] }
  | LiveHeartbeatMessage;

export function boardLivePath(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/live`;
}
