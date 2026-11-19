import { For, Show, createMemo, createSignal, createUniqueId } from 'solid-js';

import {
  BOARD_QUICK_FILTERS,
  BOARD_SORT_OPTIONS,
  formatMatchCountSummary,
  type BoardQuickFilter,
  type BoardSortMode,
} from '../lib/board-view';
import { ChevronRightIcon, CloseIcon, SearchIcon } from './Icons';

export interface BoardFilterBarProps {
  query: string;
  filter: BoardQuickFilter;
  requestedSortMode: BoardSortMode;
  effectiveSortMode: BoardSortMode;
  blindVoting: boolean;
  hasActiveFilter: boolean;
  hasSearchQuery: boolean;
  widenSearch?: boolean;
  matchedCardCount: number;
  totalCardCount: number;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: BoardQuickFilter) => void;
  onSortChange: (sortMode: BoardSortMode) => void;
  onResetFilters: () => void;
  onSearchInputRef?: (el: HTMLInputElement) => void;
}

export default function BoardFilterBar(props: BoardFilterBarProps) {
  const searchId = createUniqueId();
  const sortSelectId = createUniqueId();
  const filterControlsId = createUniqueId();
  const [showFilters, setShowFilters] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;

  const filterLabel = createMemo(() => {
    const filter = props.filter;
    return BOARD_QUICK_FILTERS.find((option) => option.value === filter)?.label;
  });
  const matchSummary = createMemo(() =>
    formatMatchCountSummary(
      props.matchedCardCount,
      props.totalCardCount,
      props.hasSearchQuery,
    ),
  );

  const isMostVotedPausedByBlindVoting = createMemo(
    () => props.blindVoting && props.requestedSortMode === 'most-voted',
  );

  function handleSearchKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onQueryChange('');
      searchInput?.blur();
    }
  }

  return (
    <section
      aria-label="Search, filter, and sort Board"
      data-print-hide="true"
      class="border-b border-border"
    >
      <div class="mx-auto max-w-[1600px] px-3 py-3 sm:px-6">
        <div class="flex flex-wrap items-end gap-2 sm:items-center sm:gap-x-4">
          <div
            class={[
              'secret-search-field min-w-[min(9rem,100%)] flex-1 sm:flex sm:max-w-72 sm:items-center sm:gap-2',
              { 'secret-search-wide': props.widenSearch },
            ]}
          >
            <label for={searchId} class="mb-1 block text-sm font-medium text-text sm:mb-0">
              Search
            </label>
            <div class="relative min-w-0 flex-1">
              <SearchIcon class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted" />
              <input
                id={searchId}
                ref={(el) => {
                  searchInput = el;
                  props.onSearchInputRef?.(el);
                }}
                type="search"
                aria-label="Search Cards, Card Groups, and comments"
                aria-keyshortcuts="/"
                value={props.query}
                onInput={(event) => props.onQueryChange(event.currentTarget.value)}
                onKeyDown={handleSearchKeyDown}
                class={[
                  'min-h-11 w-full rounded-lg border border-control bg-surface py-1.5 pr-12 pl-9 text-base text-text sm:min-h-9',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  '[&::-webkit-search-cancel-button]:appearance-none',
                ]}
              />
              <Show
                when={props.query.length > 0}
                fallback={
                  <kbd
                    aria-hidden="true"
                    class="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-border bg-canvas px-1.5 py-0.5 font-mono text-xs text-text-muted sm:inline-flex"
                  >
                    /
                  </kbd>
                }
              >
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    props.onQueryChange('');
                    searchInput?.focus();
                  }}
                  class="absolute top-1/2 right-px inline-flex min-h-11 min-w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-subtle hover:text-text active:bg-surface-subtle sm:min-h-9 sm:min-w-9"
                >
                  <CloseIcon class="size-4" />
                </button>
              </Show>
            </div>
          </div>

          <button
            type="button"
            aria-expanded={showFilters() ? 'true' : 'false'}
            aria-controls={filterControlsId}
            onClick={() => setShowFilters((open) => !open)}
            class="group inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-control bg-surface px-3 py-2 text-left text-sm font-medium text-text transition-colors hover:bg-surface-subtle active:bg-surface-subtle sm:hidden"
          >
            Filter &amp; sort
            <ChevronRightIcon class="size-4 shrink-0 group-aria-expanded:rotate-90" />
          </button>

          <div
            id={filterControlsId}
            class={[
              'w-full min-w-0 flex-wrap items-center gap-2 sm:flex sm:w-auto sm:gap-x-4',
              showFilters() ? 'flex' : 'hidden',
            ]}
          >
            <div role="group" aria-label="Filter cards" class="flex flex-wrap items-center gap-1">
              <For each={BOARD_QUICK_FILTERS}>
                {(option) => (
                  <button
                    type="button"
                    aria-pressed={props.filter === option.value ? 'true' : 'false'}
                    onClick={() => props.onFilterChange(option.value)}
                    class={[
                      'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors active:opacity-80 sm:min-h-9',
                      props.filter === option.value
                        ? 'border-accent bg-accent text-accent-contrast'
                        : 'border-control bg-surface text-text hover:bg-surface-subtle',
                    ]}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>

            <div class="flex max-w-full flex-wrap items-center gap-2">
              <label for={sortSelectId} class="text-sm font-medium text-text">
                Sort
              </label>
              <select
                id={sortSelectId}
                aria-label="Sort cards"
                value={props.effectiveSortMode}
                onChange={(event) =>
                  props.onSortChange(event.currentTarget.value as BoardSortMode)
                }
                class={[
                  'min-h-11 min-w-11 max-w-full cursor-pointer rounded-lg border border-control bg-surface px-3 py-1 text-base text-text sm:min-h-9',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                ]}
              >
                <For each={BOARD_SORT_OPTIONS}>
                  {(option) => (
                    <option
                      value={option.value}
                      disabled={option.value === 'most-voted' && props.blindVoting}
                    >
                      {option.value === 'most-voted' && props.blindVoting
                        ? `${option.label} (Blind Voting)`
                        : option.label}
                    </option>
                  )}
                </For>
              </select>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
          <div aria-live="polite" class="flex flex-wrap gap-x-2 tabular-nums">
            <Show when={props.hasActiveFilter}>
              <span class="mt-2 flex flex-wrap items-center gap-x-2">
                <Show when={props.filter !== 'all'}>
                  <span class="font-medium text-text">Filter: {filterLabel()}</span>
                </Show>
                <span>{matchSummary()}</span>
              </span>
            </Show>
            <Show when={isMostVotedPausedByBlindVoting()}>
              <span class="mt-2">Most Voted paused during Blind Voting</span>
            </Show>
          </div>
          <Show when={props.hasActiveFilter}>
            <button
              type="button"
              onClick={(event) => {
                props.onResetFilters();
                if (event.detail === 0) searchInput?.focus();
              }}
              class="mt-2 inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-control bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-subtle active:bg-surface-subtle sm:min-h-9"
            >
              Clear filters
            </button>
          </Show>
        </div>
      </div>
    </section>
  );
}
