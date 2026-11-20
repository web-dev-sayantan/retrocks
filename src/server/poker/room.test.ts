import { afterEach, beforeEach, expect, test } from 'vitest';

import { openNodePokerRooms, type NodePokerRooms } from './node';

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
