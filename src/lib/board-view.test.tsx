import { describe, expect, it } from 'vitest';

import type { BoardViewDTO, CardGroupDTO, CardViewDTO, ColumnDTO } from './board-types';
import {
  formatMatchCountSummary,
  isEditableTarget,
  projectBoardView,
  type BoardQuickFilter,
  type BoardSortMode,
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
    expect(byComment.columns.get('col_1')?.items).toEqual([]);
    expect(byComment.columns.get('col_2')?.items.map((item) => item.key)).toEqual(['card:c_2']);

    // Matches Card Group title -> includes the group and its member Cards
    const byGroupTitle = projectBoardView(board, {
      query: 'reliability',
      filter: 'all',
      sortMode: 'newest',
    });
    expect(byGroupTitle.matchedCardCount).toBe(2);
    const col1Items = byGroupTitle.columns.get('col_1')?.items ?? [];
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
    const memberItems = byMemberCard.columns.get('col_1')?.items ?? [];
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
    expect(result.columns.get('col_1')?.items.map((item) => item.key)).toEqual(['card:c_mine']);
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
    expect(newest.columns.get('col_1')?.items.map((item) => item.key)).toEqual([
      'card:c_new',
      'group:g_1',
      'card:c_old',
    ]);

    const oldest = projectBoardView(board, { query: '', filter: 'all', sortMode: 'oldest' });
    expect(oldest.columns.get('col_1')?.items.map((item) => item.key)).toEqual([
      'card:c_old',
      'group:g_1',
      'card:c_new',
    ]);
    const oldestGroup = oldest.columns.get('col_1')?.items[1];
    if (oldestGroup?.kind === 'group') {
      expect(oldestGroup.cards.map((c) => c.id)).toEqual(['c_g1', 'c_g2']);
    }

    const mostVoted = projectBoardView(board, { query: '', filter: 'all', sortMode: 'most-voted' });
    expect(mostVoted.effectiveSortMode).toBe('most-voted');
    expect(mostVoted.columns.get('col_1')?.items.map((item) => item.key)).toEqual([
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
    expect(blindMostVoted.columns.get('col_1')?.items.map((item) => item.key)).toEqual([
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
      expect(view.columns.get('col_1')?.items.map((item) => item.key)).toEqual(
        testCase.expectedKeys,
      );
      expect(view.matchedCardCount).toBe(testCase.expectedCount);
    }
  });

  it('formats concise match count summaries and detects editable targets', () => {
    expect(formatMatchCountSummary(1, 5, true)).toBe('1 match (1 of 5 cards)');
    expect(formatMatchCountSummary(0, 5, true)).toBe('0 matches (0 of 5 cards)');
    expect(formatMatchCountSummary(2, 1, false)).toBe('2 of 1 card');
    expect(formatMatchCountSummary(3, 8, false)).toBe('3 of 8 cards');

    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editableDiv = document.createElement('div');
    editableDiv.setAttribute('contenteditable', 'true');
    const nonEditableDiv = document.createElement('div');
    nonEditableDiv.setAttribute('contenteditable', 'false');
    const button = document.createElement('button');

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(select)).toBe(true);
    expect(isEditableTarget(editableDiv)).toBe(true);
    expect(isEditableTarget(nonEditableDiv)).toBe(false);
    expect(isEditableTarget(button)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
