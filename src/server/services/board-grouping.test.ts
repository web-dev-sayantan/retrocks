import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Cookie = string | undefined;

async function request<T>(
  url: string,
  options: { method?: 'GET' | 'POST'; cookie?: Cookie },
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

async function setup(options: Record<string, unknown> = {}) {
  const boardService = await import('./board-service');
  const origin = 'https://retrocks.app';
  const created = await request(origin, {}, () => boardService.createBoardForRequest(options));
  const board = created.result;
  const boardUrl = `${origin}/b/${board.id}`;
  const facilitator = created.cookie;
  if (!facilitator) throw new Error('Expected a Facilitator session');

  const read = (cookie?: Cookie) =>
    request(boardUrl, { cookie, method: 'GET' }, () =>
      boardService.getBoardForRequest(board.id));

  const join = async () => {
    const { cookie } = await read();
    if (!cookie) throw new Error('Expected a Participant session');
    return cookie;
  };
  const participant = await join();
  const otherParticipant = await join();

  const dispatch = (command: unknown, cookie: Cookie = facilitator) =>
    request(boardUrl, { cookie }, () =>
      boardService.dispatchBoardCommandForRequest(board.id, command),
    ).then(({ result }) => result);

  const createCard = async (
    content: string,
    cookie: Cookie = facilitator,
    columnId: string = board.columns[0].id,
  ) => {
    const result = await dispatch({ type: 'card:create', columnId, content }, cookie);
    const event = result.events[0];
    if (event?.type !== 'card:upserted') throw new Error('Expected a new Card');
    return event.card.id;
  };

  const merge = (
    cardId: string,
    targetType: 'card' | 'group',
    targetId: string,
    cookie: Cookie = facilitator,
  ) => dispatch({ type: 'group:merge', cardId, targetType, targetId }, cookie);

  const groupIdFrom = (events: { type: string; group?: { id: string } }[]) => {
    const event = events.find((item) => item.type === 'group:upserted');
    if (!event?.group) throw new Error('Expected a Card Group');
    return event.group.id;
  };

  const renameGroup = (groupId: string, title: string, cookie: Cookie = facilitator) =>
    dispatch({ type: 'group:rename', groupId, title }, cookie);

  const ungroup = (cardId: string, cookie: Cookie = facilitator) =>
    dispatch({ type: 'group:ungroup', cardId }, cookie);

  const dissolve = (groupId: string, cookie: Cookie = facilitator) =>
    dispatch({ type: 'group:dissolve', groupId }, cookie);

  const moveGroup = (
    groupId: string,
    targetColumnId: string,
    cookie: Cookie = facilitator,
  ) => dispatch({ type: 'group:move', groupId, targetColumnId }, cookie);

  const vote = (
    targetType: 'card' | 'group',
    targetId: string,
    delta: 1 | -1,
    cookie: Cookie = participant,
  ) => dispatch({ type: 'vote:change', targetType, targetId, delta }, cookie);

  const settings = (patch: Record<string, unknown>, cookie: Cookie = facilitator) =>
    dispatch({ type: 'voting:configure', ...patch }, cookie);

  const setPrivateMode = (isBlurred: boolean, cookie: Cookie = facilitator) =>
    dispatch({ type: 'board:set-private-mode', isBlurred }, cookie);

  const deleteCard = (cardId: string, cookie: Cookie = facilitator) =>
    dispatch({ type: 'card:delete', cardId }, cookie);

  const moveCard = (
    cardId: string,
    targetColumnId: string,
    cookie: Cookie = facilitator,
  ) => dispatch({ type: 'card:move', cardId, targetColumnId }, cookie);

  return {
    board,
    facilitator,
    participant,
    otherParticipant,
    read,
    createCard,
    deleteCard,
    moveCard,
    merge,
    groupIdFrom,
    renameGroup,
    ungroup,
    dissolve,
    moveGroup,
    vote,
    settings,
    setPrivateMode,
  };
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-grouping-session-secret-with-at-least-32-chars');
});

afterEach(() => vi.unstubAllEnvs());

it('merges two revealed Cards into a Card Group and adds Cards to it when Participants may group', async () => {
  const { board, participant, read, createCard, merge, groupIdFrom, settings } =
    await setup();

  const first = await createCard('CI flakiness');
  const second = await createCard('Flaky CI checks');
  const third = await createCard('Pipeline flakiness');

  await expect(merge(first, 'card', second, participant)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });

  const { events } = await merge(first, 'card', second);
  expect(events).toMatchObject([
    {
      type: 'group:upserted',
      group: {
        columnId: board.columns[0].id,
        title: 'Flaky CI checks',
        cardIds: expect.arrayContaining([first, second]),
        votes: 0,
        myVotes: 0,
      },
    },
    { type: 'card:upserted', card: { id: first, groupId: expect.any(String) } },
    { type: 'card:upserted', card: { id: second, groupId: expect.any(String) } },
  ]);
  const groupId = groupIdFrom(events);

  const snapshot = (await read()).result;
  expect(snapshot).toMatchObject({
    groups: [{ id: groupId, cardIds: expect.arrayContaining([first, second]) }],
    cards: expect.arrayContaining([
      expect.objectContaining({ id: first, groupId }),
      expect.objectContaining({ id: second, groupId }),
    ]),
  });

  await expect(merge(third, 'group', groupId, participant)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await settings({ allowParticipantGroup: true });
  const added = await merge(third, 'group', groupId, participant);
  expect(added.events).toMatchObject([
    {
      type: 'group:upserted',
      group: { id: groupId, cardIds: expect.arrayContaining([first, second, third]) },
    },
    { type: 'card:upserted', card: { id: third, groupId } },
  ]);
});

it('rejects grouping Cards across Columns or from redacted Cards in Private Mode', async () => {
  const { board, facilitator, participant, createCard, merge, settings } =
    await setup({ isBlurred: true });
  await settings({ allowParticipantGroup: true });

  const mine = await createCard('My private thought', participant);
  const otherMine = await createCard('My second thought', participant);
  const facilitatorCard = await createCard('Facilitator thought', facilitator);
  const otherColumnCard = await createCard(
    'Elsewhere',
    participant,
    board.columns[1].id,
  );

  await expect(merge(mine, 'card', facilitatorCard, participant)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(merge(facilitatorCard, 'card', mine, facilitator)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(merge(otherColumnCard, 'card', otherMine, participant)).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
  });

  const ownGroup = await merge(mine, 'card', otherMine, participant);
  expect(ownGroup.events).toContainEqual(
    expect.objectContaining({
      type: 'group:upserted',
      group: expect.objectContaining({ columnId: board.columns[0].id }),
    }),
  );
});

it('renames and moves an entire Card Group, and defaults these actions to Facilitators', async () => {
  const {
    board,
    participant,
    read,
    createCard,
    merge,
    groupIdFrom,
    renameGroup,
    moveGroup,
    settings,
  } = await setup();
  const first = await createCard('CI flakiness');
  const second = await createCard('Flaky CI checks');
  const groupId = groupIdFrom((await merge(first, 'card', second)).events);

  await expect(renameGroup(groupId, 'CI stability', participant)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const renamed = await renameGroup(groupId, 'CI stability');
  expect(renamed.events).toMatchObject([
    { type: 'group:upserted', group: { id: groupId, title: 'CI stability' } },
  ]);
  expect((await read()).result).toMatchObject({
    groups: [{ id: groupId, title: 'CI stability' }],
  });

  await expect(moveGroup(groupId, board.columns[1].id, participant)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const moved = await moveGroup(groupId, board.columns[1].id);
  expect(moved.events).toMatchObject([
    { type: 'group:upserted', group: { id: groupId, columnId: board.columns[1].id } },
    { type: 'card:upserted', card: { id: first, columnId: board.columns[1].id } },
    { type: 'card:upserted', card: { id: second, columnId: board.columns[1].id } },
  ]);

  const snapshot = (await read()).result;
  expect(snapshot).toMatchObject({
    groups: [{ id: groupId, columnId: board.columns[1].id }],
    cards: expect.arrayContaining([
      expect.objectContaining({ id: first, columnId: board.columns[1].id }),
      expect.objectContaining({ id: second, columnId: board.columns[1].id }),
    ]),
    columns: expect.arrayContaining([
      expect.objectContaining({ id: board.columns[0].id, cardCount: 0 }),
      expect.objectContaining({ id: board.columns[1].id, cardCount: 2 }),
    ]),
  });

  await settings({ allowParticipantGroup: true });
  await expect(moveGroup(groupId, board.columns[0].id, participant)).resolves.toMatchObject({
    ok: true,
  });
});

it('auto-dissolves below 2 Cards and refunds direct group Votes while keeping member Card Votes', async () => {
  const { participant, read, createCard, merge, groupIdFrom, ungroup, vote, settings } =
    await setup({ voteLimit: 5 });
  const first = await createCard('Slow builds');
  const second = await createCard('Compilation speed');
  await vote('card', first, 1);
  await vote('card', second, 1);
  const groupId = groupIdFrom((await merge(first, 'card', second)).events);
  const voted = await vote('group', groupId, 1);
  expect(voted.events).toMatchObject([
    {
      type: 'vote:updated',
      targetType: 'group',
      targetId: groupId,
      totalVotes: 3,
      myVotes: 3,
      remainingVotes: 2,
    },
  ]);

  await settings({ allowParticipantGroup: true });
  const { events } = await ungroup(first, participant);
  expect(events).toMatchObject([
    { type: 'group:dissolved', groupId },
    { type: 'card:upserted', card: { id: first, groupId: null } },
    { type: 'vote:balance', remainingVotes: 3 },
  ]);

  expect((await read(participant)).result).toMatchObject({
    remainingVotes: 3,
    groups: [],
    cards: expect.arrayContaining([
      expect.objectContaining({ id: first, groupId: null, myVotes: 1 }),
      expect.objectContaining({ id: second, groupId: null, myVotes: 1 }),
    ]),
  });
});

it('dissolves explicitly, refunding group Votes and preserving pre-merge Card Votes', async () => {
  const { participant, read, createCard, merge, groupIdFrom, dissolve, vote } = await setup();
  const first = await createCard('Onboarding docs');
  const second = await createCard('New joiners');
  await vote('card', first, 1);
  const groupId = groupIdFrom((await merge(first, 'card', second)).events);
  await vote('group', groupId, 1);
  await vote('group', groupId, 1);
  expect((await read(participant)).result).toMatchObject({
    remainingVotes: 2,
    groups: [{ myVotes: 3 }],
  });

  const { events } = await dissolve(groupId);
  expect(events).toMatchObject([
    { type: 'group:dissolved', groupId },
    { type: 'vote:balance', remainingVotes: 5 },
  ]);
  expect((await read(participant)).result).toMatchObject({
    remainingVotes: 4,
    groups: [],
    cards: expect.arrayContaining([
      expect.objectContaining({ id: first, groupId: null, myVotes: 1 }),
      expect.objectContaining({ id: second, groupId: null, myVotes: 0 }),
    ]),
  });
});

it('auto-dissolves when deleting a member leaves fewer than 2 Cards', async () => {
  const { read, createCard, deleteCard, merge, groupIdFrom } = await setup();
  const first = await createCard('Pair one');
  const second = await createCard('Pair two');
  const third = await createCard('Pair three');
  const groupId = groupIdFrom((await merge(first, 'card', second)).events);
  await merge(third, 'group', groupId);
  expect((await read()).result).toMatchObject({
    groups: [{ cardIds: expect.arrayContaining([first, second, third]) }],
  });

  const removedFirst = await deleteCard(first);
  expect(removedFirst.events).toMatchObject([
    {
      type: 'group:upserted',
      group: {
        id: groupId,
        cardIds: expect.arrayContaining([second, third]),
      },
    },
    { type: 'card:deleted' },
    { type: 'vote:balance' },
  ]);
  expect((await read()).result!.groups).toHaveLength(1);

  const removedSecond = await deleteCard(second);
  expect(removedSecond.events).toMatchObject([
    { type: 'group:dissolved', groupId },
    { type: 'card:deleted' },
    { type: 'vote:balance' },
  ]);
  expect((await read()).result!.groups).toEqual([]);
});

it('emits group:upserted with updated cardIds and combined votes when ungrouping or moving a Card out of a 3+ Card Group', async () => {
  const { board, participant, createCard, merge, groupIdFrom, ungroup, moveCard, vote } =
    await setup({ voteLimit: 10 });
  const first = await createCard('Alpha');
  const second = await createCard('Beta');
  const third = await createCard('Gamma');
  const fourth = await createCard('Delta');

  await vote('card', first, 1, participant);
  await vote('card', second, 1, participant);
  await vote('card', third, 1, participant);

  const groupId = groupIdFrom((await merge(first, 'card', second)).events);
  await merge(third, 'group', groupId);
  await merge(fourth, 'group', groupId);
  await vote('group', groupId, 1, participant);

  // Ungrouping first from a 4-Card Group leaves 3 Cards and emits group:upserted with updated votes
  const ungrouped = await ungroup(first);
  expect(ungrouped.events).toMatchObject([
    {
      type: 'group:upserted',
      group: {
        id: groupId,
        cardIds: expect.arrayContaining([second, third, fourth]),
        votes: 3, // second(1) + third(1) + direct(1); first(1) left
      },
    },
    { type: 'card:upserted', card: { id: first, groupId: null } },
  ]);
  const ungroupedGroupEvent = ungrouped.events.find((e) => e.type === 'group:upserted');
  if (ungroupedGroupEvent?.type === 'group:upserted') {
    expect(ungroupedGroupEvent.group.cardIds).toHaveLength(3);
    expect(ungroupedGroupEvent.group.cardIds).not.toContain(first);
  }

  // Moving second to another Column leaves 2 Cards and emits group:upserted with updated votes
  const moved = await moveCard(second, board.columns[1].id);
  expect(moved.events).toMatchObject([
    {
      type: 'group:upserted',
      group: {
        id: groupId,
        cardIds: expect.arrayContaining([third, fourth]),
        votes: 2, // third(1) + direct(1); second(1) left
      },
    },
    {
      type: 'card:upserted',
      card: { id: second, columnId: board.columns[1].id, groupId: null },
    },
  ]);
  const movedGroupEvent = moved.events.find((e) => e.type === 'group:upserted');
  if (movedGroupEvent?.type === 'group:upserted') {
    expect(movedGroupEvent.group.cardIds).toHaveLength(2);
    expect(movedGroupEvent.group.cardIds).not.toContain(second);
  }
});

it('grandfathers merged Votes, blocks new group Votes at the cap, and removes direct group Votes first', async () => {
  const { participant, read, createCard, merge, groupIdFrom, vote, settings } = await setup();
  const first = await createCard('Duplicate idea');
  const second = await createCard('Same duplicate idea');
  await vote('card', first, 1);
  await vote('card', second, 1);
  const groupId = groupIdFrom((await merge(first, 'card', second)).events);

  await settings({ maxVotesPerCard: 1 });
  expect((await read(participant)).result).toMatchObject({
    maxVotesPerCard: 1,
    groups: [{ id: groupId, myVotes: 2, votes: 2 }],
  });
  await expect(vote('group', groupId, 1)).rejects.toMatchObject({
    code: 'LIMIT_EXCEEDED',
  });

  await settings({ maxVotesPerCard: null });
  await vote('group', groupId, 1);
  let snapshot = (await read(participant)).result!;
  expect(snapshot.groups[0]).toMatchObject({ myVotes: 3, votes: 3 });

  // The direct group Vote goes first, leaving both pre-merge member Votes.
  await vote('group', groupId, -1);
  snapshot = (await read(participant)).result!;
  expect(snapshot.groups[0]).toMatchObject({ myVotes: 2, votes: 2 });
  expect(snapshot.cards).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: first, groupId, myVotes: 1 }),
      expect.objectContaining({ id: second, groupId, myVotes: 1 }),
    ]),
  );

  // A second decrement then removes one of the grandfathered member Votes
  // and emits vote:updated for both the Card Group and the decremented member Card.
  const decremented = await vote('group', groupId, -1);
  expect(decremented.events).toMatchObject([
    {
      type: 'vote:updated',
      targetType: 'group',
      targetId: groupId,
      myVotes: 1,
      totalVotes: 1,
    },
    {
      type: 'vote:updated',
      targetType: 'card',
      targetId: expect.stringMatching(new RegExp(`^(${first}|${second})$`)),
      myVotes: 0,
      totalVotes: 0,
    },
  ]);
  snapshot = (await read(participant)).result!;
  expect(snapshot.groups[0]).toMatchObject({ myVotes: 1, votes: 1 });
  expect(
    snapshot.cards.reduce((sum, card) => sum + card.myVotes, 0),
  ).toBe(1);
});

it('requires the entire Card Group to pass Private Mode on group:ungroup', async () => {
  const {
    facilitator,
    participant,
    read,
    createCard,
    merge,
    groupIdFrom,
    ungroup,
    settings,
    setPrivateMode,
  } = await setup({ isBlurred: false });
  await settings({ allowParticipantGroup: true });

  // Mixed-authorship Card Group (Participant + Facilitator)
  const participantCard = await createCard('Participant idea', participant);
  const facilitatorCard = await createCard('Facilitator idea', facilitator);
  const mixedGroupId = groupIdFrom(
    (await merge(participantCard, 'card', facilitatorCard)).events,
  );

  // Same-author Card Group (both authored by Participant)
  const ownCardA = await createCard('Own idea A', participant);
  const ownCardB = await createCard('Own idea B', participant);
  const ownGroupId = groupIdFrom(
    (await merge(ownCardA, 'card', ownCardB, participant)).events,
  );

  await setPrivateMode(true);

  // Neither the Participant nor the Facilitator can ungroup their own Card
  // from a mixed-authorship Card Group while Private Mode is active.
  await expect(ungroup(participantCard, participant)).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: "Cannot change another Participant's Card while Private Mode is active.",
  });
  await expect(ungroup(facilitatorCard, facilitator)).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: "Cannot change another Participant's Card while Private Mode is active.",
  });

  // Facilitator also cannot ungroup from the Participant's all-own Card Group.
  await expect(ungroup(ownCardA, facilitator)).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: "Cannot change another Participant's Card while Private Mode is active.",
  });

  // Participant CAN ungroup from a Card Group where every member Card is theirs.
  await expect(ungroup(ownCardA, participant)).resolves.toMatchObject({
    ok: true,
    events: expect.arrayContaining([
      expect.objectContaining({ type: 'group:dissolved', groupId: ownGroupId }),
      expect.objectContaining({
        type: 'card:upserted',
        card: expect.objectContaining({ id: ownCardA, groupId: null }),
      }),
    ]),
  });

  // The mixed-authorship Card Group remained intact throughout Private Mode.
  const privateSnapshot = (await read(participant)).result!;
  expect(privateSnapshot.groups).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: mixedGroupId })]),
  );

  // After Reveal All, ungrouping from the mixed-authorship Card Group succeeds.
  await setPrivateMode(false);
  await expect(ungroup(participantCard, participant)).resolves.toMatchObject({
    ok: true,
    events: expect.arrayContaining([
      expect.objectContaining({ type: 'group:dissolved', groupId: mixedGroupId }),
    ]),
  });
});
