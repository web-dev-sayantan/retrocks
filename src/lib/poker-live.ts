import { createLiveStream } from './live-stream';
import { parsePokerLiveMessage } from './poker-schemas';
import type { PokerLiveMessage } from './poker-types';

export function createPokerLive(id: string, update: (message: PokerLiveMessage) => void, clearPresence: () => void) {
  return createLiveStream<PokerLiveMessage>(`/api/poker/${encodeURIComponent(id)}/live`, {
    parse: parsePokerLiveMessage,
    handshake: (message) => message.type === 'room:snapshot' ? message : undefined,
    isTerminal: (message) => message.type === 'room:missing',
    onMessage: update,
    onDisconnect: clearPresence,
  });
}
