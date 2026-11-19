import 'server-only';

import { LIVE_HEARTBEAT_MS, LIVE_HEARTBEAT_TIMEOUT_MS, type BoardLiveMessage } from '../../../lib/board-live-protocol';
import { projectLivePublication, projectLiveSnapshot } from '../../domain/live-projection';
import type { BoardRealtime, BoardStore, LiveViewerContext } from '../types';

interface Subscriber {
  viewer: LiveViewerContext;
  lastSeenAt: number;
  controller: ReadableStreamDefaultController<Uint8Array>;
  pending: BoardLiveMessage[] | null;
  unsubscribe: () => void;
  disconnect: () => void;
}

interface LiveBoard {
  subscribers: Map<string, Subscriber>;
  heartbeat: ReturnType<typeof setInterval>;
}

const encoder = new TextEncoder();
const MAX_QUEUED_MESSAGES = 256;

function send(subscriber: Subscriber, message: BoardLiveMessage): void {
  if (subscriber.pending) {
    subscriber.pending.push(message);
  } else {
    subscriber.controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
  }
}

function presence(subscribers: Map<string, Subscriber>): number {
  return new Set(Array.from(subscribers.values(), ({ viewer }) => viewer.participantHash)).size;
}

function broadcastPresence(subscribers: Map<string, Subscriber>): void {
  const message = { type: 'presence:count', count: presence(subscribers) } as const;
  for (const subscriber of subscribers.values()) send(subscriber, message);
}

export function createNodeBoardRealtime(getStore: () => Promise<BoardStore>): BoardRealtime {
  const boards = new Map<string, LiveBoard>();

  function getOrCreateBoard(boardId: string): LiveBoard {
    const existing = boards.get(boardId);
    if (existing) return existing;

    const subscribers = new Map<string, Subscriber>();
    const heartbeat = setInterval(() => {
      const now = Date.now();
      for (const subscriber of subscribers.values()) {
        if (now - subscriber.lastSeenAt > LIVE_HEARTBEAT_TIMEOUT_MS) subscriber.disconnect();
      }
    }, LIVE_HEARTBEAT_MS);
    heartbeat.unref?.();
    const board = { subscribers, heartbeat };
    boards.set(boardId, board);
    return board;
  }

  return {
    async publish(boardId, publication) {
      const liveBoard = boards.get(boardId);
      if (!liveBoard) return;
      const isDeleted = !('snapshot' in publication) && publication.type === 'board:deleted';
      for (const subscriber of Array.from(liveBoard.subscribers.values())) {
        if ((subscriber.controller.desiredSize ?? 0) <= -MAX_QUEUED_MESSAGES) {
          subscriber.disconnect();
          continue;
        }
        send(subscriber, projectLivePublication(publication, subscriber.viewer));
        if (isDeleted) {
          subscriber.disconnect();
        }
      }
    },

    async handleLiveConnection(boardId, request, viewer) {
      if (request.signal.aborted) return new Response(null, { status: 408 });
      const store = await getStore();
      if (request.signal.aborted) return new Response(null, { status: 408 });

      const connectionId = crypto.randomUUID();
      let subscriber: Subscriber;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const board = getOrCreateBoard(boardId);
          const { subscribers } = board;
          function unsubscribe() {
            request.signal.removeEventListener('abort', disconnect);
            if (!subscribers.delete(connectionId)) return;
            if (subscribers.size > 0) broadcastPresence(subscribers);
            else {
              clearInterval(board.heartbeat);
              boards.delete(boardId);
            }
          }
          function disconnect() {
            if (!subscribers.has(connectionId)) return;
            unsubscribe();
            controller.close();
          }
          subscriber = { viewer, lastSeenAt: Date.now(), controller, pending: [], unsubscribe, disconnect };
          subscribers.set(connectionId, subscriber);
          request.signal.addEventListener('abort', disconnect, { once: true });

          // Subscribe before loading the snapshot so a concurrent write is visible.
          try {
            const snapshot = await store.getBoardSnapshot(boardId);
            if (!subscribers.has(connectionId)) return;
            const pending = subscriber.pending!;
            subscriber.pending = null;
            if (!snapshot) {
              send(subscriber, { type: 'board:deleted', version: 0 });
              disconnect();
              return;
            }
            send(subscriber, { ...projectLiveSnapshot(snapshot, viewer), connectionId });
            for (const message of pending) {
              if ('version' in message && message.version > snapshot.board.version) {
                send(subscriber, message);
              }
            }
            broadcastPresence(subscribers);
          } catch (error) {
            unsubscribe();
            controller.error(error);
          }
        },
        cancel() {
          subscriber.unsubscribe();
        },
      });
      return new Response(body, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store, no-transform',
          'x-accel-buffering': 'no',
        },
      });
    },

    recordHeartbeat(boardId, connectionId, viewer) {
      const subscriber = boards.get(boardId)?.subscribers.get(connectionId);
      if (!subscriber || subscriber.viewer.participantHash !== viewer.participantHash ||
          subscriber.viewer.isFacilitator !== viewer.isFacilitator) return false;
      const now = Date.now();
      if (now - subscriber.lastSeenAt > LIVE_HEARTBEAT_TIMEOUT_MS) {
        subscriber.disconnect();
        return false;
      }
      subscriber.lastSeenAt = now;
      send(subscriber, { type: 'heartbeat' });
      return true;
    },

    async getPresenceCount(boardId) {
      const board = boards.get(boardId);
      return board ? presence(board.subscribers) : 0;
    },
  };
}
