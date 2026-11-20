import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

import { parsePokerLiveMessage } from '../../lib/poker-schemas';

let testClient = 0;
const origin = 'https://retrocks.test';

let service: typeof import('./service');

beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', 'story-queue-test-session-secret-at-least-32');
  service = await import('./service');
});
afterAll(() => vi.unstubAllEnvs());

async function inRequest<T>(operation: () => Promise<T>, cookie?: string, method = 'POST', clientAddress?: string) {
  const event = createRequestEvent(new Request(origin, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(clientAddress ? { 'cf-connecting-ip': clientAddress } : {}) },
  }));
  return provideRequestEvent(event, async () => {
    const result = await operation();
    const response = commitEventResponse(new Response(null), event);
    return { result, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
  });
}

async function openRoom() {
  const { result: created, cookie: facilitator } = await inRequest(
    () => service.createPokerRoomForRequest('Alex'), undefined, 'POST', `192.0.2.${++testClient}`,
  );
  if (!created.ok || !facilitator) throw new Error('Room creation failed.');
  const { id } = created.room;
  const { result: joined, cookie: participant } = await inRequest(() =>
    service.mutatePokerRoomForRequest(id, { type: 'join', displayName: 'Sam' }),
  );
  if (!joined.ok || joined.room.closed || !participant) throw new Error('Room join failed.');

  const mutateRoom = async (input: unknown, cookie = facilitator) =>
    (await inRequest(() => service.mutatePokerRoomForRequest(id, input), cookie)).result;

  return {
    id,
    participant,
    joined: joined.room,
    mutateRoom,
    async mutate(input: unknown, cookie = facilitator) {
      const result = await mutateRoom(input, cookie);
      if (!result.ok) return result;
      if (result.room.closed) throw new Error('Expected a live Room.');
      return { ok: true as const, room: result.room };
    },
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
  if (!other.ok || other.room.closed || !otherSam) throw new Error('Second Sam could not join.');
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
          if (frame.type === 'room:snapshot' && !frame.room.closed) {
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

test('a unanimous reveal needs explicit acceptance from the Deck before moving on', async () => {
  const { id, participant, mutate, read } = await openRoom();
  await mutate({ type: 'add-story', title: 'Restore checkout' });
  const added = await mutate({ type: 'add-story', title: 'Send receipt' });
  if (!added.ok) throw new Error('Could not add Stories.');
  const [checkout, receipt] = added.room.stories;
  const selected = await mutate({ type: 'select-story', storyId: checkout.id });
  if (!selected.ok || !selected.room.round) throw new Error('Could not open Voting Round.');
  const roundId = selected.room.round.id;
  const confirm = { type: 'confirm-estimate', roundId, choice: '0' };
  const switchStory = { type: 'select-story', storyId: receipt.id };

  expect(await mutate(confirm)).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ type: 'vote', roundId, choice: '5' }, participant)).toMatchObject({ ok: true });
  expect(await mutate({ type: 'vote', roundId, choice: '5' })).toMatchObject({ ok: true });
  expect(await mutate({ type: 'reveal', roundId })).toMatchObject({
    ok: true, room: { stories: [checkout, receipt], round: { phase: 'revealed' } },
  });
  expect(await mutate(switchStory)).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate(confirm, participant)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await mutate({ ...confirm, choice: '4' })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });

  const response = await service.handlePokerLiveRequest(id, new Request(`${origin}/api/poker/${id}/live`, {
    headers: { cookie: participant },
  }));
  const reader = response.body!.getReader();
  try {
    const accepted = await mutate(confirm);
    expect(accepted).toMatchObject({
      ok: true,
      room: {
        stories: [{ ...checkout, status: 'estimated', acceptedEstimate: '0' }, receipt],
        round: { id: roundId, phase: 'accepted', ballots: [
          { displayName: 'Alex', choice: '5' }, { displayName: 'Sam', choice: '5' },
        ] },
      },
    });
    let snapshot;
    do {
      const { value, done } = await reader.read();
      if (done) throw new Error('Live stream ended before the estimate was accepted.');
      snapshot = parsePokerLiveMessage(new TextDecoder().decode(value).slice('data: '.length));
    } while (snapshot.type !== 'room:snapshot' || snapshot.room.closed || snapshot.room.round?.phase !== 'accepted');
    expect(snapshot.room.stories[0].acceptedEstimate).toBe('0');

    expect(await mutate({ ...confirm, choice: '13' })).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
    expect(await mutate(switchStory)).toMatchObject({
      ok: true,
      room: { round: { phase: 'open', submittedParticipantIds: [] }, activeStoryId: receipt.id },
    });
    expect(await read(participant)).toMatchObject({
      stories: [{ ...checkout, status: 'estimated', acceptedEstimate: '0' }, receipt],
      activeStoryId: receipt.id,
    });
  } finally {
    await reader.cancel();
  }
});

test('restarting or skipping a revealed reconsideration preserves the earlier estimate and rejects stale round commands', async () => {
  const { participant, mutate } = await openRoom();
  const added = await mutate({ type: 'add-story', title: 'Restore checkout' });
  if (!added.ok) throw new Error('Could not add Story.');
  const [checkout] = added.room.stories;
  const selected = await mutate({ type: 'select-story', storyId: checkout.id });
  if (!selected.ok || !selected.room.round) throw new Error('Could not open Voting Round.');
  const firstRound = selected.room.round.id;

  async function reveal(roundId: string) {
    expect(await mutate({ type: 'vote', roundId, choice: '5' }, participant)).toMatchObject({ ok: true });
    expect(await mutate({ type: 'reveal', roundId })).toMatchObject({ ok: true });
  }

  await reveal(firstRound);
  expect(await mutate({ type: 'confirm-estimate', roundId: firstRound, choice: '3' })).toMatchObject({ ok: true });
  const restart = { type: 'restart-round', roundId: firstRound };
  expect(await mutate(restart, participant)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  const restarted = await mutate(restart);
  const estimated = { ...checkout, acceptedEstimate: '3', status: 'estimated' };
  expect(restarted).toMatchObject({
    ok: true,
    room: { stories: [estimated], round: { phase: 'open', submittedParticipantIds: [] } },
  });
  if (!restarted.ok || !restarted.room.round) throw new Error('Could not open reconsideration.');
  const secondRound = restarted.room.round.id;
  expect(secondRound).not.toBe(firstRound);
  await reveal(secondRound);

  for (const stale of [
    restart, { type: 'skip-story', roundId: firstRound }, { type: 'confirm-estimate', roundId: firstRound, choice: '8' },
  ]) {
    expect(await mutate(stale)).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  }
  const fresh = await mutate({ type: 'restart-round', roundId: secondRound });
  if (!fresh.ok || !fresh.room.round) throw new Error('Could not re-run reconsideration.');
  const thirdRound = fresh.room.round.id;
  expect(thirdRound).not.toBe(secondRound);
  await reveal(thirdRound);
  expect(await mutate({ type: 'skip-story', roundId: thirdRound })).toMatchObject({
    ok: true,
    room: { activeStoryId: null, round: null, stories: [estimated] },
  });
  expect(await mutate({ type: 'select-story', storyId: checkout.id })).toMatchObject({
    ok: true,
    room: { activeStoryId: checkout.id, round: { phase: 'open' }, stories: [estimated] },
  });
});

test('a skipped Story returns to the queue without the votes from its old round', async () => {
  const { participant, mutate } = await openRoom();
  const added = await mutate({ type: 'add-story', title: 'Restore checkout' });
  if (!added.ok) throw new Error('Could not add Story.');
  const [checkout] = added.room.stories;
  const select = { type: 'select-story', storyId: checkout.id };
  const selected = await mutate(select);
  if (!selected.ok || !selected.room.round) throw new Error('Could not open Voting Round.');
  const roundId = selected.room.round.id;
  expect(await mutate({ type: 'vote', roundId, choice: '8' }, participant)).toMatchObject({ ok: true });
  expect(await mutate({ type: 'reveal', roundId })).toMatchObject({ ok: true });

  expect(await mutate({ type: 'skip-story', roundId }, participant)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await mutate({ type: 'skip-story', roundId })).toMatchObject({
    ok: true, room: { activeStoryId: null, round: null, stories: [{ ...checkout, status: 'skipped' }] },
  });
  expect(await mutate(select)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });

  const restore = { type: 'return-story', storyId: checkout.id };
  expect(await mutate(restore, participant)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await mutate(restore)).toMatchObject({
    ok: true, room: { activeStoryId: null, round: null, stories: [checkout] },
  });
  const reopened = await mutate(select);
  expect(reopened).toMatchObject({ ok: true, room: { round: { phase: 'open', submittedParticipantIds: [] } } });
  expect(reopened.ok && reopened.room.round?.id).not.toBe(roundId);
});

test('direct estimate and title corrections preserve the round and reject a stale correction', async () => {
  const { participant, mutate } = await openRoom();
  const added = await mutate({ type: 'add-story', title: 'Restore chekout' });
  if (!added.ok) throw new Error('Could not add Story.');
  const [checkout] = added.room.stories;
  const selected = await mutate({ type: 'select-story', storyId: checkout.id });
  if (!selected.ok || !selected.room.round) throw new Error('Could not open Voting Round.');
  const roundId = selected.room.round.id;
  const correct = { type: 'correct-estimate', storyId: checkout.id, expectedEstimate: '3', choice: '5' };
  expect(await mutate({ ...correct, expectedEstimate: undefined })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  expect(await mutate(correct)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });

  expect(await mutate({ type: 'vote', roundId, choice: '8' }, participant)).toMatchObject({ ok: true });
  expect(await mutate({ type: 'reveal', roundId })).toMatchObject({ ok: true });
  const accepted = await mutate({ type: 'confirm-estimate', roundId, choice: '3' });
  if (!accepted.ok) throw new Error('Could not record estimate.');
  const acceptedRound = accepted.room.round;

  expect(await mutate(correct, participant)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await mutate({ ...correct, choice: '4' })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  expect(await mutate({ ...correct, choice: '3' })).toEqual(accepted);
  expect(await mutate(correct)).toMatchObject({
    ok: true, room: { round: acceptedRound, stories: [{ status: 'estimated', acceptedEstimate: '5' }] },
  });
  expect(await mutate({ ...correct, choice: '0' })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });

  expect(await mutate({ type: 'edit-story', storyId: checkout.id, title: 'Restore checkout' })).toMatchObject({
    ok: true,
    room: { round: acceptedRound, stories: [{ id: checkout.id, title: 'Restore checkout', acceptedEstimate: '5' }] },
  });
  const restarted = await mutate({ type: 'restart-round', roundId });
  if (!restarted.ok || !restarted.room.round) throw new Error('Could not open reconsideration.');
  const replacementRound = restarted.room.round.id;
  await mutate({ type: 'vote', roundId: replacementRound, choice: '13' }, participant);
  await mutate({ type: 'reveal', roundId: replacementRound });
  expect(await mutate({ type: 'confirm-estimate', roundId: replacementRound, choice: '13' })).toMatchObject({
    ok: true, room: { stories: [{ status: 'estimated', acceptedEstimate: '13' }], round: { phase: 'accepted' } },
  });
  expect(await mutate({ ...correct, expectedEstimate: '5' })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
});

test('the Facilitator can change the Deck and Participants receive its ordered choices live', async () => {
  const { id, participant, mutate, read } = await openRoom();
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
    expect(await readFrame()).toMatchObject({
      type: 'room:snapshot', room: { deckType: 'fibonacci', deckLocked: false },
    });
    expect(await readFrame()).toMatchObject({ type: 'room:presence' });
    expect(await mutate({ type: 'set-deck', deck: { type: 't-shirt' } }, participant)).toMatchObject({
      ok: false, code: 'FORBIDDEN',
    });
    expect(await mutate({ type: 'set-deck', deck: { type: 't-shirt' } })).toMatchObject({
      ok: true, room: { deckType: 't-shirt', deck: ['XS', 'S', 'M', 'L', 'XL'] },
    });
    expect(await readFrame()).toMatchObject({
      type: 'room:snapshot', room: { deckType: 't-shirt', deck: ['XS', 'S', 'M', 'L', 'XL'] },
    });

    for (const choices of [['only one'], [' ', 'valid'], [1, ' 1 '], ['same', 'same']]) {
      expect(await mutate({ type: 'set-deck', deck: { type: 'custom', choices } })).toMatchObject({
        ok: false, code: 'INVALID_INPUT',
      });
    }
    const deck = ['4', 'Unexpected work', '0'];
    expect(await mutate({ type: 'set-deck', deck: { type: 'custom', choices: [4, ' Unexpected work ', 0] } })).toMatchObject({
      ok: true, room: { deckType: 'custom', deck },
    });
    expect(await readFrame()).toMatchObject({ type: 'room:snapshot', room: { deckType: 'custom', deck } });
    expect(await read(participant)).toMatchObject({ deckType: 'custom', deck, deckLocked: false });
  } finally {
    await reader.cancel();
  }
});

test('opening the first Voting Round fixes the saved Deck before any votes are cast', async () => {
  const { participant, mutate, read } = await openRoom();
  const added = await mutate({ type: 'add-story', title: 'Checkout' });
  if (!added.ok) throw new Error('Could not add Story.');
  const deck = { type: 'set-deck', deck: { type: 'custom', choices: ['Review', 0] } };
  const open = { type: 'select-story', storyId: added.room.stories[0].id };

  expect(await mutate(deck)).toMatchObject({ ok: true, room: { deckLocked: false } });
  const opened = await mutate(open);
  expect(opened).toMatchObject({ ok: true, room: { deckLocked: true, deck: ['Review', '0'] } });
  if (!opened.ok || !opened.room.round) throw new Error('Could not open Voting Round.');
  expect(await mutate({ type: 'set-deck', deck: { type: 'fibonacci' } })).toMatchObject({
    ok: false, code: 'DECK_LOCKED',
  });
  expect(await read(participant)).toMatchObject({ deckLocked: true, deck: ['Review', '0'] });

  const roundId = opened.room.round.id;
  expect(await mutate({ type: 'vote', roundId, choice: '  Review ' }, participant)).toMatchObject({
    ok: true, room: { round: { ownChoice: 'Review' } },
  });
  expect(await mutate({ type: 'vote', roundId, choice: '5' }, participant)).toMatchObject({
    ok: false, code: 'INVALID_INPUT',
  });
  expect(await mutate({ type: 'vote', roundId, choice: 0 })).toMatchObject({
    ok: true, room: { round: { ownChoice: '0' } },
  });
  expect(await mutate({ type: 'reveal', roundId })).toMatchObject({
    ok: true, room: { round: { ballots: [{ choice: '0' }, { choice: 'Review' }] } },
  });
  expect(await mutate({ type: 'confirm-estimate', roundId, choice: '5' })).toMatchObject({
    ok: false, code: 'INVALID_INPUT',
  });
  expect(await mutate({ type: 'confirm-estimate', roundId, choice: ' Review ' })).toMatchObject({
    ok: true, room: { stories: [{ status: 'estimated', acceptedEstimate: 'Review' }] },
  });
  expect(await mutate({ type: 'correct-estimate', storyId: open.storyId, expectedEstimate: 'Review', choice: 0 })).toMatchObject({
    ok: true, room: { stories: [{ status: 'estimated', acceptedEstimate: '0' }] },
  });
});

test('a Deck save racing the first Voting Round cannot change the Deck after the round opens', async () => {
  const { participant, mutate, read } = await openRoom();
  const added = await mutate({ type: 'add-story', title: 'Checkout' });
  if (!added.ok) throw new Error('Could not add Story.');
  const [opened, changed] = await Promise.all([
    mutate({ type: 'select-story', storyId: added.room.stories[0].id }),
    mutate({ type: 'set-deck', deck: { type: 't-shirt' } }),
  ]);
  if (!opened.ok) throw new Error('Could not open Voting Round.');
  const deck = changed.ok ? ['XS', 'S', 'M', 'L', 'XL'] : ['0', '1', '2', '3', '5', '8', '13', '21'];
  expect(opened.room).toMatchObject({ deck, deckLocked: true });
  if (!changed.ok) expect(changed.code).toBe('DECK_LOCKED');
  expect(await read(participant)).toMatchObject({ deck, deckLocked: true });
});

test('closing an unresolved Room publishes only the ordered summary and ends live presence', async () => {
  const { id, participant, mutate, mutateRoom } = await openRoom();
  const added = await mutate({ type: 'add-story', title: 'Save checkout' });
  if (!added.ok) throw new Error(added.message);
  const selected = await mutate({ type: 'select-story', storyId: added.room.stories[0].id });
  if (!selected.ok || !selected.room.round) throw new Error('Voting did not open.');
  const roundId = selected.room.round.id;
  await mutate({ type: 'vote', roundId, choice: '8' }, participant);
  await mutate({ type: 'reveal', roundId });
  await mutate({ type: 'confirm-estimate', roundId, choice: '5' });
  const reconsidering = await mutate({ type: 'restart-round', roundId });
  if (!reconsidering.ok || !reconsidering.room.round) throw new Error('Voting did not restart.');
  const discardRoundId = reconsidering.room.round.id;
  await mutate({ type: 'vote', roundId: discardRoundId, choice: '13' }, participant);
  await mutate({ type: 'reveal', roundId: discardRoundId });
  await mutate({ type: 'add-story', title: 'Recover a cart' });

  const connect = () => service.handlePokerLiveRequest(id, new Request(`${origin}/api/poker/${id}/live`, {
    headers: { cookie: participant },
  }));
  const reader = (await connect()).body!.getReader();
  const nextJson = async (source: ReadableStreamDefaultReader<Uint8Array>) => {
    const { value } = await source.read();
    return new TextDecoder().decode(value).slice('data: '.length);
  };

  try {
    expect(parsePokerLiveMessage(await nextJson(reader))).toMatchObject({ room: { round: { phase: 'revealed' } } });
    expect(parsePokerLiveMessage(await nextJson(reader))).toMatchObject({ type: 'room:presence' });
    expect(await mutateRoom({ type: 'close-room', discardRoundId }, participant)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await mutateRoom({ type: 'close-room' })).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
    expect(await mutateRoom({ type: 'close-room', discardRoundId: roundId })).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });

    const result = await mutateRoom({ type: 'close-room', discardRoundId });
    if (!result.ok) throw new Error(result.message);
    const summary = {
      id,
      version: result.room.version,
      closed: true,
      canDelete: false,
      stories: [
        { title: 'Save checkout', status: 'estimated', acceptedEstimate: '5' },
        { title: 'Recover a cart', status: 'pending' },
      ],
    };
    expect(result.room).toEqual({ ...summary, canDelete: true });
    const finalFrame = await nextJson(reader);
    expect(JSON.parse(finalFrame)).toEqual({ type: 'room:snapshot', room: summary });
    expect(parsePokerLiveMessage(finalFrame)).toEqual({ type: 'room:snapshot', room: summary });
    expect(await reader.read()).toMatchObject({ done: true });
    expect((await inRequest(() => service.readPokerRoomForRequest(id), undefined, 'GET')).result).toEqual(summary);
    expect(await mutate({ type: 'join', displayName: 'Late Participant' }, '')).toMatchObject({ ok: false, code: 'ROOM_CLOSED' });
    expect(await mutate({ type: 'add-story', title: 'Too late' })).toMatchObject({ ok: false, code: 'ROOM_CLOSED' });
    expect(await mutateRoom({ type: 'close-room' })).toEqual({ ok: true, room: result.room });

    const reconnect = (await connect()).body!.getReader();
    expect(JSON.parse(await nextJson(reconnect))).toEqual({ type: 'room:snapshot', room: summary });
    expect(await reconnect.read()).toMatchObject({ done: true });
  } finally {
    await reader.cancel();
  }
});
