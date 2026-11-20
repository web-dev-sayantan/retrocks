import { Toggle, ToggleGroup } from '@ui-sdk/solid/toggle';
import { ArrowUpDown, ChevronDown, Search, SlidersHorizontal, X } from 'lucide';
import { For, Show, createMemo, createSignal, createUniqueId } from 'solid-js';

import {
  BOARD_QUICK_FILTERS,
  BOARD_SORT_OPTIONS,
  formatMatchCountSummary,
  type BoardQuickFilter,
  type BoardSortMode,
} from '../lib/board-view';
import LucideIcon from './LucideIcon';

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

const focusRingClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export default function BoardFilterBar(props: BoardFilterBarProps) {
  const searchId = createUniqueId();
  const sortSelectId = createUniqueId();
  const filterControlsId = createUniqueId();
  const filterStatusId = createUniqueId();
  const [showFilters, setShowFilters] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;

  const activeFilterIndex = createMemo(() => {
    const index = BOARD_QUICK_FILTERS.findIndex((option) => option.value === props.filter);
    return index >= 0 ? index : 0;
  });
  const selectedFilterValue = createMemo((): BoardQuickFilter[] => [props.filter]);

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
  const hasStatusContent = createMemo(
    () => props.hasActiveFilter || isMostVotedPausedByBlindVoting(),
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
      class="border-b border-border/65"
    >
      <div class="mx-auto max-w-[1600px] px-3 py-0.5 sm:px-6 sm:py-2.5">
        <div class="flex flex-wrap items-center gap-2 sm:gap-2.5 sm:max-lg:grid sm:max-lg:grid-cols-[minmax(10rem,1fr)_minmax(0,auto)] lg:flex-nowrap lg:gap-3">
          <div
            class={[
              'secret-search-field group min-w-0 flex-1 sm:min-w-[min(10rem,100%)] sm:max-lg:col-start-1 sm:max-lg:row-start-1 lg:max-w-48 xl:max-w-64',
              { 'secret-search-wide': props.widenSearch },
            ]}
          >
            <label for={searchId} class="sr-only">
              Search
            </label>
            <div class="relative min-w-0">
              <LucideIcon
                icon={Search}
                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted transition-colors group-focus-within:text-text"
                strokeWidth={1.85}
              />
              <input
                id={searchId}
                ref={(el) => {
                  searchInput = el;
                  props.onSearchInputRef?.(el);
                }}
                type="search"
                placeholder="Search cards…"
                aria-label="Search Cards, Card Groups, and comments"
                aria-keyshortcuts="/"
                value={props.query}
                onInput={(event) => props.onQueryChange(event.currentTarget.value)}
                onKeyDown={handleSearchKeyDown}
                class={[
                  'h-11 w-full rounded-xl border border-border/85 bg-surface py-1.5 pr-11 pl-9 text-base text-text placeholder:text-text-muted/75 transition-colors hover:border-control/75 focus-visible:border-accent sm:h-9 sm:pr-9 sm:text-[13px]',
                  focusRingClass,
                  '[&::-webkit-search-cancel-button]:appearance-none',
                ]}
              />
              <Show
                when={props.query.length > 0}
                fallback={
                  <kbd
                    aria-hidden="true"
                    class="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 items-center justify-center rounded-md border border-border/80 bg-surface-subtle/80 px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none text-text-muted sm:inline-flex"
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
                  class={[
                    'spring-press absolute top-1/2 right-px inline-flex min-h-11 min-w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-subtle hover:text-text active:bg-surface-subtle sm:right-1 sm:min-h-7 sm:min-w-7',
                    focusRingClass,
                  ]}
                >
                  <LucideIcon icon={X} class="size-3.5" strokeWidth={2} />
                </button>
              </Show>
            </div>
          </div>

          <button
            type="button"
            aria-expanded={showFilters() ? 'true' : 'false'}
            aria-controls={`${filterControlsId} ${filterStatusId}`}
            onClick={() => setShowFilters((open) => !open)}
            class={[
              'spring-press inline-flex h-11 w-36 max-w-full shrink-0 cursor-pointer items-center justify-between gap-1.5 rounded-xl border border-border/85 bg-surface px-3 text-left text-sm font-medium text-text transition-colors hover:border-control/75 hover:bg-surface-subtle active:bg-surface-subtle sm:hidden',
              focusRingClass,
            ]}
          >
            <LucideIcon
              icon={SlidersHorizontal}
              class="size-3.5 shrink-0 text-text-muted"
              strokeWidth={1.85}
            />
            <span class="grid min-w-0 gap-0.5 whitespace-nowrap leading-none">
              <span>Filter &amp; sort</span>
              <Show when={props.hasActiveFilter || isMostVotedPausedByBlindVoting()}>
                <span aria-hidden="true" class="truncate text-[11px] font-normal text-text-muted tabular-nums">
                  {props.hasActiveFilter
                    ? `${props.matchedCardCount} ${props.matchedCardCount === 1 ? 'match' : 'matches'}`
                    : 'Sort paused'}
                </span>
              </Show>
            </span>
            <LucideIcon
              icon={ChevronDown}
              class={[
                'spring-chevron size-3.5 shrink-0 text-text-muted',
                { 'rotate-180': showFilters() },
              ]}
              strokeWidth={2}
            />
          </button>

          <div
            id={filterControlsId}
            class={[
              'w-full min-w-0 flex-wrap items-center gap-2 sm:flex sm:w-auto sm:shrink-0 sm:flex-nowrap sm:gap-2.5 sm:max-lg:col-span-2 sm:max-lg:row-start-2 lg:gap-3',
              showFilters() ? 'disclosure-reveal flex' : 'hidden',
            ]}
          >
            <ToggleGroup<BoardQuickFilter>
              aria-label="Filter cards"
              value={selectedFilterValue()}
              deselectable={false}
              onValueChange={(next) => {
                const selected = next[0];
                if (selected) props.onFilterChange(selected);
              }}
              class="segmented-track relative grid w-full grid-cols-4 items-center rounded-xl border border-border/75 p-1 sm:h-9 sm:w-auto"
            >
              <span
                aria-hidden="true"
                class="segmented-thumb pointer-events-none absolute inset-y-1 left-1 rounded-lg"
                style={{
                  '--seg-count': String(BOARD_QUICK_FILTERS.length),
                  '--seg-index': String(activeFilterIndex()),
                }}
              />
              <For each={BOARD_QUICK_FILTERS}>
                {(option) => (
                  <Toggle
                    value={option.value}
                    data-label={option.label}
                    class={[
                      'spring-press relative z-10 inline-flex min-h-11 cursor-pointer flex-col items-center justify-center whitespace-nowrap rounded-lg px-2 text-xs font-medium leading-none text-text-muted transition-colors after:block after:h-0 after:overflow-hidden after:invisible after:select-none after:font-semibold after:content-[attr(data-label)] hover:text-text data-pressed:font-semibold data-pressed:text-text sm:h-full sm:min-h-0 sm:px-2 sm:text-[13px] xl:px-2.5',
                      focusRingClass,
                    ]}
                  >
                    {option.label}
                  </Toggle>
                )}
              </For>
            </ToggleGroup>

            <div class="flex w-full items-center sm:w-auto">
              <label for={sortSelectId} class="sr-only">
                Sort
              </label>
              <div class="relative inline-flex w-full items-center sm:w-auto">
                <LucideIcon
                  icon={ArrowUpDown}
                  class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-muted"
                  strokeWidth={1.85}
                />
                <select
                  id={sortSelectId}
                  aria-label="Sort cards"
                  value={props.effectiveSortMode}
                  onChange={(event) =>
                    props.onSortChange(event.currentTarget.value as BoardSortMode)
                  }
                  class={[
                    'h-11 w-full appearance-none cursor-pointer rounded-xl border border-border/85 bg-surface pr-8 pl-8 text-base font-medium text-text transition-colors hover:border-control/75 hover:bg-surface-subtle/50 focus-visible:border-accent sm:h-9 sm:w-auto sm:text-[13px]',
                    focusRingClass,
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
                <LucideIcon
                  icon={ChevronDown}
                  class="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-text-muted"
                  strokeWidth={2}
                />
              </div>
            </div>
          </div>

          <div
            id={filterStatusId}
            data-filter-status-slot=""
            class={[
              'flex min-w-0 items-center justify-between gap-2 text-xs text-text-muted sm:ml-auto sm:justify-end sm:max-lg:col-start-2 sm:max-lg:row-start-1',
              showFilters() ? 'max-sm:h-11 max-sm:w-full' : 'max-sm:sr-only',
              !hasStatusContent() && 'sm:sr-only',
            ]}
          >
            <div
              aria-live="polite"
              class="flex min-w-0 items-start gap-x-2 gap-y-1 tabular-nums max-sm:flex-col sm:items-center"
            >
              <Show when={props.hasActiveFilter}>
                <span class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-surface-subtle/80 px-2.5 py-1 text-xs leading-none text-text-muted ring-1 ring-inset ring-border/70 sm:h-7">
                  <Show when={props.filter !== 'all'}>
                    <span class="shrink-0 font-semibold text-text">Filter: {filterLabel()}</span>
                    <span aria-hidden="true" class="h-3 w-px shrink-0 bg-border/80" />
                  </Show>
                  <span class="truncate" title={matchSummary()}>
                    {matchSummary()}
                  </span>
                </span>
              </Show>
              <Show when={props.hasActiveFilter && props.totalCardCount > 0 && props.matchedCardCount === 0}>
                <span class="sr-only">No Cards match your current search or filter.</span>
              </Show>
              <Show when={isMostVotedPausedByBlindVoting()}>
                <span class="block max-w-full truncate rounded-full bg-surface-subtle/80 px-2.5 py-1 text-xs leading-none text-text-muted ring-1 ring-inset ring-border/70 sm:py-2" title="Most Voted paused during Blind Voting">
                  Most Voted paused during Blind Voting
                </span>
              </Show>
            </div>
            <Show when={props.hasActiveFilter}>
              <button
                type="button"
                onClick={() => {
                  props.onResetFilters();
                  searchInput?.focus();
                }}
                class={[
                  'spring-press inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-xl border border-border/85 bg-surface px-3 text-xs font-semibold text-text transition-colors hover:border-control/75 hover:bg-surface-subtle active:bg-surface-subtle sm:h-9 sm:min-h-0 sm:px-2.5 sm:text-[13px]',
                  !showFilters() && 'max-sm:hidden',
                  focusRingClass,
                ]}
              >
                <LucideIcon icon={X} class="size-3.5 text-text-muted" strokeWidth={2} />
                <span>Clear filters</span>
              </button>
            </Show>
          </div>
        </div>
      </div>
    </section>
  );
}
