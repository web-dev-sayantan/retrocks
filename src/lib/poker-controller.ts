import {
  action,
  createEffect,
  createMemo,
  createOptimisticStore,
  createSignal,
  flush,
  onSettled,
  untrack,
} from 'solid-js';

import { confirmBoardAction, type BoardConfirmation } from './board-confirm';
import { subscribeFacilitatorLinkClaim, takeFacilitatorLinkToken } from './facilitator-link';
import { createLiveStream, type LiveStatus, type LiveTransport } from './live-stream';
import { projectedDeckRoundChange, isSamePokerDeck } from './poker-deck-policy';
import {
  projectedPokerDiscardDecision,
  projectedPokerDiscardPrompt,
  type PokerDiscardIntent,
} from './poker-discard-policy';
import { pokerRoomPath } from './poker-routes';
import { parsePokerLiveMessage } from './poker-schemas';
import type { PokerSharingResult } from './poker-sharing-types';
import {
  POKER_DECK_PRESETS,
  POKER_DEFAULT_ROOM_NAME,
  unresolvedPokerRoundId,
  type PokerClosedRoomView,
  type PokerLiveMessage,
  type PokerLiveRoomView,
  type PokerResult,
  type PokerRoomChange,
  type PokerRoomView,
} from './poker-types';
import { recordRecentPokerRoom, removeRecentPokerRoom } from './recent-poker-rooms';

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
    if (index === -1) round.submittedParticipantIds.push(viewerId);
  } else if (index !== -1) {
    round.submittedParticipantIds.splice(index, 1);
  }
}

function canProceedWithRoundChange(
  room: PokerLiveRoomView,
  command: { type: PokerDiscardIntent; discardRoundId?: string },
  isActive: boolean,
) {
  const decision = projectedPokerDiscardDecision(command.type, isActive, room.round, command.discardRoundId);
  return decision.type === 'proceed' || decision.type === 'discard';
}

function resolveChangedDeckChoices(
  room: Pick<PokerLiveRoomView, 'deckType' | 'deck'>,
  deck: Extract<PokerRoomChange, { type: 'set-deck' }>['deck'],
): readonly string[] | null {
  const choices = deck.type === 'custom'
    ? deck.choices.map((choice) => choice.trim()).filter(Boolean)
    : POKER_DECK_PRESETS[deck.type];
  if (deck.type === 'custom' && (choices.length < 2 || new Set(choices).size !== choices.length)) {
    return null;
  }
  return isSamePokerDeck(room, deck.type, choices) ? null : choices;
}

function applyOptimisticRoomChange(room: PokerRoomView | null, command: PokerRoomChange): void {
  if (!room || room.closed) return;
  switch (command.type) {
    case 'vote':
      applyOptimisticVote(room, command.roundId, command.choice);
      break;
    case 'edit-story': {
      const title = command.title.trim();
      if (!title) return;
      const story = room.stories.find((item) => item.id === command.storyId);
      if (!story || story.locked || story.title === title) return;
      const isActive = room.activeStoryId === story.id;
      if (!canProceedWithRoundChange(room, command, isActive)) return;
      story.title = title;
      if (isActive && unresolvedPokerRoundId(room.round) !== undefined) room.round = null;
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
      if (story && !story.locked && story.acceptedEstimate === command.expectedEstimate) {
        story.status = 'estimated';
        story.acceptedEstimate = command.choice;
      }
      break;
    }
    case 'return-story': {
      const story = room.stories.find((item) => item.id === command.storyId);
      if (story && !story.locked && story.status === 'skipped') {
        story.status = 'pending';
      }
      break;
    }
    case 'set-story-lock': {
      const story = room.stories.find((item) => item.id === command.storyId);
      if (!story) return;
      if (command.locked) {
        const isActive = room.activeStoryId === story.id;
        if (!canProceedWithRoundChange(room, command, isActive)) return;
        if (isActive) {
          room.activeStoryId = null;
          room.round = null;
        }
      }
      story.locked = command.locked;
      break;
    }
    case 'delete-story': {
      const index = room.stories.findIndex((item) => item.id === command.storyId);
      if (index === -1) return;
      const story = room.stories[index];
      if (story.locked) return;
      const isActive = room.activeStoryId === story.id;
      if (!canProceedWithRoundChange(room, command, isActive)) return;
      if (isActive) {
        room.activeStoryId = null;
        room.round = null;
      }
      room.stories.splice(index, 1);
      break;
    }
    case 'set-deck': {
      const choices = resolveChangedDeckChoices(room, command.deck);
      if (!choices) return;

      const change = projectedDeckRoundChange(room, command.discardRoundId);
      if (change.type === 'confirm' || change.type === 'stale') return;
      room.deckType = command.deck.type;
      room.deck = [...choices];
      // A replacement round becomes actionable once its authoritative ID arrives.
      if (change.type === 'discard') room.round = null;
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
    case 'rename-room': {
      room.name = command.name.trim() || POKER_DEFAULT_ROOM_NAME;
      break;
    }
    case 'add-story':
    case 'select-story':
    case 'reveal':
    case 'restart-round':
    case 'skip-story':
    case 'close-room':
    case 'reopen-room':
      break;
  }
}

export type PokerRoomPhase = 'unjoined' | 'live' | 'closed' | 'reopening' | 'unavailable';

export interface PokerChangeOptions {
  /** Called right before opening a modal confirmation dialog. */
  onBeforeConfirm?: () => void;
  /** Called right after a modal confirmation dialog closes. */
  onAfterConfirm?: (confirmed: boolean) => void;
  /** Checked after confirmation; returning false aborts before sending the command. */
  shouldContinue?: () => boolean;
}

export type PokerChangeOutcome =
  | PokerResult
  | { ok: false; reason: 'busy' | 'cancelled' }
  | { ok: false; reason: 'network'; message: string };

interface PendingConfirmation {
  discardRoundId: string | undefined;
  prompt: BoardConfirmation;
}

function resolveConfirmation(
  room: PokerLiveRoomView,
  command: PokerRoomChange,
): PendingConfirmation | null {
  if ('discardRoundId' in command && command.discardRoundId !== undefined) {
    return null;
  }

  switch (command.type) {
    case 'select-story': {
      const discardRoundId = projectedPokerDiscardPrompt('select-story', true, room.round);
      if (discardRoundId === undefined) return null;
      return {
        discardRoundId,
        prompt: {
          title: 'Switch Stories?',
          description: 'Switching Stories discards the current Voting Round and its votes.',
          cancelLabel: 'Stay with this Story',
          confirmLabel: 'Switch Story',
        },
      };
    }
    case 'add-story': {
      if (!command.makeActive) return null;
      const discardRoundId = projectedPokerDiscardPrompt('add-story', true, room.round);
      if (discardRoundId === undefined) return null;
      return {
        discardRoundId,
        prompt: {
          title: 'Make new Story active?',
          description:
            'Making this Story active discards the current Voting Round and its votes, then locks the previous Story.',
          cancelLabel: 'Keep voting',
          confirmLabel: 'Lock previous & make active',
          agentConfirm:
            'Discards the current Voting Round and its votes, locks the previous Story, and makes the new Story active.',
        },
      };
    }
    case 'edit-story': {
      const trimmed = command.title.trim();
      const story = room.stories.find((item) => item.id === command.storyId);
      if (!trimmed || !story || story.locked || story.title === trimmed) return null;
      const discardRoundId = projectedPokerDiscardPrompt(
        'edit-story',
        room.activeStoryId === story.id,
        room.round,
      );
      if (discardRoundId === undefined) return null;
      return {
        discardRoundId,
        prompt: {
          title: 'Change active Story title?',
          description: 'Changing the title restarts the current Voting Round with empty ballots.',
          cancelLabel: 'Keep current title',
          confirmLabel: 'Save and restart voting',
          agentConfirm:
            'Changes the active Story title and restarts the current Voting Round with empty ballots.',
        },
      };
    }
    case 'set-story-lock': {
      if (!command.locked) return null;
      const discardRoundId = projectedPokerDiscardPrompt(
        'set-story-lock',
        room.activeStoryId === command.storyId,
        room.round,
      );
      if (discardRoundId === undefined) return null;
      return {
        discardRoundId,
        prompt: {
          title: 'Lock active Story?',
          description:
            'Locking this Story discards the current Voting Round and its votes, then clears the stage.',
          cancelLabel: 'Keep voting',
          confirmLabel: 'Lock and discard votes',
          agentConfirm: 'Locks the active Story and discards the current Voting Round and its votes.',
        },
      };
    }
    case 'set-deck': {
      if (!resolveChangedDeckChoices(room, command.deck)) return null;
      const change = projectedDeckRoundChange(room);
      if (change.type !== 'confirm') return null;
      return {
        discardRoundId: change.roundId,
        prompt: {
          title: 'Change Deck and restart voting?',
          description:
            'Changing the Deck discards the current Voting Round and its votes. Existing Accepted Estimates stay as they are.',
          cancelLabel: 'Keep current Deck',
          confirmLabel: 'Change Deck & restart',
          agentConfirm:
            'Changes the Deck, discards the current Voting Round and its votes, and keeps existing Accepted Estimates.',
        },
      };
    }
    case 'close-room': {
      const discardRoundId = projectedPokerDiscardPrompt('close-room', true, room.round);
      return {
        discardRoundId,
        prompt: discardRoundId !== undefined
          ? {
              title: 'Close Room?',
              description:
                'Closing discards the current Voting Round and its votes while keeping Accepted Estimates in the summary. A Facilitator can reopen the Room later.',
              confirmLabel: 'Close and discard votes',
              agentConfirm:
                'Closes the Room and discards the current Voting Round and its votes. Accepted Estimates stay in the summary, and a Facilitator can reopen the Room later.',
            }
          : {
              title: 'Close Room?',
              description:
                'Closing moves the Room to a read-only summary of Stories and Accepted Estimates. A Facilitator can reopen the Room later.',
              confirmLabel: 'Close Room',
              agentConfirm:
                'Closes the Room and moves it to a read-only summary of Stories and Accepted Estimates. A Facilitator can reopen the Room later.',
            },
      };
    }
    case 'delete-story':
    case 'vote':
    case 'reveal':
    case 'confirm-estimate':
    case 'restart-round':
    case 'skip-story':
    case 'move-story':
    case 'correct-estimate':
    case 'return-story':
    case 'rename-room':
    case 'reopen-room':
      return null;
  }
}

function withDiscardRoundId(
  command: PokerRoomChange,
  discardRoundId: string | undefined,
): PokerRoomChange {
  if (discardRoundId === undefined) return command;
  switch (command.type) {
    case 'select-story':
    case 'add-story':
    case 'edit-story':
    case 'set-story-lock':
    case 'delete-story':
    case 'set-deck':
    case 'close-room':
      return { ...command, discardRoundId };
    default:
      return command;
  }
}

function fallbackErrorMessage(command: PokerRoomChange): string {
  switch (command.type) {
    case 'close-room':
      return 'Could not close the Room. Try again.';
    case 'reopen-room':
      return 'Could not reopen the Room. Try again.';
    case 'rename-room':
      return 'Could not rename the Room. Try again.';
    case 'set-deck':
      return 'Could not save the Deck. Try again.';
    case 'edit-story':
      return 'Could not update the Story title. Try again.';
    case 'vote':
    case 'reveal':
    case 'confirm-estimate':
    case 'restart-round':
    case 'skip-story':
      return 'Could not update the Voting Round. Try again.';
    case 'add-story':
    case 'select-story':
    case 'move-story':
    case 'correct-estimate':
    case 'return-story':
    case 'set-story-lock':
    case 'delete-story':
      return 'Could not update the Story queue. Try again.';
  }
}

export interface PokerFragmentAdapter {
  /** Reads and scrubs any `#f=<token>` fragment for `roomPath` from the current URL. */
  takeToken(roomPath: string): string | null;
  /** Subscribes to subsequent URL hash changes and returns an unsubscribe callback. */
  onHashChange(listener: () => void): () => void;
}

export interface PokerRecentRoomsAdapter {
  record(id: string, options?: { name?: string; onlyIfSaved?: boolean }): void;
  remove(id: string): void;
}

const browserPokerFragmentAdapter: PokerFragmentAdapter = {
  takeToken: (roomPath) => (typeof window === 'undefined' ? null : takeFacilitatorLinkToken(roomPath)),
  onHashChange: (listener) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  },
};

const browserRecentRoomsAdapter: PokerRecentRoomsAdapter = {
  record: recordRecentPokerRoom,
  remove: removeRecentPokerRoom,
};

export interface PokerRoomControllerOptions {
  /** Route-provided Room ID (used for fragment scrubbing & recent-room cleanup even when `room()` is `null`). */
  roomId?: string;
  /** Route-provided Room snapshot (`null` when unavailable); reconciled into the session when newer. */
  room: () => PokerRoomView | null;
  /** Server-action surface; production passes `changePokerRoom`, tests inject a double. */
  changeRoom: (id: string, command: PokerRoomChange) => Promise<PokerResult>;
  /** Co-Facilitator Link claim adapter; production passes `claimPokerFacilitatorLink`, tests inject a double. */
  claimFacilitatorLink?: (id: string, token: string) => Promise<PokerSharingResult<PokerRoomView>>;
  /** Injectable modal confirmation adapter; defaults to `confirmBoardAction`. */
  confirm?: (options: BoardConfirmation) => Promise<boolean>;
  /** Injectable live transport; defaults to SSE/WebSocket. */
  liveTransport?: LiveTransport;
  /** Injectable URL fragment adapter for `#f=` reading/scrubbing; defaults to browser `window.location`/`history`. */
  fragment?: PokerFragmentAdapter;
  /** Injectable recent-rooms persistence adapter; defaults to `localStorage` helpers. */
  recentRooms?: PokerRecentRoomsAdapter;
  /** Called when the Room transitions from available to unavailable (`room:missing`, `ROOM_NOT_FOUND`, or `null` prop). */
  onUnavailable?: () => void;
}

export interface PokerRoomController {
  /** Current lifecycle phase of the Pointing Poker Room session. */
  phase(): PokerRoomPhase;
  /** Current viewer-projected Room state (keyed optimistic store read), or `null` when unavailable. */
  room(): PokerRoomView | null;
  /** Current open Room view when in `'unjoined'` or `'live'` phase, otherwise `undefined`. */
  liveRoom(): PokerLiveRoomView | undefined;
  /** Current closed Room view when in `'closed'` or `'reopening'` phase, otherwise `undefined`. */
  closedRoom(): PokerClosedRoomView | undefined;
  online(): string[];
  status(): LiveStatus;
  /** True while a `#f=` Co-Facilitator Link claim is in flight. */
  claimPending(): boolean;
  /** True after a `#f=` Co-Facilitator Link claim succeeded while unjoined (ADR-0001). */
  hasPendingFacilitatorClaim(): boolean;
  /** Error message from the most recent failed Co-Facilitator Link claim. */
  claimError(): string;
  /** Error message from the most recent failed Room reopen attempt. */
  reopenError(): string;
  /** True while any Room mutation or modal discard confirmation is in flight. */
  busy(): boolean;
  /** Error message from the most recent failed Room mutation. */
  error(): string;
  /** Clears the current Room mutation error message. */
  clearError(): void;
  /** True once the session has transitioned across lifecycle phases after initial mount (focus hint). */
  hasTransitionedPhase(): boolean;
  changeRoom(command: PokerRoomChange, options?: PokerChangeOptions): Promise<PokerChangeOutcome>;
  /** Unified single-flight Room reopen flow (ADR-0004). Returns `null` on unexpected network error. */
  reopenRoom(): Promise<PokerResult | null>;
  /** Transitions the session to `'unavailable'`, disposes live transport, and removes from recent rooms. */
  markUnavailable(): void;
}

function effectiveRoomPhase(room: PokerRoomView | null): 'unjoined' | 'live' | 'closed' | 'unavailable' {
  if (!room) return 'unavailable';
  if (room.closed) return 'closed';
  return room.viewer ? 'live' : 'unjoined';
}

function shouldAcceptSnapshot(current: PokerRoomView | null, next: PokerRoomView): boolean {
  if (!current) return false;
  if (next.id !== current.id) return false;
  if (next.version < current.version) return false;
  if (next.version === current.version) {
    if (current.closed && !next.closed) return false;
    if (!current.closed && !next.closed) {
      if (current.viewer && !next.viewer) return false;
      if (current.viewer?.isFacilitator && next.viewer && !next.viewer.isFacilitator) return false;
    }
  }
  return true;
}

/**
 * Route-level Pointing Poker Room session controller: owns all Room phases
 * (`unjoined`, `live`, `closed`, `reopening`, `unavailable`), the single
 * monotonic version-guarded optimistic Room store, live stream lifecycle,
 * unified ADR-0004 reopen flow, ADR-0001 `#f=` fragment claiming/scrubbing,
 * and recent-room recording.
 */
export function createPokerRoomController(
  options: PokerRoomControllerOptions,
): PokerRoomController {
  const initialRoom = untrack(() => options.room());
  const roomId = options.roomId ?? initialRoom?.id ?? '';
  const confirmAction = options.confirm ?? confirmBoardAction;
  const fragment = options.fragment ?? browserPokerFragmentAdapter;
  const recentRooms = options.recentRooms ?? browserRecentRoomsAdapter;

  const [serverRoom, setServerRoom] = createSignal<PokerRoomView | null>(initialRoom);
  const [store, setStore] = createOptimisticStore<{ room: PokerRoomView | null }>(
    () => ({ room: serverRoom() }),
    { room: initialRoom },
    { key: 'id' },
  );

  const [online, setOnline] = createSignal<string[]>([]);
  const [unavailable, setUnavailable] = createSignal(initialRoom === null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [reopening, setReopening] = createSignal(false);
  const [reopenError, setReopenError] = createSignal('');
  const [claimPending, setClaimPending] = createSignal(false);
  const [claimError, setClaimError] = createSignal('');
  const [hasPendingFacilitatorClaim, setHasPendingFacilitatorClaim] = createSignal(false);
  const [hasTransitionedPhase, setHasTransitionedPhase] = createSignal(false);
  const [live, setLive] = createSignal<ReturnType<typeof createLiveStream> | null>(null);
  const status = createMemo<LiveStatus>(() => live()?.status() ?? 'connecting');

  function applySnapshot(next: PokerRoomView): void {
    if (untrack(unavailable)) return;
    const current = untrack(serverRoom);
    if (current === next || !shouldAcceptSnapshot(current, next)) return;
    const prevPhase = effectiveRoomPhase(current);
    const nextPhase = effectiveRoomPhase(next);
    setServerRoom(next);
    if (prevPhase !== nextPhase) {
      setHasTransitionedPhase(true);
      setError('');
      if (nextPhase !== 'closed') setReopenError('');
      if (nextPhase !== 'unjoined') setHasPendingFacilitatorClaim(false);
    }
  }

  function markUnavailable(): void {
    if (untrack(unavailable)) return;
    setUnavailable(true);
    setHasTransitionedPhase(true);
    setOnline([]);
    options.onUnavailable?.();
  }

  createEffect(
    () => options.room(),
    (next) => {
      if (next === null) markUnavailable();
      else applySnapshot(next);
    },
  );

  const liveRoom = createMemo<PokerLiveRoomView | undefined>(() => {
    if (unavailable()) return undefined;
    const current = store.room;
    return current && !current.closed ? current : undefined;
  });

  const closedRoom = createMemo<PokerClosedRoomView | undefined>(() => {
    if (unavailable()) return undefined;
    const current = store.room;
    return current?.closed ? current : undefined;
  });

  const phase = createMemo<PokerRoomPhase>(() => {
    if (unavailable()) return 'unavailable';
    const current = store.room;
    if (!current) return 'unavailable';
    if (current.closed) return reopening() ? 'reopening' : 'closed';
    return current.viewer ? 'live' : 'unjoined';
  });

  const liveRoomId = createMemo(() => {
    if (unavailable()) return null;
    const current = serverRoom();
    return !current || current.closed || !current.viewer ? null : current.id;
  });

  createEffect(liveRoomId, (activeId) => {
    if (!activeId) return;
    if (typeof window === 'undefined') return;
    const stream = createLiveStream<PokerLiveMessage>(
      `/api/poker/${encodeURIComponent(activeId)}/live`,
      {
        parse: parsePokerLiveMessage,
        handshake: (message) => (message.type === 'room:snapshot' ? message : undefined),
        isTerminal: (message) =>
          message.type === 'room:missing' ||
          (message.type === 'room:snapshot' && message.room.closed),
        onMessage(message) {
          if (message.type === 'room:snapshot') {
            applySnapshot(message.room);
          } else if (message.type === 'room:presence') {
            setOnline(message.online);
          } else if (message.type === 'room:missing') {
            markUnavailable();
          }
        },
        onDisconnect: () => setOnline([]),
      },
      options.liveTransport,
    );
    setLive(stream);
    return () => {
      setLive(null);
      setOnline([]);
      stream.dispose();
    };
  });

  createEffect(
    () => {
      if (unavailable()) return roomId ? { kind: 'remove' as const, id: roomId } : null;
      const current = store.room;
      if (!current) return roomId ? { kind: 'remove' as const, id: roomId } : null;
      if (current.closed) return { kind: 'record' as const, id: current.id, name: current.name, onlyIfSaved: true };
      if (current.viewer !== null) {
        return { kind: 'record' as const, id: current.id, name: current.name, onlyIfSaved: false };
      }
      return null;
    },
    (entry) => {
      if (!entry) return;
      if (entry.kind === 'remove') recentRooms.remove(entry.id);
      else recentRooms.record(entry.id, { name: entry.name, onlyIfSaved: entry.onlyIfSaved });
    },
  );

  onSettled(() => {
    if (!roomId) return;
    const claimLink = options.claimFacilitatorLink;
    return subscribeFacilitatorLinkClaim({
      path: pokerRoomPath(roomId),
      takeToken: fragment.takeToken,
      onHashChange: fragment.onHashChange,
      shouldClaim: () => {
        const current = untrack(serverRoom);
        return Boolean(!untrack(unavailable) && current && !current.closed && claimLink);
      },
      claim: (token) => (
        claimLink
          ? claimLink(roomId, token)
          : Promise.resolve({ ok: false as const, code: 'FORBIDDEN' as const, message: '' })
      ),
      onStart: () => setClaimError(''),
      onPendingChange: setClaimPending,
      onSuccess: (result) => {
        if (result.ok) {
          applySnapshot(result.value);
          if (!result.value.closed && !result.value.viewer) {
            setHasPendingFacilitatorClaim(true);
          }
        } else if (result.code === 'ROOM_NOT_FOUND') {
          markUnavailable();
        } else {
          setClaimError(result.message);
        }
      },
      onError: () => {
        setClaimError('Could not claim Facilitator access. Open the Co-Facilitator Link to try again.');
      },
    });
  });

  const performChange = action(function* (activeId: string, command: PokerRoomChange) {
    setStore((draft) => {
      applyOptimisticRoomChange(draft.room, command);
    });
    const result: PokerResult = yield options.changeRoom(activeId, command);
    if (!result.ok) throw new PokerChangeRejected(result);
    applySnapshot(result.room);
    return result;
  });

  let mutationInFlight = false;

  async function changeRoom(
    command: PokerRoomChange,
    changeOptions?: PokerChangeOptions,
  ): Promise<PokerChangeOutcome> {
    if (mutationInFlight) {
      return { ok: false, reason: 'busy' };
    }
    const current = untrack(serverRoom);
    if (untrack(unavailable) || !current) {
      return {
        ok: false,
        code: 'ROOM_NOT_FOUND',
        message: 'This Room is no longer available.',
      };
    }

    mutationInFlight = true;
    setBusy(true);
    setError('');

    try {
      let effectiveCommand = command;
      if (!current.closed) {
        const confirmation = resolveConfirmation(current, command);
        if (confirmation) {
          changeOptions?.onBeforeConfirm?.();
          let confirmed = false;
          try {
            confirmed = await confirmAction(confirmation.prompt);
          } finally {
            changeOptions?.onAfterConfirm?.(confirmed);
          }
          if (!confirmed) {
            return { ok: false, reason: 'cancelled' };
          }
          if (changeOptions?.shouldContinue && !changeOptions.shouldContinue()) {
            return { ok: false, reason: 'cancelled' };
          }
          const latest = untrack(serverRoom);
          if (untrack(unavailable) || !latest || latest.closed) {
            return { ok: false, reason: 'cancelled' };
          }
          effectiveCommand = withDiscardRoundId(command, confirmation.discardRoundId);
        }
      }

      // Commit process flags (busy/error and caller state) before the action
      // opens; the action's transaction would otherwise hold them until it settles.
      flush();
      return await performChange(current.id, effectiveCommand);
    } catch (caught) {
      if (caught instanceof PokerChangeRejected) {
        if (caught.result.code === 'ROOM_NOT_FOUND') {
          markUnavailable();
        } else {
          setError(caught.result.message);
        }
        return caught.result;
      }
      const message = fallbackErrorMessage(command);
      setError(message);
      return { ok: false, reason: 'network', message };
    } finally {
      mutationInFlight = false;
      setBusy(false);
    }
  }

  let activeReopen: Promise<PokerResult | null> | null = null;

  function reopenRoom(): Promise<PokerResult | null> {
    if (activeReopen) return activeReopen;
    const current = untrack(serverRoom);
    if (untrack(unavailable) || !current) {
      return Promise.resolve({
        ok: false,
        code: 'ROOM_NOT_FOUND',
        message: 'This Room is no longer available.',
      });
    }

    setReopening(true);
    setReopenError('');
    const promise = (async (): Promise<PokerResult | null> => {
      try {
        const result = await changeRoom({ type: 'reopen-room' });
        if (result.ok) {
          if (!result.room.closed) {
            setClaimError('');
          }
          return result;
        }
        if ('reason' in result) {
          if (result.reason === 'network') {
            setReopenError(result.message);
          }
          return null;
        }
        if (result.code !== 'ROOM_NOT_FOUND') {
          setReopenError(result.message);
        }
        return result;
      } finally {
        activeReopen = null;
        setReopening(false);
      }
    })();
    activeReopen = promise;
    return promise;
  }

  return {
    phase,
    room: () => (unavailable() ? null : store.room),
    liveRoom,
    closedRoom,
    online,
    status,
    claimPending,
    hasPendingFacilitatorClaim,
    claimError,
    reopenError,
    busy,
    error,
    clearError: () => setError(''),
    hasTransitionedPhase,
    changeRoom,
    reopenRoom,
    markUnavailable,
  };
}
