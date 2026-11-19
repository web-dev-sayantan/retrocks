import ssrHandler from 'virtual:solid-ssr-handler';

export { BoardRoom } from './server/adapters/cloudflare/board-room';

export default {
  async fetch(
    request: Request,
    _env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    // WebSocket upgrade interception for `/api/boards/:id/live` hooks in here
    // (Issue #2) before `ssrHandler.fetch` so Cloudflare `101` responses are
    // returned untouched without passing through `commitEventResponse`.
    return ssrHandler.fetch(request);
  },
};
