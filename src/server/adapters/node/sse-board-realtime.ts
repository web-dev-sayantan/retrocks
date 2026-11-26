import 'server-only';

import type { BoardLiveMessage } from '../../../lib/board-live-protocol';
import { projectLivePublication, projectLiveSnapshot } from '../../domain/live-projection';
import { createNodeSseHub } from '../../live/node-sse-hub';
import type { BoardRealtime, BoardStore, LiveViewerContext } from '../types';

export interface NodeBoardRealtime extends BoardRealtime {
  recordHeartbeat(boardId: string, connectionId: string, viewer: LiveViewerContext): boolean;
  close(): void;
}

function countUniqueParticipants(viewers: readonly LiveViewerContext[]): number {
  return new Set(viewers.map((viewer) => viewer.participantHash)).size;
}

export function createNodeBoardRealtime(getStore: () => Promise<BoardStore>): NodeBoardRealtime {
  const hub = createNodeSseHub<LiveViewerContext, BoardLiveMessage>({
    matchesViewer: (subscribed, candidate) =>
      subscribed.participantHash === candidate.participantHash
      && subscribed.isFacilitator === candidate.isFacilitator,
    formatPresence: (viewers) => ({
      type: 'presence:count',
      count: countUniqueParticipants(viewers),
    }),
  });

  return {
    async publish(boardId, publication) {
      hub.publish(boardId, {
        project: (viewer) => projectLivePublication(publication, viewer),
        terminal: !('snapshot' in publication) && publication.type === 'board:deleted',
      });
    },

    async handleLiveConnection(boardId, request, viewer) {
      if (request.signal.aborted) return new Response(null, { status: 408 });
      const store = await getStore();
      if (request.signal.aborted) return new Response(null, { status: 408 });

      return hub.connect(boardId, request, viewer, async (connectionId) => {
        // Subscribe before loading the snapshot so any concurrent mutation is buffered and replayed in order.
        const snapshot = await store.getBoardSnapshot(boardId);
        if (!snapshot) {
          return { terminalMessage: { type: 'board:deleted', version: 0 } };
        }
        return {
          initialMessage: { ...projectLiveSnapshot(snapshot, viewer), connectionId },
          shouldReplay: (message) =>
            'version' in message && message.version > snapshot.board.version,
        };
      });
    },

    recordHeartbeat(boardId, connectionId, viewer) {
      return hub.recordHeartbeat(boardId, connectionId, viewer);
    },

    async getPresenceCount(boardId) {
      return countUniqueParticipants(hub.getViewers(boardId));
    },

    close() {
      hub.close();
    },
  };
}
