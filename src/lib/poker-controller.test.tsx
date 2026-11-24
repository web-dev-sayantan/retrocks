import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { createEffect, createMemo, createRoot, createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPokerRoomController,
  type PokerRoomController,
} from './poker-controller';
import type { PokerLiveTransport } from './poker-live';
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
    deckLocked: false,
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
  transport: PokerLiveTransport;
  connections: FakeConnection[];
} {
  const connections: FakeConnection[] = [];
  const transport: PokerLiveTransport = {
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

interface SessionHarness {
  controller: PokerRoomController;
  setRoomProp: (room: PokerRoomView) => void;
  connections: FakeConnection[];
  changeRoomSpy: ReturnType<typeof vi.fn<(id: string, command: PokerRoomChange) => Promise<PokerResult>>>;
  onUnavailable: ReturnType<typeof vi.fn<() => void>>;
  dispose: () => void;
}

const mounted: SessionHarness[] = [];

function mountSession(initialRoom: PokerRoomView = makeLiveRoom()): SessionHarness {
  const { transport, connections } = createFakeLiveTransport();
  const changeRoomSpy = vi.fn<(id: string, command: PokerRoomChange) => Promise<PokerResult>>();
  const onUnavailable = vi.fn<() => void>();
  let harness!: SessionHarness;
  const dispose = createRoot((disposeRoot) => {
    const [roomProp, setRoomProp] = createSignal<PokerRoomView>(initialRoom);
    const controller = createPokerRoomController({
      room: roomProp,
      changeRoom: changeRoomSpy,
      liveTransport: transport,
      onUnavailable,
    });
    harness = {
      controller,
      setRoomProp,
      connections,
      changeRoomSpy,
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
        if (room.closed) return '';
        const alice = room.participants.find((p) => p.id === ALICE_ID);
        aliceReads += 1;
        return alice?.displayName ?? '';
      });
      const bobName = createMemo(() => {
        const room = controller.room();
        if (room.closed) return '';
        const bob = room.participants.find((p) => p.id === BOB_ID);
        bobReads += 1;
        return bob?.displayName ?? '';
      });
      const story1Title = createMemo(() => {
        const room = controller.room();
        if (room.closed) return '';
        const story = room.stories.find((s) => s.id === STORY_1_ID);
        story1Reads += 1;
        return story?.title ?? '';
      });
      const story2Title = createMemo(() => {
        const room = controller.room();
        if (room.closed) return '';
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
    expect(room.closed).toBe(false);
    if (!room.closed) {
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
    expect(afterStale.version).toBe(2);
    if (!afterStale.closed) {
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
    expect(optimisticRoom.closed).toBe(false);
    if (!optimisticRoom.closed && optimisticRoom.round?.phase === 'open') {
      expect(optimisticRoom.deckLocked).toBe(true);
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
    expect(afterCommit.version).toBe(2);
    if (!afterCommit.closed && afterCommit.round?.phase === 'open') {
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
    if (!optimisticCleared.closed && optimisticCleared.round?.phase === 'open') {
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
    if (!afterRollback.closed && afterRollback.round?.phase === 'open') {
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
    if (!optimisticEight.closed && optimisticEight.round?.phase === 'open') {
      expect(optimisticEight.round.ownChoice).toBe('8');
    }

    rejectNetwork(new Error('Network down'));
    await expect(failingVote).rejects.toThrow('Network down');
    flush();

    const afterNetworkRollback = controller.room();
    if (!afterNetworkRollback.closed && afterNetworkRollback.round?.phase === 'open') {
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
    });
    flush();

    let current = controller.room();
    if (!current.closed) {
      expect(current.stories[0]?.title).toBe('Renamed story');
    }
    resolveEdit({ ok: false, code: 'FORBIDDEN', message: 'Only a Facilitator can edit Stories.' });
    const editResult = await editPromise;
    flush();
    expect(editResult.ok).toBe(false);
    current = controller.room();
    if (!current.closed) {
      expect(current.stories[0]?.title).toBe('First story');
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
    if (!current.closed) {
      expect(current.stories.map((s) => s.id)).toEqual([STORY_2_ID, STORY_1_ID]);
    }
    resolveMove({ ok: false, code: 'ROOM_CLOSED', message: 'This Room is closed.' });
    await movePromise;
    flush();
    current = controller.room();
    if (!current.closed) {
      expect(current.stories.map((s) => s.id)).toEqual([STORY_1_ID, STORY_2_ID]);
    }

    // 3. Set deck optimistically, then reject with DECK_LOCKED -> reverts.
    let resolveDeck!: (result: PokerResult) => void;
    changeRoomSpy.mockImplementationOnce(
      () => new Promise<PokerResult>((resolve) => {
        resolveDeck = resolve;
      }),
    );
    const deckPromise = controller.changeRoom({
      type: 'set-deck',
      deck: { type: 't-shirt' },
    });
    flush();
    current = controller.room();
    if (!current.closed) {
      expect(current.deckType).toBe('t-shirt');
      expect(current.deck).toEqual(['XS', 'S', 'M', 'L', 'XL']);
    }
    resolveDeck({ ok: false, code: 'DECK_LOCKED', message: 'The Deck is locked.' });
    await deckPromise;
    flush();
    current = controller.room();
    if (!current.closed) {
      expect(current.deckType).toBe('fibonacci');
      expect(current.deck).toEqual([...FIBONACCI_DECK]);
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
    if (!current.closed) {
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
    expect(current.version).toBe(2);
    if (!current.closed) {
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

    // 1. Optimistic edits on an already locked Story do not mutate optimistic state.
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
    if (!current.closed) {
      expect(current.stories[1]?.title).toBe('Second story');
    }
    resolveEditLocked({ ok: false, code: 'STORY_LOCKED', message: 'Unlock this Story before changing it.' });
    await editLocked;
    flush();

    // 2. Locking the active Story with 0 cast votes optimistically locks it and clears the stage, then reverts on rejection.
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
    if (!current.closed) {
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
    if (!current.closed) {
      expect(current.stories[0]?.locked).toBe(false);
      expect(current.activeStoryId).toBe(STORY_1_ID);
      expect(current.round?.id).toBe(ROUND_1_ID);
    }

    // 3. Unlocking a locked Story optimistically unlocks it and commits on success.
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
    if (!current.closed) {
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
    expect(current.version).toBe(2);
    if (!current.closed) {
      expect(current.stories[1]?.locked).toBe(false);
    }
  });

  it('disposes the live stream cleanly when a live snapshot or command closes the Room', async () => {
    const closedSnapshot: PokerClosedRoomView = {
      closed: true,
      id: ROOM_ID,
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

    expect(liveClose.controller.room().closed).toBe(true);
    expect(liveClose.controller.online()).toEqual([]);
    expect(liveClose.connections[0].closed).toBe(true);
    expect(liveClose.connections).toHaveLength(1);

    // A stale/equal-version open route prop must not reopen a closed Room.
    liveClose.setRoomProp(makeLiveRoom({ version: 3 }));
    flush();
    expect(liveClose.controller.room().closed).toBe(true);

    // Case B: close-room server action closes the Room.
    const actionClose = mountSession(makeLiveRoom());
    actionClose.connections[0].emit({ type: 'room:presence', online: [ALICE_ID, BOB_ID] });
    flush();
    actionClose.changeRoomSpy.mockResolvedValueOnce({ ok: true, room: closedSnapshot });

    const result = await actionClose.controller.changeRoom({ type: 'close-room', discardRoundId: ROUND_1_ID });
    flush();

    expect(result.ok).toBe(true);
    expect(actionClose.controller.room().closed).toBe(true);
    expect(actionClose.controller.online()).toEqual([]);
    expect(actionClose.connections[0].closed).toBe(true);
    expect(actionClose.connections).toHaveLength(1);
  });

  it('transitions cleanly from closed back to open on newer versions without connecting while unjoined', async () => {
    const closedSnapshot: PokerClosedRoomView = {
      closed: true,
      id: ROOM_ID,
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
    expect(session.controller.room().closed).toBe(true);
    expect(session.connections[0].closed).toBe(true);

    // Equal-version open snapshot must still be ignored while closed.
    session.setRoomProp(makeLiveRoom({ version: 3 }));
    flush();
    expect(session.controller.room().closed).toBe(true);

    // Newer-version reopen-room result transitions back to open without opening a live stream for viewer === null.
    session.changeRoomSpy.mockResolvedValueOnce({ ok: true, room: reopenedSnapshot });
    const result = await session.controller.changeRoom({ type: 'reopen-room' });
    flush();

    expect(result).toEqual({ ok: true, room: reopenedSnapshot });
    const current = session.controller.room();
    expect(current.closed).toBe(false);
    expect(current.version).toBe(4);
    if (!current.closed) {
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
            version: 5,
            canDelete: true,
            stories: [{ title: 'First story', status: 'pending' }],
          },
        });
        flush();
        expect(controller.room().closed).toBe(true);
      },
      { scenario: 'poker-room-controller-live-and-optimistic-actions' },
    );
    expectNoDiagnostics(artifact);
  });
});
