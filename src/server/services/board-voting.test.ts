import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

async function setup(options: Record<string, unknown> = {}) {
  const boardService = await import('./board-service');
  const origin = 'https://retrocks.app';
  const created = await request(origin, {}, () => boardService.createBoardForRequest(options));
  const board = created.result;
  const boardUrl = `${origin}/b/${board.id}`;
  const facilitator = created.cookie;
  if (!facilitator) throw new Error('Expected a Facilitator session');
  const read = (cookie?: string) => request(boardUrl, { cookie, method: 'GET' }, () =>
    boardService.getBoardForRequest(board.id));
  const participant = (await read()).cookie;
  if (!participant) throw new Error('Expected a Participant session');
  const dispatch = (command: unknown, cookie?: string) =>
    request(boardUrl, { cookie }, () =>
      boardService.dispatchBoardCommandForRequest(board.id, command));
  async function createCard(content: string, cookie = facilitator) {
    const { result } = await dispatch(
      { type: 'card:create', columnId: board.columns[0].id, content },
      cookie,
    );
    const event = result.events[0];
    if (event.type !== 'card:upserted') throw new Error('Expected a new Card');
    return event.card.id;
  }
  const vote = (targetId: string, delta: 1 | -1, cookie = participant) =>
    dispatch({ type: 'vote:change', targetType: 'card', targetId, delta }, cookie);

  const settings = (patch: Record<string, unknown>, cookie = facilitator) =>
    dispatch({ type: 'voting:configure', ...patch }, cookie);

  return { board, boardUrl, facilitator, participant, read, dispatch, createCard, vote, settings };
}

async function request<T>(
  url: string,
  options: { method?: 'GET' | 'POST'; cookie?: string },
  run: () => Promise<T>,
) {
  const req = new Request(url, {
    method: options.method ?? 'POST',
    headers: options.cookie ? { cookie: options.cookie } : {},
  });
  const event = createRequestEvent(req);
  return provideRequestEvent(event, async () => {
    const result = await run();
    const response = commitEventResponse(new Response(), event);
    const cookie = response.headers.getSetCookie().at(-1)?.split(';')[0];
    return { result, cookie };
  });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-voting-session-secret-with-at-least-32-chars');
});

afterEach(() => vi.unstubAllEnvs());

it('stacks Votes, enforces the Board budget per Participant, and refunds a removed Vote', async () => {
  const { board, facilitator, vote, read, createCard } = await setup({ voteLimit: 3 });
  const card = await createCard('Checkout performance');
  const otherCard = await createCard('Deployment feedback');

  await vote(card, 1);
  await vote(card, 1);
  const { result } = await vote(card, 1);
  expect(result.events).toEqual([{
    type: 'vote:updated',
    version: 6,
    targetType: 'card',
    targetId: card,
    totalVotes: 3,
    myVotes: 3,
    remainingVotes: 0,
  }]);
  await expect(vote(otherCard, 1)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

  expect((await read(facilitator)).result).toMatchObject({
    id: board.id,
    remainingVotes: 3,
    cards: expect.arrayContaining([expect.objectContaining({ id: card, votes: 3, myVotes: 0 })]),
  });

  await expect(vote(card, -1)).resolves.toMatchObject({
    result: { events: [{ totalVotes: 2, myVotes: 2, remainingVotes: 1 }] },
  });
  await expect(vote(otherCard, 1)).resolves.toMatchObject({
    result: { events: [{ totalVotes: 1, myVotes: 1, remainingVotes: 0 }] },
  });
});

it('lets Facilitators change custom and unlimited budgets and single-Vote caps without discarding existing Votes', async () => {
  const { createCard, participant, read, settings, vote } = await setup();
  const card = await createCard('Keep weekly demos');
  const otherCard = await createCard('Improve builds');

  await vote(card, 1);
  await vote(card, 1);
  await expect(settings({ voteLimit: 7 }, participant)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(settings({ voteLimit: 2.5 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  await expect(settings({ voteLimit: 7, maxVotesPerCard: 1 })).resolves.toMatchObject({
    result: { events: [{ type: 'board:snapshot', board: { voteLimit: 7, maxVotesPerCard: 1 } }] },
  });
  expect((await read(participant)).result).toMatchObject({ remainingVotes: 5 });
  await expect(vote(card, 1)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  await expect(vote(otherCard, 1)).resolves.toMatchObject({
    result: { events: [{ myVotes: 1, remainingVotes: 4 }] },
  });
  await expect(vote(otherCard, 1)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

  await settings({ voteLimit: 1 });
  expect((await read(participant)).result).toMatchObject({ remainingVotes: 0 });
  await expect(vote(card, -1)).resolves.toMatchObject({
    result: { events: [{ myVotes: 1, remainingVotes: 0 }] },
  });

  await settings({ voteLimit: null, maxVotesPerCard: null });
  await expect(vote(card, 1)).resolves.toMatchObject({
    result: { events: [{ myVotes: 2, remainingVotes: null }] },
  });
});

it('lets a Facilitator reset everyone’s Votes and restores each Participant’s budget', async () => {
  const { facilitator, participant, read, dispatch, createCard, vote } = await setup();
  const card = await createCard('Helpful release notes');
  await vote(card, 1);
  await vote(card, 1, facilitator);

  const reset = (cookie?: string) => dispatch({ type: 'voting:reset' }, cookie);
  await expect(reset(participant)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(reset(facilitator)).resolves.toMatchObject({
    result: { events: [{
      type: 'board:snapshot',
      board: { remainingVotes: 5, cards: [{ votes: 0, myVotes: 0 }] },
    }] },
  });
  expect((await read(participant)).result).toMatchObject({
    remainingVotes: 5,
    cards: [{ votes: 0, myVotes: 0 }],
  });
});

it('publishes the refunded Vote budget when Cards or Columns are deleted', async () => {
  const { board, facilitator, dispatch, createCard, vote } = await setup();
  const firstCard = await createCard('Preserve the changelog');
  const secondCard = await createCard('Improve onboarding');
  await vote(firstCard, 1, facilitator);
  await vote(secondCard, 1, facilitator);

  const { result } = await dispatch(
    { type: 'card:delete', cardId: firstCard },
    facilitator,
  );
  expect(result.events).toMatchObject([
    { type: 'card:deleted', cardId: firstCard },
    { type: 'vote:balance', remainingVotes: 4 },
  ]);

  const { result: removedColumn } = await dispatch(
    { type: 'column:delete', columnId: board.columns[0].id },
    facilitator,
  );
  expect(removedColumn.events).toMatchObject([
    { type: 'column:deleted', columnId: board.columns[0].id },
    { type: 'vote:balance', remainingVotes: 5 },
  ]);
});

it('serializes concurrent Votes for a final budget slot and rejects Votes on redacted Cards', async () => {
  const { vote, createCard, participant, facilitator } = await setup({ isBlurred: true, voteLimit: 3 });
  const privateCard = await createCard('Unrevealed idea', facilitator);
  const firstCard = await createCard('My first idea', participant);
  const secondCard = await createCard('My second idea', participant);

  await expect(vote(privateCard, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(vote(firstCard, 1, facilitator)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await vote(firstCard, 1);
  await vote(firstCard, 1);

  const results = await Promise.allSettled([vote(firstCard, 1), vote(secondCard, 1)]);
  expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.reason).toMatchObject({ code: 'LIMIT_EXCEEDED' });
});

it('preserves exact Vote denial codes and messages across Cards, Card Groups, and Private Mode', async () => {
  const { dispatch, createCard, participant, facilitator, settings } = await setup({
    isBlurred: false,
    voteLimit: 3,
    maxVotesPerCard: 1,
  });
  await settings({ voteLimit: 2 });

  const participantCard = await createCard('Participant card', participant);
  const facilitatorCard = await createCard('Facilitator card', facilitator);
  const standaloneCard = await createCard('Standalone card', participant);

  // Removing a Vote when none cast on a standalone Card -> VALIDATION_ERROR
  await expect(
    dispatch({ type: 'vote:change', targetType: 'card', targetId: standaloneCard, delta: -1 }, participant),
  ).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
    message: 'You have no Votes to remove from this Card.',
  });

  // Per-Card limit on standalone Card -> LIMIT_EXCEEDED
  await dispatch({ type: 'vote:change', targetType: 'card', targetId: standaloneCard, delta: 1 }, participant);
  await expect(
    dispatch({ type: 'vote:change', targetType: 'card', targetId: standaloneCard, delta: 1 }, participant),
  ).rejects.toMatchObject({
    code: 'LIMIT_EXCEEDED',
    message: 'You reached the Vote limit for this Card.',
  });

  // Merge participantCard + facilitatorCard into a mixed-authorship Card Group
  const merged = await dispatch(
    { type: 'group:merge', cardId: participantCard, targetType: 'card', targetId: facilitatorCard },
    facilitator,
  );
  const groupEvent = merged.result.events.find((e) => e.type === 'group:upserted');
  if (groupEvent?.type !== 'group:upserted') throw new Error('Expected a Card Group');
  const groupId = groupEvent.group.id;

  // Voting directly on a grouped Card -> FORBIDDEN with routing message
  await expect(
    dispatch({ type: 'vote:change', targetType: 'card', targetId: participantCard, delta: 1 }, participant),
  ).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Vote on the Card Group instead.',
  });

  // Removing a Vote when none cast on a Card Group -> VALIDATION_ERROR
  await expect(
    dispatch({ type: 'vote:change', targetType: 'group', targetId: groupId, delta: -1 }, participant),
  ).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
    message: 'You have no Votes to remove from this Card Group.',
  });

  // Per-Card Group limit -> LIMIT_EXCEEDED
  await dispatch({ type: 'vote:change', targetType: 'group', targetId: groupId, delta: 1 }, participant);
  await expect(
    dispatch({ type: 'vote:change', targetType: 'group', targetId: groupId, delta: 1 }, participant),
  ).rejects.toMatchObject({
    code: 'LIMIT_EXCEEDED',
    message: 'You reached the Vote limit for this Card Group.',
  });

  // Board Vote budget exhausted (2 of 2 cast) -> LIMIT_EXCEEDED
  await settings({ maxVotesPerCard: null });
  await expect(
    dispatch({ type: 'vote:change', targetType: 'group', targetId: groupId, delta: 1 }, participant),
  ).rejects.toMatchObject({
    code: 'LIMIT_EXCEEDED',
    message: 'You have no Votes left.',
  });

  // Private Mode blocks voting on a mixed-authorship Card Group for both Participant and Facilitator
  await dispatch({ type: 'board:set-private-mode', isBlurred: true }, facilitator);
  for (const cookie of [participant, facilitator]) {
    await expect(
      dispatch({ type: 'vote:change', targetType: 'group', targetId: groupId, delta: -1 }, cookie),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: "Cannot change another Participant's Card while Private Mode is active.",
    });
  }
});
