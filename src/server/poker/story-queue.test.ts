import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

import { submitPokerRoomJoin } from '../../lib/poker-actions';
import { parsePokerLiveMessage } from '../../lib/poker-schemas';
import { runWithCloudflareEnv } from '../adapters/cloudflare-context';
import { readSseStream } from '../live/sse-test-helper';
import { checkBoardCreateRateLimit } from '../rate-limit';

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

  const stream = readSseStream(
    await service.handlePokerLiveRequest(id, new Request(`${origin}/api/poker/${id}/live`, {
      headers: { cookie: participant },
    })),
    parsePokerLiveMessage,
  );

  try {
    expect(await stream.next()).toMatchObject({ type: 'room:snapshot', room: { stories: [] } });
    expect(await stream.next()).toMatchObject({ type: 'room:presence' });

    expect(await mutate({ type: 'add-story', title: '  Save checkout progress  ' })).toMatchObject({
      ok: true,
      room: { stories: [{ title: 'Save checkout progress', status: 'pending' }], activeStoryId: null },
    });
    expect(await stream.next()).toMatchObject({
      type: 'room:snapshot',
      room: {
        viewer: { displayName: 'Sam', isFacilitator: false },
        stories: [{ title: 'Save checkout progress', status: 'pending' }],
        activeStoryId: null,
      },
    });
  } finally {
    await stream.close();
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
    const stream = readSseStream(
      await service.handlePokerLiveRequest(id, new Request(`${origin}/api/poker/${id}/live`, {
        headers: { cookie },
      })),
      parsePokerLiveMessage,
    );
    return {
      cancel: () => stream.close(),
      async snapshot() {
        for (;;) {
          const json = await stream.nextRaw();
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

  expect(await mutate({ type: 'edit-story', storyId: checkout.id, title: 'Save checkout' }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  const edited = await mutate({ type: 'edit-story', storyId: checkout.id, title: 'Save checkout', discardRoundId: roundId });
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

  const stream = readSseStream(
    await service.handlePokerLiveRequest(id, new Request(`${origin}/api/poker/${id}/live`, {
      headers: { cookie: participant },
    })),
    parsePokerLiveMessage,
  );
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
    const snapshot = await stream.until(
      'room:snapshot',
      (frame) => !frame.room.closed && frame.room.round?.phase === 'accepted',
    );
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
    await stream.close();
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
  const stream = readSseStream(
    await service.handlePokerLiveRequest(id, new Request(`${origin}/api/poker/${id}/live`, {
      headers: { cookie: participant },
    })),
    parsePokerLiveMessage,
  );

  try {
    expect(await stream.next()).toMatchObject({
      type: 'room:snapshot', room: { deckType: 'fibonacci' },
    });
    expect(await stream.next()).toMatchObject({ type: 'room:presence' });
    expect(await mutate({ type: 'set-deck', deck: { type: 't-shirt' } }, participant)).toMatchObject({
      ok: false, code: 'FORBIDDEN',
    });
    expect(await mutate({ type: 'set-deck', deck: { type: 't-shirt' } })).toMatchObject({
      ok: true, room: { deckType: 't-shirt', deck: ['XS', 'S', 'M', 'L', 'XL'] },
    });
    expect(await stream.next()).toMatchObject({
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
    expect(await stream.next()).toMatchObject({ type: 'room:snapshot', room: { deckType: 'custom', deck } });
    expect(await read(participant)).toMatchObject({ deckType: 'custom', deck });
  } finally {
    await stream.close();
  }
});

test('a Facilitator can change the Deck at any time, confirming to restart active rounds with votes while keeping Accepted Estimates', async () => {
  const { participant, mutate, read } = await openRoom();
  const firstStory = await mutate({ type: 'add-story', title: 'Checkout' });
  if (!firstStory.ok) throw new Error('Could not add first Story.');
  const secondStory = await mutate({ type: 'add-story', title: 'Receipt' });
  if (!secondStory.ok) throw new Error('Could not add second Story.');
  const firstStoryId = secondStory.room.stories[0].id;
  const secondStoryId = secondStory.room.stories[1].id;

  const opened = await mutate({ type: 'select-story', storyId: firstStoryId });
  expect(opened).toMatchObject({
    ok: true,
    room: { deckType: 'fibonacci', deck: ['0', '1', '2', '3', '5', '8', '13', '21'] },
  });
  if (!opened.ok || !opened.room.round) throw new Error('Could not open Voting Round.');
  const roundId = opened.room.round.id;

  // Changing Deck during an open round with no votes updates immediately without restarting.
  expect(await mutate({ type: 'set-deck', deck: { type: 'custom', choices: ['Review', 0] } })).toMatchObject({
    ok: true,
    room: { deckType: 'custom', deck: ['Review', '0'], round: { id: roundId, phase: 'open' } },
  });
  expect(await read(participant)).toMatchObject({ deck: ['Review', '0'] });

  // Once a vote is cast, changing Deck requires discardRoundId and restarts voting with empty ballots.
  expect(await mutate({ type: 'vote', roundId, choice: '  Review ' }, participant)).toMatchObject({
    ok: true,
    room: { round: { ownChoice: 'Review' } },
  });
  expect(await mutate({ type: 'set-deck', deck: { type: 'fibonacci' } })).toMatchObject({
    ok: false,
    code: 'ROUND_CHANGED',
    message: 'Confirm that you want to restart the current Voting Round before changing the Deck.',
  });
  // Saving the same Deck is a no-op and does not require confirmation or restart the round.
  expect(await mutate({ type: 'set-deck', deck: { type: 'custom', choices: ['Review', '0'] } })).toMatchObject({
    ok: true,
    room: { deckType: 'custom', deck: ['Review', '0'], round: { id: roundId, phase: 'open' } },
  });
  expect(await read(participant)).toMatchObject({ deck: ['Review', '0'], round: { ownChoice: 'Review' } });

  const restarted = await mutate({
    type: 'set-deck',
    deck: { type: 'fibonacci' },
    discardRoundId: roundId,
  });
  expect(restarted).toMatchObject({
    ok: true,
    room: {
      deckType: 'fibonacci',
      deck: ['0', '1', '2', '3', '5', '8', '13', '21'],
      round: { phase: 'open', submittedParticipantIds: [], ownChoice: null },
    },
  });
  if (!restarted.ok || !restarted.room.round) throw new Error('Expected restarted Voting Round.');
  expect(restarted.room.round.id).not.toBe(roundId);
  const secondRoundId = restarted.room.round.id;

  expect(await mutate({
    type: 'set-deck',
    deck: { type: 't-shirt' },
    discardRoundId: roundId,
  })).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await read(participant)).toMatchObject({
    deckType: 'fibonacci',
    round: { id: secondRoundId, phase: 'open', submittedParticipantIds: [] },
  });

  // Vote, reveal, and confirm an Accepted Estimate under Fibonacci.
  expect(await mutate({ type: 'vote', roundId: secondRoundId, choice: '5' }, participant)).toMatchObject({
    ok: true, room: { round: { ownChoice: '5' } },
  });
  expect(await mutate({ type: 'reveal', roundId: secondRoundId })).toMatchObject({
    ok: true, room: { round: { phase: 'revealed', ballots: [{ choice: '5' }] } },
  });

  // Changing Deck while revealed (unresolved with votes) also requires discardRoundId.
  expect(await mutate({ type: 'set-deck', deck: { type: 't-shirt' } })).toMatchObject({
    ok: false,
    code: 'ROUND_CHANGED',
  });

  // Confirming the estimate resolves the round; changing Deck afterward succeeds without confirmation
  // and preserves the existing Accepted Estimate.
  expect(await mutate({ type: 'confirm-estimate', roundId: secondRoundId, choice: '5' })).toMatchObject({
    ok: true,
    room: { stories: [{ id: firstStoryId, status: 'estimated', acceptedEstimate: '5' }, { id: secondStoryId }] },
  });
  expect(await mutate({ type: 'set-deck', deck: { type: 't-shirt' } })).toMatchObject({
    ok: true,
    room: {
      deckType: 't-shirt',
      deck: ['XS', 'S', 'M', 'L', 'XL'],
      stories: [{ id: firstStoryId, status: 'estimated', acceptedEstimate: '5' }, { id: secondStoryId }],
    },
  });

  // Correcting an earlier Story's Accepted Estimate validates against the new Deck.
  expect(await mutate({ type: 'correct-estimate', storyId: firstStoryId, expectedEstimate: '5', choice: '8' })).toMatchObject({
    ok: false, code: 'INVALID_INPUT',
  });
  expect(await mutate({ type: 'correct-estimate', storyId: firstStoryId, expectedEstimate: '5', choice: 'M' })).toMatchObject({
    ok: true,
    room: { stories: [{ id: firstStoryId, status: 'estimated', acceptedEstimate: 'M' }, { id: secondStoryId }] },
  });

  // Selecting the next Story uses the new Deck.
  const nextStory = await mutate({ type: 'select-story', storyId: secondStoryId });
  expect(nextStory).toMatchObject({ ok: true, room: { deckType: 't-shirt', deck: ['XS', 'S', 'M', 'L', 'XL'] } });
  if (!nextStory.ok || !nextStory.room.round) throw new Error('Could not select second Story.');
  expect(await mutate({ type: 'vote', roundId: nextStory.room.round.id, choice: '5' }, participant)).toMatchObject({
    ok: false, code: 'INVALID_INPUT',
  });
  expect(await mutate({ type: 'vote', roundId: nextStory.room.round.id, choice: 'L' }, participant)).toMatchObject({
    ok: true, room: { round: { ownChoice: 'L' } },
  });
});

test('a Deck save racing the first cast vote requires confirmation if the vote lands first', async () => {
  const { participant, mutate, read } = await openRoom();
  const added = await mutate({ type: 'add-story', title: 'Checkout' });
  if (!added.ok) throw new Error('Could not add Story.');
  const opened = await mutate({ type: 'select-story', storyId: added.room.stories[0].id });
  if (!opened.ok || !opened.room.round) throw new Error('Could not open Voting Round.');
  const roundId = opened.room.round.id;

  const [voted, changed] = await Promise.all([
    mutate({ type: 'vote', roundId, choice: '5' }, participant),
    mutate({ type: 'set-deck', deck: { type: 't-shirt' } }),
  ]);
  if (voted.ok) {
    expect(changed).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
    expect(await read(participant)).toMatchObject({
      deck: ['0', '1', '2', '3', '5', '8', '13', '21'],
    });
  } else {
    expect(voted.code).toBe('INVALID_INPUT');
    expect(changed).toMatchObject({ ok: true, room: { deck: ['XS', 'S', 'M', 'L', 'XL'] } });
  }
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
  expect(await mutateRoom({ type: 'close-room' })).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutateRoom({ type: 'close-room', discardRoundId: roundId }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  await mutate({ type: 'vote', roundId: discardRoundId, choice: '13' }, participant);
  await mutate({ type: 'reveal', roundId: discardRoundId });
  await mutate({ type: 'add-story', title: 'Recover a cart' });

  const connect = async () =>
    readSseStream(
      await service.handlePokerLiveRequest(id, new Request(`${origin}/api/poker/${id}/live`, {
        headers: { cookie: participant },
      })),
      parsePokerLiveMessage,
    );
  const stream = await connect();

  try {
    expect(await stream.next()).toMatchObject({ room: { round: { phase: 'revealed' } } });
    expect(await stream.next()).toMatchObject({ type: 'room:presence' });
    expect(await mutateRoom({ type: 'close-room', discardRoundId }, participant)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await mutateRoom({ type: 'close-room' })).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
    expect(await mutateRoom({ type: 'close-room', discardRoundId: roundId })).toMatchObject({ ok: false, code: 'ROUND_CHANGED' });

    const result = await mutateRoom({ type: 'close-room', discardRoundId });
    if (!result.ok) throw new Error(result.message);
    const summary = {
      id,
      name: 'Poker Room',
      version: result.room.version,
      closed: true,
      canDelete: false,
      stories: [
        { title: 'Save checkout', status: 'estimated', acceptedEstimate: '5' },
        { title: 'Recover a cart', status: 'pending' },
      ],
    };
    expect(result.room).toEqual({ ...summary, canDelete: true });
    const finalFrame = await stream.nextRaw();
    expect(JSON.parse(finalFrame)).toEqual({ type: 'room:snapshot', room: summary });
    expect(parsePokerLiveMessage(finalFrame)).toEqual({ type: 'room:snapshot', room: summary });
    await stream.expectClosed();
    expect((await inRequest(() => service.readPokerRoomForRequest(id), undefined, 'GET')).result).toEqual(summary);
    expect(await mutate({ type: 'join', displayName: 'Late Participant' }, '')).toMatchObject({ ok: false, code: 'ROOM_CLOSED' });
    expect(await mutate({ type: 'add-story', title: 'Too late' })).toMatchObject({ ok: false, code: 'ROOM_CLOSED' });
    expect(await mutateRoom({ type: 'close-room' })).toEqual({ ok: true, room: result.room });

    const reconnect = await connect();
    expect(await reconnect.next()).toEqual({ type: 'room:snapshot', room: summary });
    await reconnect.expectClosed();
  } finally {
    await stream.close();
  }
});

test('editing a revealed Story resets its unresolved round and preserves its last Accepted Estimate', async () => {
  const { participant, mutate, read } = await openRoom();
  const added = await mutate({ type: 'add-story', title: 'Checkout' });
  if (!added.ok) throw new Error(added.message);
  const storyId = added.room.stories[0].id;
  const selected = await mutate({ type: 'select-story', storyId });
  if (!selected.ok || !selected.room.round) throw new Error('Could not open Voting Round.');
  const firstRoundId = selected.room.round.id;
  await mutate({ type: 'vote', roundId: firstRoundId, choice: '5' }, participant);
  await mutate({ type: 'reveal', roundId: firstRoundId });
  expect(await mutate({ type: 'confirm-estimate', roundId: firstRoundId, choice: '5' })).toMatchObject({ ok: true });

  expect(await mutate({ type: 'edit-story', storyId, title: 'Save checkout' })).toMatchObject({
    ok: true, room: {
      round: { id: firstRoundId, phase: 'accepted' },
      stories: [{ title: 'Save checkout', acceptedEstimate: '5' }],
    },
  });
  const restarted = await mutate({ type: 'restart-round', roundId: firstRoundId });
  if (!restarted.ok || !restarted.room.round) throw new Error('Could not start another Voting Round.');
  const revealedRoundId = restarted.room.round.id;
  await mutate({ type: 'vote', roundId: revealedRoundId, choice: '8' }, participant);
  expect(await mutate({ type: 'reveal', roundId: revealedRoundId })).toMatchObject({ ok: true });

  expect(await mutate({ type: 'edit-story', storyId, title: 'Restore checkout' }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ type: 'edit-story', storyId, title: 'Restore checkout', discardRoundId: revealedRoundId }))
    .toMatchObject({ ok: true });
  const updated = await read(participant);
  expect(updated).toMatchObject({
    activeStoryId: storyId,
    stories: [{ title: 'Restore checkout', status: 'estimated', acceptedEstimate: '5' }],
    round: { phase: 'open', ownChoice: null, submittedParticipantIds: [] },
  });
  expect(updated && !updated.closed && updated.round?.id).not.toBe(revealedRoundId);
  expect(await mutate({ type: 'confirm-estimate', roundId: revealedRoundId, choice: '8' }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
});

test('submitting a Display Name after a Room closes redirects its participant link to the summary', async () => {
  const { id, mutateRoom } = await openRoom();
  expect((await inRequest(() => service.readPokerRoomForRequest(id), undefined, 'GET')).result)
    .toMatchObject({ closed: false, viewer: null });
  expect(await mutateRoom({ type: 'close-room' })).toMatchObject({ ok: true, room: { closed: true } });
  const form = new FormData();
  form.set('displayName', 'Jo');

  const { result } = await inRequest(() => submitPokerRoomJoin(id, form));
  expect(result).toBeInstanceOf(Response);
  if (!(result instanceof Response)) throw new Error('Expected a redirect response.');
  expect(result.status).toBe(302);
  expect(result.headers.get('location')).toBe(`/p/${id}`);
  expect((await inRequest(() => service.readPokerRoomForRequest(id), undefined, 'GET')).result)
    .toMatchObject({ closed: true, canDelete: false });
});

test.each(['Node', 'Cloudflare'])('Board and Poker creation have independent budgets on %s', async (runtime) => {
  const address = runtime === 'Node' ? '198.51.100.60' : '198.51.100.61';
  const request = new Request(origin, { headers: { 'cf-connecting-ip': address } });
  const buckets = new Map<string, number>();

  async function exerciseBudgets() {
    for (let count = 0; count < 10; count++) {
      expect(await checkBoardCreateRateLimit(request)).toEqual({ allowed: true });
    }
    expect(await checkBoardCreateRateLimit(request)).toEqual({ allowed: false });
    if (runtime === 'Cloudflare') {
      expect([...buckets.keys()]).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
    }

    for (let count = 0; count < 10; count++) {
      const { result } = await inRequest(
        () => service.createPokerRoomForRequest('Alex'), undefined, 'POST', address,
      );
      expect(result.ok).toBe(true);
    }
    const { result } = await inRequest(
      () => service.createPokerRoomForRequest('Alex'), undefined, 'POST', address,
    );
    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(await checkBoardCreateRateLimit(request)).toEqual({ allowed: false });
  }

  if (runtime === 'Node') {
    await exerciseBudgets();
  } else {
    const env = {
      BOARD_CREATE_LIMITER: {
        async limit({ key }: { key: string }) {
          const count = (buckets.get(key) ?? 0) + 1;
          buckets.set(key, count);
          return { success: count <= 10 };
        },
      },
    };
    await runWithCloudflareEnv(env as Cloudflare.Env, exerciseBudgets);
  }
});

test('a Facilitator can lock and unlock Stories across pending, estimated, and skipped states while blocking edits and selection', async () => {
  const { participant, mutate, read } = await openRoom();
  await mutate({ type: 'add-story', title: 'Pending story' });
  await mutate({ type: 'add-story', title: 'Estimated story' });
  const added = await mutate({ type: 'add-story', title: 'Skipped story' });
  if (!added.ok) throw new Error('Could not add Stories.');
  const [pendingStory, estimatedStory, skippedStory] = added.room.stories;

  const selEst = await mutate({ type: 'select-story', storyId: estimatedStory.id });
  if (!selEst.ok || !selEst.room.round) throw new Error('Could not select estimated Story.');
  await mutate({ type: 'vote', roundId: selEst.room.round.id, choice: '5' }, participant);
  await mutate({ type: 'reveal', roundId: selEst.room.round.id });
  await mutate({ type: 'confirm-estimate', roundId: selEst.room.round.id, choice: '5' });

  const selSkip = await mutate({ type: 'select-story', storyId: skippedStory.id });
  if (!selSkip.ok || !selSkip.room.round) throw new Error('Could not select skipped Story.');
  await mutate({ type: 'vote', roundId: selSkip.room.round.id, choice: '3' }, participant);
  await mutate({ type: 'reveal', roundId: selSkip.room.round.id });
  await mutate({ type: 'skip-story', roundId: selSkip.room.round.id });

  expect(await mutate({ type: 'set-story-lock', storyId: pendingStory.id, locked: true }, participant))
    .toMatchObject({ ok: false, code: 'FORBIDDEN' });

  expect(await mutate({ type: 'set-story-lock', storyId: pendingStory.id, locked: true })).toMatchObject({
    ok: true,
    room: { stories: [{ id: pendingStory.id, status: 'pending', locked: true }, { id: estimatedStory.id }, { id: skippedStory.id }] },
  });
  expect(await mutate({ type: 'set-story-lock', storyId: estimatedStory.id, locked: true })).toMatchObject({
    ok: true,
    room: {
      stories: [
        { id: pendingStory.id, status: 'pending', locked: true },
        { id: estimatedStory.id, status: 'estimated', acceptedEstimate: '5', locked: true },
        { id: skippedStory.id },
      ],
    },
  });
  expect(await mutate({ type: 'set-story-lock', storyId: skippedStory.id, locked: true })).toMatchObject({
    ok: true,
    room: {
      stories: [
        { id: pendingStory.id, status: 'pending', locked: true },
        { id: estimatedStory.id, status: 'estimated', acceptedEstimate: '5', locked: true },
        { id: skippedStory.id, status: 'skipped', locked: true },
      ],
    },
  });

  expect(await mutate({ type: 'select-story', storyId: pendingStory.id })).toMatchObject({ ok: false, code: 'STORY_LOCKED' });
  expect(await mutate({ type: 'select-story', storyId: estimatedStory.id })).toMatchObject({ ok: false, code: 'STORY_LOCKED' });
  expect(await mutate({ type: 'edit-story', storyId: pendingStory.id, title: 'Edited' })).toMatchObject({ ok: false, code: 'STORY_LOCKED' });
  expect(await mutate({ type: 'correct-estimate', storyId: estimatedStory.id, expectedEstimate: '5', choice: '8' }))
    .toMatchObject({ ok: false, code: 'STORY_LOCKED' });
  expect(await mutate({ type: 'return-story', storyId: skippedStory.id })).toMatchObject({ ok: false, code: 'STORY_LOCKED' });

  expect(await mutate({ type: 'move-story', storyId: skippedStory.id, targetId: pendingStory.id, placement: 'before' }))
    .toMatchObject({ ok: true });

  expect(await read(participant)).toMatchObject({
    stories: [
      { id: skippedStory.id, status: 'skipped', locked: true },
      { id: pendingStory.id, status: 'pending', locked: true },
      { id: estimatedStory.id, status: 'estimated', acceptedEstimate: '5', locked: true },
    ],
  });

  expect(await mutate({ type: 'set-story-lock', storyId: estimatedStory.id, locked: false })).toMatchObject({
    ok: true,
    room: {
      stories: [
        { id: skippedStory.id, locked: true },
        { id: pendingStory.id, locked: true },
        { id: estimatedStory.id, status: 'estimated', acceptedEstimate: '5', locked: false },
      ],
    },
  });
  expect(await mutate({ type: 'correct-estimate', storyId: estimatedStory.id, expectedEstimate: '5', choice: '8' }))
    .toMatchObject({ ok: true, room: { stories: [{}, {}, { id: estimatedStory.id, acceptedEstimate: '8' }] } });
  expect(await mutate({ type: 'edit-story', storyId: estimatedStory.id, title: 'Updated estimated' }))
    .toMatchObject({ ok: true });
  expect(await mutate({ type: 'select-story', storyId: estimatedStory.id })).toMatchObject({ ok: true });
});

test('locking the active Story requires discard confirmation only when an unresolved Voting Round has cast votes, then clears the stage', async () => {
  const { participant, mutate } = await openRoom();
  const added = await mutate({ type: 'add-story', title: 'Checkout flow' });
  if (!added.ok) throw new Error('Could not add Story.');
  const [story] = added.room.stories;

  const openEmpty = await mutate({ type: 'select-story', storyId: story.id });
  if (!openEmpty.ok || !openEmpty.room.round) throw new Error('Could not open round.');
  expect(await mutate({ type: 'set-story-lock', storyId: story.id, locked: true })).toMatchObject({
    ok: true,
    room: {
      activeStoryId: null,
      round: null,
      stories: [{ id: story.id, status: 'pending', locked: true }],
    },
  });

  await mutate({ type: 'set-story-lock', storyId: story.id, locked: false });
  const openVoted = await mutate({ type: 'select-story', storyId: story.id });
  if (!openVoted.ok || !openVoted.room.round) throw new Error('Could not reopen round.');
  const votedRoundId = openVoted.room.round.id;
  await mutate({ type: 'vote', roundId: votedRoundId, choice: '5' }, participant);

  expect(await mutate({ type: 'set-story-lock', storyId: story.id, locked: true }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ type: 'set-story-lock', storyId: story.id, locked: true, discardRoundId: openEmpty.room.round.id }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ type: 'set-story-lock', storyId: story.id, locked: true, discardRoundId: votedRoundId })).toMatchObject({
    ok: true,
    room: {
      activeStoryId: null,
      round: null,
      stories: [{ id: story.id, status: 'pending', locked: true }],
    },
  });

  await mutate({ type: 'set-story-lock', storyId: story.id, locked: false });
  const forAccept = await mutate({ type: 'select-story', storyId: story.id });
  if (!forAccept.ok || !forAccept.room.round) throw new Error('Could not start round.');
  await mutate({ type: 'vote', roundId: forAccept.room.round.id, choice: '8' }, participant);
  await mutate({ type: 'reveal', roundId: forAccept.room.round.id });
  await mutate({ type: 'confirm-estimate', roundId: forAccept.room.round.id, choice: '8' });

  expect(await mutate({ type: 'set-story-lock', storyId: story.id, locked: true })).toMatchObject({
    ok: true,
    room: {
      activeStoryId: null,
      round: null,
      stories: [{ id: story.id, status: 'estimated', acceptedEstimate: '8', locked: true }],
    },
  });
});

test('a Facilitator can delete unlocked pending, estimated, and skipped Stories, while Locked Stories reject until unlocked', async () => {
  const { participant, mutate, read } = await openRoom();

  await mutate({ type: 'add-story', title: 'Pending Story' });
  await mutate({ type: 'add-story', title: 'Estimated Story' });
  const added = await mutate({ type: 'add-story', title: 'Skipped Story' });
  if (!added.ok) throw new Error('Could not add Stories.');
  const [pendingStory, estimatedStory, skippedStory] = added.room.stories;

  const selectEst = await mutate({ type: 'select-story', storyId: estimatedStory.id });
  if (!selectEst.ok || !selectEst.room.round) throw new Error('Could not select Story.');
  await mutate({ type: 'vote', roundId: selectEst.room.round.id, choice: '5' }, participant);
  await mutate({ type: 'reveal', roundId: selectEst.room.round.id });
  await mutate({ type: 'confirm-estimate', roundId: selectEst.room.round.id, choice: '5' });

  const selectSkip = await mutate({ type: 'select-story', storyId: skippedStory.id });
  if (!selectSkip.ok || !selectSkip.room.round) throw new Error('Could not select skipped Story.');
  await mutate({ type: 'vote', roundId: selectSkip.room.round.id, choice: '3' }, participant);
  await mutate({ type: 'reveal', roundId: selectSkip.room.round.id });
  await mutate({ type: 'skip-story', roundId: selectSkip.room.round.id });

  expect(await mutate({ type: 'delete-story', storyId: pendingStory.id }, participant))
    .toMatchObject({ ok: false, code: 'FORBIDDEN' });

  await mutate({ type: 'set-story-lock', storyId: estimatedStory.id, locked: true });
  expect(await mutate({ type: 'delete-story', storyId: estimatedStory.id }))
    .toMatchObject({ ok: false, code: 'STORY_LOCKED' });

  expect(await mutate({ type: 'delete-story', storyId: pendingStory.id })).toMatchObject({
    ok: true,
    room: {
      stories: [
        { id: estimatedStory.id, status: 'estimated', acceptedEstimate: '5', locked: true },
        { id: skippedStory.id, status: 'skipped' },
      ],
    },
  });
  expect(await mutate({ type: 'delete-story', storyId: skippedStory.id })).toMatchObject({
    ok: true,
    room: {
      stories: [{ id: estimatedStory.id, status: 'estimated', acceptedEstimate: '5', locked: true }],
    },
  });

  await mutate({ type: 'set-story-lock', storyId: estimatedStory.id, locked: false });
  expect(await mutate({ type: 'delete-story', storyId: estimatedStory.id })).toMatchObject({
    ok: true,
    room: { stories: [] },
  });

  expect(await mutate({ type: 'delete-story', storyId: estimatedStory.id }))
    .toMatchObject({ ok: false, code: 'INVALID_INPUT' });

  expect(await read(participant)).toMatchObject({ stories: [] });
});

test('deleting the active Story clears the stage and requires discardRoundId only when unresolved votes exist', async () => {
  const { participant, mutate } = await openRoom();
  await mutate({ type: 'add-story', title: 'First active' });
  await mutate({ type: 'add-story', title: 'Second active' });
  const added = await mutate({ type: 'add-story', title: 'Third active' });
  if (!added.ok) throw new Error('Could not add Stories.');
  const [first, second, third] = added.room.stories;

  const openEmpty = await mutate({ type: 'select-story', storyId: first.id });
  if (!openEmpty.ok || !openEmpty.room.round) throw new Error('Could not select first Story.');
  expect(await mutate({ type: 'delete-story', storyId: first.id })).toMatchObject({
    ok: true,
    room: {
      activeStoryId: null,
      round: null,
      stories: [{ id: second.id }, { id: third.id }],
    },
  });

  const openVoted = await mutate({ type: 'select-story', storyId: second.id });
  if (!openVoted.ok || !openVoted.room.round) throw new Error('Could not select second Story.');
  const votedRoundId = openVoted.room.round.id;
  await mutate({ type: 'vote', roundId: votedRoundId, choice: '5' }, participant);

  expect(await mutate({ type: 'delete-story', storyId: second.id }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ type: 'delete-story', storyId: second.id, discardRoundId: openEmpty.room.round.id }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ type: 'delete-story', storyId: second.id, discardRoundId: votedRoundId })).toMatchObject({
    ok: true,
    room: {
      activeStoryId: null,
      round: null,
      stories: [{ id: third.id }],
    },
  });

  const forAccept = await mutate({ type: 'select-story', storyId: third.id });
  if (!forAccept.ok || !forAccept.room.round) throw new Error('Could not select third Story.');
  await mutate({ type: 'vote', roundId: forAccept.room.round.id, choice: '8' }, participant);
  await mutate({ type: 'reveal', roundId: forAccept.room.round.id });
  await mutate({ type: 'confirm-estimate', roundId: forAccept.room.round.id, choice: '8' });

  expect(await mutate({ type: 'delete-story', storyId: third.id })).toMatchObject({
    ok: true,
    room: {
      activeStoryId: null,
      round: null,
      stories: [],
    },
  });
});

test('add-story supports queueing and atomic makeActive with previous Story locking and vote discard checks', async () => {
  const { participant, mutate } = await openRoom();

  const first = await mutate({ type: 'add-story', title: 'Checkout flow', makeActive: true });
  if (!first.ok) throw new Error('Could not add and activate first Story.');
  expect(first.room.stories).toHaveLength(1);
  const firstStory = first.room.stories[0];
  expect(first.room.activeStoryId).toBe(firstStory.id);
  expect(first.room.round).toMatchObject({ phase: 'open', submittedParticipantIds: [] });

  const queued = await mutate({ type: 'add-story', title: 'Queued Story' });
  if (!queued.ok) throw new Error('Could not queue Story.');
  expect(queued.room.stories).toHaveLength(2);
  expect(queued.room.stories[1]).toMatchObject({ title: 'Queued Story', status: 'pending', locked: false });
  expect(queued.room.activeStoryId).toBe(firstStory.id);
  expect(queued.room.round?.id).toBe(first.room.round?.id);
  expect(queued.room.stories[0].locked).toBe(false);

  const second = await mutate({ type: 'add-story', title: 'Zero-vote replacement', makeActive: true });
  if (!second.ok) throw new Error('Could not replace zero-vote active Story.');
  const secondStory = second.room.stories[2];
  expect(second.room.activeStoryId).toBe(secondStory.id);
  expect(second.room.round?.phase).toBe('open');
  expect(second.room.round?.id).not.toBe(first.room.round?.id);
  expect(second.room.stories[0]).toMatchObject({ id: firstStory.id, status: 'pending', locked: true });
  expect(second.room.stories[2]).toMatchObject({ id: secondStory.id, status: 'pending', locked: false });

  const votedRoundId = second.room.round!.id;
  await mutate({ type: 'vote', roundId: votedRoundId, choice: '5' }, participant);
  expect(await mutate({ type: 'add-story', title: 'Blocked while voted', makeActive: true }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ type: 'add-story', title: 'Blocked stale round', makeActive: true, discardRoundId: first.room.round!.id }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });

  const third = await mutate({ type: 'add-story', title: 'Confirmed replacement', makeActive: true, discardRoundId: votedRoundId });
  if (!third.ok) throw new Error('Could not replace voted Story with matching discardRoundId.');
  const thirdStory = third.room.stories[3];
  expect(third.room.activeStoryId).toBe(thirdStory.id);
  expect(third.room.round).toMatchObject({ phase: 'open', submittedParticipantIds: [] });
  expect(third.room.stories[2]).toMatchObject({ id: secondStory.id, status: 'pending', locked: true });
  expect(third.room.stories[3]).toMatchObject({ id: thirdStory.id, status: 'pending', locked: false });

  const revealedRoundId = third.room.round!.id;
  await mutate({ type: 'vote', roundId: revealedRoundId, choice: '8' }, participant);
  await mutate({ type: 'reveal', roundId: revealedRoundId });
  expect(await mutate({ type: 'add-story', title: 'Blocked while revealed', makeActive: true }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });

  await mutate({ type: 'confirm-estimate', roundId: revealedRoundId, choice: '8' });
  const fourth = await mutate({ type: 'add-story', title: 'After accepted estimate', makeActive: true });
  if (!fourth.ok) throw new Error('Could not add and activate Story after accepted estimate.');
  const fourthStory = fourth.room.stories[4];
  expect(fourth.room.activeStoryId).toBe(fourthStory.id);
  expect(fourth.room.round).toMatchObject({ phase: 'open', submittedParticipantIds: [] });
  expect(fourth.room.stories[3]).toMatchObject({
    id: thirdStory.id,
    status: 'estimated',
    acceptedEstimate: '8',
    locked: true,
  });
  expect(fourth.room.stories[4]).toMatchObject({ id: fourthStory.id, status: 'pending', locked: false });
});

test('edit-story requires matching discardRoundId when editing the active Story with cast votes', async () => {
  const { participant, mutate } = await openRoom();
  await mutate({ type: 'add-story', title: 'Checkout flow' });
  const added = await mutate({ type: 'add-story', title: 'Receipt email' });
  if (!added.ok) throw new Error('Could not add Stories.');
  const [checkout, receipt] = added.room.stories;

  const opened = await mutate({ type: 'select-story', storyId: checkout.id });
  if (!opened.ok || !opened.room.round) throw new Error('Could not open round.');
  const emptyRoundId = opened.room.round.id;

  const editedEmpty = await mutate({ type: 'edit-story', storyId: checkout.id, title: 'Checkout v2' });
  if (!editedEmpty.ok || !editedEmpty.room.round) throw new Error('Could not edit zero-vote active Story.');
  const votedRoundId = editedEmpty.room.round.id;
  expect(votedRoundId).not.toBe(emptyRoundId);

  await mutate({ type: 'vote', roundId: votedRoundId, choice: '5' }, participant);

  expect(await mutate({ type: 'edit-story', storyId: checkout.id, title: 'Checkout v2' })).toMatchObject({
    ok: true,
    room: { round: { id: votedRoundId, submittedParticipantIds: [expect.any(String)] } },
  });
  expect(await mutate({ type: 'edit-story', storyId: checkout.id, title: 'Checkout v3' }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ type: 'edit-story', storyId: checkout.id, title: 'Checkout v3', discardRoundId: emptyRoundId }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });
  expect(await mutate({ type: 'edit-story', storyId: receipt.id, title: 'Receipt v2', discardRoundId: votedRoundId }))
    .toMatchObject({ ok: false, code: 'ROUND_CHANGED' });

  const editedVoted = await mutate({
    type: 'edit-story',
    storyId: checkout.id,
    title: 'Checkout v3',
    discardRoundId: votedRoundId,
  });
  if (!editedVoted.ok || !editedVoted.room.round) throw new Error('Could not edit active Story with discardRoundId.');
  expect(editedVoted.room.stories[0]?.title).toBe('Checkout v3');
  expect(editedVoted.room.round).toMatchObject({ phase: 'open', submittedParticipantIds: [] });
  expect(editedVoted.room.round.id).not.toBe(votedRoundId);
});
