import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { parsePokerLiveMessage, type PokerLiveMessage } from '../../lib/poker-schemas';
import { wrapDatabaseSync } from '../adapters/node/sqlite';
import { generateEntityId } from '../crypto';
import { readSseStream } from '../live/sse-test-helper';
import { openNodePokerRooms, type NodePokerRooms } from './node';
import { PokerRoomStorage } from './room';

const day = 24 * 60 * 60 * 1000;
let rooms: NodePokerRooms;

beforeEach(async () => {
  rooms = await openNodePokerRooms(':memory:');
});

afterEach(() => rooms?.close());

async function readLiveRoom(hash: string) {
  const room = await rooms.read('room-a', hash);
  if (!room || room.closed) throw new Error('Expected a live Room.');
  return room;
}

test('creates an empty Room and gives its creator Facilitator access', async () => {
  const created = await rooms.create('room-a', 'creator', 'Alex');

  expect(created).toMatchObject({
    id: 'room-a',
    viewer: { displayName: 'Alex', isFacilitator: true },
    participants: [{ displayName: 'Alex', isFacilitator: true }],
  });
  expect(await rooms.read('room-a', 'visitor')).toMatchObject({
    id: 'room-a',
    viewer: null,
    participants: [],
  });
});

test('duplicate Display Names identify separate Participants and rejoining preserves identity', async () => {
  await rooms.create('room-a', 'creator', 'Alex');
  expect((await rooms.mutate('room-a', 'first', { type: 'join', displayName: 'Sam' })).ok).toBe(true);
  expect((await rooms.mutate('room-a', 'second', { type: 'join', displayName: 'Sam' })).ok).toBe(true);

  const first = (await readLiveRoom('first')).viewer!;
  const second = (await readLiveRoom('second')).viewer!;
  expect(first.displayName).toBe('Sam');
  expect(second.displayName).toBe('Sam');
  expect(first.id).not.toBe(second.id);
  expect((await readLiveRoom('creator')).participants.map((entry) => entry.displayName))
    .toEqual(['Alex', 'Sam', 'Sam']);

  await rooms.mutate('room-a', 'first', { type: 'join', displayName: 'Another name' });
  expect((await readLiveRoom('first')).viewer).toEqual(first);
  expect((await readLiveRoom('first')).participants).toHaveLength(3);
});

test('Participants see connections arrive and leave without changing the roster', async () => {
  await rooms.create('room-a', 'creator', 'Alex');
  const creator = (await readLiveRoom('creator')).viewer!;
  const firstConnection = new AbortController();
  const secondConnection = new AbortController();
  const openStream = (hash: string, signal: AbortSignal) =>
    readSseStream(
      rooms.connect('room-a', hash, new Request('https://retrocks.test/live', { signal })),
      (raw) => JSON.parse(raw) as PokerLiveMessage,
    );

  try {
    const first = openStream('creator', firstConnection.signal);
    expect(await first.next()).toMatchObject({ type: 'room:snapshot', room: { viewer: creator } });
    expect(await first.next()).toEqual({ type: 'room:presence', online: [creator.id] });

    const joined = await rooms.mutate('room-a', 'second', { type: 'join', displayName: 'Sam' });
    if (!joined.ok) throw new Error(joined.message);
    const sam = (await readLiveRoom('second')).viewer!;
    expect(await first.next()).toMatchObject({ type: 'room:snapshot', room: {
      viewer: creator, participants: [creator, sam],
    } });

    const second = openStream('second', secondConnection.signal);
    expect(await second.next()).toMatchObject({ type: 'room:snapshot', room: { viewer: sam } });
    expect(await first.next()).toEqual({ type: 'room:presence', online: [creator.id, sam.id] });
    secondConnection.abort();
    expect(await first.next()).toEqual({ type: 'room:presence', online: [creator.id] });

    expect((await readLiveRoom('second')).viewer).toEqual(sam);
  } finally {
    secondConnection.abort();
    firstConnection.abort();
  }
});

test('an open Room keeps the deadline from its last actual vote or content change', async () => {
  const createdAt = Date.UTC(2026, 0, 1);
  let now = createdAt;
  const timedRooms = await openNodePokerRooms(':memory:', { now: () => now, expirySweepIntervalMs: 0 });
  try {
    await timedRooms.create('room-a', 'facilitator', 'Alex');
    now = createdAt + day;
    await timedRooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'A Story' });
    const afterAdd = await timedRooms.read('room-a', 'facilitator');
    if (!afterAdd || afterAdd.closed) throw new Error('Expected live Room.');
    const storyId = afterAdd.stories[0].id;
    await timedRooms.mutate('room-a', 'facilitator', { type: 'select-story', storyId });
    const afterSelect = await timedRooms.read('room-a', 'facilitator');
    if (!afterSelect || afterSelect.closed || !afterSelect.round) throw new Error('Expected active round.');
    const roundId = afterSelect.round.id;
    now = createdAt + 2 * day;
    await timedRooms.mutate('room-a', 'voter', { type: 'join', displayName: 'Sam' });
    await timedRooms.mutate('room-a', 'voter', { type: 'vote', roundId, choice: '0' });
    now = createdAt + 3 * day;
    await timedRooms.mutate('room-a', 'voter', { type: 'vote', roundId, choice: '1' });
    now = createdAt + 4 * day;
    await timedRooms.mutate('room-a', 'voter', { type: 'vote', roundId, choice: null });
    now = createdAt + 5 * day;
    await timedRooms.mutate('room-a', 'voter', { type: 'vote', roundId, choice: null });
    await timedRooms.mutate('room-a', 'voter', { type: 'vote', roundId: 'stale', choice: '1' });
    await timedRooms.mutate('room-a', 'facilitator', { type: 'edit-story', storyId, title: 'A Story' });
    await timedRooms.mutate('room-a', 'voter', { type: 'join', displayName: 'Different' });
    await timedRooms.mutate('room-a', 'other', { type: 'join', displayName: 'Max' });
    now = createdAt + 94 * day - 1;
    expect(await timedRooms.read('room-a', 'facilitator')).not.toBeNull();
    now = createdAt + 94 * day;
    expect(await timedRooms.read('room-a', 'facilitator')).toBeNull();
    expect(await timedRooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'Too late' }))
      .toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  } finally {
    timedRooms.close();
  }
});

test('Room closure starts a fixed 90-day deadline', async () => {
  const createdAt = Date.UTC(2026, 0, 1);
  let now = createdAt;
  const timedRooms = await openNodePokerRooms(':memory:', { now: () => now, expirySweepIntervalMs: 0 });
  try {
    await timedRooms.create('room-a', 'facilitator', 'Alex');
    now = createdAt + day;
    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'close-room' })).ok).toBe(true);
    now = createdAt + 90 * day;
    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'close-room' })).ok).toBe(true);
    expect(await timedRooms.read('room-a', 'visitor')).toMatchObject({ closed: true, stories: [] });
    now = createdAt + 91 * day;
    expect(await timedRooms.read('room-a', 'visitor')).toBeNull();
  } finally {
    timedRooms.close();
  }
});

test('open Room deletion checks the Facilitator and sends a terminal frame to each live viewer', async () => {
  const id = generateEntityId();
  await rooms.create(id, 'facilitator', 'Alex');
  await rooms.mutate(id, 'participant', { type: 'join', displayName: 'Sam' });
  const liveRequest = new Request('https://retrocks.test/live');
  const facilitator = readSseStream(rooms.connect(id, 'facilitator', liveRequest), parsePokerLiveMessage);
  const participant = readSseStream(rooms.connect(id, 'participant', liveRequest), parsePokerLiveMessage);

  expect(await facilitator.next()).toMatchObject({ type: 'room:snapshot' });
  expect(await facilitator.next()).toMatchObject({ type: 'room:presence' });
  expect(await facilitator.next()).toMatchObject({ type: 'room:presence' });
  expect(await participant.next()).toMatchObject({ type: 'room:snapshot' });
  expect(await participant.next()).toMatchObject({ type: 'room:presence' });
  expect(await rooms.delete(id, 'participant')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await rooms.delete(id, 'facilitator')).toEqual({ ok: true });
  for (const stream of [facilitator, participant]) {
    expect(await stream.next()).toEqual({ type: 'room:missing' });
    await stream.expectClosed();
  }
  expect(await rooms.read(id, 'facilitator')).toBeNull();
  const reconnect = readSseStream(rooms.connect(id, 'participant', liveRequest), parsePokerLiveMessage);
  expect(await reconnect.next()).toEqual({ type: 'room:missing' });
  await reconnect.expectClosed();
});

test('closed Room deletion uses the retained Facilitator capability', async () => {
  await rooms.create('room-a', 'facilitator', 'Alex');
  expect((await rooms.mutate('room-a', 'facilitator', { type: 'close-room' })).ok).toBe(true);
  expect(await rooms.delete('room-a', 'visitor')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await rooms.delete('room-a', 'facilitator')).toEqual({ ok: true });
  expect(await rooms.read('room-a', 'visitor')).toBeNull();
  expect(await rooms.delete('room-a', 'facilitator')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
});

test('Room name defaults to Poker Room when omitted or blank, and appears on open, pre-join, and closed projections', async () => {
  const unnamed = await rooms.create('room-default', 'creator', 'Alex');
  expect(unnamed).toMatchObject({ name: 'Poker Room' });
  expect(await rooms.read('room-default', 'visitor')).toMatchObject({ name: 'Poker Room', viewer: null });

  const blank = await rooms.create('room-blank', 'creator', 'Alex', '   ');
  expect(blank).toMatchObject({ name: 'Poker Room' });

  const named = await rooms.create('room-named', 'creator', 'Alex', '  Sprint 14 Planning  ');
  expect(named).toMatchObject({ name: 'Sprint 14 Planning' });
  expect(await rooms.read('room-named', 'visitor')).toMatchObject({ name: 'Sprint 14 Planning', viewer: null });

  expect((await rooms.mutate('room-named', 'creator', { type: 'close-room' })).ok).toBe(true);
  expect(await rooms.read('room-named', 'visitor')).toMatchObject({ closed: true, name: 'Sprint 14 Planning' });
});

test('loading a legacy stored Room without a name defaults to Poker Room', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const storage = new PokerRoomStorage(wrapDatabaseSync(db));
    storage.create('room-legacy', 'creator', 'Alex');
    const row = db.prepare('SELECT data FROM poker_rooms WHERE id = ?').get('room-legacy') as { data: string };
    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    delete parsed.name;
    db.prepare('UPDATE poker_rooms SET data = ? WHERE id = ?').run(JSON.stringify(parsed), 'room-legacy');

    expect(storage.read('room-legacy', 'creator')).toMatchObject({ name: 'Poker Room' });
  } finally {
    db.close();
  }
});

test('only a Facilitator can rename a Room, blank resets to Poker Room, and live Participants receive updates', async () => {
  const id = generateEntityId();
  await rooms.create(id, 'facilitator', 'Alex', 'Initial Name');
  await rooms.mutate(id, 'participant', { type: 'join', displayName: 'Sam' });

  const connection = new AbortController();
  const stream = readSseStream(
    rooms.connect(id, 'participant', new Request('https://retrocks.test/live', { signal: connection.signal })),
    parsePokerLiveMessage,
  );

  try {
    expect(await stream.next()).toMatchObject({ type: 'room:snapshot', room: { name: 'Initial Name' } });
    expect(await stream.next()).toMatchObject({ type: 'room:presence' });

    expect(await rooms.mutate(id, 'participant', { type: 'rename-room', name: 'Hijacked' }))
      .toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const renamed = await rooms.mutate(id, 'facilitator', { type: 'rename-room', name: '  Payments Estimation  ' });
    expect(renamed).toMatchObject({ ok: true, room: { name: 'Payments Estimation' } });
    expect(await stream.next()).toMatchObject({ type: 'room:snapshot', room: { name: 'Payments Estimation' } });

    const reset = await rooms.mutate(id, 'facilitator', { type: 'rename-room', name: '   ' });
    expect(reset).toMatchObject({ ok: true, room: { name: 'Poker Room' } });
    expect(await stream.next()).toMatchObject({ type: 'room:snapshot', room: { name: 'Poker Room' } });
  } finally {
    connection.abort();
  }
});

test('reopening a closed Room requires a pre-close Facilitator, locks prior Stories, preserves Deck state, resets 90-day expiry, and restores Facilitator claims on rejoin', async () => {
  const createdAt = Date.UTC(2026, 0, 1);
  let now = createdAt;
  const timedRooms = await openNodePokerRooms(':memory:', { now: () => now, expirySweepIntervalMs: 0 });
  async function readTimedLive(hash: string) {
    const view = await timedRooms.read('room-a', hash);
    if (!view || view.closed) throw new Error('Expected live Room.');
    return view;
  }
  try {
    await timedRooms.create('room-a', 'facilitator', 'Alex');
    expect((await timedRooms.mutate('room-a', 'facilitator', {
      type: 'set-deck',
      deck: { type: 'custom', choices: ['Low', 'Med', 'High'] },
    })).ok).toBe(true);
    expect((await timedRooms.mutate('room-a', 'participant', { type: 'join', displayName: 'Sam' })).ok).toBe(true);
    expect((await timedRooms.replaceFacilitatorCapability('room-a', 'facilitator', 0, {
      hash: 'old-hash',
      encrypted: 'old-encrypted',
      revision: 1,
    })).ok).toBe(true);

    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'Estimated Story' })).ok).toBe(true);
    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'Skipped Story' })).ok).toBe(true);
    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'Pending Story' })).ok).toBe(true);
    const [estimatedStory, skippedStory, pendingStory] = (await readTimedLive('facilitator')).stories;

    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'select-story', storyId: estimatedStory.id })).ok).toBe(true);
    const round1 = (await readTimedLive('facilitator')).round!.id;
    expect((await timedRooms.mutate('room-a', 'participant', { type: 'vote', roundId: round1, choice: 'Med' })).ok).toBe(true);
    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'reveal', roundId: round1 })).ok).toBe(true);
    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'confirm-estimate', roundId: round1, choice: 'Med' })).ok).toBe(true);

    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'select-story', storyId: skippedStory.id })).ok).toBe(true);
    const round2 = (await readTimedLive('facilitator')).round!.id;
    expect((await timedRooms.mutate('room-a', 'participant', { type: 'vote', roundId: round2, choice: 'High' })).ok).toBe(true);
    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'reveal', roundId: round2 })).ok).toBe(true);
    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'skip-story', roundId: round2 })).ok).toBe(true);

    now = createdAt + day;
    const closed = await timedRooms.mutate('room-a', 'facilitator', { type: 'close-room' });
    expect(closed).toMatchObject({ ok: true, room: { closed: true, canDelete: true } });

    now = createdAt + 40 * day;
    expect(await timedRooms.mutate('room-a', 'participant', { type: 'reopen-room' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await timedRooms.mutate('room-a', 'visitor', { type: 'reopen-room' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const reopened = await timedRooms.mutate('room-a', 'facilitator', { type: 'reopen-room' });
    expect(reopened).toMatchObject({
      ok: true,
      room: {
        closed: false,
        id: 'room-a',
        viewer: null,
        participants: [],
        activeStoryId: null,
        round: null,
      },
    });
    if (!reopened.ok || reopened.room.closed) throw new Error('Expected reopened Room.');
    const reopenedVersion = reopened.room.version;

    expect(await timedRooms.mutate('room-a', 'facilitator', { type: 'reopen-room' })).toEqual(reopened);
    expect(await timedRooms.mutate('room-a', 'participant', { type: 'reopen-room' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    expect(await timedRooms.claimFacilitator('room-a', 'visitor', 'old-hash')).toMatchObject({ ok: false, code: 'INVALID_LINK' });

    expect((await timedRooms.mutate('room-a', 'participant', { type: 'join', displayName: 'Sam again' })).ok).toBe(true);
    expect((await readTimedLive('participant')).viewer).toMatchObject({ displayName: 'Sam again', isFacilitator: false });

    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'join', displayName: 'Alex again' })).ok).toBe(true);
    const rejoined = await readTimedLive('facilitator');
    expect(rejoined.viewer).toMatchObject({ displayName: 'Alex again', isFacilitator: true });
    expect(rejoined.deckType).toBe('custom');
    expect(rejoined.deck).toEqual(['Low', 'Med', 'High']);
    expect(rejoined.facilitatorLinkRevision).toBeUndefined();
    expect(await timedRooms.getFacilitatorCapability('room-a', 'facilitator')).toEqual({ ok: true, value: null });
    expect(rejoined.stories).toEqual([
      { id: estimatedStory.id, title: 'Estimated Story', status: 'estimated', acceptedEstimate: 'Med', locked: true },
      { id: skippedStory.id, title: 'Skipped Story', status: 'skipped', locked: true },
      { id: pendingStory.id, title: 'Pending Story', status: 'pending', locked: true },
    ]);

    expect(await timedRooms.mutate('room-a', 'facilitator', {
      type: 'edit-story',
      storyId: pendingStory.id,
      title: 'Blocked edit',
    })).toMatchObject({ ok: false, code: 'STORY_LOCKED' });
    expect((await timedRooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'New Story' })).ok).toBe(true);
    expect((await readTimedLive('facilitator')).stories.at(-1)).toMatchObject({ title: 'New Story', locked: false });

    const repeat = await timedRooms.mutate('room-a', 'facilitator', { type: 'reopen-room' });
    expect(repeat.ok).toBe(true);
    expect((await readTimedLive('facilitator')).stories.at(-1)).toMatchObject({ title: 'New Story', locked: false });
    expect(reopenedVersion).toBeGreaterThan(1);

    now = createdAt + 130 * day - 1;
    expect(await timedRooms.read('room-a', 'facilitator')).not.toBeNull();
    now = createdAt + 130 * day;
    expect(await timedRooms.read('room-a', 'facilitator')).toBeNull();
  } finally {
    timedRooms.close();
  }
});

test('re-closing a reopened Room preserves unjoined Co-Facilitator access to reopen or delete', async () => {
  await rooms.create('room-a', 'facilitator-a', 'Alex');
  expect((await rooms.replaceFacilitatorCapability('room-a', 'facilitator-a', 0, {
    hash: 'co-fac-hash',
    encrypted: 'co-fac-encrypted',
    revision: 1,
  })).ok).toBe(true);
  expect((await rooms.claimFacilitator('room-a', 'facilitator-b', 'co-fac-hash')).ok).toBe(true);
  expect((await rooms.mutate('room-a', 'facilitator-b', { type: 'join', displayName: 'Blair' })).ok).toBe(true);
  expect((await readLiveRoom('facilitator-b')).viewer).toMatchObject({ displayName: 'Blair', isFacilitator: true });

  expect((await rooms.mutate('room-a', 'facilitator-a', { type: 'close-room' })).ok).toBe(true);
  expect((await rooms.mutate('room-a', 'facilitator-a', { type: 'reopen-room' })).ok).toBe(true);
  expect((await rooms.mutate('room-a', 'facilitator-a', { type: 'join', displayName: 'Alex' })).ok).toBe(true);
  expect((await rooms.mutate('room-a', 'facilitator-a', { type: 'close-room' })).ok).toBe(true);

  expect(await rooms.read('room-a', 'facilitator-b')).toMatchObject({ closed: true, canDelete: true });
  expect(await rooms.mutate('room-a', 'facilitator-b', { type: 'reopen-room' })).toMatchObject({
    ok: true,
    room: { closed: false, viewer: null },
  });
  expect((await rooms.mutate('room-a', 'facilitator-b', { type: 'join', displayName: 'Blair' })).ok).toBe(true);
  expect((await readLiveRoom('facilitator-b')).viewer).toMatchObject({ displayName: 'Blair', isFacilitator: true });
  expect((await rooms.mutate('room-a', 'facilitator-b', { type: 'close-room' })).ok).toBe(true);
  expect(await rooms.delete('room-a', 'facilitator-b')).toEqual({ ok: true });
});

test('openNodePokerRooms supports configurable clock, expirySweepIntervalMs, and clean idempotent close()', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let now = Date.UTC(2026, 0, 1);
  const timedRooms = await openNodePokerRooms(':memory:', {
    now: () => now,
    expirySweepIntervalMs: 5_000,
  });
  const disabledSweepRooms = await openNodePokerRooms(':memory:', {
    now: () => now,
    expirySweepIntervalMs: 0,
  });
  try {
    await timedRooms.create('room-sweep', 'facilitator', 'Alex');
    await disabledSweepRooms.create('room-no-sweep', 'facilitator', 'Alex');

    // Before expiry, sweep keeps the Room intact.
    now += 89 * day;
    vi.advanceTimersByTime(5_000);
    expect(await timedRooms.read('room-sweep', 'facilitator')).not.toBeNull();

    // Advance past 90-day TTL and trigger the periodic sweep.
    now += 2 * day;
    vi.advanceTimersByTime(5_000);
    // Roll clock back to verify the sweep actually deleted the row rather than lazy read expiry.
    now -= 2 * day;
    expect(await timedRooms.read('room-sweep', 'facilitator')).toBeNull();
    // With expirySweepIntervalMs: 0, no sweep ran so the row is still present when rolled back.
    expect(await disabledSweepRooms.read('room-no-sweep', 'facilitator')).not.toBeNull();

    // close() is idempotent and clears the interval timer cleanly.
    timedRooms.close();
    timedRooms.close();
    vi.advanceTimersByTime(10_000);
  } finally {
    timedRooms.close();
    disabledSweepRooms.close();
    vi.useRealTimers();
  }
});
