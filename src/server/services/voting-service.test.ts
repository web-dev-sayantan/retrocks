import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

async function setup(options: Record<string, unknown> = {}) {
  const boardService = await import('./board-service');
  const voting = await import('./voting-service');
  const origin = 'https://retrocks.app';
  const created = await request(origin, {}, () => boardService.createBoardForRequest(options));
  const board = created.result;
  const boardUrl = `${origin}/b/${board.id}`;
  const facilitator = created.cookie;
  const read = (cookie?: string) => request(boardUrl, { cookie, method: 'GET' }, () =>
    boardService.getBoardForRequest(board.id));
  const participant = (await read()).cookie;
  async function createCard(content: string, cookie = facilitator) {
    const { result } = await request(boardUrl, { cookie }, () =>
      boardService.createCardForRequest({ boardId: board.id, columnId: board.columns[0].id, content }));
    const event = result.events[0];
    if (event.type !== 'card:upserted') throw new Error('Expected a new Card');
    return event.card.id;
  }
  const vote = (targetId: string, delta: 1 | -1, cookie = participant) =>
    request(boardUrl, { cookie }, () =>
      voting.changeVoteForRequest({ boardId: board.id, targetType: 'card', targetId, delta }));

  const settings = (patch: Record<string, unknown>, cookie = facilitator) =>
    request(boardUrl, { cookie }, () => voting.updateVotingSettingsForRequest({ boardId: board.id, ...patch }));

  return { board, boardUrl, facilitator, participant, read, createCard, vote, voting, settings };
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
  const { board, boardUrl, facilitator, participant, read, createCard, vote, voting } = await setup();
  const card = await createCard('Helpful release notes');
  await vote(card, 1);
  await vote(card, 1, facilitator);

  const reset = (cookie?: string) => request(boardUrl, { cookie }, () =>
    voting.resetVotesForRequest({ boardId: board.id }));
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
