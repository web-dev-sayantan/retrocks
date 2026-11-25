import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { createEffect, createMemo, createRoot, createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardConfirmation } from './board-confirm';
import {
  createPokerRoomController,
  type PokerFragmentAdapter,
  type PokerRecentRoomsAdapter,
  type PokerRoomController,
} from './poker-controller';
import type { LiveTransport } from './live-stream';
import type { PokerSharingResult } from './poker-sharing-types';
import {
  FIBONACCI_DECK,
  type PokerClosedRoomView,
  type PokerLiveMessage,
  type PokerLiveRoomView,
  type PokerResult,
  type PokerRoomChange,
  type PokerRoomView,
} from './poker-types';

const ROOM_ID = 'room_12345678901234567';
const ALICE_ID = 'part_alice_12345678901';
const BOB_ID = 'part_bob_1234567890123';
const STORY_1_ID = 'story_1_12345678901234';
const STORY_2_ID = 'story_2_12345678901234';
const ROUND_1_ID = 'round_1_12345678901234';

function makeLiveRoom(overrides: Partial<PokerLiveRoomView> = {}): PokerLiveRoomView {
  return {
    closed: false,
    id: ROOM_ID,
    name: 'Poker Room',
    version: 1,
    viewer: { id: ALICE_ID, displayName: 'Alice', isFacilitator: true },
    facilitatorLinkRevision: 1,
    participants: [
      { id: ALICE_ID, displayName: 'Alice', isFacilitator: true },
      { id: BOB_ID, displayName: 'Bob', isFacilitator: false },
    ],
    stories: [
      { id: STORY_1_ID, title: 'First story', status: 'pending' },
      { id: STORY_2_ID, title: 'Second story', status: 'pending' },
    ],
    activeStoryId: STORY_1_ID,
    deck: [...FIBONACCI_DECK],
    deckType: 'fibonacci',
    round: {
      id: ROUND_1_ID,
      phase: 'open',
      submittedParticipantIds: [],
      ownChoice: null,
    },
    ...overrides,
  };
}

interface FakeConnection {
  path: string;
  closed: boolean;
  emit(message: PokerLiveMessage): void;
  fail(): void;
}

function createFakeLiveTransport(): {
  transport: LiveTransport;
  connections: FakeConnection[];
} {
  const connections: FakeConnection[] = [];
  const transport: LiveTransport = {
    connect(path, handlers) {
      const connection: FakeConnection = {
        path,
        closed: false,
        emit(message) {
          handlers.onMessage(JSON.stringify(message));
        },
        fail() {
          handlers.onFailure();
        },
      };
      connections.push(connection);
      return {
        ping() {},
        close() {
          connection.closed = true;
        },
      };
    },
  };
  return { transport, connections };
}

interface FakeFragmentHarness {
  adapter: PokerFragmentAdapter;
  takenPaths: string[];
  setToken(token: string | null): void;
  triggerHashChange(token?: string | null): void;
  listenerCount(): number;
}

function createFakeFragmentAdapter(initialToken: string | null = null): FakeFragmentHarness {
  let currentToken = initialToken;
  const takenPaths: string[] = [];
  const listeners = new Set<() => void>();
  return {
    takenPaths,
    setToken(token) {
      currentToken = token;
    },
    triggerHashChange(token) {
      if (token !== undefined) currentToken = token;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
    adapter: {
      takeToken(roomPath) {
        takenPaths.push(roomPath);
        const token = currentToken;
        currentToken = null;
        return token;
      },
      onHashChange(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

interface SessionHarness {
  controller: PokerRoomController;
  setRoomProp: (room: PokerRoomView | null) => void;
  connections: FakeConnection[];
  changeRoomSpy: ReturnType<typeof vi.fn<(id: string, command: PokerRoomChange) => Promise<PokerResult>>>;
  claimLinkSpy: ReturnType<typeof vi.fn<(id: string, token: string) => Promise<PokerSharingResult<PokerRoomView>>>>;
  confirmSpy: ReturnType<typeof vi.fn<(options: BoardConfirmation) => Promise<boolean>>>;
  fragment: FakeFragmentHarness;
  recentRooms: {
    record: ReturnType<typeof vi.fn<PokerRecentRoomsAdapter['record']>>;
    remove: ReturnType<typeof vi.fn<PokerRecentRoomsAdapter['remove']>>;
  };
  onUnavailable: ReturnType<typeof vi.fn<() => void>>;
  dispose: () => void;
}

const mounted: SessionHarness[] = [];

function mountSession(
  initialRoom: PokerRoomView | null = makeLiveRoom(),
  options: {
    roomId?: string;
    initialFragmentToken?: string | null;
    confirm?: (options: BoardConfirmation) => Promise<boolean>;
  } = {},
): SessionHarness {
  const { transport, connections } = createFakeLiveTransport();
  const changeRoomSpy = vi.fn<(id: string, command: PokerRoomChange) => Promise<PokerResult>>();
  const claimLinkSpy = vi.fn<(id: string, token: string) => Promise<PokerSharingResult<PokerRoomView>>>(
    () => new Promise<PokerSharingResult<PokerRoomView>>(() => {}),
  );
  const confirmSpy = vi.fn<(options: BoardConfirmation) => Promise<boolean>>(
    options.confirm ?? (async () => true),
  );
  const fragment = createFakeFragmentAdapter(options.initialFragmentToken ?? null);
  const recentRooms = {
    record: vi.fn<PokerRecentRoomsAdapter['record']>(),
    remove: vi.fn<PokerRecentRoomsAdapter['remove']>(),
  };
  const onUnavailable = vi.fn<() => void>();
  let harness!: SessionHarness;
  const dispose = createRoot((disposeRoot) => {
    const [roomProp, setRoomProp] = createSignal<PokerRoomView | null>(initialRoom);
    const controller = createPokerRoomController({
      roomId: options.roomId ?? initialRoom?.id ?? ROOM_ID,
      room: roomProp,
      changeRoom: changeRoomSpy,
      claimFacilitatorLink: claimLinkSpy,
      confirm: confirmSpy,
      liveTransport: transport,
      fragment: fragment.adapter,
      recentRooms,
      onUnavailable,
    });
    harness = {
      controller,
      setRoomProp,
      connections,
      changeRoomSpy,
      claimLinkSpy,
      confirmSpy,
      fragment,
      recentRooms,
      onUnavailable,
      dispose: disposeRoot,
    };
    return disposeRoot;
  });
  flush();
  mounted.push(harness);
  return { ...harness, dispose };
}

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.dispose();
  }
});

describe('createPokerRoomController', () => {
  it('reconciles incoming live snapshots by key for Participants and Stories without re-running unchanged readers, ignores stale versions, and tracks presence', () => {
    const initial = makeLiveRoom();
    const { controller, connections } = mountSession(initial);

    expect(connections).toHaveLength(1);
    expect(connections[0].path).toBe(`/api/poker/${ROOM_ID}/live`);
    expect(controller.status()).toBe('connecting');

    let aliceReads = 0;
    let bobReads = 0;
    let story1Reads = 0;
    let story2Reads = 0;

    const cleanupObservers = createRoot((dispose) => {
      const aliceName = createMemo(() => {
        const room = controller.room();
        if (!room || room.closed) return '';
        const alice = room.participants.find((p) => p.id === ALICE_ID);
        aliceReads += 1;
        return alice?.displayName ?? '';
      });
      const bobName = createMemo(() => {
        const room = controller.room();
        if (!room || room.closed) return '';
        const bob = room.participants.find((p) => p.id === BOB_ID);
        bobReads += 1;
        return bob?.displayName ?? '';
      });
      const story1Title = createMemo(() => {
        const room = controller.room();
        if (!room || room.closed) return '';
        const story = room.stories.find((s) => s.id === STORY_1_ID);
        story1Reads += 1;
        return story?.title ?? '';
      });
      const story2Title = createMemo(() => {
        const room = controller.room();
        if (!room || room.closed) return '';
        const story = room.stories.find((s) => s.id === STORY_2_ID);
        story2Reads += 1;
        return story?.title ?? '';
      });
      createEffect(() => [aliceName(), bobName(), story1Title(), story2Title()], () => {});
      return dispose;
    });
    flush();

    expect(aliceReads).toBe(1);
    expect(bobReads).toBe(1);
    expect(story1Reads).toBe(1);
    expect(story2Reads).toBe(1);

    // Emit a live snapshot updating only Bob's displayName and Story 2's title.
    connections[0].emit({
      type: 'room:snapshot',
      room: makeLiveRoom({
        version: 2,
        participants: [
          { id: ALICE_ID, displayName: 'Alice', isFacilitator: true },
          { id: BOB_ID, displayName: 'Robert', isFacilitator: false },
        ],
        stories: [
          { id: STORY_1_ID, title: 'First story', status: 'pending' },
          { id: STORY_2_ID, title: 'Second story (edited)', status: 'pending' },
        ],
      }),
    });
    flush();

    expect(controller.status()).toBe('live');
    const room = controller.room();
    expect(room?.closed).toBe(false);
    if (room && !room.closed) {
      expect(room.version).toBe(2);
      expect(room.participants[1]?.displayName).toBe('Robert');
      expect(room.stories[1]?.title).toBe('Second story (edited)');
    }
    // Unchanged Participant (Alice) and unchanged Story (Story 1) did NOT re-run!
    expect(aliceReads).toBe(1);
    expect(story1Reads).toBe(1);
    expect(bobReads).toBe(2);
    expect(story2Reads).toBe(2);

    // Stale snapshot must not regress state.
    connections[0].emit({
      type: 'room:snapshot',
      room: makeLiveRoom({
        version: 1,
        participants: [
          { id: ALICE_ID, displayName: 'Alice', isFacilitator: true },
          { id: BOB_ID, displayName: 'Stale Bob', isFacilitator: false },
        ],
      }),
    });
    flush();
    const afterStale = controller.room();
    expect(afterStale?.version).toBe(2);
    if (afterStale && !afterStale.closed) {
      expect(afterStale.participants[1]?.displayName).toBe('Robert');
    }

    // Presence updates and clears on disconnect.
    connections[0].emit({ type: 'room:presence', online: [ALICE_ID, BOB_ID] });
    flush();
    expect(controller.online()).toEqual([ALICE_ID, BOB_ID]);

    connections[0].fail();
    flush();
    expect(controller.online()).toEqual([]);
    expect(controller.status()).toBe('reconnecting');

    cleanupObservers();
  });

  it('reconnects after a transport failure and restores live status, snapshot, and presence', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { controller, connections } = mountSession(makeLiveRoom());

      connections[0].emit({ type: 'room:snapshot', room: makeLiveRoom({ version: 2, name: 'Before drop' }) });
      connections[0].emit({ type: 'room:presence', online: [ALICE_ID, BOB_ID] });
      flush();
      expect(controller.status()).toBe('live');
      expect(controller.online()).toEqual([ALICE_ID, BOB_ID]);

      connections[0].fail();
      flush();
      expect(connections[0].closed).toBe(true);
      expect(controller.status()).toBe('reconnecting');
      expect(controller.online()).toEqual([]);

      vi.advanceTimersByTime(500);
      flush();
      expect(connections).toHaveLength(2);
      expect(controller.status()).toBe('connecting');

      connections[1].emit({ type: 'room:snapshot', room: makeLiveRoom({ version: 3, name: 'After reconnect' }) });
      connections[1].emit({ type: 'room:presence', online: [ALICE_ID] });
      flush();
      expect(controller.status()).toBe('live');
      expect(controller.room()?.name).toBe('After reconnect');
      expect(controller.room()?.version).toBe(3);
      expect(controller.online()).toEqual([ALICE_ID]);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('applies Vote selection and clearing optimistically, commits authoritative state on success, and rolls back automatically on rejection or network error', async () => {
    const initial = makeLiveRoom();
    const { controller, changeRoomSpy } = mountSession(initial);

    let resolveVote!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveVote = resolve;
      }),
    );

    // 1. Cast a Vote optimistically during an open Voting Round.
    const votePromise = controller.changeRoom({ type: 'vote', roundId: ROUND_1_ID, choice: '5' });
    flush();

    const optimisticRoom = controller.room();
    expect(optimisticRoom?.closed).toBe(false);
    if (optimisticRoom && !optimisticRoom.closed && optimisticRoom.round?.phase === 'open') {
      expect(optimisticRoom.round.ownChoice).toBe('5');
      expect(optimisticRoom.round.submittedParticipantIds).toContain(ALICE_ID);
    } else {
      throw new Error('Expected open voting round');
    }
    expect(changeRoomSpy).toHaveBeenCalledWith(ROOM_ID, {
      type: 'vote',
      roundId: ROUND_1_ID,
      choice: '5',
    });

    // Authoritative server response commits cleanly.
    const committedRoom = makeLiveRoom({
      version: 2,
      round: {
        id: ROUND_1_ID,
        phase: 'open',
        submittedParticipantIds: [ALICE_ID, BOB_ID],
        ownChoice: '5',
      },
    });
    resolveVote({ ok: true, room: committedRoom });
    const voteResult = await votePromise;
    flush();

    expect(voteResult).toEqual({ ok: true, room: committedRoom });
    const afterCommit = controller.room();
    expect(afterCommit?.version).toBe(2);
    if (afterCommit && !afterCommit.closed && afterCommit.round?.phase === 'open') {
      expect(afterCommit.round.ownChoice).toBe('5');
      expect(afterCommit.round.submittedParticipantIds).toEqual([ALICE_ID, BOB_ID]);
    }

    // 2. Clear Vote optimistically, then reject with ROUND_CHANGED -> reverts automatically.
    let resolveReject!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveReject = resolve;
      }),
    );

    const clearPromise = controller.changeRoom({ type: 'vote', roundId: ROUND_1_ID, choice: null });
    flush();

    const optimisticCleared = controller.room();
    if (optimisticCleared && !optimisticCleared.closed && optimisticCleared.round?.phase === 'open') {
      expect(optimisticCleared.round.ownChoice).toBeNull();
      expect(optimisticCleared.round.submittedParticipantIds).toEqual([BOB_ID]);
    }

    const rejection: PokerResult = {
      ok: false,
      code: 'ROUND_CHANGED',
      message: 'The Voting Round changed before your vote arrived.',
    };
    resolveReject(rejection);
    const clearResult = await clearPromise;
    flush();

    expect(clearResult).toEqual(rejection);
    const afterRollback = controller.room();
    if (afterRollback && !afterRollback.closed && afterRollback.round?.phase === 'open') {
      expect(afterRollback.round.ownChoice).toBe('5');
      expect(afterRollback.round.submittedParticipantIds).toEqual([ALICE_ID, BOB_ID]);
    }

    // 3. Network failure (rejected promise) also reverts automatically and rethrows.
    let rejectNetwork!: (error: Error) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((_, reject) => {
        rejectNetwork = reject;
      }),
    );

    const failingVote = controller.changeRoom({ type: 'vote', roundId: ROUND_1_ID, choice: '8' });
    flush();

    const optimisticEight = controller.room();
    if (optimisticEight && !optimisticEight.closed && optimisticEight.round?.phase === 'open') {
      expect(optimisticEight.round.ownChoice).toBe('8');
    }

    rejectNetwork(new Error('Network down'));
    await expect(failingVote).resolves.toEqual({
      ok: false,
      reason: 'network',
      message: 'Could not update the Voting Round. Try again.',
    });
    flush();

    expect(controller.error()).toBe('Could not update the Voting Round. Try again.');
    expect(controller.busy()).toBe(false);
    const afterNetworkRollback = controller.room();
    if (afterNetworkRollback && !afterNetworkRollback.closed && afterNetworkRollback.round?.phase === 'open') {
      expect(afterNetworkRollback.round.ownChoice).toBe('5');
      expect(afterNetworkRollback.round.submittedParticipantIds).toEqual([ALICE_ID, BOB_ID]);
    }
  });

  it('applies safe Facilitator Room commands optimistically and reverts on rejection', async () => {
    const initial = makeLiveRoom({
      stories: [
        { id: STORY_1_ID, title: 'First story', status: 'pending' },
        { id: STORY_2_ID, title: 'Second story', status: 'skipped' },
      ],
      round: {
        id: ROUND_1_ID,
        phase: 'revealed',
        ballots: [{ participantId: ALICE_ID, displayName: 'Alice', choice: '5' }],
      },
    });
    const { controller, changeRoomSpy } = mountSession(initial);

    // 1. Edit story title optimistically, then reject with FORBIDDEN -> reverts.
    let resolveEdit!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveEdit = resolve;
      }),
    );
    const editPromise = controller.changeRoom({
      type: 'edit-story',
      storyId: STORY_1_ID,
      title: 'Renamed story',
      discardRoundId: ROUND_1_ID,
    });
    flush();

    let current = controller.room();
    if (current && !current.closed) {
      expect(current.stories[0]?.title).toBe('Renamed story');
      expect(current.round).toBeNull();
    }
    resolveEdit({ ok: false, code: 'FORBIDDEN', message: 'Only a Facilitator can edit Stories.' });
    const editResult = await editPromise;
    flush();
    expect(editResult.ok).toBe(false);
    current = controller.room();
    if (current && !current.closed) {
      expect(current.stories[0]?.title).toBe('First story');
      expect(current.round?.id).toBe(ROUND_1_ID);
    }

    // 2. Move story optimistically, then reject with ROOM_CLOSED -> reverts.
    let resolveMove!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveMove = resolve;
      }),
    );
    const movePromise = controller.changeRoom({
      type: 'move-story',
      storyId: STORY_2_ID,
      targetId: STORY_1_ID,
      placement: 'before',
    });
    flush();
    current = controller.room();
    if (current && !current.closed) {
      expect(current.stories.map((s) => s.id)).toEqual([STORY_2_ID, STORY_1_ID]);
    }
    resolveMove({ ok: false, code: 'ROOM_CLOSED', message: 'This Room is closed.' });
    await movePromise;
    flush();
    current = controller.room();
    if (current && !current.closed) {
      expect(current.stories.map((s) => s.id)).toEqual([STORY_1_ID, STORY_2_ID]);
    }

    // 3. Set deck optimistically with discardRoundId, then reject with ROUND_CHANGED -> reverts.
    let resolveDeck!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveDeck = resolve;
      }),
    );
    const deckPromise = controller.changeRoom({
      type: 'set-deck',
      deck: { type: 't-shirt' },
      discardRoundId: ROUND_1_ID,
    });
    flush();
    current = controller.room();
    if (current && !current.closed) {
      expect(current.deckType).toBe('t-shirt');
      expect(current.deck).toEqual(['XS', 'S', 'M', 'L', 'XL']);
      expect(current.round).toBeNull();
    }
    resolveDeck({ ok: false, code: 'ROUND_CHANGED', message: 'The Voting Round has changed.' });
    await deckPromise;
    flush();
    current = controller.room();
    if (current && !current.closed) {
      expect(current.deckType).toBe('fibonacci');
      expect(current.deck).toEqual([...FIBONACCI_DECK]);
      expect(current.round).toEqual(initial.round);
    }

    // 4. Confirm estimate optimistically, then commit on success.
    let resolveConfirm!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const confirmPromise = controller.changeRoom({
      type: 'confirm-estimate',
      roundId: ROUND_1_ID,
      choice: '5',
    });
    flush();
    current = controller.room();
    if (current && !current.closed) {
      expect(current.round?.phase).toBe('accepted');
      expect(current.stories[0]?.status).toBe('estimated');
      expect(current.stories[0]?.acceptedEstimate).toBe('5');
    }
    resolveConfirm({
      ok: true,
      room: makeLiveRoom({
        version: 2,
        stories: [
          { id: STORY_1_ID, title: 'First story', status: 'estimated', acceptedEstimate: '5' },
          { id: STORY_2_ID, title: 'Second story', status: 'skipped' },
        ],
        round: {
          id: ROUND_1_ID,
          phase: 'accepted',
          ballots: [{ participantId: ALICE_ID, displayName: 'Alice', choice: '5' }],
        },
      }),
    });
    await confirmPromise;
    flush();
    current = controller.room();
    expect(current?.version).toBe(2);
    if (current && !current.closed) {
      expect(current.stories[0]?.acceptedEstimate).toBe('5');
    }
  });

  it('applies set-story-lock optimistically (clearing active stage when locking active Story), guards locked Story edits, and rolls back on rejection', async () => {
    const initial = makeLiveRoom({
      stories: [
        { id: STORY_1_ID, title: 'First story', status: 'estimated', acceptedEstimate: '5', locked: false },
        { id: STORY_2_ID, title: 'Second story', status: 'skipped', locked: true },
      ],
      activeStoryId: STORY_1_ID,
      round: {
        id: ROUND_1_ID,
        phase: 'open',
        submittedParticipantIds: [],
        ownChoice: null,
      },
    });
    const { controller, changeRoomSpy } = mountSession(initial);

    let resolveEditLocked!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveEditLocked = resolve;
      }),
    );
    const editLocked = controller.changeRoom({
      type: 'edit-story',
      storyId: STORY_2_ID,
      title: 'Should not apply',
    });
    flush();
    let current = controller.room();
    if (current && !current.closed) {
      expect(current.stories[1]?.title).toBe('Second story');
    }
    resolveEditLocked({ ok: false, code: 'STORY_LOCKED', message: 'Unlock this Story before changing it.' });
    await editLocked;
    flush();

    let resolveLock!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveLock = resolve;
      }),
    );
    const lockPromise = controller.changeRoom({
      type: 'set-story-lock',
      storyId: STORY_1_ID,
      locked: true,
    });
    flush();
    current = controller.room();
    if (current && !current.closed) {
      expect(current.stories[0]?.locked).toBe(true);
      expect(current.stories[0]?.status).toBe('estimated');
      expect(current.stories[0]?.acceptedEstimate).toBe('5');
      expect(current.activeStoryId).toBeNull();
      expect(current.round).toBeNull();
    }
    resolveLock({ ok: false, code: 'ROUND_CHANGED', message: 'The Voting Round has changed.' });
    await lockPromise;
    flush();
    current = controller.room();
    if (current && !current.closed) {
      expect(current.stories[0]?.locked).toBe(false);
      expect(current.activeStoryId).toBe(STORY_1_ID);
      expect(current.round?.id).toBe(ROUND_1_ID);
    }

    let resolveUnlock!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveUnlock = resolve;
      }),
    );
    const unlockPromise = controller.changeRoom({
      type: 'set-story-lock',
      storyId: STORY_2_ID,
      locked: false,
    });
    flush();
    current = controller.room();
    if (current && !current.closed) {
      expect(current.stories[1]?.locked).toBe(false);
    }
    resolveUnlock({
      ok: true,
      room: makeLiveRoom({
        version: 2,
        stories: [
          { id: STORY_1_ID, title: 'First story', status: 'estimated', acceptedEstimate: '5', locked: false },
          { id: STORY_2_ID, title: 'Second story', status: 'skipped', locked: false },
        ],
      }),
    });
    await unlockPromise;
    flush();
    current = controller.room();
    expect(current?.version).toBe(2);
    if (current && !current.closed) {
      expect(current.stories[1]?.locked).toBe(false);
    }
  });

  it('applies delete-story optimistically (clearing active stage), guards locked Stories, and reverts on rejection', async () => {
    const initial = makeLiveRoom({
      stories: [
        { id: STORY_1_ID, title: 'First story', status: 'pending', locked: false },
        { id: STORY_2_ID, title: 'Second story', status: 'estimated', acceptedEstimate: '5', locked: true },
      ],
      activeStoryId: STORY_1_ID,
      round: {
        id: ROUND_1_ID,
        phase: 'open',
        submittedParticipantIds: [ALICE_ID],
        ownChoice: '5',
      },
    });
    const { controller, changeRoomSpy } = mountSession(initial);

    let resolveLocked!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveLocked = resolve;
      }),
    );
    const lockedDelete = controller.changeRoom({ type: 'delete-story', storyId: STORY_2_ID });
    flush();
    let current = controller.room();
    if (current && !current.closed) {
      expect(current.stories.map((s) => s.id)).toEqual([STORY_1_ID, STORY_2_ID]);
    }
    resolveLocked({ ok: false, code: 'STORY_LOCKED', message: 'Unlock this Story before changing it.' });
    await lockedDelete;
    flush();

    let resolveDeleteReject!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveDeleteReject = resolve;
      }),
    );
    const deleteReject = controller.changeRoom({
      type: 'delete-story',
      storyId: STORY_1_ID,
      discardRoundId: ROUND_1_ID,
    });
    flush();
    current = controller.room();
    if (current && !current.closed) {
      expect(current.stories.map((s) => s.id)).toEqual([STORY_2_ID]);
      expect(current.activeStoryId).toBeNull();
      expect(current.round).toBeNull();
    }
    resolveDeleteReject({ ok: false, code: 'ROUND_CHANGED', message: 'The Voting Round has changed.' });
    await deleteReject;
    flush();
    current = controller.room();
    if (current && !current.closed) {
      expect(current.stories.map((s) => s.id)).toEqual([STORY_1_ID, STORY_2_ID]);
      expect(current.activeStoryId).toBe(STORY_1_ID);
      expect(current.round?.id).toBe(ROUND_1_ID);
    }

    let resolveDeleteOk!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveDeleteOk = resolve;
      }),
    );
    const deleteOk = controller.changeRoom({
      type: 'delete-story',
      storyId: STORY_1_ID,
      discardRoundId: ROUND_1_ID,
    });
    flush();
    resolveDeleteOk({
      ok: true,
      room: makeLiveRoom({
        version: 2,
        stories: [{ id: STORY_2_ID, title: 'Second story', status: 'estimated', acceptedEstimate: '5', locked: true }],
        activeStoryId: null,
        round: null,
      }),
    });
    await deleteOk;
    flush();
    current = controller.room();
    expect(current?.version).toBe(2);
    if (current && !current.closed) {
      expect(current.stories.map((s) => s.id)).toEqual([STORY_2_ID]);
      expect(current.activeStoryId).toBeNull();
      expect(current.round).toBeNull();
    }
  });

  it('disposes the live stream cleanly when a live snapshot or command closes the Room', async () => {
    const closedSnapshot: PokerClosedRoomView = {
      closed: true,
      id: ROOM_ID,
      name: 'Poker Room',
      version: 3,
      canDelete: true,
      stories: [{ title: 'First story', status: 'estimated', acceptedEstimate: '5' }],
    };

    // Case A: live room:snapshot closes the Room.
    const liveClose = mountSession(makeLiveRoom());
    liveClose.connections[0].emit({ type: 'room:presence', online: [ALICE_ID] });
    flush();
    expect(liveClose.controller.online()).toEqual([ALICE_ID]);

    liveClose.connections[0].emit({ type: 'room:snapshot', room: closedSnapshot });
    flush();

    expect(liveClose.controller.room()?.closed).toBe(true);
    expect(liveClose.controller.online()).toEqual([]);
    expect(liveClose.connections[0].closed).toBe(true);
    expect(liveClose.connections).toHaveLength(1);

    // A stale/equal-version open route prop must not reopen a closed Room.
    liveClose.setRoomProp(makeLiveRoom({ version: 3 }));
    flush();
    expect(liveClose.controller.room()?.closed).toBe(true);

    // Case B: close-room server action closes the Room.
    const actionClose = mountSession(makeLiveRoom());
    actionClose.connections[0].emit({ type: 'room:presence', online: [ALICE_ID, BOB_ID] });
    flush();
    actionClose.changeRoomSpy.mockResolvedValueOnce({ ok: true, room: closedSnapshot });

    const result = await actionClose.controller.changeRoom({ type: 'close-room', discardRoundId: ROUND_1_ID });
    flush();

    expect(result.ok).toBe(true);
    expect(actionClose.controller.room()?.closed).toBe(true);
    expect(actionClose.controller.online()).toEqual([]);
    expect(actionClose.connections[0].closed).toBe(true);
    expect(actionClose.connections).toHaveLength(1);
  });

  it('transitions cleanly from closed back to open on newer versions without connecting while unjoined', async () => {
    const closedSnapshot: PokerClosedRoomView = {
      closed: true,
      id: ROOM_ID,
      name: 'Poker Room',
      version: 3,
      canDelete: true,
      stories: [{ title: 'First story', status: 'estimated', acceptedEstimate: '5' }],
    };
    const reopenedSnapshot = makeLiveRoom({
      version: 4,
      viewer: null,
      participants: [],
      stories: [],
      activeStoryId: null,
      round: null,
    });

    const session = mountSession(makeLiveRoom({ version: 2 }));
    expect(session.connections).toHaveLength(1);

    session.connections[0].emit({ type: 'room:snapshot', room: closedSnapshot });
    flush();
    expect(session.controller.room()?.closed).toBe(true);
    expect(session.connections[0].closed).toBe(true);

    session.setRoomProp(makeLiveRoom({ version: 3 }));
    flush();
    expect(session.controller.room()?.closed).toBe(true);

    session.changeRoomSpy.mockResolvedValueOnce({ ok: true, room: reopenedSnapshot });
    const result = await session.controller.changeRoom({ type: 'reopen-room' });
    flush();

    expect(result).toEqual({ ok: true, room: reopenedSnapshot });
    const current = session.controller.room();
    expect(current?.closed).toBe(false);
    expect(current?.version).toBe(4);
    if (current && !current.closed) {
      expect(current.viewer).toBeNull();
      expect(current.participants).toEqual([]);
    }
    expect(session.connections).toHaveLength(1);
  });

  it('disposes the live stream and signals unavailable on live room:missing or ROOM_NOT_FOUND', async () => {
    // Case A: live room:missing
    const liveMissing = mountSession(makeLiveRoom());
    liveMissing.connections[0].emit({ type: 'room:presence', online: [ALICE_ID] });
    flush();

    liveMissing.connections[0].emit({ type: 'room:missing' });
    flush();

    expect(liveMissing.controller.online()).toEqual([]);
    expect(liveMissing.onUnavailable).toHaveBeenCalledTimes(1);
    expect(liveMissing.connections[0].closed).toBe(true);
    expect(liveMissing.connections).toHaveLength(1);

    // Case B: ROOM_NOT_FOUND from changeRoom
    const actionMissing = mountSession(makeLiveRoom());
    actionMissing.connections[0].emit({ type: 'room:presence', online: [ALICE_ID] });
    flush();
    actionMissing.changeRoomSpy.mockResolvedValueOnce({
      ok: false,
      code: 'ROOM_NOT_FOUND',
      message: 'This Room is no longer available.',
    });

    const result = await actionMissing.controller.changeRoom({
      type: 'vote',
      roundId: ROUND_1_ID,
      choice: '3',
    });
    flush();

    expect(result.ok).toBe(false);
    expect(actionMissing.controller.online()).toEqual([]);
    expect(actionMissing.onUnavailable).toHaveBeenCalledTimes(1);
    expect(actionMissing.connections[0].closed).toBe(true);
    expect(actionMissing.connections).toHaveLength(1);
  });

  it('keeps live snapshots, prop updates, optimistic actions, rollbacks, and disposal free of Solid 2.0 diagnostics', async () => {
    const { artifact } = await captureArtifact(
      async () => {
        const { controller, setRoomProp, connections, changeRoomSpy } = mountSession(makeLiveRoom());

        // Live snapshot + presence
        connections[0].emit({
          type: 'room:snapshot',
          room: makeLiveRoom({ version: 2 }),
        });
        connections[0].emit({
          type: 'room:presence',
          online: [ALICE_ID, BOB_ID],
        });
        flush();

        // Route prop update (e.g., Co-Facilitator Link claim)
        setRoomProp(makeLiveRoom({ version: 3, facilitatorLinkRevision: 2 }));
        flush();

        // Optimistic Vote commit
        changeRoomSpy.mockResolvedValueOnce({
          ok: true,
          room: makeLiveRoom({
            version: 4,
            round: {
              id: ROUND_1_ID,
              phase: 'open',
              submittedParticipantIds: [ALICE_ID],
              ownChoice: '5',
            },
          }),
        });
        await controller.changeRoom({ type: 'vote', roundId: ROUND_1_ID, choice: '5' });
        flush();

        // Optimistic Vote rollback
        changeRoomSpy.mockResolvedValueOnce({
          ok: false,
          code: 'ROUND_CHANGED',
          message: 'Round changed.',
        });
        await controller.changeRoom({ type: 'vote', roundId: ROUND_1_ID, choice: '8' });
        flush();

        // Close Room transition
        connections[0].emit({
          type: 'room:snapshot',
          room: {
            closed: true,
            id: ROOM_ID,
            name: 'Poker Room',
            version: 5,
            canDelete: true,
            stories: [{ title: 'First story', status: 'pending' }],
          },
        });
        flush();
        expect(controller.room()?.closed).toBe(true);
      },
      { scenario: 'poker-room-controller-live-and-optimistic-actions' },
    );
    expectNoDiagnostics(artifact);
  });

  it('optimistically renames the Room, defaults blank to Poker Room, and rolls back on failure', async () => {
    const initial = makeLiveRoom({ name: 'Sprint 14' });
    const { controller, changeRoomSpy } = mountSession(initial);

    let resolveRename!: (value: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => { resolveRename = resolve; }),
    );

    const pending = controller.changeRoom({ type: 'rename-room', name: '  Payments Planning  ' });
    flush();
    expect(controller.room()?.name).toBe('Payments Planning');

    resolveRename({ ok: true, room: makeLiveRoom({ name: 'Payments Planning', version: 2 }) });
    await pending;
    flush();
    expect(controller.room()?.name).toBe('Payments Planning');

    changeRoomSpy.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN', message: 'Facilitator access is required.' });
    const rejected = await controller.changeRoom({ type: 'rename-room', name: '   ' });
    flush();
    expect(rejected).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(controller.room()?.name).toBe('Payments Planning');
  });

  it('owns initial unavailable state, removes recent rooms, and scrubs #f= fragments without claiming', () => {
    const session = mountSession(null, { roomId: ROOM_ID, initialFragmentToken: 'secret-token' });

    expect(session.controller.phase()).toBe('unavailable');
    expect(session.controller.room()).toBeNull();
    expect(session.connections).toHaveLength(0);
    expect(session.recentRooms.remove).toHaveBeenCalledWith(ROOM_ID);
    expect(session.recentRooms.record).not.toHaveBeenCalled();
    expect(session.fragment.takenPaths).toEqual([`/p/${ROOM_ID}`]);
    expect(session.claimLinkSpy).not.toHaveBeenCalled();

    // Subsequent hashchange on an unavailable Room also scrubs without claiming.
    session.fragment.triggerHashChange('another-secret');
    expect(session.fragment.takenPaths).toEqual([`/p/${ROOM_ID}`, `/p/${ROOM_ID}`]);
    expect(session.claimLinkSpy).not.toHaveBeenCalled();

    session.dispose();
    expect(session.fragment.listenerCount()).toBe(0);
  });

  it('records recent rooms on live join and rename, updates closed rooms with onlyIfSaved, and removes on unavailable', () => {
    // Unjoined room does not record until joined.
    const unjoined = mountSession(makeLiveRoom({ viewer: null, name: 'Sprint 14' }));
    expect(unjoined.controller.phase()).toBe('unjoined');
    expect(unjoined.recentRooms.record).not.toHaveBeenCalled();

    // Joining transitions to live and records recent room.
    unjoined.setRoomProp(makeLiveRoom({ version: 2, name: 'Sprint 14' }));
    flush();
    expect(unjoined.controller.phase()).toBe('live');
    expect(unjoined.recentRooms.record).toHaveBeenCalledWith(ROOM_ID, { name: 'Sprint 14', onlyIfSaved: false });

    // Live rename updates recent room name.
    unjoined.connections[0].emit({
      type: 'room:snapshot',
      room: makeLiveRoom({ version: 3, name: 'Sprint 15' }),
    });
    flush();
    expect(unjoined.recentRooms.record).toHaveBeenCalledWith(ROOM_ID, { name: 'Sprint 15', onlyIfSaved: false });

    // Transitioning to unavailable removes recent room.
    unjoined.connections[0].emit({ type: 'room:missing' });
    flush();
    expect(unjoined.controller.phase()).toBe('unavailable');
    expect(unjoined.recentRooms.remove).toHaveBeenCalledWith(ROOM_ID);

    // Initially closed room records with onlyIfSaved: true.
    const closed = mountSession({
      closed: true,
      id: ROOM_ID,
      name: 'Closed Sprint',
      version: 5,
      canDelete: false,
      stories: [],
    });
    expect(closed.controller.phase()).toBe('closed');
    expect(closed.recentRooms.record).toHaveBeenCalledWith(ROOM_ID, { name: 'Closed Sprint', onlyIfSaved: true });
  });

  it('runs one unified ADR-0004 close -> reopen -> re-join flow with single-flight reopening, locked prior Stories, and error handling', async () => {
    const closedSnapshot: PokerClosedRoomView = {
      closed: true,
      id: ROOM_ID,
      name: 'Sprint 14',
      version: 3,
      canDelete: true,
      stories: [{ title: 'Checkout flow', status: 'estimated', acceptedEstimate: '5' }],
    };
    const reopenedSnapshot = makeLiveRoom({
      version: 4,
      name: 'Sprint 14',
      viewer: null,
      participants: [],
      stories: [{ id: STORY_1_ID, title: 'Checkout flow', status: 'estimated', acceptedEstimate: '5', locked: true }],
      activeStoryId: null,
      round: null,
    });
    const rejoinedSnapshot = makeLiveRoom({
      version: 5,
      name: 'Sprint 14',
      viewer: { id: ALICE_ID, displayName: 'Alice', isFacilitator: true },
      participants: [{ id: ALICE_ID, displayName: 'Alice', isFacilitator: true }],
      stories: [{ id: STORY_1_ID, title: 'Checkout flow', status: 'estimated', acceptedEstimate: '5', locked: true }],
      activeStoryId: null,
      round: null,
    });

    const session = mountSession(makeLiveRoom({ version: 2, name: 'Sprint 14' }));
    expect(session.controller.phase()).toBe('live');
    expect(session.connections).toHaveLength(1);

    // 1. Close Room via live snapshot.
    session.connections[0].emit({ type: 'room:snapshot', room: closedSnapshot });
    flush();
    expect(session.controller.phase()).toBe('closed');
    expect(session.connections[0].closed).toBe(true);
    expect(session.controller.hasTransitionedPhase()).toBe(true);

    // 2. First reopen attempt fails with FORBIDDEN -> returns to closed with reopenError.
    let resolveFail!: (result: PokerResult) => void;
    session.changeRoomSpy.mockImplementationOnce(() => new Promise<PokerResult>((resolve) => { resolveFail = resolve; }));
    const firstAttempt = session.controller.reopenRoom();
    flush();
    expect(session.controller.phase()).toBe('reopening');

    // Duplicate click while reopening is deduplicated (single-flight).
    const duplicateAttempt = session.controller.reopenRoom();
    expect(session.changeRoomSpy).toHaveBeenCalledTimes(1);

    resolveFail({ ok: false, code: 'FORBIDDEN', message: 'Facilitator access is required.' });
    expect(await firstAttempt).toEqual({ ok: false, code: 'FORBIDDEN', message: 'Facilitator access is required.' });
    expect(await duplicateAttempt).toEqual({ ok: false, code: 'FORBIDDEN', message: 'Facilitator access is required.' });
    flush();
    expect(session.controller.phase()).toBe('closed');
    expect(session.controller.reopenError()).toBe('Facilitator access is required.');

    // 3. Second reopen attempt succeeds -> transitions to unjoined with ADR-0004 locked Stories & cleared roster.
    session.changeRoomSpy.mockResolvedValueOnce({ ok: true, room: reopenedSnapshot });
    const reopenedResult = await session.controller.reopenRoom();
    flush();
    expect(reopenedResult).toEqual({ ok: true, room: reopenedSnapshot });
    expect(session.controller.phase()).toBe('unjoined');
    expect(session.controller.reopenError()).toBe('');
    expect(session.connections).toHaveLength(1); // still no live stream while unjoined
    const unjoinedRoom = session.controller.liveRoom();
    expect(unjoinedRoom?.viewer).toBeNull();
    expect(unjoinedRoom?.participants).toEqual([]);
    expect(unjoinedRoom?.stories[0]?.locked).toBe(true);

    // 4. Re-joining via route prop update transitions to live and opens a fresh live stream.
    session.setRoomProp(rejoinedSnapshot);
    flush();
    expect(session.controller.phase()).toBe('live');
    expect(session.connections).toHaveLength(2);
    expect(session.controller.liveRoom()?.viewer?.isFacilitator).toBe(true);
  });

  it('transitions to unavailable when reopenRoom receives ROOM_NOT_FOUND and surfaces fallback error on network failure', async () => {
    const closedRoom: PokerClosedRoomView = {
      closed: true,
      id: ROOM_ID,
      name: 'Sprint 14',
      version: 3,
      canDelete: true,
      stories: [],
    };
    const session = mountSession(closedRoom);

    session.changeRoomSpy.mockRejectedValueOnce(new Error('offline'));
    const networkResult = await session.controller.reopenRoom();
    flush();
    expect(networkResult).toBeNull();
    expect(session.controller.phase()).toBe('closed');
    expect(session.controller.reopenError()).toBe('Could not reopen the Room. Try again.');

    session.changeRoomSpy.mockResolvedValueOnce({
      ok: false,
      code: 'ROOM_NOT_FOUND',
      message: 'This Room is no longer available.',
    });
    await session.controller.reopenRoom();
    flush();
    expect(session.controller.phase()).toBe('unavailable');
    expect(session.controller.room()).toBeNull();
    expect(session.recentRooms.remove).toHaveBeenCalledWith(ROOM_ID);
  });

  it('claims and scrubs #f= Co-Facilitator Link fragments once across unjoined, live, and closed states with monotonic version reconciliation', async () => {
    // 1. Unjoined room claims #f= on mount, reconciles into single snapshot, and sets pending claim hint.
    let resolveClaim!: (result: PokerSharingResult<PokerRoomView>) => void;
    const unjoined = mountSession(makeLiveRoom({ version: 1, viewer: null }), {
      initialFragmentToken: 'token-1',
    });
    expect(unjoined.fragment.takenPaths).toEqual([`/p/${ROOM_ID}`]);
    expect(unjoined.claimLinkSpy).toHaveBeenCalledWith(ROOM_ID, 'token-1');
    expect(unjoined.controller.claimPending()).toBe(true);

    // Mount a second session with controllable claim promise to verify pending -> resolved -> stale protection.
    const controlled = mountSession(makeLiveRoom({ version: 2, viewer: null }));
    controlled.claimLinkSpy.mockImplementationOnce(
      () => new Promise<PokerSharingResult<PokerRoomView>>((resolve) => { resolveClaim = resolve; }),
    );
    controlled.fragment.triggerHashChange('token-2');
    flush();
    expect(controlled.controller.claimPending()).toBe(true);

    // Out-of-order stale version from claim must not regress snapshot, newer version updates it.
    resolveClaim({
      ok: true,
      value: makeLiveRoom({ version: 3, viewer: null, facilitatorLinkRevision: 2 }),
    });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(controlled.controller.claimPending()).toBe(false);
    expect(controlled.controller.hasPendingFacilitatorClaim()).toBe(true);
    expect(controlled.controller.room()?.version).toBe(3);

    // Stale route prop (version 2) must not overwrite claimed version 3.
    controlled.setRoomProp(makeLiveRoom({ version: 2, viewer: null, facilitatorLinkRevision: 1 }));
    flush();
    expect(controlled.controller.room()?.version).toBe(3);

    // 2. Live room claims #f= via hashchange and upgrades viewer to Facilitator in place.
    const live = mountSession(makeLiveRoom({
      version: 2,
      viewer: { id: BOB_ID, displayName: 'Bob', isFacilitator: false },
    }));
    live.claimLinkSpy.mockResolvedValueOnce({
      ok: true,
      value: makeLiveRoom({
        version: 3,
        viewer: { id: BOB_ID, displayName: 'Bob', isFacilitator: true },
      }),
    });
    live.fragment.triggerHashChange('live-token');
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(live.claimLinkSpy).toHaveBeenCalledWith(ROOM_ID, 'live-token');
    expect(live.controller.liveRoom()?.viewer?.isFacilitator).toBe(true);
    expect(live.controller.room()?.version).toBe(3);

    // 3. Closed room scrubs #f= without calling claimFacilitatorLink.
    const closed = mountSession(
      { closed: true, id: ROOM_ID, name: 'Closed', version: 4, canDelete: false, stories: [] },
      { initialFragmentToken: 'closed-secret' },
    );
    expect(closed.fragment.takenPaths).toEqual([`/p/${ROOM_ID}`]);
    expect(closed.claimLinkSpy).not.toHaveBeenCalled();

    closed.fragment.triggerHashChange('closed-secret-2');
    expect(closed.fragment.takenPaths).toEqual([`/p/${ROOM_ID}`, `/p/${ROOM_ID}`]);
    expect(closed.claimLinkSpy).not.toHaveBeenCalled();
  });

  it('surfaces claim errors, handles ROOM_NOT_FOUND from claim, and ignores stale claim failures', async () => {
    const live = mountSession(makeLiveRoom({
      version: 2,
      viewer: { id: BOB_ID, displayName: 'Bob', isFacilitator: false },
    }));

    let resolveFirst!: (result: PokerSharingResult<PokerRoomView>) => void;
    let resolveSecond!: (result: PokerSharingResult<PokerRoomView>) => void;
    live.claimLinkSpy
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    live.fragment.triggerHashChange('old-token');
    live.fragment.triggerHashChange('new-token');
    flush();

    // First (superseded) claim fails -> ignored because a newer attempt is active.
    resolveFirst({ ok: false, code: 'INVALID_LINK', message: 'Stale error' });
    await Promise.resolve();
    flush();
    expect(live.controller.claimError()).toBe('');
    expect(live.controller.claimPending()).toBe(true);

    // Second (latest) claim fails -> surfaced.
    resolveSecond({ ok: false, code: 'INVALID_LINK', message: 'This Co-Facilitator Link is no longer valid.' });
    await Promise.resolve();
    flush();
    expect(live.controller.claimError()).toBe('This Co-Facilitator Link is no longer valid.');
    expect(live.controller.claimPending()).toBe(false);

    // ROOM_NOT_FOUND transitions session to unavailable.
    live.claimLinkSpy.mockResolvedValueOnce({
      ok: false,
      code: 'ROOM_NOT_FOUND',
      message: 'This Room is no longer available.',
    });
    live.fragment.triggerHashChange('missing-room-token');
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(live.controller.phase()).toBe('unavailable');
    expect(live.onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent cross-panel mutations through one single-flight coordinator with shared busy and error state', async () => {
    const { controller, changeRoomSpy } = mountSession(makeLiveRoom());
    expect(controller.busy()).toBe(false);
    expect(controller.error()).toBe('');

    const firstPending = Promise.withResolvers<PokerResult>();
    changeRoomSpy.mockReturnValueOnce(firstPending.promise);

    // 1. Start a Story queue move mutation.
    const movePromise = controller.changeRoom({
      type: 'move-story',
      storyId: STORY_2_ID,
      targetId: STORY_1_ID,
      placement: 'before',
    });
    flush();
    expect(controller.busy()).toBe(true);
    expect(changeRoomSpy).toHaveBeenCalledTimes(1);

    // 2. Concurrent mutations from Deck settings, Voting Round, and Room rename are rejected as busy.
    const concurrentDeck = await controller.changeRoom({ type: 'set-deck', deck: { type: 't-shirt' } });
    const concurrentVote = await controller.changeRoom({ type: 'vote', roundId: ROUND_1_ID, choice: '5' });
    const concurrentRename = await controller.changeRoom({ type: 'rename-room', name: 'Renamed' });
    expect(concurrentDeck).toEqual({ ok: false, reason: 'busy' });
    expect(concurrentVote).toEqual({ ok: false, reason: 'busy' });
    expect(concurrentRename).toEqual({ ok: false, reason: 'busy' });
    expect(changeRoomSpy).toHaveBeenCalledTimes(1);

    // 3. First mutation fails -> busy clears and shared error is surfaced.
    firstPending.resolve({ ok: false, code: 'RATE_LIMITED', message: 'Too many requests.' });
    expect(await movePromise).toEqual({ ok: false, code: 'RATE_LIMITED', message: 'Too many requests.' });
    flush();
    expect(controller.busy()).toBe(false);
    expect(controller.error()).toBe('Too many requests.');

    // 4. Subsequent mutation clears the previous error and runs cleanly.
    const nextRoom = makeLiveRoom({ version: 2, deckType: 't-shirt', deck: ['XS', 'S', 'M', 'L', 'XL'] });
    changeRoomSpy.mockResolvedValueOnce({ ok: true, room: nextRoom });
    const deckResult = await controller.changeRoom({ type: 'set-deck', deck: { type: 't-shirt' } });
    flush();
    expect(deckResult).toEqual({ ok: true, room: nextRoom });
    expect(controller.busy()).toBe(false);
    expect(controller.error()).toBe('');
    expect(changeRoomSpy).toHaveBeenCalledTimes(2);
  });

  it('orchestrates modal discard confirmations via injectable adapter, blocks concurrent actions while confirming, and preserves stale-confirmation rollback', async () => {
    const votedRoom = makeLiveRoom({
      version: 1,
      round: {
        id: ROUND_1_ID,
        phase: 'open',
        submittedParticipantIds: [ALICE_ID],
        ownChoice: '5',
      },
    });
    const session = mountSession(votedRoom);

    // 1. Cancelled confirmation does not emit a command, clears busy, and leaves error empty.
    const firstModal = Promise.withResolvers<boolean>();
    session.confirmSpy.mockReturnValueOnce(firstModal.promise);

    const switchPromise = session.controller.changeRoom({ type: 'select-story', storyId: STORY_2_ID });
    flush();
    expect(session.controller.busy()).toBe(true);
    expect(session.confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Switch Stories?' }));

    // Concurrent action while modal is open is dropped as busy.
    expect(await session.controller.changeRoom({ type: 'vote', roundId: ROUND_1_ID, choice: '8' })).toEqual({
      ok: false,
      reason: 'busy',
    });

    firstModal.resolve(false);
    expect(await switchPromise).toEqual({ ok: false, reason: 'cancelled' });
    flush();
    expect(session.controller.busy()).toBe(false);
    expect(session.controller.error()).toBe('');
    expect(session.changeRoomSpy).not.toHaveBeenCalled();

    // 2. Confirmed Deck change sends captured discardRoundId, clears round optimistically, and rolls back on stale ROUND_CHANGED.
    const deckModal = Promise.withResolvers<boolean>();
    const deckServer = Promise.withResolvers<PokerResult>();
    session.confirmSpy.mockReturnValueOnce(deckModal.promise);
    session.changeRoomSpy.mockReturnValueOnce(deckServer.promise);

    const onBeforeConfirm = vi.fn();
    const onAfterConfirm = vi.fn();
    const deckPromise = session.controller.changeRoom(
      { type: 'set-deck', deck: { type: 't-shirt' } },
      { onBeforeConfirm, onAfterConfirm },
    );
    flush();
    expect(onBeforeConfirm).toHaveBeenCalledTimes(1);
    expect(session.confirmSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Change Deck and restart voting?' }),
    );

    deckModal.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(onAfterConfirm).toHaveBeenCalledWith(true);
    expect(session.changeRoomSpy).toHaveBeenCalledWith(ROOM_ID, {
      type: 'set-deck',
      deck: { type: 't-shirt' },
      discardRoundId: ROUND_1_ID,
    });
    // Optimistic restart safety: round is cleared while waiting for replacement round ID.
    const optimisticDeck = session.controller.liveRoom();
    expect(optimisticDeck?.deckType).toBe('t-shirt');
    expect(optimisticDeck?.round).toBeNull();

    deckServer.resolve({ ok: false, code: 'ROUND_CHANGED', message: 'The Voting Round has changed.' });
    expect(await deckPromise).toEqual({
      ok: false,
      code: 'ROUND_CHANGED',
      message: 'The Voting Round has changed.',
    });
    flush();
    expect(session.controller.liveRoom()?.deckType).toBe('fibonacci');
    expect(session.controller.liveRoom()?.round?.id).toBe(ROUND_1_ID);
    expect(session.controller.error()).toBe('The Voting Round has changed.');

    // 3. Stale confirmation: round changes while Close Room modal is open -> still sends originally reviewed discardRoundId.
    const closeModal = Promise.withResolvers<boolean>();
    session.confirmSpy.mockReturnValueOnce(closeModal.promise);
    session.changeRoomSpy.mockResolvedValueOnce({
      ok: false,
      code: 'ROUND_CHANGED',
      message: 'The Voting Round has changed.',
    });

    const closePromise = session.controller.changeRoom({ type: 'close-room' });
    flush();
    expect(session.confirmSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Close Room?', confirmLabel: 'Close and discard votes' }),
    );
    session.connections[0].emit({
      type: 'room:snapshot',
      room: makeLiveRoom({
        version: 2,
        round: { id: 'round_2_12345678901234', phase: 'open', submittedParticipantIds: [], ownChoice: null },
      }),
    });
    flush();

    closeModal.resolve(true);
    await closePromise;
    flush();
    expect(session.changeRoomSpy).toHaveBeenLastCalledWith(ROOM_ID, {
      type: 'close-room',
      discardRoundId: ROUND_1_ID,
    });

    // 4. shouldContinue returning false after confirmation aborts without calling changeRoom.
    session.connections[0].emit({
      type: 'room:snapshot',
      room: makeLiveRoom({
        version: 3,
        round: { id: 'round_3_12345678901234', phase: 'open', submittedParticipantIds: [ALICE_ID], ownChoice: '5' },
      }),
    });
    flush();
    session.changeRoomSpy.mockClear();
    session.confirmSpy.mockResolvedValueOnce(true);
    const abortedEdit = await session.controller.changeRoom(
      { type: 'edit-story', storyId: STORY_1_ID, title: 'Renamed' },
      { shouldContinue: () => false },
    );
    expect(abortedEdit).toEqual({ ok: false, reason: 'cancelled' });
    expect(session.changeRoomSpy).not.toHaveBeenCalled();

    // 5. Inline delete-story does not invoke modal confirm and forwards its submission-time discardRoundId.
    session.confirmSpy.mockClear();
    session.changeRoomSpy.mockResolvedValueOnce({
      ok: true,
      room: makeLiveRoom({
        version: 4,
        stories: [{ id: STORY_2_ID, title: 'Second story', status: 'pending' }],
        activeStoryId: null,
        round: null,
      }),
    });
    const deleteResult = await session.controller.changeRoom({
      type: 'delete-story',
      storyId: STORY_1_ID,
      discardRoundId: 'round_3_12345678901234',
    });
    expect(deleteResult.ok).toBe(true);
    expect(session.confirmSpy).not.toHaveBeenCalled();
    expect(session.changeRoomSpy).toHaveBeenCalledWith(ROOM_ID, {
      type: 'delete-story',
      storyId: STORY_1_ID,
      discardRoundId: 'round_3_12345678901234',
    });
  });
});
