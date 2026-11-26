import { describe, expect, it } from 'vitest';

import type { CardViewDTO } from './board-types';
import { makeBoardView, makeCard } from './board-fixtures';
import {
  acceptsBoardDrop,
  buildBoardTransferLists,
  canGrabTransferItem,
  parseTransferKey,
  resolveBoardTransferMove,
} from './board-transfer';
import { projectBoardView } from './board-view';

function makeGroup(overrides?: Partial<import('./board-types').CardGroupDTO>) {
  return {
    id: 'group_1',
    columnId: 'col_1',
    title: 'Deploy pipeline notes',
    cardIds: ['card_1', 'card_2'] as string[],
    votes: 0,
    myVotes: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

const unlocked = { isLocked: false, isFacilitator: false, isBlurred: false };

describe('canGrabTransferItem', () => {
  it('allows grabbing your own revealed Card on an unlocked Board', () => {
    const board = makeBoardView({
      ...unlocked,
      cards: [makeCard({ id: 'card_a', isMine: true })],
    });
    expect(canGrabTransferItem(board, 'card:card_a')).toBe(true);
  });

  it('rejects locked Boards, redacted Cards, and unknown items', () => {
    const board = makeBoardView({
      isLocked: true,
      cards: [makeCard({ id: 'card_a', isMine: true })],
    });
    expect(canGrabTransferItem(board, 'card:card_a')).toBe(false);
    const blurred = makeBoardView({
      isBlurred: true,
      cards: [makeCard({ id: 'card_redacted', isMine: true, redacted: true })],
    });
    expect(canGrabTransferItem(blurred, 'card:card_redacted')).toBe(false);
    expect(canGrabTransferItem(unlockedBoard(), 'card:missing')).toBe(false);
    expect(canGrabTransferItem(null, 'card:card_a')).toBe(false);
  });

  it('lets a Participant drag someone else’s Card only for grouping, never to move', () => {
    const stranger = makeCard({ id: 'card_b', isMine: false });
    const noGrouping = makeBoardView({ ...unlocked, cards: [stranger] });
    expect(canGrabTransferItem(noGrouping, 'card:card_b')).toBe(false);

    const groupingAllowed = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      cards: [stranger],
    });
    expect(canGrabTransferItem(groupingAllowed, 'card:card_b')).toBe(true);
  });

  it('rejects grabbing pending Cards or another Participant’s Card during Private Mode', () => {
    const pending = makeCard({ id: 'card_pending', isMine: true, pending: true });
    const foreign = makeCard({ id: 'card_foreign', isMine: false });
    const board = makeBoardView({
      ...unlocked,
      isBlurred: true,
      allowParticipantGroup: true,
      cards: [pending, foreign],
    });
    expect(canGrabTransferItem(board, 'card:card_pending')).toBe(false);
    expect(canGrabTransferItem(board, 'card:card_foreign')).toBe(false);
  });

  it('grabs Card Groups only when every member is yours and grouping is allowed', () => {
    const mine = makeGroup({ cardIds: ['card_a'] });
    const board = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      groups: [mine],
      cards: [makeCard({ id: 'card_a', isMine: true })],
    });
    expect(canGrabTransferItem(board, 'group:group_1')).toBe(true);

    const others = makeBoardView({
      ...unlocked,
      isBlurred: true,
      allowParticipantGroup: true,
      groups: [mine],
      cards: [makeCard({ id: 'card_a', isMine: false })],
    });
    expect(canGrabTransferItem(others, 'group:group_1')).toBe(false);

    const lockedBoard = makeBoardView({
      ...unlocked,
      isLocked: true,
      allowParticipantGroup: true,
      groups: [mine],
      cards: [makeCard({ id: 'card_a', isMine: true })],
    });
    expect(canGrabTransferItem(lockedBoard, 'group:group_1')).toBe(false);
  });
});

describe('acceptsBoardDrop', () => {
  const myCard = makeCard({ id: 'card_a', isMine: true, columnId: 'col_1' });
  const teammateCard = makeCard({
    id: 'card_b',
    isMine: false,
    columnId: 'col_1',
    content: 'Teammate note',
  });

  it('accepts any Column for your own Card, including the source Column', () => {
    const board = makeBoardView({ ...unlocked, cards: [myCard] });
    expect(acceptsBoardDrop(board, 'card:card_a', 'col_2')).toBe(true);
    expect(acceptsBoardDrop(board, 'card:card_a', 'col_1')).toBe(true);
  });

  it('rejects every target while the Board is Locked', () => {
    const board = makeBoardView({ isLocked: true, cards: [myCard] });
    expect(acceptsBoardDrop(board, 'card:card_a', 'col_2')).toBe(false);
    expect(
      acceptsBoardDrop(board, 'card:card_a', 'on:card:card_b'),
    ).toBe(false);
  });

  it('rejects Columns for a Card you can only group, not move', () => {
    const board = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      cards: [teammateCard],
    });
    expect(acceptsBoardDrop(board, 'card:card_b', 'col_2')).toBe(false);
  });

  it('accepts dropping your Card onto a same-Column Card to group them', () => {
    const board = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      cards: [myCard, teammateCard],
    });
    expect(acceptsBoardDrop(board, 'card:card_a', 'on:card:card_b')).toBe(true);
  });

  it('rejects redacted targets, self-drops, and Cards already in the same Group', () => {
    const redacted = makeCard({
      id: 'card_hidden',
      isMine: false,
      redacted: true,
      columnId: 'col_1',
    });
    const grouped = makeCard({
      id: 'card_samegroup',
      isMine: false,
      groupId: 'group_1',
      columnId: 'col_1',
    });
    const board = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      cards: [
        { ...myCard, groupId: 'group_1' },
        redacted,
        grouped,
        teammateCard,
      ],
    });
    expect(acceptsBoardDrop(board, 'card:card_a', 'on:card:card_hidden')).toBe(
      false,
    );
    expect(acceptsBoardDrop(board, 'card:card_a', 'on:card:card_a')).toBe(false);
    expect(
      acceptsBoardDrop(board, 'card:card_a', 'on:card:card_samegroup'),
    ).toBe(false);
  });

  it('accepts dropping onto a same-Column Card Group you are not part of', () => {
    const group = makeGroup({ cardIds: ['card_b'] });
    const board = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      groups: [group],
      cards: [myCard, { ...teammateCard, groupId: 'group_1' }],
    });
    expect(acceptsBoardDrop(board, 'card:card_a', 'on:group:group_1')).toBe(
      true,
    );
    expect(acceptsBoardDrop(board, 'card:card_b', 'on:group:group_1')).toBe(
      false,
    );
  });

  it('rejects dropping onto redacted or mixed-authorship Card Groups during Private Mode', () => {
    const ownCard = makeCard({ id: 'card_own_2', isMine: true, columnId: 'col_1' });
    const ownGroup = makeGroup({ id: 'group_own', cardIds: ['card_own_2'] });
    const redactedGroup = makeGroup({
      id: 'group_redacted',
      cardIds: ['card_b'],
      redacted: true,
    });
    const mixedGroup = makeGroup({
      id: 'group_mixed',
      cardIds: ['card_own_2', 'card_b'],
    });
    const board = makeBoardView({
      isLocked: false,
      isFacilitator: true,
      isBlurred: true,
      groups: [ownGroup, redactedGroup, mixedGroup],
      cards: [
        myCard,
        { ...ownCard, groupId: 'group_own' },
        { ...teammateCard, groupId: 'group_redacted' },
      ],
    });
    expect(acceptsBoardDrop(board, 'card:card_a', 'on:group:group_own')).toBe(true);
    expect(acceptsBoardDrop(board, 'card:card_a', 'on:group:group_redacted')).toBe(false);
    expect(acceptsBoardDrop(board, 'card:card_a', 'on:group:group_mixed')).toBe(false);
  });

  it('redirects cross-Column Card and Group targets to a Column move', () => {
    const board = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      cards: [myCard, { ...teammateCard, columnId: 'col_2' }],
    });
    // Hovering through another Column’s Card means “move there”, like the Column.
    expect(acceptsBoardDrop(board, 'card:card_a', 'on:card:card_b')).toBe(
      true,
    );
    const notMine = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      cards: [{ ...teammateCard, columnId: 'col_2' }],
    });
    expect(acceptsBoardDrop(notMine, 'card:card_b', 'on:card:card_a')).toBe(
      false,
    );
  });

  it('never drops a Card Group onto Cards or Card Groups', () => {
    const group = makeGroup({ cardIds: ['card_a'] });
    const board = makeBoardView({
      ...unlocked,
      groups: [group],
      cards: [myCard, teammateCard],
    });
    expect(acceptsBoardDrop(board, 'group:group_1', 'on:card:card_b')).toBe(
      false,
    );
    expect(acceptsBoardDrop(board, 'group:group_1', 'on:group:group_1')).toBe(
      false,
    );
  });
});

describe('resolveBoardTransferMove', () => {
  const myCard = makeCard({ id: 'card_a', isMine: true, columnId: 'col_1' });

  it('maps a cross-Column drop onto moveCard', () => {
    const board = makeBoardView({ ...unlocked, cards: [myCard] });
    expect(
      resolveBoardTransferMove(board, { key: 'card:card_a', to: 'col_2' }),
    ).toEqual({ kind: 'move-card', cardId: 'card_a', targetColumnId: 'col_2' });
  });

  it('maps a Card Group drop onto moveCardGroup', () => {
    const group = makeGroup({ cardIds: ['card_a'] });
    const board = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      groups: [group],
      cards: [myCard],
    });
    expect(
      resolveBoardTransferMove(board, { key: 'group:group_1', to: 'col_2' }),
    ).toEqual({
      kind: 'move-group',
      groupId: 'group_1',
      targetColumnId: 'col_2',
    });
  });

  it('maps same-Column Card and Card Group targets onto the grouping mutation', () => {
    const target = makeCard({ id: 'card_b', isMine: false, columnId: 'col_1' });
    const group = makeGroup({ cardIds: ['card_b'] });
    const board = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      groups: [group],
      cards: [myCard, { ...target, groupId: 'group_1' }],
    });
    expect(
      resolveBoardTransferMove(board, {
        key: 'card:card_a',
        to: 'on:card:card_b',
      }),
    ).toEqual({
      kind: 'group-with-card',
      cardId: 'card_a',
      targetCardId: 'card_b',
    });
    expect(
      resolveBoardTransferMove(board, {
        key: 'card:card_a',
        to: 'on:group:group_1',
      }),
    ).toEqual({
      kind: 'group-with-group',
      cardId: 'card_a',
      targetGroupId: 'group_1',
    });
  });

  it('treats cross-Column Card and Group targets as moves to their Column', () => {
    const target = makeCard({ id: 'card_b', isMine: false, columnId: 'col_2' });
    const group = makeGroup({ cardIds: ['card_b'], columnId: 'col_2' });
    const board = makeBoardView({
      ...unlocked,
      groups: [group],
      cards: [myCard, target],
    });
    expect(
      resolveBoardTransferMove(board, {
        key: 'card:card_a',
        to: 'on:card:card_b',
      }),
    ).toEqual({ kind: 'move-card', cardId: 'card_a', targetColumnId: 'col_2' });
    expect(
      resolveBoardTransferMove(board, {
        key: 'card:card_a',
        to: 'on:group:group_1',
      }),
    ).toEqual({ kind: 'move-card', cardId: 'card_a', targetColumnId: 'col_2' });
  });

  it('returns null for home-Column no-ops, own-Group members, and unknown items', () => {
    const board = makeBoardView({ ...unlocked, cards: [myCard] });
    expect(
      resolveBoardTransferMove(board, { key: 'card:card_a', to: 'col_1' }),
    ).toBeNull();
    expect(
      resolveBoardTransferMove(board, { key: 'card:missing', to: 'col_2' }),
    ).toBeNull();
    expect(
      resolveBoardTransferMove(null, { key: 'card:card_a', to: 'col_2' }),
    ).toBeNull();

    const member = { ...myCard, groupId: 'group_1' };
    const group = makeGroup({ cardIds: ['card_a'] });
    const grouped = makeBoardView({
      ...unlocked,
      groups: [group],
      cards: [member],
    });
    expect(
      resolveBoardTransferMove(grouped, {
        key: 'card:card_a',
        to: 'on:group:group_1',
      }),
    ).toBeNull();
  });

  it('rechecks a previously accepted destination against the Board at release', () => {
    const target = makeCard({ id: 'card_b', isMine: false, columnId: 'col_1' });
    const board = makeBoardView({
      ...unlocked,
      allowParticipantGroup: true,
      cards: [myCard, target],
    });
    const move = { key: 'card:card_a', to: 'col_2' };
    expect(acceptsBoardDrop(board, move.key, move.to)).toBe(true);
    expect(resolveBoardTransferMove({ ...board, isLocked: true }, move)).toBeNull();
    expect(resolveBoardTransferMove({
      ...board,
      columns: board.columns.filter((column) => column.id !== move.to),
    }, move)).toBeNull();

    const group = { key: move.key, to: 'on:card:card_b' };
    expect(acceptsBoardDrop(board, group.key, group.to)).toBe(true);
    expect(resolveBoardTransferMove({ ...board, allowParticipantGroup: false }, group)).toBeNull();
    expect(resolveBoardTransferMove({ ...board, cards: [myCard] }, group)).toBeNull();
  });
});

describe('buildBoardTransferLists', () => {
  it('mirrors the rendered stream per Column and registers every visible item as a target', () => {
    const grouped = makeCard({
      id: 'card_g1',
      groupId: 'group_1',
      content: 'Grouped note',
    });
    const loose: CardViewDTO = makeCard({
      id: 'card_loose',
      content: 'Loose note',
    });
    const board = makeBoardView({
      columns: [
        { id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 2 },
        { id: 'col_2', title: 'To Improve', accent: 'rose', position: 1, isActionColumn: false, cardCount: 0 },
      ],
      groups: [makeGroup({ cardIds: ['card_g1'] })],
      cards: [grouped, loose],
    });
    const view = projectBoardView(board, {
      query: '',
      filter: 'all',
      sortMode: 'newest',
    });

    expect(buildBoardTransferLists(view)).toEqual({
      col_1: ['group:group_1', 'card:card_loose'],
      col_2: [],
      // A Card Group’s drop zone doubles as the transfer list of its members.
      'on:group:group_1': ['card:card_g1'],
      'on:card:card_loose': [],
    });
  });
});

describe('parseTransferKey', () => {
  it('splits card and group keys and rejects everything else', () => {
    expect(parseTransferKey('card:card_9')).toEqual({
      kind: 'card',
      id: 'card_9',
    });
    expect(parseTransferKey('group:group_9')).toEqual({
      kind: 'group',
      id: 'group_9',
    });
    expect(parseTransferKey('col_1')).toBeUndefined();
    expect(parseTransferKey('on:card:card_9')).toBeUndefined();
  });
});

function unlockedBoard(): ReturnType<typeof makeBoardView> {
  return makeBoardView({ isLocked: false, isFacilitator: false, cards: [] });
}
