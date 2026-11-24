import {
  action,
  createEffect,
  createMemo,
  createOptimisticStore,
  createSignal,
  flush,
  untrack,
} from 'solid-js';

import {
  createPokerLive,
  type PokerLiveStatus,
  type PokerLiveTransport,
} from './poker-live';
import {
  POKER_DECK_PRESETS,
  type PokerLiveRoomView,
  type PokerResult,
  type PokerRoomChange,
  type PokerRoomView,
} from './poker-types';

type PokerFailure = Extract<PokerResult, { ok: false }>;

class PokerChangeRejected extends Error {
  constructor(readonly result: PokerFailure) {
    super(result.message);
  }
}

function applyOptimisticVote(room: PokerLiveRoomView, roundId: string, choice: string | null): void {
  const round = room.round;
  if (!round || round.phase !== 'open' || round.id !== roundId) return;
  round.ownChoice = choice;
  const viewerId = room.viewer?.id;
  if (!viewerId) return;
  const index = round.submittedParticipantIds.indexOf(viewerId);
  if (choice !== null) {
    room.deckLocked = true;
    if (index === -1) round.submittedParticipantIds.push(viewerId);
  } else if (index !== -1) {
    round.submittedParticipantIds.splice(index, 1);
  }
}

function applyOptimisticRoomChange(room: PokerRoomView, command: PokerRoomChange): void {
  if (room.closed) return;
  switch (command.type) {
    case 'vote':
      applyOptimisticVote(room, command.roundId, command.choice);
      break;
    case 'edit-story': {
      const title = command.title.trim();
      if (!title) return;
      const story = room.stories.find((item) => item.id === command.storyId);
      if (story) story.title = title;
      break;
    }
    case 'move-story': {
      if (command.storyId === command.targetId) return;
      const fromIndex = room.stories.findIndex((item) => item.id === command.storyId);
      if (fromIndex === -1) return;
      const targetExists = room.stories.some((item) => item.id === command.targetId);
      if (!targetExists) return;
      const [moved] = room.stories.splice(fromIndex, 1);
      if (!moved) return;
      const targetIndex = room.stories.findIndex((item) => item.id === command.targetId);
      const insertAt = command.placement === 'before' ? targetIndex : targetIndex + 1;
      room.stories.splice(insertAt, 0, moved);
      break;
    }
    case 'correct-estimate': {
      const story = room.stories.find((item) => item.id === command.storyId);
      if (story && story.acceptedEstimate === command.expectedEstimate) {
        story.status = 'estimated';
        story.acceptedEstimate = command.choice;
      }
      break;
    }
    case 'return-story': {
      const story = room.stories.find((item) => item.id === command.storyId);
      if (story && story.status === 'skipped') {
        story.status = 'pending';
      }
      break;
    }
    case 'set-deck': {
      if (room.deckLocked) return;
      if (command.deck.type === 'custom') {
        const choices = command.deck.choices.map((c) => c.trim()).filter(Boolean);
        if (choices.length < 2 || new Set(choices).size !== choices.length) return;
        room.deckType = 'custom';
        room.deck = choices;
      } else {
        room.deckType = command.deck.type;
        room.deck = [...POKER_DECK_PRESETS[command.deck.type]];
      }
      break;
    }
    case 'confirm-estimate': {
      if (room.round?.phase !== 'revealed' || room.round.id !== command.roundId) return;
      room.round.phase = 'accepted';
      const activeStory = room.stories.find((item) => item.id === room.activeStoryId);
      if (activeStory) {
        activeStory.status = 'estimated';
        activeStory.acceptedEstimate = command.choice;
      }
      break;
    }
    case 'add-story':
    case 'select-story':
    case 'reveal':
    case 'restart-round':
    case 'skip-story':
    case 'close-room':
      break;
  }
}

export interface PokerRoomControllerOptions {
  /** Route-provided Room snapshot; reconciled into the controller store when newer. */
  room: () => PokerRoomView;
  /** Server-action surface; production passes `changePokerRoom`, tests inject a double. */
  changeRoom: (id: string, command: PokerRoomChange) => Promise<PokerResult>;
  /** Injectable live transport; defaults to SSE/WebSocket. */
  liveTransport?: PokerLiveTransport;
  /** Called when the Room transitions to unavailable (`room:missing` or `ROOM_NOT_FOUND`). */
  onUnavailable?: () => void;
}

export interface PokerRoomController {
  /** Current viewer-projected Room state (keyed optimistic store read). */
  room(): PokerRoomView;
  online(): string[];
  status(): PokerLiveStatus;
  changeRoom(command: PokerRoomChange): Promise<PokerResult>;
}

/**
 * Reactive Pointing Poker Room controller: owns the keyed optimistic Room store,
 * live stream lifecycle, presence list, and optimistic Room command dispatch.
 */
export function createPokerRoomController(
  options: PokerRoomControllerOptions,
): PokerRoomController {
  const initialRoom = untrack(() => options.room());
  const [serverRoom, setServerRoom] = createSignal<PokerRoomView>(initialRoom);
  const [store, setStore] = createOptimisticStore<{ room: PokerRoomView }>(
    () => ({ room: serverRoom() }),
    { room: initialRoom },
    { key: 'id' },
  );

  const [online, setOnline] = createSignal<string[]>([]);
  const [unavailable, setUnavailable] = createSignal(false);
  const [live, setLive] = createSignal<ReturnType<typeof createPokerLive> | null>(null);
  const status = createMemo<PokerLiveStatus>(() => live()?.status() ?? 'connecting');

  function applySnapshot(next: PokerRoomView): void {
    setServerRoom((current) => {
      if (next.id !== current.id) return current;
      if (next.version < current.version) return current;
      if (current.closed && !next.closed) return current;
      return next;
    });
  }

  function markUnavailable(): void {
    if (untrack(unavailable)) return;
    setUnavailable(true);
    setOnline([]);
    options.onUnavailable?.();
  }

  createEffect(() => options.room(), (next) => applySnapshot(next));

  const liveRoomId = createMemo(() => {
    if (unavailable()) return null;
    const current = serverRoom();
    return current.closed ? null : current.id;
  });

  createEffect(liveRoomId, (roomId) => {
    if (!roomId) return;
    if (typeof window === 'undefined') return;
    const stream = createPokerLive(
      roomId,
      (message) => {
        if (message.type === 'room:snapshot') {
          applySnapshot(message.room);
        } else if (message.type === 'room:presence') {
          setOnline(message.online);
        } else if (message.type === 'room:missing') {
          markUnavailable();
        }
      },
      () => setOnline([]),
      options.liveTransport,
    );
    setLive(stream);
    return () => {
      setLive(null);
      setOnline([]);
      stream.dispose();
    };
  });

  const performChange = action(function* (roomId: string, command: PokerRoomChange) {
    setStore((draft) => {
      applyOptimisticRoomChange(draft.room, command);
    });
    const result: PokerResult = yield options.changeRoom(roomId, command);
    if (!result.ok) throw new PokerChangeRejected(result);
    applySnapshot(result.room);
    return result;
  });

  async function changeRoom(command: PokerRoomChange): Promise<PokerResult> {
    // Commit caller-owned process flags written in this tick before the action
    // opens; the action's transaction would otherwise hold them until it settles.
    flush();
    const roomId = untrack(() => serverRoom().id);
    try {
      return await performChange(roomId, command);
    } catch (error) {
      if (error instanceof PokerChangeRejected) {
        if (error.result.code === 'ROOM_NOT_FOUND') markUnavailable();
        return error.result;
      }
      throw error;
    }
  }

  return {
    room: () => store.room,
    online,
    status,
    changeRoom,
  };
}
