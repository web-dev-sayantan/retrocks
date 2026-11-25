import { ArrowUpDown, ChevronDown, Search, SlidersHorizontal, X } from 'lucide';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/solid/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui-sdk/solid/select';
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
  'board-focus-ring';

export default function BoardFilterBar(props: BoardFilterBarProps) {
  const searchId = createUniqueId();
  const filterControlsId = createUniqueId();
  const filterStatusId = createUniqueId();
  const [showFilters, setShowFilters] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;

  const sortItems = createMemo(() =>
    BOARD_SORT_OPTIONS.map((option) => ({
      ...option,
      disabled: option.value === 'most-voted' && props.blindVoting,
      label: option.value === 'most-voted' && props.blindVoting
        ? `${option.label} (Blind Voting)`
        : option.label,
    })),
  );

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
      <div class="mx-auto max-w-[1600px] px-3 py-2 sm:px-6 sm:py-2.5">
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
                  'h-11 w-full rounded-md border border-border/85 bg-surface py-1.5 pl-9 text-base text-text placeholder:text-text-muted/75 transition-colors hover:border-control/75 sm:h-9 sm:pr-9 sm:text-[13px]',
                  props.query.length > 0 ? 'pr-11' : 'pr-2',
                  focusRingClass,
                  '[&::-webkit-search-cancel-button]:appearance-none',
                ]}
              />
              <Show
                when={props.query.length > 0}
                fallback={
                  <kbd
                    aria-hidden="true"
                    class="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 items-center justify-center rounded-sm border border-border/80 bg-surface-subtle/80 px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none text-text-muted sm:inline-flex"
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
                    'spring-press absolute top-1/2 right-px inline-flex min-h-11 min-w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-subtle hover:text-text active:bg-surface-subtle sm:right-1 sm:min-h-7 sm:min-w-7',
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
              'spring-press relative inline-flex h-11 w-36 max-w-full shrink-0 cursor-pointer items-center justify-between gap-1.5 rounded-md border border-border/85 bg-surface px-3 text-left text-sm font-medium text-text transition-colors hover:border-control/75 hover:bg-surface-subtle active:bg-surface-subtle max-[25rem]:w-11 max-[25rem]:justify-center max-[25rem]:px-0 sm:hidden',
              focusRingClass,
            ]}
          >
            <LucideIcon
              icon={SlidersHorizontal}
              class="size-3.5 shrink-0 text-text-muted"
              strokeWidth={1.85}
            />
            {/* Compact icon mode hides the match summary, so keep active-filter state visible. */}
            <Show when={hasStatusContent()}>
              <span aria-hidden="true" class="absolute top-1.5 right-1.5 hidden size-1.5 rounded-full bg-accent max-[25rem]:block" />
            </Show>
            <span class="grid min-w-0 gap-0.5 whitespace-nowrap leading-none max-[25rem]:sr-only">
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
                'spring-chevron size-3.5 shrink-0 text-text-muted max-[25rem]:hidden',
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
            <SegmentedControl<BoardQuickFilter>
              aria-label="Filter cards"
              value={props.filter}
              onValueChange={(next) => {
                if (next) props.onFilterChange(next);
              }}
              class="segmented-track relative isolate grid w-full grid-cols-4 items-center rounded-md border border-border/75 p-1 sm:h-9 sm:w-auto"
            >
              <SegmentedControlIndicator
                aria-hidden="true"
                class="segmented-thumb pointer-events-none rounded-sm"
              />
              <For each={BOARD_QUICK_FILTERS}>
                {(option) => (
                  <SegmentedControlItem
                    value={option.value}
                    data-label={option.label}
                    class={[
                      'spring-press relative z-10 inline-flex board-touch-target cursor-pointer flex-col items-center justify-center whitespace-nowrap rounded-sm px-2 text-xs font-medium leading-none text-text-muted transition-colors after:block after:h-0 after:overflow-hidden after:invisible after:select-none after:font-semibold after:content-[attr(data-label)] hover:text-text data-checked:font-semibold data-checked:text-text max-[25rem]:px-0.5 sm:h-full sm:min-h-0 sm:px-2 sm:text-[13px] xl:px-2.5',
                      focusRingClass,
                    ]}
                  >
                    {option.label}
                  </SegmentedControlItem>
                )}
              </For>
            </SegmentedControl>

            <div class="flex w-full items-center sm:w-auto">
              <Select
                items={sortItems()}
                value={props.effectiveSortMode}
                onValueChange={(next) => {
                  if (next) props.onSortChange(next as BoardSortMode);
                }}
              >
                <SelectTrigger
                  aria-label="Sort cards"
                  class={[
                    'relative inline-flex h-11 w-full cursor-pointer items-center gap-2 rounded-md border border-border/85 bg-surface pl-9 pr-2.5 text-base font-medium text-text transition-colors hover:border-control/75 hover:bg-surface-subtle/50 sm:h-9 sm:w-auto sm:text-[13px]',
                    focusRingClass,
                  ]}
                >
                  <LucideIcon
                    icon={ArrowUpDown}
                    class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-muted"
                    strokeWidth={1.85}
                  />
                  <SelectValue />
                  <LucideIcon
                    icon={ChevronDown}
                    class="pointer-events-none size-3.5 text-text-muted"
                    strokeWidth={2}
                  />
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  align="end"
                  sideOffset={6}
                  collisionPadding={8}
                  data-board-overlay="true"
                  class="board-popover z-40 max-h-64 w-44 overflow-y-auto rounded-md border border-border bg-surface p-1 text-text"
                >
                  <For each={BOARD_SORT_OPTIONS}>
                    {(option) => (
                      <SelectItem
                        value={option.value}
                        disabled={option.value === 'most-voted' && props.blindVoting}
                        class="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2.5 py-1.5 text-sm text-text hover:bg-surface-subtle data-highlighted:bg-surface-subtle data-disabled:cursor-not-allowed data-disabled:opacity-50 sm:min-h-8"
                      >
                        {option.value === 'most-voted' && props.blindVoting
                          ? `${option.label} (Blind Voting)`
                          : option.label}
                      </SelectItem>
                    )}
                  </For>
                </SelectContent>
              </Select>
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
                  'spring-press inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border/85 bg-surface px-3 text-xs font-semibold text-text transition-colors hover:border-control/75 hover:bg-surface-subtle active:bg-surface-subtle sm:h-9 sm:min-h-0 sm:px-2.5 sm:text-[13px]',
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
