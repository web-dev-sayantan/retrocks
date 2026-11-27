import 'server-only';

import { LIVE_HEARTBEAT_TIMEOUT_MS, type LiveHeartbeatMessage } from '../../lib/live-protocol';
import {
  LIVE_FACILITATOR_HEADER,
  LIVE_PARTICIPANT_HEADER,
  POKER_LIVE_VIEWER_HEADER,
} from './headers';

const INTERNAL_LIVE_HEADERS = [
  LIVE_PARTICIPANT_HEADER,
  LIVE_FACILITATOR_HEADER,
  POKER_LIVE_VIEWER_HEADER,
] as const;

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

function upgradeRequiredResponse(): Response {
  return new Response(null, {
    status: 426,
    headers: {
      upgrade: 'websocket',
      'cache-control': 'no-store',
    },
  });
}

function noStoreEmptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

/**
 * Shared Cloudflare Worker-to-Durable-Object WebSocket upgrade forwarder.
 * Validates `Upgrade: websocket` before waking the Durable Object, strips
 * `cookie` credentials, clears spoofed internal viewer headers, and stamps
 * trusted Worker-derived viewer headers onto the forwarded request.
 */
export async function forwardWebSocketUpgrade(
  stub: Pick<DurableObjectStub, 'fetch'>,
  request: Request,
  internalHeaders: Record<string, string>,
): Promise<Response> {
  if (!isWebSocketUpgrade(request)) {
    return upgradeRequiredResponse();
  }
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  for (const name of INTERNAL_LIVE_HEADERS) {
    headers.delete(name);
  }
  for (const [name, value] of Object.entries(internalHeaders)) {
    headers.set(name, value);
  }
  return stub.fetch(new Request(request.url, { method: request.method, headers }));
}

export type DurableObjectConnectDecision<Viewer extends object, Message> =
  | { type: 'reject'; status: number }
  | {
      type: 'terminal';
      message: Message;
      closeReason: string;
    }
  | {
      type: 'accept';
      viewer: Viewer;
      initialMessage: Message;
    };

export interface DurableObjectWebSocketHubOptions<Identity, Viewer extends object, Message> {
  /** Parses trusted Worker-stamped internal viewer identity headers; return `null` to reject with `401`. */
  parseIdentity(request: Request): Identity | null;
  /** Authorizes an incoming WebSocket upgrade and returns the initial frame or rejection/terminal decision. */
  onConnect(identity: Identity, now: number): DurableObjectConnectDecision<Viewer, Message>;
  /** Builds the domain presence broadcast frame for currently active viewers, or `null` to skip. */
  createPresenceMessage(viewers: readonly Viewer[], now: number): Message | null;
  /** Optional gate to suppress presence broadcasts (e.g. closed or missing Rooms) before scanning sockets. */
  shouldBroadcastPresence?(now: number): boolean;
  /** Optional availability/expiry check run on incoming client `'ping'` frames; return `false` to halt ping handling. */
  onPing?(now: number): boolean;
  /** Heartbeat timeout window in milliseconds; defaults to `LIVE_HEARTBEAT_TIMEOUT_MS`. */
  heartbeatTimeoutMs?: number;
}

export interface DurableObjectPublishOptions {
  /** Optional guard evaluated only when at least one active socket exists (e.g. Board stale-version check). */
  shouldPublish?(): boolean;
  /** When set, clears each delivered socket's attachment and closes it with code `1000` and this reason. */
  closeReason?: string;
}

export interface DurableObjectWebSocketHub<Viewer extends object, Message> {
  fetch(request: Request): Response;
  publish(
    projectMessage: (viewer: Viewer) => Message,
    options?: DurableObjectPublishOptions,
  ): void;
  closeAll(message: Message, reason: string): void;
  getActiveViewers(): Viewer[];
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void;
  webSocketClose(socket: WebSocket): void;
  webSocketError(socket: WebSocket): void;
}

type HibernatedAttachment<Viewer extends object> = Viewer & { lastSeenAt: number };

function readAttachment<Viewer extends object>(
  socket: WebSocket,
): HibernatedAttachment<Viewer> | null {
  const raw = socket.deserializeAttachment() as
    | (Viewer & { lastSeenAt?: unknown })
    | null
    | undefined;
  if (!raw || typeof raw !== 'object' || typeof raw.lastSeenAt !== 'number') {
    return null;
  }
  return raw as HibernatedAttachment<Viewer>;
}

function closeSafely(socket: WebSocket, code?: number, reason?: string): void {
  try {
    if (code === undefined) {
      socket.close();
    } else {
      socket.close(code, reason);
    }
  } catch {
    // Ignore close errors on sockets that are already closing or failed.
  }
}

function clearAttachmentSafely(socket: WebSocket): void {
  if (typeof socket.serializeAttachment === 'function') {
    try {
      socket.serializeAttachment(null);
    } catch {
      // Ignore attachment cleanup errors on closing sockets.
    }
  }
}

function sendSerialized(socket: WebSocket, payload: string): boolean {
  try {
    socket.send(payload);
    return true;
  } catch {
    closeSafely(socket, 1011, 'Live delivery failed');
    return false;
  }
}

/**
 * Composable Cloudflare Durable Object Hibernatable WebSocket hub shared by
 * Boards (`BoardRoom`) and Pointing Poker Rooms (`PointingPokerRoom`).
 */
export function createDurableObjectWebSocketHub<Identity, Viewer extends object, Message>(
  ctx: DurableObjectState,
  options: DurableObjectWebSocketHubOptions<Identity, Viewer, Message>,
): DurableObjectWebSocketHub<Viewer, Message> {
  const timeoutMs = options.heartbeatTimeoutMs ?? LIVE_HEARTBEAT_TIMEOUT_MS;

  function sendMessage(socket: WebSocket, message: Message | LiveHeartbeatMessage): boolean {
    return sendSerialized(socket, JSON.stringify(message));
  }

  function collectActive(
    excluded: ReadonlySet<WebSocket> | undefined,
    now: number,
  ): { active: Array<{ socket: WebSocket; viewer: HibernatedAttachment<Viewer> }>; prunedCount: number } {
    const active: Array<{ socket: WebSocket; viewer: HibernatedAttachment<Viewer> }> = [];
    let prunedCount = 0;
    for (const socket of ctx.getWebSockets()) {
      if (excluded?.has(socket) || socket.readyState !== WebSocket.OPEN) continue;
      const viewer = readAttachment<Viewer>(socket);
      if (!viewer) continue;
      if (now - viewer.lastSeenAt > timeoutMs) {
        closeSafely(socket, 1001, 'Live connection timed out');
        prunedCount += 1;
        continue;
      }
      active.push({ socket, viewer });
    }
    return { active, prunedCount };
  }

  function broadcastPresence(initialExcluded?: ReadonlySet<WebSocket>, now = Date.now()): void {
    if (options.shouldBroadcastPresence && !options.shouldBroadcastPresence(now)) {
      return;
    }
    const excluded = new Set<WebSocket>(initialExcluded);

    while (true) {
      const { active } = collectActive(excluded, now);
      if (active.length === 0) return;
      const message = options.createPresenceMessage(
        active.map(({ viewer }) => viewer),
        now,
      );
      if (message === null) return;

      const payload = JSON.stringify(message);
      let hadFailure = false;
      for (const { socket } of active) {
        if (!sendSerialized(socket, payload)) {
          excluded.add(socket);
          hadFailure = true;
        }
      }
      if (!hadFailure) return;
    }
  }

  return {
    fetch(request: Request): Response {
      if (!isWebSocketUpgrade(request)) {
        return upgradeRequiredResponse();
      }
      const identity = options.parseIdentity(request);
      if (identity === null) {
        return noStoreEmptyResponse(401);
      }

      const now = Date.now();
      const decision = options.onConnect(identity, now);
      if (decision.type === 'reject') {
        return noStoreEmptyResponse(decision.status);
      }

      const { 0: client, 1: server } = new WebSocketPair();
      ctx.acceptWebSocket(server);

      if (decision.type === 'terminal') {
        const sent = sendMessage(server, decision.message);
        if (sent) closeSafely(server, 1000, decision.closeReason);
        return new Response(null, { status: 101, webSocket: client });
      }

      server.serializeAttachment({ ...decision.viewer, lastSeenAt: now });
      const sent = sendMessage(server, decision.initialMessage);
      if (sent) {
        broadcastPresence(undefined, now);
      }
      return new Response(null, { status: 101, webSocket: client });
    },

    publish(
      projectMessage: (viewer: Viewer) => Message,
      publishOptions?: DurableObjectPublishOptions,
    ): void {
      const now = Date.now();
      const { active, prunedCount } = collectActive(undefined, now);
      if (active.length === 0) return;

      if (publishOptions?.shouldPublish && !publishOptions.shouldPublish()) {
        if (prunedCount > 0) broadcastPresence(undefined, now);
        return;
      }

      const failedSockets = new Set<WebSocket>();
      for (const { socket, viewer } of active) {
        const sent = sendMessage(socket, projectMessage(viewer));
        if (publishOptions?.closeReason) {
          clearAttachmentSafely(socket);
          if (sent) closeSafely(socket, 1000, publishOptions.closeReason);
        } else if (!sent) {
          failedSockets.add(socket);
        }
      }

      if (!publishOptions?.closeReason && (prunedCount > 0 || failedSockets.size > 0)) {
        broadcastPresence(failedSockets, now);
      }
    },

    closeAll(message: Message, reason: string): void {
      const payload = JSON.stringify(message);
      for (const socket of ctx.getWebSockets()) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        const sent = sendSerialized(socket, payload);
        clearAttachmentSafely(socket);
        if (sent) closeSafely(socket, 1000, reason);
      }
    },

    getActiveViewers(): Viewer[] {
      const now = Date.now();
      const { active, prunedCount } = collectActive(undefined, now);
      if (prunedCount > 0) {
        broadcastPresence(undefined, now);
      }
      return active.map(({ viewer }) => viewer);
    },

    webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
      if (message !== 'ping') return;
      const attachment = readAttachment<Viewer>(socket);
      if (!attachment) return;
      const now = Date.now();
      if (options.onPing && !options.onPing(now)) {
        return;
      }
      if (now - attachment.lastSeenAt > timeoutMs) {
        closeSafely(socket, 1001, 'Live connection timed out');
        broadcastPresence(new Set([socket]), now);
        return;
      }
      socket.serializeAttachment({ ...attachment, lastSeenAt: now });
      const heartbeat: LiveHeartbeatMessage = { type: 'heartbeat' };
      const sent = sendMessage(socket, heartbeat);
      const excluded = sent ? undefined : new Set([socket]);
      const { prunedCount } = collectActive(excluded, now);
      if (!sent || prunedCount > 0) {
        broadcastPresence(excluded, now);
      }
    },

    webSocketClose(socket: WebSocket): void {
      if (socket.readyState === WebSocket.CLOSING) {
        closeSafely(socket);
      }
      broadcastPresence(new Set([socket]));
    },

    webSocketError(socket: WebSocket): void {
      closeSafely(socket, 1011, 'Live connection failed');
      broadcastPresence(new Set([socket]));
    },
  };
}
