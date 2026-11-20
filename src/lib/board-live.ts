import { createSignal } from 'solid-js';

import { boardLivePath, type BoardLiveMessage } from './board-live-protocol';
import { createLiveStream, type LiveStatus, type LiveTransport } from './live-stream';
import { parseBoardLiveMessage } from './wire-schemas';

export type { LiveTransport as BoardLiveTransport } from './live-stream';
export type BoardLiveStatus = LiveStatus;

export interface BoardLive {
  status(): BoardLiveStatus;
  lastEvent(): BoardLiveMessage | null;
  onlineCount(): number | null;
  reconnect(): void;
  dispose(): void;
}

export function createBoardLive(boardId: string, transport?: LiveTransport): BoardLive {
  const [lastEvent, setLastEvent] = createSignal<BoardLiveMessage | null>(null);
  const [onlineCount, setOnlineCount] = createSignal<number | null>(null);
  const stream = createLiveStream<BoardLiveMessage>(boardLivePath(boardId), {
    parse: parseBoardLiveMessage,
    handshake: (message) => message.type === 'board:snapshot' ? message : undefined,
    isTerminal: (message) => message.type === 'board:deleted',
    onMessage(message) {
      if (message.type === 'presence:count') setOnlineCount(message.count);
      setLastEvent(message);
    },
    onDisconnect: () => setOnlineCount(null),
  }, transport);

  return { ...stream, lastEvent, onlineCount };
}
