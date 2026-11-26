import 'server-only';

import { LIVE_CONNECTION_HEADER } from '../../lib/live-protocol';
import { getSessionFromRequest, type RetrocksSession } from '../session';

export interface LiveHttpTransport<Viewer> {
  connect(id: string, request: Request, viewer: Viewer): Promise<Response> | Response;
  heartbeat?(id: string, connectionId: string, viewer: Viewer): Promise<boolean> | boolean;
}

export interface LiveHttpHandlerOptions<Viewer> {
  isValidId(id: string): boolean;
  resolveTransport(id: string): Promise<LiveHttpTransport<Viewer>> | LiveHttpTransport<Viewer>;
  resolveViewer(id: string, session: RetrocksSession): Promise<Viewer | null> | Viewer | null;
}

function emptyResponse(status: number, headers?: Record<string, string>): Response {
  return new Response(null, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function ensureNoStore(response: Response): Response {
  if (
    response.status === 101
    || response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')
    || response.headers.has('cache-control')
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Shared HTTP entry gatekeeper for Board and Pointing Poker Room live endpoints.
 * Enforces method hygiene, same-origin checks, ID validation, anonymous session auth,
 * POST heartbeat framing, and `Cache-Control: no-store` on all non-stream responses.
 */
export function createLiveHttpHandler<Viewer>(
  options: LiveHttpHandlerOptions<Viewer>,
): (id: string, request: Request) => Promise<Response> {
  return async function handleLiveHttpRequest(id: string, request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'POST') {
      return emptyResponse(405, { allow: 'GET, POST' });
    }

    const origin = request.headers.get('origin');
    if (origin !== null && origin !== new URL(request.url).origin) {
      return emptyResponse(403);
    }

    if (!options.isValidId(id)) {
      return emptyResponse(404);
    }

    const session = await getSessionFromRequest(request);
    if (!session) {
      return emptyResponse(401);
    }

    const transport = await options.resolveTransport(id);
    if (request.method === 'POST') {
      if (!transport.heartbeat) {
        return emptyResponse(405, { allow: 'GET' });
      }
      const connectionId = request.headers.get(LIVE_CONNECTION_HEADER)?.trim();
      if (!connectionId) {
        return emptyResponse(400);
      }
      const viewer = await options.resolveViewer(id, session);
      if (viewer === null) {
        return emptyResponse(404);
      }
      const received = await transport.heartbeat(id, connectionId, viewer);
      return emptyResponse(received ? 204 : 404);
    }

    const viewer = await options.resolveViewer(id, session);
    if (viewer === null) {
      return emptyResponse(404);
    }

    return ensureNoStore(await transport.connect(id, request, viewer));
  };
}
