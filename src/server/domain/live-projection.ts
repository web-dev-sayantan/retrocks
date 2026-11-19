import 'server-only';

import type { BoardLiveMessage } from '../../lib/board-live-protocol';
import type { BoardPublication, LiveViewerContext } from '../adapters/types';
import type { RawBoardSnapshot } from '../db/raw-types';
import { projectBoardForViewer, projectMutationEventsForViewer } from './projection';

export function projectLiveSnapshot(
  snapshot: RawBoardSnapshot,
  viewer: LiveViewerContext,
): Extract<BoardLiveMessage, { type: 'board:snapshot' }> {
  return {
    type: 'board:snapshot',
    version: snapshot.board.version,
    serverNow: Date.now(),
    board: projectBoardForViewer(snapshot, viewer.participantHash, viewer.isFacilitator),
  };
}

export function projectLivePublication(
  publication: BoardPublication,
  viewer: LiveViewerContext,
): BoardLiveMessage {
  if (!('snapshot' in publication)) return publication;
  const { snapshot, events } = publication;
  if (events.some((event) =>
    event.type === 'board:updated' &&
    (event.patch.isBlurred !== undefined || event.patch.blindVoting !== undefined),
  )) {
    // Privacy transitions also change the presentation of existing Cards and Votes.
    return projectLiveSnapshot(snapshot, viewer);
  }
  return {
    type: 'board:mutation',
    version: snapshot.board.version,
    events: projectMutationEventsForViewer(
      snapshot,
      events,
      viewer.participantHash,
      viewer.isFacilitator,
    ),
  };
}
