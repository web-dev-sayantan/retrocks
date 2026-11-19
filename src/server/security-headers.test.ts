import type { StartRequestEvent } from '@solidjs/vite-plugin';
import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { describe, expect, it } from 'vitest';

import { securityHeadersMiddleware } from './security-headers';

async function runMiddleware(request: Request) {
  const event: StartRequestEvent = createRequestEvent(request);
  let capturedNonce: unknown;

  const response = await provideRequestEvent(event, async () => {
    const res = await securityHeadersMiddleware(event, async () => {
      capturedNonce = event.nonce;
      return new Response('ok');
    });
    return commitEventResponse(res, event);
  });

  return { response, event, capturedNonce };
}

describe('securityHeadersMiddleware', () => {
  it('applies baseline CSP with a per-request script nonce and security headers', async () => {
    const first = await runMiddleware(new Request('https://retrocks.app/'));
    const second = await runMiddleware(new Request('https://retrocks.app/'));

    const csp = first.response.headers.get('content-security-policy');
    expect(csp).toBeTruthy();

    // Nonce is attached to event before next() and mirrored in CSP script-src
    expect(first.capturedNonce).toEqual(
      expect.objectContaining({ script: expect.any(String), style: false }),
    );
    const firstScriptNonce = (first.capturedNonce as { script: string }).script;
    const secondScriptNonce = (second.capturedNonce as { script: string })
      .script;
    expect(firstScriptNonce.length).toBeGreaterThanOrEqual(16);
    expect(firstScriptNonce).not.toBe(secondScriptNonce);

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(`script-src 'self' 'nonce-${firstScriptNonce}'`);
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");

    expect(first.response.headers.get('x-content-type-options')).toBe(
      'nosniff',
    );
    expect(first.response.headers.get('x-frame-options')).toBe('DENY');
    expect(first.response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(first.response.headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=()',
    );
  });

  it('attaches X-Robots-Tag: noindex, nofollow on /b/* routes only', async () => {
    for (const path of ['/b', '/b/abc123', '/b/abc123/settings']) {
      const { response } = await runMiddleware(
        new Request(`https://retrocks.app${path}`),
      );
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    }

    for (const path of ['/', '/board-guide', '/api/boards/abc123/export']) {
      const { response } = await runMiddleware(
        new Request(`https://retrocks.app${path}`),
      );
      expect(response.headers.get('x-robots-tag')).toBeNull();
    }
  });

  it('skips response header mutations on WebSocket upgrade requests', async () => {
    const request = new Request(
      'https://retrocks.app/api/boards/abc123/live',
      {
        headers: {
          upgrade: 'websocket',
          connection: 'Upgrade',
        },
      },
    );
    const event: StartRequestEvent = createRequestEvent(request);
    const sentinel = new Response(null, { status: 204 });

    const returned = await provideRequestEvent(event, () =>
      securityHeadersMiddleware(event, async () => sentinel),
    );

    expect(returned).toBe(sentinel);
    expect(event.nonce).toBeUndefined();
    expect([...event.response.headers.keys()]).toEqual([]);
  });
});
