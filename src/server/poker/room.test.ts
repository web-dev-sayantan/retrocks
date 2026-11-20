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
