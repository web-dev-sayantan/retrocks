import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

import { parsePokerLiveMessage } from '../../lib/poker-schemas';

const origin = 'https://retrocks.test';

let service: typeof import('./service');

beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', 'story-queue-test-session-secret-at-least-32');
  service = await import('./service');
});
afterAll(() => vi.unstubAllEnvs());

async function inRequest<T>(operation: () => Promise<T>, cookie?: string, method = 'POST') {
  const event = createRequestEvent(new Request(origin, {
    method,
    headers: cookie ? { cookie } : undefined,
  }));
  return provideRequestEvent(event, async () => {
    const result = await operation();
    const response = commitEventResponse(new Response(null), event);
    return { result, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
  });
}

async function openRoom() {
  const { result: created, cookie: facilitator } = await inRequest(() => service.createPokerRoomForRequest('Alex'));
  if (!created.ok || !facilitator) throw new Error('Room creation failed.');
  const { id } = created.room;
  const { result: joined, cookie: participant } = await inRequest(() =>
    service.mutatePokerRoomForRequest(id, { type: 'join', displayName: 'Sam' }),
  );
  if (!joined.ok || !participant) throw new Error('Room join failed.');

  return {
    id,
    participant,
    joined: joined.room,
    mutate: async (input: unknown, cookie = facilitator) =>
      (await inRequest(() => service.mutatePokerRoomForRequest(id, input), cookie)).result,
    read: async (cookie: string) =>
      (await inRequest(() => service.readPokerRoomForRequest(id), cookie, 'GET')).result,
  };
}

test('a Room can be joined empty and a Facilitator’s first Story appears in the Participant’s live view', async () => {
  const { id, participant, joined, mutate } = await openRoom();
  expect(joined).toMatchObject({ stories: [], activeStoryId: null });

  const response = await service.handlePokerLiveRequest(id, new Request(`${origin}/api/poker/${id}/live`, {
    headers: { cookie: participant },
  }));
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  async function readFrame() {
    const { value } = await reader.read();
    return parsePokerLiveMessage(new TextDecoder().decode(value).slice('data: '.length));
  }

  try {
    expect(await readFrame()).toMatchObject({ type: 'room:snapshot', room: { stories: [] } });
    expect(await readFrame()).toMatchObject({ type: 'room:presence' });

    expect(await mutate({ type: 'add-story', title: '  Save checkout progress  ' })).toMatchObject({
      ok: true,
      room: { stories: [{ title: 'Save checkout progress', status: 'pending' }], activeStoryId: null },
    });
    expect(await readFrame()).toMatchObject({
      type: 'room:snapshot',
      room: {
        viewer: { displayName: 'Sam', isFacilitator: false },
        stories: [{ title: 'Save checkout progress', status: 'pending' }],
        activeStoryId: null,
      },
    });
  } finally {
    await reader.cancel();
  }
});

test('only a Facilitator may add, edit, move or select Stories', async () => {
  const { participant, mutate, read } = await openRoom();
  const first = await mutate({ type: 'add-story', title: 'Saved checkout' });
  const second = await mutate({ type: 'add-story', title: 'Pay with a gift card' });
  if (!first.ok || !second.ok) throw new Error('Story creation failed.');
  const [savedCheckout, giftCard] = second.room.stories;
  const move = {
    type: 'move-story', storyId: giftCard.id, targetId: savedCheckout.id, placement: 'before',
  };
  const edit = { type: 'edit-story', storyId: savedCheckout.id, title: '  Restore checkout  ' };
  const select = { type: 'select-story', storyId: savedCheckout.id };

  for (const input of [{ type: 'add-story', title: 'Unauthorized' }, move, edit, select]) {
    expect(await mutate(input, participant)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  }
  expect(await mutate({ ...edit, title: '  ' })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });

  expect(await mutate(edit)).toMatchObject({
    ok: true,
    room: { stories: [{ id: savedCheckout.id, title: 'Restore checkout' }, giftCard] },
  });
  expect(await mutate(move)).toMatchObject({ ok: true });
  expect(await mutate(select)).toMatchObject({ ok: true });
  expect(await read(participant)).toMatchObject({
    stories: [giftCard, { id: savedCheckout.id, title: 'Restore checkout', status: 'pending' }],
    activeStoryId: savedCheckout.id,
  });
});

test('same-name Participants vote privately, keep their own choice on reconnect, and see the named ballots after reveal', async () => {
  const { id, participant, joined, mutate, read } = await openRoom();
  const { result: other, cookie: otherSam } = await inRequest(() =>
    service.mutatePokerRoomForRequest(id, { type: 'join', displayName: 'Sam' }),
  );
  if (!other.ok || !otherSam) throw new Error('Second Sam could not join.');
  const added = await mutate({ type: 'add-story', title: 'Saved checkout' });
  if (!added.ok) throw new Error('Could not add Story.');
  const selected = await mutate({ type: 'select-story', storyId: added.room.stories[0].id });
  expect(selected).toMatchObject({
    ok: true,
    room: { deck: ['0', '1', '2', '3', '5', '8', '13', '21'], round: { phase: 'open', ownChoice: null } },
  });
  if (!selected.ok || !selected.room.round) throw new Error('Voting has not started.');
  const roundId = selected.room.round.id;

  const vote = (choice: string | null) => ({ type: 'vote', roundId, choice });
  const reveal = { type: 'reveal', roundId };

  async function connect(cookie: string) {
    const response = await service.handlePokerLiveRequest(id, new Request(`${origin}/api/poker/${id}/live`, {
      headers: { cookie },
    }));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    return {
      cancel: () => reader.cancel(),
      async snapshot() {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) throw new Error('Live stream ended before a snapshot.');
          const json = new TextDecoder().decode(value).slice('data: '.length);
          const frame = parsePokerLiveMessage(json);
          if (frame.type === 'room:snapshot') {
            expect(JSON.parse(json)).toMatchObject({ room: { round: frame.room.round } });
            return { raw: JSON.parse(json).room.round, room: frame.room };
          }
        }
      },
    };
  }

  expect(await mutate(reveal)).toMatchObject({ ok: false });
  expect(await mutate(vote('4'), participant)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  const stream = await connect(otherSam);
  const firstId = joined.viewer!.id;
  const secondId = other.room.viewer!.id;
  try {
    await stream.snapshot();
    const zero = await mutate(vote('0'), participant);
    expect(zero).toMatchObject({
      ok: true,
      room: { round: { id: roundId, phase: 'open', ownChoice: '0', submittedParticipantIds: [firstId] } },
    });
    expect((await stream.snapshot()).raw).toEqual({
      id: roundId, phase: 'open', ownChoice: null, submittedParticipantIds: [firstId],
    });

    expect(await mutate(vote(null), participant)).toMatchObject({
      ok: true, room: { round: { ownChoice: null, submittedParticipantIds: [] } },
    });
    expect(await mutate(reveal)).toMatchObject({ ok: false });
    const firstChanged = await mutate(vote('3'), participant);
    expect(firstChanged).toMatchObject({ ok: true, room: { round: { ownChoice: '3' } } });
    const repeat = await mutate(vote('3'), participant);
    expect(repeat).toEqual(firstChanged);
    expect(await mutate(reveal, participant)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await mutate(vote('8'), otherSam)).toMatchObject({
      ok: true, room: { round: { ownChoice: '8', submittedParticipantIds: [firstId, secondId] } },
    });

    const reconnect = await connect(participant);
    try {
      expect((await reconnect.snapshot()).room.round).toEqual({
        id: roundId, phase: 'open', ownChoice: '3', submittedParticipantIds: [firstId, secondId],
      });
    } finally {
      await reconnect.cancel();
    }

    const revealed = await mutate(reveal);
    const expectedRound = {
      id: roundId,
      phase: 'revealed',
      ballots: [
        { participantId: firstId, displayName: 'Sam', choice: '3' },
        { participantId: secondId, displayName: 'Sam', choice: '8' },
      ],
    };
    expect(revealed).toMatchObject({ ok: true, room: { round: expectedRound, stories: [{ status: 'pending' }] } });
    expect(await read(otherSam)).toMatchObject({ round: expectedRound });
    expect(await mutate(vote(null), participant)).toMatchObject({ ok: false });
    const late = await inRequest(() => service.mutatePokerRoomForRequest(id, { type: 'join', displayName: 'Jo' }));
    expect(late.result).toMatchObject({ ok: true, room: { round: expectedRound } });
    if (revealed.ok) {
      let snapshot = await stream.snapshot();
      while (snapshot.room.version < revealed.room.version) snapshot = await stream.snapshot();
      expect(snapshot.raw).toEqual(expectedRound);
    }
  } finally {
    await stream.cancel();
  }
});

test('Editing the active Story invalidates old vote, reveal, and switch commands for the same Story', async () => {
  const { participant, mutate, read } = await openRoom();
  await mutate({ type: 'add-story', title: 'Checkout' });
  const added = await mutate({ type: 'add-story', title: 'Receipt' });
  if (!added.ok) throw new Error('Could not add Stories.');
  const [checkout, receipt] = added.room.stories;
  const selected = await mutate({ type: 'select-story', storyId: checkout.id });
  if (!selected.ok || !selected.room.round) throw new Error('Could not open Voting Round.');
  const roundId = selected.room.round.id;
  const vote = { type: 'vote', roundId, choice: '5' };
  expect(await mutate(vote, participant)).toMatchObject({ ok: true });

  expect(await mutate({ type: 'edit-story', storyId: receipt.id, title: 'Send receipt' })).toMatchObject({
    ok: true, room: { round: { id: roundId, submittedParticipantIds: [expect.any(String)] } },
  });
  expect(await mutate({
    type: 'move-story', storyId: receipt.id, targetId: checkout.id, placement: 'before',
  })).toMatchObject({ ok: true, room: { round: { id: roundId } } });

  const edited = await mutate({ type: 'edit-story', storyId: checkout.id, title: 'Save checkout' });
  if (!edited.ok || !edited.room.round) throw new Error('Could not edit active Story.');
  expect(edited.room.round).toMatchObject({ phase: 'open', ownChoice: null, submittedParticipantIds: [] });
  expect(edited.room.round.id).not.toBe(roundId);
  expect(await mutate(vote, participant)).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ type: 'reveal', roundId })).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  const switchStory = { type: 'select-story', storyId: receipt.id };
  expect(await mutate(switchStory)).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ ...switchStory, discardRoundId: roundId })).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await read(participant)).toMatchObject({
    activeStoryId: checkout.id,
    round: edited.room.round,
  });
  expect(await mutate({ ...switchStory, discardRoundId: edited.room.round.id })).toMatchObject({
    ok: true,
    room: { activeStoryId: receipt.id, stories: [{ status: 'pending' }, { status: 'pending' }] },
  });
});
