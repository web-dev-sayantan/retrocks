import 'server-only';
import type { StartMiddleware } from '@solidjs/vite-plugin';

import { isPokerRoomPathname } from '../lib/poker-routes';
import { isBoardPathname } from '../lib/routes';

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildContentSecurityPolicy(scriptNonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${scriptNonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export const securityHeadersMiddleware: StartMiddleware = async (
  event,
  next,
) => {
  // Never mutate event.response.headers on WebSocket upgrades: Cloudflare
  // `workerd` throws or drops `.webSocket` if `commitEventResponse` wraps a 101.
  if (event.request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    return next();
  }

  const scriptNonce = generateNonce();
  event.nonce = { script: scriptNonce, style: false };

  const headers = event.response.headers;
  headers.set('content-security-policy', buildContentSecurityPolicy(scriptNonce));
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');

  const { pathname } = new URL(event.request.url);
  const pokerRoom = isPokerRoomPathname(pathname);
  if (isBoardPathname(pathname) || pokerRoom) {
    headers.set('x-robots-tag', 'noindex, nofollow');
    if (event.request.method === 'GET' && (pokerRoom || /^\/b\/[^/]+\/?$/.test(pathname))) {
      // The workspace read sets the Participant cookie and may return a 404.
      // Wait for both before committing the initial page headers.
      event.renderMode = 'async';
    }
  }

  if (pokerRoom || pathname.startsWith('/api/poker/')) headers.set('cache-control', 'no-store');

  return next();
};
