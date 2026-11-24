import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { parsePokerLiveMessage } from '../../lib/poker-schemas';
import { generateEntityId } from '../crypto';
import { openNodePokerRooms, type NodePokerRooms } from './node';

const day = 24 * 60 * 60 * 1000;
let rooms: NodePokerRooms;

beforeEach(async () => {
  rooms = await openNodePokerRooms(':memory:');
});

afterEach(() => rooms?.close());

function readLiveRoom(hash: string) {
  const room = rooms.read('room-a', hash);
  if (!room || room.closed) throw new Error('Expected a live Room.');
  return room;
}

test('creates an empty Room and gives its creator Facilitator access', () => {
  const created = rooms.create('room-a', 'creator', 'Alex');

  expect(created).toMatchObject({
    id: 'room-a',
    viewer: { displayName: 'Alex', isFacilitator: true },
    participants: [{ displayName: 'Alex', isFacilitator: true }],
  });
  expect(rooms.read('room-a', 'visitor')).toMatchObject({
    id: 'room-a',
    viewer: null,
    participants: [],
  });
});

test('duplicate Display Names identify separate Participants and rejoining preserves identity', () => {
  rooms.create('room-a', 'creator', 'Alex');
  expect(rooms.mutate('room-a', 'first', { type: 'join', displayName: 'Sam' }).ok).toBe(true);
  expect(rooms.mutate('room-a', 'second', { type: 'join', displayName: 'Sam' }).ok).toBe(true);

  const first = readLiveRoom('first').viewer!;
  const second = readLiveRoom('second').viewer!;
  expect(first.displayName).toBe('Sam');
  expect(second.displayName).toBe('Sam');
  expect(first.id).not.toBe(second.id);
  expect(readLiveRoom('creator').participants.map((entry) => entry.displayName))
    .toEqual(['Alex', 'Sam', 'Sam']);

  rooms.mutate('room-a', 'first', { type: 'join', displayName: 'Another name' });
  expect(readLiveRoom('first').viewer).toEqual(first);
  expect(readLiveRoom('first').participants).toHaveLength(3);
});

test('Participants see connections arrive and leave without changing the roster', async () => {
  rooms.create('room-a', 'creator', 'Alex');
  const creator = readLiveRoom('creator').viewer!;
  const firstConnection = new AbortController();
  const secondConnection = new AbortController();
  const getReader = async (hash: string, signal: AbortSignal) => {
    const response = await rooms.connect('room-a', hash, new Request('https://retrocks.test/live', { signal }));
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    return response.body!.getReader();
  };
  const nextFrame = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const frame = await reader.read();
    return JSON.parse(new TextDecoder().decode(frame.value).slice(6));
  };

  try {
    const first = await getReader('creator', firstConnection.signal);
    expect(await nextFrame(first)).toMatchObject({ type: 'room:snapshot', room: { viewer: creator } });
    expect(await nextFrame(first)).toEqual({ type: 'room:presence', online: [creator.id] });

    const joined = rooms.mutate('room-a', 'second', { type: 'join', displayName: 'Sam' });
    if (!joined.ok) throw new Error(joined.message);
    const sam = readLiveRoom('second').viewer!;
    expect(await nextFrame(first)).toMatchObject({ type: 'room:snapshot', room: {
      viewer: creator, participants: [creator, sam],
    } });

    const second = await getReader('second', secondConnection.signal);
    expect(await nextFrame(second)).toMatchObject({ type: 'room:snapshot', room: { viewer: sam } });
    expect(await nextFrame(first)).toEqual({ type: 'room:presence', online: [creator.id, sam.id] });
    secondConnection.abort();
    expect(await nextFrame(first)).toEqual({ type: 'room:presence', online: [creator.id] });

    expect(readLiveRoom('second').viewer).toEqual(sam);
  } finally {
    secondConnection.abort();
    firstConnection.abort();
  }
});

test('an open Room keeps the deadline from its last actual vote or content change', () => {
  const createdAt = Date.UTC(2026, 0, 1);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(createdAt);
  try {
    rooms.create('room-a', 'facilitator', 'Alex');
    clock.mockReturnValue(createdAt + day);
    rooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'A Story' });
    const storyId = readLiveRoom('facilitator').stories[0].id;
    rooms.mutate('room-a', 'facilitator', { type: 'select-story', storyId });
    const roundId = readLiveRoom('facilitator').round!.id;
    clock.mockReturnValue(createdAt + 2 * day);
    rooms.mutate('room-a', 'voter', { type: 'join', displayName: 'Sam' });
    rooms.mutate('room-a', 'voter', { type: 'vote', roundId, choice: '0' });
    clock.mockReturnValue(createdAt + 3 * day);
    rooms.mutate('room-a', 'voter', { type: 'vote', roundId, choice: '1' });
    clock.mockReturnValue(createdAt + 4 * day);
    rooms.mutate('room-a', 'voter', { type: 'vote', roundId, choice: null });
    clock.mockReturnValue(createdAt + 5 * day);
    rooms.mutate('room-a', 'voter', { type: 'vote', roundId, choice: null });
    rooms.mutate('room-a', 'voter', { type: 'vote', roundId: 'stale', choice: '1' });
    rooms.mutate('room-a', 'facilitator', { type: 'edit-story', storyId, title: 'A Story' });
    rooms.mutate('room-a', 'voter', { type: 'join', displayName: 'Different' });
    rooms.mutate('room-a', 'other', { type: 'join', displayName: 'Max' });
    clock.mockReturnValue(createdAt + 94 * day - 1);
    expect(rooms.read('room-a', 'facilitator')).not.toBeNull();
    clock.mockReturnValue(createdAt + 94 * day);
    expect(rooms.read('room-a', 'facilitator')).toBeNull();
    expect(rooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'Too late' }))
      .toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  } finally {
    clock.mockRestore();
  }
});

test('Room closure starts a fixed 90-day deadline', () => {
  const createdAt = Date.UTC(2026, 0, 1);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(createdAt);
  try {
    rooms.create('room-a', 'facilitator', 'Alex');
    clock.mockReturnValue(createdAt + day);
    expect(rooms.mutate('room-a', 'facilitator', { type: 'close-room' }).ok).toBe(true);
    clock.mockReturnValue(createdAt + 90 * day);
    expect(rooms.mutate('room-a', 'facilitator', { type: 'close-room' }).ok).toBe(true);
    expect(rooms.read('room-a', 'visitor')).toMatchObject({ closed: true, stories: [] });
    clock.mockReturnValue(createdAt + 91 * day);
    expect(rooms.read('room-a', 'visitor')).toBeNull();
  } finally {
    clock.mockRestore();
  }
});

test('open Room deletion checks the Facilitator and sends a terminal frame to each live viewer', async () => {
  const id = generateEntityId();
  rooms.create(id, 'facilitator', 'Alex');
  rooms.mutate(id, 'participant', { type: 'join', displayName: 'Sam' });
  const liveRequest = new Request('https://retrocks.test/live');
  const facilitator = rooms.connect(id, 'facilitator', liveRequest).body!.getReader();
  const participant = rooms.connect(id, 'participant', liveRequest).body!.getReader();
  const frame = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const { value } = await reader.read();
    return parsePokerLiveMessage(new TextDecoder().decode(value).slice(6));
  };

  expect(await frame(facilitator)).toMatchObject({ type: 'room:snapshot' });
  expect(await frame(facilitator)).toMatchObject({ type: 'room:presence' });
  expect(await frame(facilitator)).toMatchObject({ type: 'room:presence' });
  expect(await frame(participant)).toMatchObject({ type: 'room:snapshot' });
  expect(await frame(participant)).toMatchObject({ type: 'room:presence' });
  expect(rooms.delete(id, 'participant')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(rooms.delete(id, 'facilitator')).toEqual({ ok: true });
  for (const reader of [facilitator, participant]) {
    expect(await frame(reader)).toEqual({ type: 'room:missing' });
    expect(await reader.read()).toMatchObject({ done: true });
  }
  expect(rooms.read(id, 'facilitator')).toBeNull();
  const reconnect = rooms.connect(id, 'participant', liveRequest);
  expect(parsePokerLiveMessage((await reconnect.text()).slice(6))).toEqual({ type: 'room:missing' });
});

test('closed Room deletion uses the retained Facilitator capability', () => {
  rooms.create('room-a', 'facilitator', 'Alex');
  expect(rooms.mutate('room-a', 'facilitator', { type: 'close-room' }).ok).toBe(true);
  expect(rooms.delete('room-a', 'visitor')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(rooms.delete('room-a', 'facilitator')).toEqual({ ok: true });
  expect(rooms.read('room-a', 'visitor')).toBeNull();
  expect(rooms.delete('room-a', 'facilitator')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
});

test('reopening a closed Room requires a pre-close Facilitator, locks prior Stories, preserves Deck state, resets 90-day expiry, and restores Facilitator claims on rejoin', () => {
  const createdAt = Date.UTC(2026, 0, 1);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(createdAt);
  try {
    rooms.create('room-a', 'facilitator', 'Alex');
    expect(rooms.mutate('room-a', 'facilitator', {
      type: 'set-deck',
      deck: { type: 'custom', choices: ['Low', 'Med', 'High'] },
    }).ok).toBe(true);
    expect(rooms.mutate('room-a', 'participant', { type: 'join', displayName: 'Sam' }).ok).toBe(true);
    expect(rooms.replaceFacilitatorCapability('room-a', 'facilitator', 0, {
      hash: 'old-hash',
      encrypted: 'old-encrypted',
      revision: 1,
    }).ok).toBe(true);

    // Add three Stories covering estimated, skipped, and pending states.
    expect(rooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'Estimated Story' }).ok).toBe(true);
    expect(rooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'Skipped Story' }).ok).toBe(true);
    expect(rooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'Pending Story' }).ok).toBe(true);
    const [estimatedStory, skippedStory, pendingStory] = readLiveRoom('facilitator').stories;

    // Estimate first Story (also locks the Deck).
    expect(rooms.mutate('room-a', 'facilitator', { type: 'select-story', storyId: estimatedStory.id }).ok).toBe(true);
    const round1 = readLiveRoom('facilitator').round!.id;
    expect(rooms.mutate('room-a', 'participant', { type: 'vote', roundId: round1, choice: 'Med' }).ok).toBe(true);
    expect(rooms.mutate('room-a', 'facilitator', { type: 'reveal', roundId: round1 }).ok).toBe(true);
    expect(rooms.mutate('room-a', 'facilitator', { type: 'confirm-estimate', roundId: round1, choice: 'Med' }).ok).toBe(true);

    // Skip second Story.
    expect(rooms.mutate('room-a', 'facilitator', { type: 'select-story', storyId: skippedStory.id }).ok).toBe(true);
    const round2 = readLiveRoom('facilitator').round!.id;
    expect(rooms.mutate('room-a', 'participant', { type: 'vote', roundId: round2, choice: 'High' }).ok).toBe(true);
    expect(rooms.mutate('room-a', 'facilitator', { type: 'reveal', roundId: round2 }).ok).toBe(true);
    expect(rooms.mutate('room-a', 'facilitator', { type: 'skip-story', roundId: round2 }).ok).toBe(true);

    // Close the Room on day 1.
    clock.mockReturnValue(createdAt + day);
    const closed = rooms.mutate('room-a', 'facilitator', { type: 'close-room' });
    expect(closed).toMatchObject({ ok: true, room: { closed: true, canDelete: true } });

    // Non-Facilitators cannot reopen the closed Room.
    clock.mockReturnValue(createdAt + 40 * day);
    expect(rooms.mutate('room-a', 'participant', { type: 'reopen-room' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(rooms.mutate('room-a', 'visitor', { type: 'reopen-room' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    // Pre-close Facilitator reopens the Room on day 40.
    const reopened = rooms.mutate('room-a', 'facilitator', { type: 'reopen-room' });
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

    // Idempotent reopen by pending Facilitator does not bump version; non-Facilitators are forbidden.
    expect(rooms.mutate('room-a', 'facilitator', { type: 'reopen-room' })).toEqual(reopened);
    expect(rooms.mutate('room-a', 'participant', { type: 'reopen-room' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    // Old Co-Facilitator Link was cleared on close and stays cleared on reopen.
    expect(rooms.claimFacilitator('room-a', 'visitor', 'old-hash')).toMatchObject({ ok: false, code: 'INVALID_LINK' });

    // Returning Participant joins as non-Facilitator; returning Facilitator regains Facilitator role.
    expect(rooms.mutate('room-a', 'participant', { type: 'join', displayName: 'Sam again' }).ok).toBe(true);
    expect(readLiveRoom('participant').viewer).toMatchObject({ displayName: 'Sam again', isFacilitator: false });

    expect(rooms.mutate('room-a', 'facilitator', { type: 'join', displayName: 'Alex again' }).ok).toBe(true);
    const rejoined = readLiveRoom('facilitator');
    expect(rejoined.viewer).toMatchObject({ displayName: 'Alex again', isFacilitator: true });
    expect(rejoined.deckType).toBe('custom');
    expect(rejoined.deck).toEqual(['Low', 'Med', 'High']);
    expect(rejoined.deckLocked).toBe(true);
    expect(rejoined.facilitatorLinkRevision).toBeUndefined();
    expect(rooms.getFacilitatorCapability('room-a', 'facilitator')).toEqual({ ok: true, value: null });
    expect(rejoined.stories).toEqual([
      { id: estimatedStory.id, title: 'Estimated Story', status: 'estimated', acceptedEstimate: 'Med', locked: true },
      { id: skippedStory.id, title: 'Skipped Story', status: 'skipped', locked: true },
      { id: pendingStory.id, title: 'Pending Story', status: 'pending', locked: true },
    ]);

    // Pre-close Stories stay locked until unlocked; newly added Stories start unlocked.
    expect(rooms.mutate('room-a', 'facilitator', {
      type: 'edit-story',
      storyId: pendingStory.id,
      title: 'Blocked edit',
    })).toMatchObject({ ok: false, code: 'STORY_LOCKED' });
    expect(rooms.mutate('room-a', 'facilitator', { type: 'add-story', title: 'New Story' }).ok).toBe(true);
    expect(readLiveRoom('facilitator').stories.at(-1)).toMatchObject({ title: 'New Story', locked: false });

    // Idempotent reopen after joining does not re-lock the newly added Story.
    const repeat = rooms.mutate('room-a', 'facilitator', { type: 'reopen-room' });
    expect(repeat.ok).toBe(true);
    expect(readLiveRoom('facilitator').stories.at(-1)).toMatchObject({ title: 'New Story', locked: false });
    expect(reopenedVersion).toBeGreaterThan(1);

    // 90-day expiry was reset from day 40 (reopen) -> expires on day 130, not day 91 (close + 90).
    clock.mockReturnValue(createdAt + 130 * day - 1);
    expect(rooms.read('room-a', 'facilitator')).not.toBeNull();
    clock.mockReturnValue(createdAt + 130 * day);
    expect(rooms.read('room-a', 'facilitator')).toBeNull();
  } finally {
    clock.mockRestore();
  }
});
