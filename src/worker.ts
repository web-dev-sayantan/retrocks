import ssrHandler from 'virtual:solid-ssr-handler';

import { runWithCloudflareEnv } from './server/adapters/cloudflare-context';

export { BoardRoom } from './server/adapters/cloudflare/board-room';

export default {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    // Bind Worker env (`BOARD_ROOM`, `BOARD_CREATE_LIMITER`) into AsyncLocalStorage
    // so runtime-agnostic server modules access Cloudflare bindings cleanly.
    // WebSocket upgrade interception for `/api/boards/:id/live` hooks in here
    // (Issue #5) before `ssrHandler.fetch` so Cloudflare `101` responses are
    // returned untouched without passing through `commitEventResponse`.
    return runWithCloudflareEnv(env, () => ssrHandler.fetch(request));
  },
};
