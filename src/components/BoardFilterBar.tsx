import { For, Show, createMemo, createUniqueId } from 'solid-js';

import {
  BOARD_QUICK_FILTERS,
  BOARD_SORT_OPTIONS,
  formatMatchCountSummary,
  type BoardQuickFilter,
  type BoardSortMode,
} from '../lib/board-view';
import { CloseIcon, SearchIcon } from './Icons';

export interface BoardFilterBarProps {
  query: string;
  filter: BoardQuickFilter;
  requestedSortMode: BoardSortMode;
  effectiveSortMode: BoardSortMode;
  blindVoting: boolean;
  hasActiveFilter: boolean;
  hasSearchQuery: boolean;
  matchedCardCount: number;
  totalCardCount: number;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: BoardQuickFilter) => void;
  onSortChange: (sortMode: BoardSortMode) => void;
  onResetFilters: () => void;
  onSearchInputRef?: (el: HTMLInputElement) => void;
}

export default function BoardFilterBar(props: BoardFilterBarProps) {
  const sortSelectId = createUniqueId();
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
      if (props.query.length > 0) {
        props.onQueryChange('');
      }
      if (event.currentTarget instanceof HTMLInputElement) {
        event.currentTarget.blur();
      }
    }
  }

  return (
    <section
      aria-label="Search, filter, and sort Board"
      class="border-b border-border/70 bg-surface/60"
    >
      <div class="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-2 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        {/* Search input + Sort dropdown row on mobile/tablet */}
        <div class="flex min-w-0 flex-wrap items-center gap-2 lg:flex-nowrap">
          <div class="relative min-w-0 flex-1 sm:w-64 sm:flex-none lg:w-72">
            <span
              aria-hidden="true"
              class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted"
            >
              <SearchIcon class="h-3.5 w-3.5" />
            </span>
            <input
              ref={(el) => props.onSearchInputRef?.(el)}
              type="search"
              aria-label="Search Cards, Card Groups, and comments"
              aria-keyshortcuts="/"
              placeholder="Search cards, groups, comments..."
              value={props.query}
              onInput={(event) => props.onQueryChange(event.currentTarget.value)}
              onKeyDown={handleSearchKeyDown}
              class={[
                'min-h-11 w-full rounded-lg border border-border bg-canvas py-1.5 pr-9 pl-8 text-xs text-text sm:min-h-9 sm:text-sm',
                'placeholder:text-text-muted focus:border-focus focus:outline-none',
                '[&::-webkit-search-cancel-button]:appearance-none',
              ]}
            />
            <Show
              when={props.query.length > 0}
              fallback={
                <kbd
                  aria-hidden="true"
                  class="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:inline-flex"
                >
                  /
                </kbd>
              }
            >
              <button
                type="button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => props.onQueryChange('')}
                class={[
                  'absolute top-1/2 right-1 inline-flex min-h-9 min-w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-text-muted sm:min-h-7 sm:min-w-7',
                  'transition-colors hover:bg-surface-subtle hover:text-text',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                ]}
              >
                <CloseIcon class="h-3.5 w-3.5" />
              </button>
            </Show>
          </div>

          <div class="flex shrink-0 items-center gap-1.5">
            <label
              for={sortSelectId}
              class="hidden text-xs font-medium text-text-muted sm:inline"
            >
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
                'min-h-11 cursor-pointer rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text sm:min-h-9',
                'focus:border-focus focus:outline-none',
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

        {/* Quick Filter chips + match count / reset */}
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-2 lg:flex-1 lg:justify-end">
          <div
            role="group"
            aria-label="Filter cards"
            class="flex max-w-full items-center gap-1 overflow-x-auto"
          >
            <For each={BOARD_QUICK_FILTERS}>
              {(chip) => (
                <button
                  type="button"
                  aria-pressed={props.filter === chip.value ? 'true' : 'false'}
                  onClick={() => props.onFilterChange(chip.value)}
                  class={[
                    'inline-flex min-h-11 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-colors sm:min-h-8',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    {
                      'border-accent bg-accent text-accent-contrast':
                        props.filter === chip.value,
                      'border-border bg-surface text-text-muted hover:bg-surface-subtle hover:text-text':
                        props.filter !== chip.value,
                    },
                  ]}
                >
                  {chip.label}
                </button>
              )}
            </For>
          </div>

          <Show when={props.hasActiveFilter || isMostVotedPausedByBlindVoting()}>
            <div class="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <Show when={isMostVotedPausedByBlindVoting()}>
                <span class="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-muted">
                  Most Voted paused during Blind Voting
                </span>
              </Show>
              <Show when={props.hasActiveFilter}>
                <span
                  aria-live="polite"
                  class="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium text-text tabular-nums"
                >
                  {matchSummary()}
                </span>
                <button
                  type="button"
                  onClick={() => props.onResetFilters()}
                  class={[
                    'inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-text-muted sm:min-h-8',
                    'transition-colors hover:bg-surface-subtle hover:text-text',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  ]}
                >
                  Reset filters
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </section>
  );
}
