/// <reference types="vite/client" />
/// <reference types="@solidjs/vite-plugin/boundary-modules" />
/// <reference types="@cloudflare/workers-types" />
/// <reference types="../file-routes.d.ts" />

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
    BOARD_CREATE_LIMITER: RateLimit;
    SESSION_SECRET: string;
  }
}
