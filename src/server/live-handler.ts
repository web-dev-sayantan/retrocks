import 'server-only';
import { safeParse } from 'valibot';

import { BoardIdSchema } from '../lib/schemas';
import { getBoardRealtime, getBoardStore } from './adapters/runtime';
import type { LiveViewerContext } from './adapters/types';
import { hashTokenWithSalt } from './crypto';
import { createLiveHttpHandler } from './live/http-guard';
import { isFacilitatorForBoard } from './session';

export const handleLiveRequest = createLiveHttpHandler<LiveViewerContext>({
  isValidId: (boardId) => safeParse(BoardIdSchema, boardId).success,
  resolveTransport: () => {
    const realtime = getBoardRealtime();
    const recordHeartbeat = realtime.recordHeartbeat;
    return {
      connect: (boardId, request, viewer) => realtime.handleLiveConnection(boardId, request, viewer),
      heartbeat: recordHeartbeat
        ? (boardId, connectionId, viewer) => recordHeartbeat(boardId, connectionId, viewer)
        : undefined,
    };
  },
  async resolveViewer(boardId, session) {
    const store = await getBoardStore();
    const salt = await store.getBoardTokenSalt(boardId);
    if (!salt) return null;
    return {
      participantHash: await hashTokenWithSalt(session.participantId, salt),
      isFacilitator: isFacilitatorForBoard(session, boardId),
    };
  },
});
