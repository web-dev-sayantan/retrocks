import { createSignal } from 'solid-js';

import {
  LIVE_CONNECTION_HEADER,
  LIVE_HEARTBEAT_MS,
  LIVE_HEARTBEAT_TIMEOUT_MS,
} from './board-live-protocol';

const RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

/** Reports wire frames and stream failures from one live connection. */
export interface LiveHandlers {
  onMessage(data: string): void;
  onFailure(): void;
}

/** One live stream connection; closed when the module reconnects or disposes. */
export interface LiveConnection {
  ping(connectionId: string | undefined): void;
  close(): void;
}

/** Opens live streams; SSE and WebSocket ship as defaults, tests inject a fake. */
export interface LiveTransport {
  connect(path: string, handlers: LiveHandlers): LiveConnection | undefined;
}

export function createLiveStream<Message>(
  path: string,
  options: {
    parse(data: string): Message;
    handshake(message: Message): { connectionId?: string } | undefined;
    isTerminal(message: Message): boolean;
    onMessage(message: Message): void;
    onDisconnect(): void;
  },
  transport = defaultLiveTransport(),
) {
  const [status, setStatus] = createSignal<LiveStatus>('connecting');
  let generation = 0;
  let attempt = 0;
  let connection: LiveConnection | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  function disconnect(): void {
    generation += 1;
    clearTimeout(retry);
    clearTimeout(watchdog);
    clearInterval(heartbeat);
    connection?.close();
    connection = undefined;
    options.onDisconnect();
  }

  function dispose(): void {
    document.removeEventListener('visibilitychange', reconnectWhenVisible);
    window.removeEventListener('online', reconnectWhenVisible);
    disconnect();
  }

  function connect(): void {
    disconnect();
    setStatus('connecting');
    const activeGeneration = generation;
    let connectionId: string | undefined;

    function retryConnection(): void {
      if (activeGeneration !== generation) return;
      disconnect();
      setStatus('reconnecting');
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      attempt += 1;
      retry = setTimeout(connect, delay * (1 + Math.random() * 0.2));
    }

    function resetWatchdog(): void {
      clearTimeout(watchdog);
      watchdog = setTimeout(retryConnection, LIVE_HEARTBEAT_TIMEOUT_MS);
    }

    function receive(data: string): void {
      if (activeGeneration !== generation) return;
      let message: Message;
      try {
        // Malformed or drifted frames reconnect instead of applying partial state.
        message = options.parse(data);
      } catch {
        retryConnection();
        return;
      }
      if (options.isTerminal(message)) {
        dispose();
        options.onMessage(message);
        return;
      }
      const handshake = options.handshake(message);
      if (handshake) {
        attempt = 0;
        if (handshake.connectionId) connectionId = handshake.connectionId;
        setStatus('live');
      }
      resetWatchdog();
      options.onMessage(message);
    }

    const opened = transport.connect(path, { onMessage: receive, onFailure: retryConnection });
    if (!opened) return;
    connection = opened;
    heartbeat = setInterval(() => opened.ping(connectionId), LIVE_HEARTBEAT_MS);
    resetWatchdog();
  }

  function reconnectWhenVisible(): void {
    if (document.visibilityState === 'visible') connect();
  }

  document.addEventListener('visibilitychange', reconnectWhenVisible);
  window.addEventListener('online', reconnectWhenVisible);
  connect();
  return {
    status,
    // Reopening the stream loads the latest viewer-projected snapshot first.
    reconnect: connect,
    dispose,
  };
}

function createSseTransport(): LiveTransport {
  return {
    connect(path, handlers) {
      if (typeof EventSource === 'undefined') return undefined;
      const stream = new EventSource(path);
      let activePing: AbortController | undefined;
      stream.addEventListener('message', (event: MessageEvent<string>) => {
        handlers.onMessage(event.data);
      });
      stream.addEventListener('error', () => handlers.onFailure());
      return {
        ping(connectionId) {
          if (!connectionId) return;
          activePing?.abort();
          activePing = new AbortController();
          void fetch(path, {
            method: 'POST',
            headers: { [LIVE_CONNECTION_HEADER]: connectionId },
            signal: activePing.signal,
          }).then((response) => {
            if (!response.ok) handlers.onFailure();
          }).catch((error: unknown) => {
            if (!(error instanceof DOMException && error.name === 'AbortError')) handlers.onFailure();
          });
        },
        close() {
          activePing?.abort();
          stream.close();
        },
      };
    },
  };
}

function createWebSocketTransport(): LiveTransport {
  return {
    connect(path, handlers) {
      if (typeof WebSocket === 'undefined') return undefined;
      const socket = new WebSocket(new URL(path, window.location.href));
      socket.addEventListener('message', (event: MessageEvent<string>) => {
        handlers.onMessage(event.data);
      });
      socket.addEventListener('close', () => handlers.onFailure());
      socket.addEventListener('error', () => handlers.onFailure());
      return {
        ping() {
          if (socket.readyState === WebSocket.OPEN) socket.send('ping');
        },
        close() {
          socket.close();
        },
      };
    },
  };
}

const sseTransport = createSseTransport();
const webSocketTransport = createWebSocketTransport();

function defaultLiveTransport(): LiveTransport {
  return import.meta.env.RETROCKS_LIVE_SSE ? sseTransport : webSocketTransport;
}
