import 'server-only';

import {
  LIVE_HEARTBEAT_MS,
  LIVE_HEARTBEAT_TIMEOUT_MS,
  type LiveHeartbeatMessage,
} from '../../lib/live-protocol';

const encoder = new TextEncoder();

const SSE_STREAM_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-store, no-transform',
  'x-accel-buffering': 'no',
} as const;

const SSE_MAX_QUEUED_FRAMES = 128;

const HEARTBEAT_MESSAGE: LiveHeartbeatMessage = { type: 'heartbeat' };

function formatSseFrame(message: unknown): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

function encodeSseFrame(message: unknown): Uint8Array {
  return encoder.encode(formatSseFrame(message));
}

const HEARTBEAT_FRAME = encodeSseFrame(HEARTBEAT_MESSAGE);

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise;
}

function safeClose(controller: ReadableStreamDefaultController<Uint8Array>): void {
  try {
    controller.close();
  } catch {
    // Stream may already be closed or cancelled by a concurrent abort or reader.cancel().
  }
}

function safeError(
  controller: ReadableStreamDefaultController<Uint8Array>,
  error: unknown,
): void {
  try {
    controller.error(error);
  } catch {
    // Stream may already be closed or cancelled by a concurrent abort or reader.cancel().
  }
}

function hasBackpressure(controller: ReadableStreamDefaultController<Uint8Array>): boolean {
  return controller.desiredSize === null || controller.desiredSize <= -SSE_MAX_QUEUED_FRAMES;
}

/** Builds a one-shot SSE response carrying a single terminal frame (e.g. closed or missing Room). */
export function createSseFrameResponse(message: unknown): Response {
  return new Response(formatSseFrame(message), { headers: SSE_STREAM_HEADERS });
}

export type NodeSseConnectInit<Message> =
  | {
      initialMessage: Message;
      shouldReplay?(buffered: Message | LiveHeartbeatMessage): boolean;
    }
  | {
      terminalMessage: Message;
    };

export interface NodeSsePublishOptions<Viewer, Message> {
  project(viewer: Viewer): Message;
  terminal?: boolean;
}

export interface NodeSseHubOptions<Viewer, Message, HeartbeatViewer = Viewer> {
  /** Verifies that an incoming POST heartbeat belongs to the subscribed viewer. */
  matchesViewer(subscribed: Viewer, candidate: HeartbeatViewer): boolean;
  /** Formats the presence broadcast frame for the currently subscribed viewers on a channel. */
  formatPresence(viewers: readonly Viewer[]): Message;
  /**
   * Optional domain availability/expiry check invoked during heartbeat sweeps
   * and incoming POST heartbeats. Returning a projector broadcasts a terminal
   * frame to every subscriber on the channel and closes their streams.
   */
  checkAvailability?(
    channelId: string,
    now: number,
  ): ((viewer: Viewer) => Message) | null;
}

export interface NodeSseHub<Viewer, Message, HeartbeatViewer = Viewer> {
  connect(
    channelId: string,
    request: Request,
    viewer: Viewer,
    initialize: (
      connectionId: string,
    ) => NodeSseConnectInit<Message> | Promise<NodeSseConnectInit<Message>>,
  ): Response;
  publish(channelId: string, options: NodeSsePublishOptions<Viewer, Message>): void;
  recordHeartbeat(
    channelId: string,
    connectionId: string,
    viewer: HeartbeatViewer,
  ): boolean;
  getViewers(channelId: string): Viewer[];
  close(): void;
}

interface SseConnection<Viewer, Message> {
  readonly id: string;
  readonly viewer: Viewer;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly signal: AbortSignal;
  lastSeenAt: number;
  pending: Array<Message | LiveHeartbeatMessage> | null;
  closed: boolean;
  onAbort: () => void;
}

/**
 * Shared Node Server-Sent Events streaming hub used by Boards and Pointing Poker Rooms.
 * Centralizes SSE framing and headers, O(1) per-connection heartbeat lookup, uniform
 * backpressure eviction across all outbound frames, abort/cancel safety, managed heartbeat
 * sweeps with optional domain expiry checks, and explicit teardown.
 */
export function createNodeSseHub<Viewer, Message, HeartbeatViewer = Viewer>(
  options: NodeSseHubOptions<Viewer, Message, HeartbeatViewer>,
): NodeSseHub<Viewer, Message, HeartbeatViewer> {
  const channels = new Map<string, Map<string, SseConnection<Viewer, Message>>>();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function stopHeartbeatIfIdle(): void {
    if (channels.size === 0 && heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function ensureHeartbeatTimer(): void {
    if (heartbeatTimer !== null) return;
    heartbeatTimer = setInterval(sweepConnections, LIVE_HEARTBEAT_MS);
    heartbeatTimer.unref?.();
  }

  function teardownConnection(
    connection: SseConnection<Viewer, Message>,
    closeController: boolean,
  ): void {
    if (connection.closed) return;
    connection.closed = true;
    connection.pending = null;
    connection.signal.removeEventListener('abort', connection.onAbort);
    if (closeController) {
      safeClose(connection.controller);
    }
  }

  function removeConnection(
    channelId: string,
    connection: SseConnection<Viewer, Message>,
    action: { closeController: boolean; notifyPresence: boolean },
  ): void {
    if (connection.closed) return;

    const channel = channels.get(channelId);
    const removedFromActiveChannel =
      channel !== undefined
      && channel.get(connection.id) === connection
      && channel.delete(connection.id);
    if (removedFromActiveChannel && channel.size === 0) {
      channels.delete(channelId);
      stopHeartbeatIfIdle();
    }

    teardownConnection(connection, action.closeController);

    if (action.notifyPresence && removedFromActiveChannel && channel.size > 0) {
      broadcastPresence(channelId);
    }
  }

  function deliver(
    channelId: string,
    connection: SseConnection<Viewer, Message>,
    message: Message | LiveHeartbeatMessage,
    encoded: Uint8Array | null,
    notifyPresence: boolean,
  ): boolean {
    if (connection.closed) return false;
    if (connection.pending !== null) {
      if (connection.pending.length >= SSE_MAX_QUEUED_FRAMES) {
        removeConnection(channelId, connection, { closeController: true, notifyPresence });
        return false;
      }
      connection.pending.push(message);
      return true;
    }
    if (hasBackpressure(connection.controller)) {
      removeConnection(channelId, connection, { closeController: true, notifyPresence });
      return false;
    }
    try {
      connection.controller.enqueue(encoded ?? encodeSseFrame(message));
      return true;
    } catch {
      removeConnection(channelId, connection, { closeController: true, notifyPresence });
      return false;
    }
  }

  function broadcastPresence(channelId: string): void {
    while (true) {
      const channel = channels.get(channelId);
      if (!channel || channel.size === 0) return;
      const message = options.formatPresence(Array.from(channel.values(), (c) => c.viewer));
      const encoded = encodeSseFrame(message);
      let dropped = false;
      for (const connection of Array.from(channel.values())) {
        if (!deliver(channelId, connection, message, encoded, false)) {
          dropped = true;
        }
      }
      if (!dropped) return;
    }
  }

  function publish(
    channelId: string,
    publishOptions: NodeSsePublishOptions<Viewer, Message>,
  ): void {
    const channel = channels.get(channelId);
    if (!channel) return;

    if (publishOptions.terminal) {
      channels.delete(channelId);
      stopHeartbeatIfIdle();
      for (const connection of Array.from(channel.values())) {
        if (connection.closed) continue;
        if (!hasBackpressure(connection.controller)) {
          try {
            connection.controller.enqueue(encodeSseFrame(publishOptions.project(connection.viewer)));
          } catch {
            // Stream may already be cancelled/closed by a concurrent abort.
          }
        }
        teardownConnection(connection, true);
      }
      return;
    }

    let dropped = false;
    for (const connection of Array.from(channel.values())) {
      const message = publishOptions.project(connection.viewer);
      if (!deliver(channelId, connection, message, null, false)) {
        dropped = true;
      }
    }
    if (dropped) {
      broadcastPresence(channelId);
    }
  }

  function sweepConnections(): void {
    const now = Date.now();
    for (const [channelId, channel] of Array.from(channels.entries())) {
      const terminalProject = options.checkAvailability?.(channelId, now) ?? null;
      if (terminalProject) {
        publish(channelId, { project: terminalProject, terminal: true });
        continue;
      }
      let pruned = false;
      for (const connection of Array.from(channel.values())) {
        if (now - connection.lastSeenAt > LIVE_HEARTBEAT_TIMEOUT_MS) {
          removeConnection(channelId, connection, { closeController: true, notifyPresence: false });
          pruned = true;
        }
      }
      if (pruned && channels.has(channelId)) {
        broadcastPresence(channelId);
      }
    }
  }

  return {
    connect(channelId, request, viewer, initialize) {
      if (request.signal.aborted) {
        return new Response(null, { status: 408 });
      }

      const connectionId = crypto.randomUUID();
      let activeConnection: SseConnection<Viewer, Message> | null = null;

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          let channel = channels.get(channelId);
          if (!channel) {
            channel = new Map();
            channels.set(channelId, channel);
          }

          const connection: SseConnection<Viewer, Message> = {
            id: connectionId,
            viewer,
            controller,
            signal: request.signal,
            lastSeenAt: Date.now(),
            pending: [],
            closed: false,
            onAbort: () => {
              removeConnection(channelId, connection, {
                closeController: true,
                notifyPresence: true,
              });
            },
          };
          activeConnection = connection;
          channel.set(connectionId, connection);
          ensureHeartbeatTimer();
          request.signal.addEventListener('abort', connection.onAbort, { once: true });

          const finishInit = (init: NodeSseConnectInit<Message>): void => {
            if (connection.closed || channels.get(channelId)?.get(connectionId) !== connection) {
              return;
            }
            const buffered = connection.pending;
            if (buffered === null) {
              throw new Error('SSE replay reached after the pending queue was flushed');
            }
            connection.pending = null;

            if ('terminalMessage' in init) {
              deliver(channelId, connection, init.terminalMessage, null, false);
              removeConnection(channelId, connection, {
                closeController: true,
                notifyPresence: true,
              });
              return;
            }

            if (!deliver(channelId, connection, init.initialMessage, null, true)) {
              return;
            }
            for (const bufferedMessage of buffered) {
              if (!init.shouldReplay || init.shouldReplay(bufferedMessage)) {
                if (!deliver(channelId, connection, bufferedMessage, null, true)) {
                  return;
                }
              }
            }
            broadcastPresence(channelId);
          };

          const handleInitError = (error: unknown): void => {
            if (connection.closed) return;
            removeConnection(channelId, connection, {
              closeController: false,
              notifyPresence: true,
            });
            safeError(controller, error);
          };

          try {
            const initResult = initialize(connectionId);
            if (isPromiseLike(initResult)) {
              void initResult.then(finishInit).catch(handleInitError);
            } else {
              finishInit(initResult);
            }
          } catch (error) {
            handleInitError(error);
          }
        },
        cancel() {
          if (activeConnection) {
            removeConnection(channelId, activeConnection, {
              closeController: false,
              notifyPresence: true,
            });
          }
        },
      });

      return new Response(body, { headers: SSE_STREAM_HEADERS });
    },

    publish,

    recordHeartbeat(channelId, connectionId, viewer) {
      const connection = channels.get(channelId)?.get(connectionId);
      if (!connection || !options.matchesViewer(connection.viewer, viewer)) {
        return false;
      }

      const now = Date.now();
      const terminalProject = options.checkAvailability?.(channelId, now) ?? null;
      if (terminalProject) {
        publish(channelId, { project: terminalProject, terminal: true });
        return true;
      }

      if (now - connection.lastSeenAt > LIVE_HEARTBEAT_TIMEOUT_MS) {
        removeConnection(channelId, connection, {
          closeController: true,
          notifyPresence: true,
        });
        return false;
      }

      connection.lastSeenAt = now;
      return deliver(channelId, connection, HEARTBEAT_MESSAGE, HEARTBEAT_FRAME, true);
    },

    getViewers(channelId) {
      const channel = channels.get(channelId);
      return channel ? Array.from(channel.values(), (connection) => connection.viewer) : [];
    },

    close() {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      const activeChannels = Array.from(channels.values());
      channels.clear();
      for (const channel of activeChannels) {
        for (const connection of channel.values()) {
          teardownConnection(connection, true);
        }
      }
    },
  };
}
