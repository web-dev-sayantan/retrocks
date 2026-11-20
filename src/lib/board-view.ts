import { createMemo, createProjection, mapArray, type Store } from 'solid-js';

import type { BoardViewDTO, CardGroupDTO, CardViewDTO, ColumnDTO } from './board-types';
import { cloneCardGroup, cloneCardView } from './board-types';

export type BoardSortMode = 'newest' | 'oldest' | 'most-voted';
export type BoardQuickFilter = 'all' | 'mine' | 'voted' | 'action-items';

export const BOARD_SORT_OPTIONS: readonly {
  value: BoardSortMode;
  label: string;
}[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most-voted', label: 'Most Voted' },
];

export const BOARD_QUICK_FILTERS: readonly {
  value: BoardQuickFilter;
  label: string;
}[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'voted', label: 'Voted' },
  { value: 'action-items', label: 'Action Items' },
];

export interface BoardViewFilterOptions {
  query: string;
  filter: BoardQuickFilter;
  sortMode: BoardSortMode;
}

export type ColumnStreamItem =
  | {
      kind: 'card';
      key: string;
      card: CardViewDTO;
    }
  | {
      kind: 'group';
      key: string;
      group: CardGroupDTO;
      cards: CardViewDTO[];
    };

export interface ColumnViewProjection {
  /** Column id — the reconcile key for this bucket. */
  id: string;
  column: ColumnDTO;
  /** Every Card in this Column, unfiltered — grouping targets and drag checks read these. */
  cards: CardViewDTO[];
  /** Every Card Group in this Column, unfiltered. */
  groups: CardGroupDTO[];
  /** Filtered and sorted Card/Card Group stream for this Column. */
  items: ColumnStreamItem[];
  visibleCardCount: number;
  totalCardCount: number;
}

export interface BoardViewProjection {
  /** Every Column DTO in board order — Column/Card move menus read these. */
  columns: ColumnDTO[];
  /** Per-Column buckets — the Column panels' single grouping source. */
  columnViews: ColumnViewProjection[];
  /** Every Card in board order — Action Items and open-detail lookups read these. */
  cards: CardViewDTO[];
  effectiveSortMode: BoardSortMode;
  hasActiveFilter: boolean;
  hasSearchQuery: boolean;
  normalizedQuery: string;
  totalCardCount: number;
  matchedCardCount: number;
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function resolveEffectiveSortMode(
  sortMode: BoardSortMode,
  blindVoting: boolean,
): BoardSortMode {
  return sortMode === 'most-voted' && blindVoting ? 'newest' : sortMode;
}

export function cardMatchesSearch(
  card: CardViewDTO,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) return true;
  if (card.redacted) return false;
  if (card.content.toLowerCase().includes(normalizedQuery)) return true;
  return card.comments.some((comment) =>
    comment.content.toLowerCase().includes(normalizedQuery),
  );
}

export function cardMatchesQuickFilter(
  card: CardViewDTO,
  filter: BoardQuickFilter,
  group: CardGroupDTO | null = null,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'mine':
      return card.isMine;
    case 'voted':
      return group !== null
        ? (!group.redacted && group.myVotes > 0) || (!card.redacted && card.myVotes > 0)
        : !card.redacted && card.myVotes > 0;
    case 'action-items':
      return !card.redacted && card.isActionItem;
  }
}

function sortCardsByMode(
  cards: readonly CardViewDTO[],
  effectiveSortMode: BoardSortMode,
): CardViewDTO[] {
  const sorted = [...cards];
  sorted.sort((a, b) =>
    effectiveSortMode === 'oldest'
      ? a.createdAt - b.createdAt
      : b.createdAt - a.createdAt,
  );
  return sorted;
}

function getItemSortTimestamp(item: ColumnStreamItem): number {
  return item.kind === 'group' ? item.group.createdAt : item.card.createdAt;
}

function getItemSortVotes(item: ColumnStreamItem): number {
  const votes = item.kind === 'group' ? item.group.votes : item.card.votes;
  return votes ?? 0;
}

export function projectBoardView(
  board: Pick<BoardViewDTO, 'columns' | 'cards' | 'groups' | 'blindVoting'>,
  options: BoardViewFilterOptions,
): BoardViewProjection {
  const normalizedQuery = normalizeSearchQuery(options.query);
  const hasSearchQuery = normalizedQuery.length > 0;
  const hasActiveFilter = hasSearchQuery || options.filter !== 'all';
  const effectiveSortMode = resolveEffectiveSortMode(
    options.sortMode,
    board.blindVoting,
  );

  // Inputs arrive as per-item defensive copies (see createBoardProjection), so
  // the same clone safely serves the flat list, the Column bucket, and the
  // stream entry — they stay one store target after adoption.
  const { columns, cards, groups } = board;

  const cardsByColumn = new Map<string, CardViewDTO[]>();
  const groupsByColumn = new Map<string, CardGroupDTO[]>();

  for (const column of columns) {
    cardsByColumn.set(column.id, []);
    groupsByColumn.set(column.id, []);
  }

  for (const card of cards) {
    let list = cardsByColumn.get(card.columnId);
    if (!list) {
      list = [];
      cardsByColumn.set(card.columnId, list);
    }
    list.push(card);
  }

  for (const group of groups) {
    let list = groupsByColumn.get(group.columnId);
    if (!list) {
      list = [];
      groupsByColumn.set(group.columnId, list);
    }
    list.push(group);
  }

  const columnViews: ColumnViewProjection[] = [];
  let matchedCardCount = 0;

  for (const column of columns) {
    const columnCards = cardsByColumn.get(column.id) ?? [];
    const columnGroups = groupsByColumn.get(column.id) ?? [];
    const items: ColumnStreamItem[] = [];
    let visibleCardCount = 0;

    for (const group of columnGroups) {
      const memberCards = columnCards.filter(
        (card) => card.groupId === group.id,
      );
      if (memberCards.length === 0) continue;

      const filterMatchedMembers = memberCards.filter((card) =>
        cardMatchesQuickFilter(card, options.filter, group),
      );
      if (filterMatchedMembers.length === 0) continue;

      const groupTitleMatches =
        hasSearchQuery &&
        !group.redacted &&
        group.title.toLowerCase().includes(normalizedQuery);
      const visibleMembers =
        !hasSearchQuery || groupTitleMatches
          ? filterMatchedMembers
          : filterMatchedMembers.filter((card) =>
              cardMatchesSearch(card, normalizedQuery),
            );
      if (visibleMembers.length === 0) continue;

      items.push({
        kind: 'group',
        key: `group:${group.id}`,
        group,
        cards: sortCardsByMode(visibleMembers, effectiveSortMode),
      });
      visibleCardCount += visibleMembers.length;
    }

    for (const card of columnCards) {
      if (card.groupId !== null) continue;
      if (!cardMatchesQuickFilter(card, options.filter, null)) continue;
      if (!cardMatchesSearch(card, normalizedQuery)) continue;
      items.push({
        kind: 'card',
        key: `card:${card.id}`,
        card,
      });
      visibleCardCount += 1;
    }

    items.sort((a, b) => {
      if (effectiveSortMode === 'most-voted') {
        const voteDiff = getItemSortVotes(b) - getItemSortVotes(a);
        if (voteDiff !== 0) return voteDiff;
        return getItemSortTimestamp(b) - getItemSortTimestamp(a);
      }
      if (effectiveSortMode === 'oldest') {
        return getItemSortTimestamp(a) - getItemSortTimestamp(b);
      }
      return getItemSortTimestamp(b) - getItemSortTimestamp(a);
    });

    matchedCardCount += visibleCardCount;
    columnViews.push({
      id: column.id,
      column,
      cards: columnCards,
      groups: columnGroups,
      items,
      visibleCardCount,
      totalCardCount: columnCards.length,
    });
  }

  return {
    columns,
    columnViews,
    cards,
    effectiveSortMode,
    hasActiveFilter,
    hasSearchQuery,
    normalizedQuery,
    totalCardCount: cards.length,
    matchedCardCount,
  };
}

/** Viewer-local reactive inputs to the Board projection. */
export interface BoardProjectionInputs {
  query: () => string;
  filter: () => BoardQuickFilter;
  sortMode: () => BoardSortMode;
}

// Reconcile identity: Cards, Card Groups, Columns, and buckets carry `id`;
// Column stream items carry their `key` (`card:`/`group:` prefixed).
function projectionKey(item: { id?: string; key?: string }): unknown {
  return item.id ?? item.key;
}

const EMPTY_BOARD_VIEW: BoardViewProjection = {
  columns: [],
  columnViews: [],
  cards: [],
  effectiveSortMode: 'newest',
  hasActiveFilter: false,
  hasSearchQuery: false,
  normalizedQuery: '',
  totalCardCount: 0,
  matchedCardCount: 0,
};

/**
 * The single keyed projection over the Board store (#51): reads the Board and
 * the viewer-local filter inputs, then reconciles the rebuilt view by key so
 * surviving Cards, Card Groups, and stream items keep their store identity
 * across upserts, reorders, and filter changes. `columnViews` groups Cards
 * and Card Groups per Column once — consumers never regroup or re-diff.
 *
 * The defensive copies are produced by per-item `mapArray` rows, not in the
 * derive: each Card's clone re-runs only when that Card changes, so no single
 * scope tracks every field of every Card.
 */
export function createBoardProjection(
  board: () => BoardViewDTO | null,
  inputs: BoardProjectionInputs,
): Store<BoardViewProjection> {
  const clonedCards = mapArray(
    () => board()?.cards,
    (card) => createMemo(() => cloneCardView(card)),
    { name: 'board-projection-cards' },
  );
  const clonedGroups = mapArray(
    () => board()?.groups,
    (group) => createMemo(() => cloneCardGroup(group)),
    { name: 'board-projection-groups' },
  );
  const clonedColumns = mapArray(
    () => board()?.columns,
    (column) => createMemo(() => ({ ...column })),
    { name: 'board-projection-columns' },
  );

  return createProjection(
    () => {
      const current = board();
      if (current === null) return EMPTY_BOARD_VIEW;
      return projectBoardView(
        {
          columns: clonedColumns().map((column) => column()),
          cards: clonedCards().map((card) => card()),
          groups: clonedGroups().map((group) => group()),
          blindVoting: current.blindVoting,
        },
        {
          query: inputs.query(),
          filter: inputs.filter(),
          sortMode: inputs.sortMode(),
        },
      );
    },
    null,
    { key: projectionKey },
  );
}

export function formatMatchCountSummary(
  matchedCardCount: number,
  totalCardCount: number,
  hasSearchQuery: boolean,
): string {
  const cardUnit = totalCardCount === 1 ? 'card' : 'cards';
  if (hasSearchQuery) {
    const matchUnit = matchedCardCount === 1 ? 'match' : 'matches';
    return `${matchedCardCount} ${matchUnit} (${matchedCardCount} of ${totalCardCount} ${cardUnit})`;
  }
  return `${matchedCardCount} of ${totalCardCount} ${cardUnit}`;
}
