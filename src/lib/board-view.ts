import type { BoardViewDTO, CardGroupDTO, CardViewDTO } from './board-types';

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
  columnId: string;
  items: ColumnStreamItem[];
  visibleCardCount: number;
  totalCardCount: number;
}

export interface BoardViewProjection {
  effectiveSortMode: BoardSortMode;
  hasActiveFilter: boolean;
  hasSearchQuery: boolean;
  normalizedQuery: string;
  totalCardCount: number;
  matchedCardCount: number;
  columns: Map<string, ColumnViewProjection>;
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

  const cardsByColumn = new Map<string, CardViewDTO[]>();
  const groupsByColumn = new Map<string, CardGroupDTO[]>();

  for (const column of board.columns) {
    cardsByColumn.set(column.id, []);
    groupsByColumn.set(column.id, []);
  }

  for (const card of board.cards) {
    let list = cardsByColumn.get(card.columnId);
    if (!list) {
      list = [];
      cardsByColumn.set(card.columnId, list);
    }
    list.push(card);
  }

  for (const group of board.groups) {
    let list = groupsByColumn.get(group.columnId);
    if (!list) {
      list = [];
      groupsByColumn.set(group.columnId, list);
    }
    list.push(group);
  }

  const columns = new Map<string, ColumnViewProjection>();
  let matchedCardCount = 0;

  for (const column of board.columns) {
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
    columns.set(column.id, {
      columnId: column.id,
      items,
      visibleCardCount,
      totalCardCount: columnCards.length,
    });
  }

  return {
    effectiveSortMode,
    hasActiveFilter,
    hasSearchQuery,
    normalizedQuery,
    totalCardCount: board.cards.length,
    matchedCardCount,
    columns,
  };
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
