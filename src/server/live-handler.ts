import 'server-only';
import { safeParse } from 'valibot';

import { LIVE_CONNECTION_HEADER } from '../lib/board-live-protocol';
import { BoardIdSchema } from '../lib/schemas';
import { getBoardRealtime, getBoardStore } from './adapters/runtime';
import { hashTokenWithSalt } from './crypto';
import { getSessionFromRequest, isFacilitatorForBoard } from './session';

export async function handleLiveRequest(boardId: string, request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
  }
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return new Response(null, { status: 403 });
  }
  if (!safeParse(BoardIdSchema, boardId).success) {
    return new Response(null, { status: 404 });
  }

  const session = await getSessionFromRequest(request);
  if (!session) return new Response(null, { status: 401 });

  const store = await getBoardStore();
  const salt = await store.getBoardTokenSalt(boardId);
  if (!salt) return new Response(null, { status: 404 });

  const realtime = getBoardRealtime();
  const viewer = {
    participantHash: await hashTokenWithSalt(session.participantId, salt),
    isFacilitator: isFacilitatorForBoard(session, boardId),
  };
  if (request.method === 'POST') {
    if (!realtime.recordHeartbeat) return new Response(null, { status: 405, headers: { allow: 'GET' } });
    const connectionId = request.headers.get(LIVE_CONNECTION_HEADER);
    if (!connectionId) return new Response(null, { status: 400 });
    const received = realtime.recordHeartbeat(boardId, connectionId, viewer);
    return new Response(null, { status: received ? 204 : 404 });
  }
  return realtime.handleLiveConnection(boardId, request, viewer);
}
