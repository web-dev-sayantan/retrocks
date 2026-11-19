import {
  boardLivePath,
  LIVE_CONNECTION_HEADER,
  LIVE_HEARTBEAT_MS,
  LIVE_HEARTBEAT_TIMEOUT_MS,
  type BoardLiveMessage,
} from './board-live-protocol';

const RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];

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
        message = JSON.parse(event.data) as BoardLiveMessage;
        if (!message || typeof message.type !== 'string') throw new Error('Invalid live message');
      } catch {
        retryConnection();
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
