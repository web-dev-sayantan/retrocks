import ssrHandler from 'virtual:solid-ssr-handler';

import { runWithCloudflareEnv } from './server/adapters/cloudflare-context';
import { handleLiveRequest } from './server/live-handler';

export { BoardRoom } from './server/adapters/cloudflare/board-room';

export default {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    // Bind Worker env (`BOARD_ROOM`, `BOARD_CREATE_LIMITER`) into AsyncLocalStorage
    // so runtime-agnostic server modules access Cloudflare bindings cleanly.
    return runWithCloudflareEnv(env, () => {
      if (request.method === 'GET' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const match = /^\/api\/boards\/([^/]+)\/live$/.exec(new URL(request.url).pathname);
        // Preserve the original 101 and its socket outside SSR response wrapping.
        if (match) return handleLiveRequest(match[1], request);
      }
      return ssrHandler.fetch(request);
    });
  },
};
