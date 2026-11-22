import { createLiveStream, type LiveStatus, type LiveTransport } from './live-stream';
import { parsePokerLiveMessage } from './poker-schemas';
import type { PokerLiveMessage } from './poker-types';

export type PokerLiveStatus = LiveStatus;
export type PokerLiveTransport = LiveTransport;

export function createPokerLive(
  id: string,
  update: (message: PokerLiveMessage) => void,
  clearPresence: () => void,
  transport?: LiveTransport,
) {
  return createLiveStream<PokerLiveMessage>(`/api/poker/${encodeURIComponent(id)}/live`, {
    parse: parsePokerLiveMessage,
    handshake: (message) => message.type === 'room:snapshot' ? message : undefined,
    isTerminal: (message) => message.type === 'room:missing' || (message.type === 'room:snapshot' && message.room.closed),
    onMessage: update,
    onDisconnect: clearPresence,
  }, transport);
}
