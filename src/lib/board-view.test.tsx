import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { createSignal, createStore, flush, untrack } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { makeBoardView } from './board-fixtures';
import { applyBoardEvents } from './board-store';
import type { BoardViewDTO, CardGroupDTO, CardViewDTO, ColumnDTO } from './board-types';
import {
  createBoardProjection,
  formatMatchCountSummary,
  projectBoardView,
  type BoardProjectionInputs,
  type BoardQuickFilter,
  type BoardSortMode,
  type BoardViewProjection,
} from './board-view';

function makeColumn(overrides?: Partial<ColumnDTO>): ColumnDTO {
  return {
    id: 'col_1',
    title: 'Went Well',
    accent: 'sage',
    position: 0,
    isActionColumn: false,
    cardCount: 0,
    ...overrides,
  };
}

function makeCard(overrides?: Partial<CardViewDTO>): CardViewDTO {
  return {
    id: 'card_1',
    columnId: 'col_1',
    groupId: null,
    content: 'Fast deploys',
    redacted: false,
    isMine: false,
    isActionItem: false,
    actionDone: false,
    actionOwner: '',
    votes: 0,
    myVotes: 0,
    reactions: {},
    myReactions: [],
    commentCount: 0,
    comments: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function makeGroup(overrides?: Partial<CardGroupDTO>): CardGroupDTO {
  return {
    id: 'group_1',
    columnId: 'col_1',
    title: 'CI Stability',
    cardIds: [],
    votes: 0,
    myVotes: 0,
    createdAt: 1_500,
    ...overrides,
  };
}

function makeBoard(overrides?: {
  columns?: ColumnDTO[];
  cards?: CardViewDTO[];
  groups?: CardGroupDTO[];
  blindVoting?: boolean;
}): Pick<BoardViewDTO, 'columns' | 'cards' | 'groups' | 'blindVoting'> {
  return {
    columns: overrides?.columns ?? [
      makeColumn({ id: 'col_1', title: 'Went Well', position: 0 }),
      makeColumn({ id: 'col_2', title: 'To Improve', position: 1 }),
    ],
    cards: overrides?.cards ?? [],
    groups: overrides?.groups ?? [],
    blindVoting: overrides?.blindVoting ?? false,
  };
}

function columnView(view: BoardViewProjection, columnId: string) {
  return view.columnViews.find((entry) => entry.id === columnId);
}

describe('projectBoardView', () => {
  it('filters Cards, Card Group titles, and comments case-insensitively and tracks match counts', () => {
    const group = makeGroup({
      id: 'group_ci',
      columnId: 'col_1',
      title: 'Pipeline Reliability',
      cardIds: ['c_g1', 'c_g2'],
      createdAt: 2_000,
    });
    const board = makeBoard({
      groups: [group],
      cards: [
        makeCard({ id: 'c_1', columnId: 'col_1', content: 'Zero downtime release', createdAt: 1_000 }),
        makeCard({
          id: 'c_2',
          columnId: 'col_2',
          content: 'Database migration checklist',
          comments: [
            {
              id: 'cm_1',
              cardId: 'c_2',
              content: 'Remember rollback script for staging',
              isMine: false,
              createdAt: 1_200,
            },
          ],
          commentCount: 1,
          createdAt: 1_100,
        }),
        makeCard({ id: 'c_g1', columnId: 'col_1', groupId: 'group_ci', content: 'Flaky integration job', createdAt: 1_300 }),
        makeCard({ id: 'c_g2', columnId: 'col_1', groupId: 'group_ci', content: 'Cache warming helped', createdAt: 1_400 }),
      ],
    });

    // Matches Card comment text
    const byComment = projectBoardView(board, {
      query: '  ROLLBACK  ',
      filter: 'all',
      sortMode: 'newest',
    });
    expect(byComment.hasActiveFilter).toBe(true);
    expect(byComment.hasSearchQuery).toBe(true);
    expect(byComment.matchedCardCount).toBe(1);
    expect(byComment.totalCardCount).toBe(4);
    expect(columnView(byComment, 'col_1')?.items).toEqual([]);
    expect(columnView(byComment, 'col_2')?.items.map((item) => item.key)).toEqual(['card:c_2']);

    // Matches Card Group title -> includes the group and its member Cards
    const byGroupTitle = projectBoardView(board, {
      query: 'reliability',
      filter: 'all',
      sortMode: 'newest',
    });
    expect(byGroupTitle.matchedCardCount).toBe(2);
    const col1Items = columnView(byGroupTitle, 'col_1')?.items ?? [];
    expect(col1Items).toHaveLength(1);
    expect(col1Items[0]).toMatchObject({
      kind: 'group',
      key: 'group:group_ci',
    });
    if (col1Items[0].kind === 'group') {
      expect(col1Items[0].cards.map((card) => card.id)).toEqual(['c_g2', 'c_g1']);
    }

    // Matches single member Card inside a Card Group -> shows group with only matching member Card
    const byMemberCard = projectBoardView(board, {
      query: 'cache warming',
      filter: 'all',
      sortMode: 'newest',
    });
    expect(byMemberCard.matchedCardCount).toBe(1);
    const memberItems = columnView(byMemberCard, 'col_1')?.items ?? [];
    expect(memberItems).toHaveLength(1);
    if (memberItems[0].kind === 'group') {
      expect(memberItems[0].cards.map((card) => card.id)).toEqual(['c_g2']);
    }
  });

  it('never matches redacted Cards by hidden content or comments during Private Mode', () => {
    const board = makeBoard({
      cards: [
        makeCard({
          id: 'c_mine',
          content: 'My visible secret note',
          isMine: true,
          redacted: false,
        }),
        makeCard({
          id: 'c_redacted',
          content: 'secret leaked text',
          redacted: true,
          isMine: false,
          comments: [
            {
              id: 'cm_hidden',
              cardId: 'c_redacted',
              content: 'secret hidden comment',
              isMine: false,
              createdAt: 2_000,
            },
          ],
          commentCount: 1,
        }),
      ],
    });

    const result = projectBoardView(board, {
      query: 'secret',
      filter: 'all',
      sortMode: 'newest',
    });
    expect(result.matchedCardCount).toBe(1);
    expect(columnView(result, 'col_1')?.items.map((item) => item.key)).toEqual(['card:c_mine']);
  });

  it('never matches a redacted Card Group title during Private Mode search', () => {
    const redactedGroup = makeGroup({
      id: 'g_secret',
      columnId: 'col_1',
      title: 'Secret merged theme',
      redacted: true,
      cardIds: ['c_r1', 'c_r2'],
      votes: null,
      myVotes: 0,
    });
    const board = makeBoard({
      groups: [redactedGroup],
      cards: [
        makeCard({ id: 'c_r1', groupId: 'g_secret', content: '', redacted: true, isMine: false }),
        makeCard({ id: 'c_r2', groupId: 'g_secret', content: '', redacted: true, isMine: false }),
      ],
    });

    const result = projectBoardView(board, {
      query: 'secret',
      filter: 'all',
      sortMode: 'newest',
    });
    expect(result.matchedCardCount).toBe(0);
    expect(columnView(result, 'col_1')?.items).toEqual([]);
  });

  it('sorts unified standalone Cards and Card Groups by Newest, Oldest, and Most Voted with Blind Voting fallback', () => {
    const group = makeGroup({
      id: 'g_1',
      columnId: 'col_1',
      title: 'Deploy speed',
      cardIds: ['c_g1', 'c_g2'],
      votes: 5,
      createdAt: 2_000,
    });
    const board = makeBoard({
      groups: [group],
      cards: [
        makeCard({ id: 'c_old', columnId: 'col_1', content: 'Oldest card', votes: 8, createdAt: 1_000 }),
        makeCard({ id: 'c_new', columnId: 'col_1', content: 'Newest card', votes: 1, createdAt: 3_000 }),
        makeCard({ id: 'c_g1', columnId: 'col_1', groupId: 'g_1', content: 'Member A', createdAt: 1_200 }),
        makeCard({ id: 'c_g2', columnId: 'col_1', groupId: 'g_1', content: 'Member B', createdAt: 1_800 }),
      ],
    });

    const newest = projectBoardView(board, { query: '', filter: 'all', sortMode: 'newest' });
    expect(columnView(newest, 'col_1')?.items.map((item) => item.key)).toEqual([
      'card:c_new',
      'group:g_1',
      'card:c_old',
    ]);

    const oldest = projectBoardView(board, { query: '', filter: 'all', sortMode: 'oldest' });
    expect(columnView(oldest, 'col_1')?.items.map((item) => item.key)).toEqual([
      'card:c_old',
      'group:g_1',
      'card:c_new',
    ]);
    const oldestGroup = columnView(oldest, 'col_1')?.items[1];
    if (oldestGroup?.kind === 'group') {
      expect(oldestGroup.cards.map((c) => c.id)).toEqual(['c_g1', 'c_g2']);
    }

    const mostVoted = projectBoardView(board, { query: '', filter: 'all', sortMode: 'most-voted' });
    expect(mostVoted.effectiveSortMode).toBe('most-voted');
    expect(columnView(mostVoted, 'col_1')?.items.map((item) => item.key)).toEqual([
      'card:c_old',
      'group:g_1',
      'card:c_new',
    ]);

    // Blind Voting hides aggregate totals and falls back cleanly to Newest
    const blindBoard = makeBoard({
      blindVoting: true,
      groups: [{ ...group, votes: null }],
      cards: board.cards.map((card) => ({ ...card, votes: null })),
    });
    const blindMostVoted = projectBoardView(blindBoard, {
      query: '',
      filter: 'all',
      sortMode: 'most-voted',
    });
    expect(blindMostVoted.effectiveSortMode).toBe('newest');
    expect(columnView(blindMostVoted, 'col_1')?.items.map((item) => item.key)).toEqual([
      'card:c_new',
      'group:g_1',
      'card:c_old',
    ]);
  });

  it('composes Quick Filters (Mine, Voted, Action Items) cleanly with Search and Sort', () => {
    const groupVotedDirectly = makeGroup({
      id: 'g_voted',
      columnId: 'col_1',
      title: 'Shared incident review',
      cardIds: ['c_gv1', 'c_gv2'],
      votes: 4,
      myVotes: 2,
      createdAt: 2_500,
    });
    const board = makeBoard({
      groups: [groupVotedDirectly],
      cards: [
        makeCard({ id: 'c_mine_only', content: 'My deployment win', isMine: true, myVotes: 0, isActionItem: false, votes: 1, createdAt: 1_000 }),
        makeCard({ id: 'c_voted_action', content: 'Automate release notes', isMine: false, myVotes: 1, isActionItem: true, votes: 6, createdAt: 2_000 }),
        makeCard({ id: 'c_gv1', groupId: 'g_voted', content: 'Improve alerting docs', isMine: true, myVotes: 0, isActionItem: true, createdAt: 1_500 }),
        makeCard({ id: 'c_gv2', groupId: 'g_voted', content: 'Run game day', isMine: false, myVotes: 0, isActionItem: false, createdAt: 1_600 }),
      ],
    });

    const cases: Array<{
      filter: BoardQuickFilter;
      query: string;
      sortMode: BoardSortMode;
      expectedKeys: string[];
      expectedCount: number;
    }> = [
      {
        filter: 'mine',
        query: '',
        sortMode: 'newest',
        expectedKeys: ['group:g_voted', 'card:c_mine_only'],
        expectedCount: 2,
      },
      {
        filter: 'voted',
        query: '',
        sortMode: 'most-voted',
        expectedKeys: ['card:c_voted_action', 'group:g_voted'],
        expectedCount: 3, // c_voted_action + both members of g_voted
      },
      {
        filter: 'action-items',
        query: '',
        sortMode: 'newest',
        expectedKeys: ['group:g_voted', 'card:c_voted_action'],
        expectedCount: 2, // c_gv1 + c_voted_action
      },
      {
        filter: 'action-items',
        query: 'alerting',
        sortMode: 'newest',
        expectedKeys: ['group:g_voted'],
        expectedCount: 1,
      },
    ];

    for (const testCase of cases) {
      const view = projectBoardView(board, {
        query: testCase.query,
        filter: testCase.filter,
        sortMode: testCase.sortMode,
      });
      expect(columnView(view, 'col_1')?.items.map((item) => item.key)).toEqual(
        testCase.expectedKeys,
      );
      expect(view.matchedCardCount).toBe(testCase.expectedCount);
    }
  });

  it('exposes complete per-Column Card and Card Group lists alongside the filtered stream', () => {
    const group = makeGroup({
      id: 'g_all',
      columnId: 'col_1',
      title: 'Keep shipping',
      cardIds: ['c_g1', 'c_g2'],
      createdAt: 2_500,
    });
    const board = makeBoard({
      groups: [group],
      cards: [
        makeCard({ id: 'c_g1', columnId: 'col_1', groupId: 'g_all', content: 'Member one', createdAt: 1_000 }),
        makeCard({ id: 'c_g2', columnId: 'col_1', groupId: 'g_all', content: 'Member two', createdAt: 1_100 }),
        makeCard({ id: 'c_1', columnId: 'col_1', content: 'Standalone card', createdAt: 1_200 }),
        makeCard({ id: 'c_2', columnId: 'col_2', content: 'Other column card', createdAt: 1_300 }),
      ],
    });

    const view = projectBoardView(board, { query: 'member', filter: 'all', sortMode: 'newest' });
    expect(view.columns.map((column) => column.id)).toEqual(['col_1', 'col_2']);
    expect(view.cards.map((card) => card.id)).toEqual(['c_g1', 'c_g2', 'c_1', 'c_2']);
    expect(view.columnViews.map((entry) => entry.id)).toEqual(['col_1', 'col_2']);

    const col1 = columnView(view, 'col_1');
    // The per-Column lists stay complete regardless of the active filter.
    expect(col1?.cards.map((card) => card.id)).toEqual(['c_g1', 'c_g2', 'c_1']);
    expect(col1?.groups.map((entry) => entry.id)).toEqual(['g_all']);
    expect(col1?.totalCardCount).toBe(3);
    expect(col1?.items.map((item) => item.key)).toEqual(['group:g_all']);
    expect(col1?.visibleCardCount).toBe(2);

    const col2 = columnView(view, 'col_2');
    expect(col2?.cards.map((card) => card.id)).toEqual(['c_2']);
    expect(col2?.totalCardCount).toBe(1);
    expect(col2?.visibleCardCount).toBe(0);

    expect(view.matchedCardCount).toBe(2);
    expect(view.totalCardCount).toBe(4);
    expect(view.normalizedQuery).toBe('member');
  });

  it('formats concise match count summaries', () => {
    expect(formatMatchCountSummary(1, 5, true)).toBe('1 match (1 of 5 cards)');
    expect(formatMatchCountSummary(0, 5, true)).toBe('0 matches (0 of 5 cards)');
    expect(formatMatchCountSummary(2, 1, false)).toBe('2 of 1 card');
    expect(formatMatchCountSummary(3, 8, false)).toBe('3 of 8 cards');
  });
});

describe('createBoardProjection (keyed projection)', () => {
  interface ProjectionHarness {
    setBoard: (fn: (draft: BoardViewDTO) => void) => void;
    view: BoardViewProjection;
    setQuery: (query: string) => void;
    setFilter: (filter: BoardQuickFilter) => void;
    setSortMode: (mode: BoardSortMode) => void;
  }

  /** Deliberate point-in-time reads: identity assertions ignore reactivity. */
  function read<T>(fn: () => T): T {
    return untrack(fn);
  }

  function setupProjection(initial: {
    cards?: CardViewDTO[];
    groups?: CardGroupDTO[];
  }): ProjectionHarness {
    const [store, setStore] = createStore<BoardViewDTO>(
      makeBoardView({
        cards: initial.cards ?? [],
        groups: initial.groups ?? [],
      }),
    );
    const [query, setQuery] = createSignal('');
    const [filter, setFilter] = createSignal<BoardQuickFilter>('all');
    const [sortMode, setSortMode] = createSignal<BoardSortMode>('newest');
    const inputs: BoardProjectionInputs = { query, filter, sortMode };
    const view = createBoardProjection(() => store, inputs);
    flush();
    return { setBoard: setStore, view, setQuery, setFilter, setSortMode };
  }

  function makeStoreCard(overrides?: Partial<CardViewDTO>): CardViewDTO {
    return makeCard({ isMine: true, ...overrides });
  }

  it('preserves Card, Card Group, and stream identity across whole-item upserts', () => {
    const cardA = makeStoreCard({ id: 'card_a', content: 'Alpha', groupId: 'group_1', createdAt: 1_000, updatedAt: 1_000 });
    const cardB = makeStoreCard({ id: 'card_b', content: 'Beta', createdAt: 2_000, updatedAt: 2_000 });
    const group = {
      id: 'group_1',
      columnId: 'col_1',
      title: 'Theme',
      cardIds: ['card_a'],
      votes: 0,
      myVotes: 0,
      createdAt: 1_500,
    };
    const { setBoard, view } = setupProjection({ cards: [cardA, cardB], groups: [group] });

    const colView = read(() => view.columnViews[0]);
    const groupedCard = read(() => view.columnViews[0].cards.find((card) => card.id === 'card_a'));
    const groupRow = read(() => view.columnViews[0].items.find((item) => item.key === 'group:group_1'));
    const cardRow = read(() => view.columnViews[0].items.find((item) => item.key === 'card:card_b'));
    const bucketGroup = read(() => view.columnViews[0].groups[0]);

    // Whole-item upsert through the reducer: identity survives the adoption.
    setBoard((draft) => {
      applyBoardEvents(draft, [
        { type: 'card:upserted', version: 2, card: { ...cardA, content: 'Alpha edited' } },
      ]);
    });
    flush();
    expect(read(() => view.columnViews[0]) === colView).toBe(true);
    expect(
      read(() => view.columnViews[0].cards.find((card) => card.id === 'card_a')) === groupedCard,
    ).toBe(true);
    expect(read(() => groupedCard?.content)).toBe('Alpha edited');
    expect(read(() => view.cards.find((card) => card.id === 'card_a')) === groupedCard).toBe(true);
    expect(
      read(() => view.columnViews[0].items.find((item) => item.key === 'group:group_1')) === groupRow,
    ).toBe(true);
    expect(
      read(() => view.columnViews[0].items.find((item) => item.key === 'card:card_b')) === cardRow,
    ).toBe(true);

    // Group upsert: the bucket's group and the stream row keep identity too.
    setBoard((draft) => {
      applyBoardEvents(draft, [
        { type: 'group:upserted', version: 3, group: { ...group, title: 'Renamed theme' } },
      ]);
    });
    flush();
    expect(read(() => view.columnViews[0].groups[0]) === bucketGroup).toBe(true);
    expect(read(() => view.columnViews[0].groups[0].title)).toBe('Renamed theme');
    expect(
      read(() => view.columnViews[0].items.find((item) => item.key === 'group:group_1')) === groupRow,
    ).toBe(true);

    // Reactions and comments adopted as whole values stay readable.
    setBoard((draft) => {
      applyBoardEvents(draft, [
        {
          type: 'reaction:updated',
          version: 4,
          cardId: 'card_b',
          counts: { '👍': 2 },
          myReactions: ['👍'],
        },
      ]);
    });
    flush();
    expect(
      read(() => view.columnViews[0].cards.find((card) => card.id === 'card_b')?.reactions),
    ).toEqual({ '👍': 2 });
  });

  it('reorders stream items by key on sort changes so surviving rows keep their proxies', () => {
    const cardOld = makeStoreCard({ id: 'card_old', content: 'A1', createdAt: 1_000, updatedAt: 1_000 });
    const cardMid = makeStoreCard({ id: 'card_mid', content: 'B1', createdAt: 2_000, updatedAt: 2_000 });
    const cardNew = makeStoreCard({ id: 'card_new', content: 'A2', createdAt: 3_000, updatedAt: 3_000 });
    const { setBoard, view, setQuery, setSortMode } = setupProjection({
      cards: [cardOld, cardMid, cardNew],
    });

    const itemOld = read(() => view.columnViews[0].items.find((item) => item.key === 'card:card_old'));
    const itemMid = read(() => view.columnViews[0].items.find((item) => item.key === 'card:card_mid'));
    const itemNew = read(() => view.columnViews[0].items.find((item) => item.key === 'card:card_new'));

    // Sort reorder: keyed matching moves the rows instead of re-creating them.
    setSortMode('oldest');
    flush();
    expect(read(() => view.columnViews[0].items.map((item) => item.key))).toEqual([
      'card:card_old',
      'card:card_mid',
      'card:card_new',
    ]);
    setSortMode('newest');
    flush();
    expect(read(() => view.columnViews[0].items.map((item) => item.key))).toEqual([
      'card:card_new',
      'card:card_mid',
      'card:card_old',
    ]);
    expect(read(() => view.columnViews[0].items[0]) === itemNew).toBe(true);
    expect(read(() => view.columnViews[0].items[1]) === itemMid).toBe(true);
    expect(read(() => view.columnViews[0].items[2]) === itemOld).toBe(true);

    // Hide the middle Card: the survivors keep their item identity.
    setQuery('a');
    flush();
    expect(read(() => view.columnViews[0].items.map((item) => item.key))).toEqual([
      'card:card_new',
      'card:card_old',
    ]);
    expect(
      read(() => view.columnViews[0].items.find((item) => item.key === 'card:card_old')) === itemOld,
    ).toBe(true);
    expect(
      read(() => view.columnViews[0].items.find((item) => item.key === 'card:card_new')) === itemNew,
    ).toBe(true);

    setQuery('');
    flush();
    expect(read(() => view.columnViews[0].items.map((item) => item.key))).toEqual([
      'card:card_new',
      'card:card_mid',
      'card:card_old',
    ]);
    expect(
      read(() => view.columnViews[0].items.find((item) => item.key === 'card:card_old')) === itemOld,
    ).toBe(true);
    expect(
      read(() => view.columnViews[0].items.find((item) => item.key === 'card:card_new')) === itemNew,
    ).toBe(true);
    // card_mid was disposed while filtered out; its slot holds a fresh item.
    expect(
      read(() => view.columnViews[0].items.find((item) => item.key === 'card:card_mid')) === itemMid,
    ).toBe(false);

    // Deleting the middle Card splices it out; its bucket slot is gone.
    setBoard((draft) => {
      applyBoardEvents(draft, [
        { type: 'card:deleted', version: 2, cardId: 'card_mid' },
      ]);
    });
    flush();
    expect(read(() => view.columnViews[0].items.map((item) => item.key))).toEqual([
      'card:card_new',
      'card:card_old',
    ]);
    expect(read(() => view.columnViews[0].totalCardCount)).toBe(2);
    expect(read(() => view.columnViews[0].items[0]) === itemNew).toBe(true);
    expect(read(() => view.columnViews[0].items[1]) === itemOld).toBe(true);
  });

  it('moves Cards between Column buckets on cross-Column upserts while Column buckets stay keyed', () => {
    const cardA = makeStoreCard({ id: 'card_a', content: 'Alpha', createdAt: 1_000, updatedAt: 1_000 });
    const cardB = makeStoreCard({ id: 'card_b', content: 'Beta', createdAt: 2_000, updatedAt: 2_000 });
    const { setBoard, view } = setupProjection({ cards: [cardA, cardB] });

    const colView1 = read(() => view.columnViews[0]);
    const colView2 = read(() => view.columnViews[1]);

    setBoard((draft) => {
      applyBoardEvents(draft, [
        {
          type: 'card:upserted',
          version: 2,
          card: { ...cardA, columnId: 'col_2', content: 'Alpha moved' },
        },
      ]);
    });
    flush();

    expect(read(() => view.columnViews[0]) === colView1).toBe(true);
    expect(read(() => view.columnViews[1]) === colView2).toBe(true);
    expect(read(() => view.columnViews[0].cards.map((card) => card.id))).toEqual(['card_b']);
    expect(read(() => view.columnViews[1].cards.map((card) => card.id))).toEqual(['card_a']);
    expect(read(() => view.columnViews[0].items.map((item) => item.key))).toEqual(['card:card_b']);
    expect(read(() => view.columnViews[1].items.map((item) => item.key))).toEqual(['card:card_a']);
    expect(read(() => view.columnViews[0].totalCardCount)).toBe(1);
    expect(read(() => view.columnViews[1].totalCardCount)).toBe(1);
    // The flat Card list keeps every Card in board order.
    expect(read(() => view.cards.map((card) => card.id))).toEqual(['card_a', 'card_b']);
  });

  it('keeps totals and per-Column lists intact through mutations and filter changes', () => {
    const cardMine = makeStoreCard({ id: 'card_mine', content: 'My card', isMine: true, createdAt: 1_000, updatedAt: 1_000 });
    const cardOther = makeStoreCard({ id: 'card_other', content: 'Their card', isMine: false, createdAt: 2_000, updatedAt: 2_000 });
    const { setBoard, view, setFilter } = setupProjection({ cards: [cardMine, cardOther] });

    expect(read(() => view.matchedCardCount)).toBe(2);
    expect(read(() => view.totalCardCount)).toBe(2);
    expect(read(() => view.hasActiveFilter)).toBe(false);

    setFilter('mine');
    flush();
    expect(read(() => view.columnViews[0].items.map((item) => item.key))).toEqual(['card:card_mine']);
    expect(read(() => view.columnViews[0].visibleCardCount)).toBe(1);
    expect(read(() => view.columnViews[0].totalCardCount)).toBe(2);
    // The per-Column Card list stays complete while filtered.
    expect(read(() => view.columnViews[0].cards.map((card) => card.id))).toEqual([
      'card_mine',
      'card_other',
    ]);
    expect(read(() => view.matchedCardCount)).toBe(1);
    expect(read(() => view.hasActiveFilter)).toBe(true);

    // A new Card lands in the complete list and the stream while filtered.
    setBoard((draft) => {
      applyBoardEvents(draft, [
        {
          type: 'card:upserted',
          version: 2,
          card: makeStoreCard({ id: 'card_new', content: 'Fresh card', isMine: true, createdAt: 3_000, updatedAt: 3_000 }),
        },
      ]);
    });
    flush();
    expect(read(() => view.columnViews[0].cards.map((card) => card.id))).toEqual([
      'card_mine',
      'card_other',
      'card_new',
    ]);
    expect(read(() => view.columnViews[0].items.map((item) => item.key))).toEqual([
      'card:card_new',
      'card:card_mine',
    ]);
    expect(read(() => view.totalCardCount)).toBe(3);
    expect(read(() => view.matchedCardCount)).toBe(2);
  });

  it('serves an empty view while no Board is mounted', () => {
    const view = createBoardProjection(() => null, {
      query: () => '',
      filter: () => 'all',
      sortMode: () => 'newest',
    });
    flush();
    expect(read(() => view.columnViews)).toEqual([]);
    expect(read(() => view.columns)).toEqual([]);
    expect(read(() => view.cards)).toEqual([]);
    expect(read(() => view.matchedCardCount)).toBe(0);
    expect(read(() => view.hasActiveFilter)).toBe(false);
  });

  it('runs whole-item upserts, filter, and sort changes with zero reactivity diagnostics', async () => {
    const { artifact } = await captureArtifact(
      () => {
        const cardA = makeStoreCard({ id: 'card_a', content: 'Alpha', groupId: 'group_1', createdAt: 1_000, updatedAt: 1_000 });
        const cardB = makeStoreCard({ id: 'card_b', content: 'Beta', createdAt: 2_000, updatedAt: 2_000 });
        const group = {
          id: 'group_1',
          columnId: 'col_1',
          title: 'Theme',
          cardIds: ['card_a'],
          votes: 0,
          myVotes: 0,
          createdAt: 1_500,
        };
        const [store, setStore] = createStore<BoardViewDTO>(
          makeBoardView({ cards: [cardA, cardB], groups: [group] }),
        );
        const [query, setQuery] = createSignal('');
        const [filter, setFilter] = createSignal<BoardQuickFilter>('all');
        const [sortMode, setSortMode] = createSignal<BoardSortMode>('newest');
        const view = createBoardProjection(() => store, { query, filter, sortMode });
        flush();

        expect(untrack(() => view.columnViews[0].items.map((item) => item.key))).toEqual([
          'card:card_b',
          'group:group_1',
        ]);

        setStore((draft) => {
          applyBoardEvents(draft, [
            { type: 'card:upserted', version: 2, card: { ...cardA, content: 'Alpha edited' } },
            { type: 'group:upserted', version: 3, group: { ...group, title: 'Renamed' } },
          ]);
        });
        flush();
        setQuery('alph');
        flush();
        setFilter('mine');
        flush();
        setSortMode('oldest');
        flush();

        expect(untrack(() => view.columnViews[0].groups[0].title)).toBe('Renamed');
        expect(untrack(() => view.matchedCardCount)).toBe(1);
      },
      { scenario: 'board-view-keyed-projection' },
    );
    expectNoDiagnostics(artifact);
  });
});
