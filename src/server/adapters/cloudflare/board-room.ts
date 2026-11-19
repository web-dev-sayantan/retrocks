import { DurableObject } from 'cloudflare:workers';

/**
 * SQLite-backed Durable Object managing one Board's state, Hibernatable WebSockets,
 * and automatic inactivity expiry alarm. Implemented in Issue #2.
 */
export class BoardRoom extends DurableObject<Cloudflare.Env> {
  async fetch(_request: Request): Promise<Response> {
    return new Response('BoardRoom not yet implemented', { status: 501 });
  }
}
