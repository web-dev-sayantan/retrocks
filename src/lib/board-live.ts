import { createSignal } from 'solid-js';

import {
  boardLivePath,
  LIVE_CONNECTION_HEADER,
  LIVE_HEARTBEAT_MS,
  LIVE_HEARTBEAT_TIMEOUT_MS,
  type BoardLiveMessage,
} from './board-live-protocol';
import { parseBoardLiveMessage } from './wire-schemas';

const RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];

export type BoardLiveStatus = 'connecting' | 'live' | 'reconnecting';

/** Reports wire frames and stream failures from one live connection. */
export interface BoardLiveHandlers {
  onMessage(data: string): void;
  onFailure(): void;
}

/** One live stream connection; closed when the module reconnects or disposes. */
export interface LiveConnection {
  ping(connectionId: string | undefined): void;
  close(): void;
}

/** Opens Board live streams; SSE and WebSocket ship as defaults, tests inject a fake. */
export interface BoardLiveTransport {
  connect(path: string, handlers: BoardLiveHandlers): LiveConnection | undefined;
}

/** Reactive handle over one Board's live stream. */
export interface BoardLive {
  status(): BoardLiveStatus;
  lastEvent(): BoardLiveMessage | null;
  onlineCount(): number | null;
  reconnect(): void;
  dispose(): void;
}

export function createBoardLive(boardId: string, transport = defaultBoardLiveTransport()): BoardLive {
  const path = boardLivePath(boardId);
  const [status, setStatus] = createSignal<BoardLiveStatus>('connecting');
  const [lastEvent, setLastEvent] = createSignal<BoardLiveMessage | null>(null);
  const [onlineCount, setOnlineCount] = createSignal<number | null>(null);
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
  }

  function connect(): void {
    disconnect();
    setStatus('connecting');
    setOnlineCount(null);
    const activeGeneration = generation;
    let connectionId: string | undefined;

    function retryConnection(): void {
      if (activeGeneration !== generation) return;
      disconnect();
      setStatus('reconnecting');
      setOnlineCount(null);
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
      let message: BoardLiveMessage;
      try {
        // Malformed or drifted frames reconnect instead of applying partial state.
        message = parseBoardLiveMessage(data);
      } catch {
        retryConnection();
        return;
      }
      if (message.type === 'board:deleted') {
        disconnect();
        setLastEvent(message);
        return;
      }
      if (message.type === 'board:snapshot') {
        attempt = 0;
        if (message.connectionId) connectionId = message.connectionId;
        setStatus('live');
      }
      if (message.type === 'presence:count') setOnlineCount(message.count);
      resetWatchdog();
      setLastEvent(message);
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
    lastEvent,
    onlineCount,
    // Reopening the stream loads the latest viewer-projected snapshot first.
    reconnect: connect,
    dispose() {
      document.removeEventListener('visibilitychange', reconnectWhenVisible);
      window.removeEventListener('online', reconnectWhenVisible);
      disconnect();
    },
  };
}

function createSseTransport(): BoardLiveTransport {
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

function createWebSocketTransport(): BoardLiveTransport {
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

function defaultBoardLiveTransport(): BoardLiveTransport {
  return import.meta.env.RETROCKS_LIVE_SSE ? sseTransport : webSocketTransport;
}

interface LiveCallbacks {
  onMessage: (message: BoardLiveMessage) => void;
  onReconnect: () => void;
}

export function connectBoardLive(boardId: string, callbacks: LiveCallbacks) {
  const path = boardLivePath(boardId);
  const useSse = import.meta.env.RETROCKS_LIVE_SSE;
  let generation = 0;
  let attempt = 0;
  let activePing: AbortController | undefined;
  let source: EventSource | WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  function disconnect(): void {
    generation += 1;
    clearTimeout(retry);
    clearTimeout(watchdog);
    clearInterval(heartbeat);
    activePing?.abort();
    source?.close();
    source = undefined;
  }

  function connect(): void {
    disconnect();
    callbacks.onReconnect();
    const activeGeneration = generation;
    let connectionId: string | undefined;

    function retryConnection(): void {
      if (activeGeneration !== generation) return;
      disconnect();
      callbacks.onReconnect();
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      attempt += 1;
      retry = setTimeout(connect, delay * (1 + Math.random() * 0.2));
    }

    function resetWatchdog(): void {
      clearTimeout(watchdog);
      watchdog = setTimeout(retryConnection, LIVE_HEARTBEAT_TIMEOUT_MS);
    }

    function receive(event: MessageEvent<string>): void {
      if (activeGeneration !== generation) return;
      let message: BoardLiveMessage;
      try {
        // Malformed or drifted frames reconnect instead of applying partial state.
        message = parseBoardLiveMessage(event.data);
      } catch {
        retryConnection();
        return;
      }
      if (message.type === 'board:deleted') {
        disconnect();
        callbacks.onMessage(message);
        return;
      }
      if (message.type === 'board:snapshot') {
        attempt = 0;
        if (message.connectionId) connectionId = message.connectionId;
      }
      resetWatchdog();
      callbacks.onMessage(message);
    }

    if (useSse) {
      if (typeof EventSource === 'undefined') return;
      const stream = new EventSource(path);
      source = stream;
      stream.addEventListener('message', receive);
      stream.addEventListener('error', retryConnection);
      heartbeat = setInterval(() => {
        if (!connectionId) return;
        activePing?.abort();
        activePing = new AbortController();
        void fetch(path, {
          method: 'POST',
          headers: { [LIVE_CONNECTION_HEADER]: connectionId },
          signal: activePing.signal,
        }).then((response) => {
          if (!response.ok) retryConnection();
        }).catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) retryConnection();
        });
      }, LIVE_HEARTBEAT_MS);
    } else {
      if (typeof WebSocket === 'undefined') return;
      const socket = new WebSocket(new URL(path, window.location.href));
      source = socket;
      socket.addEventListener('message', receive);
      socket.addEventListener('close', retryConnection);
      socket.addEventListener('error', retryConnection);
      heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      }, LIVE_HEARTBEAT_MS);
    }
    resetWatchdog();
  }

  function reconnectWhenVisible(): void {
    if (document.visibilityState === 'visible') connect();
  }

  document.addEventListener('visibilitychange', reconnectWhenVisible);
  window.addEventListener('online', reconnectWhenVisible);
  connect();
  return {
    // Reopening the stream loads the latest viewer-projected snapshot first.
    reconnect: connect,
    dispose() {
      document.removeEventListener('visibilitychange', reconnectWhenVisible);
      window.removeEventListener('online', reconnectWhenVisible);
      disconnect();
    },
  };
}
