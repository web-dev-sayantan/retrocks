/// <reference types="vite/client" />
/// <reference types="@solidjs/vite-plugin/boundary-modules" />
/// <reference types="@cloudflare/workers-types" />
/// <reference types="../file-routes.d.ts" />

interface ImportMetaEnv {
  readonly RETROCKS_LIVE_SSE: boolean;
}

declare module 'virtual:solid-ssr-handler' {
  export function handleRequest(request: Request): Promise<Response>;
  const handler: {
    fetch(request: Request): Promise<Response>;
  };
  export default handler;
}

declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    BOARD_ROOM: DurableObjectNamespace;
    POINTING_POKER_ROOM: DurableObjectNamespace<import('./server/poker/durable-room').PointingPokerRoom>;
    BOARD_CREATE_LIMITER: RateLimit;
    SESSION_SECRET: string;
  }
}
