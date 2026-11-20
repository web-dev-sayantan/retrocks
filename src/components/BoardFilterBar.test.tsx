import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { fireEvent, render, within } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveEffectiveSortMode,
  type BoardQuickFilter,
  type BoardSortMode,
} from '../lib/board-view';
import BoardFilterBar, { type BoardFilterBarProps } from './BoardFilterBar';

interface HarnessOptions {
  initialQuery?: string;
  initialFilter?: BoardQuickFilter;
  initialSort?: BoardSortMode;
  blindVoting?: boolean;
  widenSearch?: boolean;
  matchedCardCount?: number;
  totalCardCount?: number;
}

function renderFilterBar(options: HarnessOptions = {}) {
  const [query, setQuery] = createSignal(options.initialQuery ?? '');
  const [filter, setFilter] = createSignal<BoardQuickFilter>(options.initialFilter ?? 'all');
  const [requestedSort, setRequestedSort] = createSignal<BoardSortMode>(
    options.initialSort ?? 'newest',
  );
  const [blindVoting, setBlindVoting] = createSignal(options.blindVoting ?? false);
  const [widenSearch, setWidenSearch] = createSignal(options.widenSearch ?? false);
  const [matchedCardCount, setMatchedCardCount] = createSignal(options.matchedCardCount ?? 5);
  const totalCardCount = options.totalCardCount ?? 5;

  const onResetSpy = vi.fn(() => {
    setQuery('');
    setFilter('all');
  });

  const view = render(() => {
    const hasSearchQuery = () => query().trim().length > 0;
    const hasActiveFilter = () => hasSearchQuery() || filter() !== 'all';
    const effectiveSortMode = () => resolveEffectiveSortMode(requestedSort(), blindVoting());

    const barProps: BoardFilterBarProps = {
      get query() {
        return query();
      },
      get filter() {
        return filter();
      },
      get requestedSortMode() {
        return requestedSort();
      },
      get effectiveSortMode() {
        return effectiveSortMode();
      },
      get blindVoting() {
        return blindVoting();
      },
      get hasActiveFilter() {
        return hasActiveFilter();
      },
      get hasSearchQuery() {
        return hasSearchQuery();
      },
      get widenSearch() {
        return widenSearch();
      },
      get matchedCardCount() {
        return matchedCardCount();
      },
      totalCardCount,
      onQueryChange: setQuery,
      onFilterChange: setFilter,
      onSortChange: setRequestedSort,
      onResetFilters: onResetSpy,
    };

    return <BoardFilterBar {...barProps} />;
  });

  flush();

  return {
    view,
    query,
    setQuery,
    filter,
    setFilter,
    requestedSort,
    setRequestedSort,
    setBlindVoting,
    setWidenSearch,
    setMatchedCardCount,
    onResetSpy,
  };
}

describe('BoardFilterBar', () => {
  it('renders quick filters as a segmented radio group with a sliding indicator, neutral default All state, and roving keyboard navigation with zero diagnostics', async () => {
    const { artifact } = await captureArtifact(
      () => {
        const { view, filter } = renderFilterBar();
        try {
          const group = view.getByRole('radiogroup', { name: 'Filter cards' });
          expect(group).toHaveClass('segmented-track');

          const thumb = group.querySelector('.segmented-thumb') as HTMLElement | null;
          expect(thumb).toBeInTheDocument();
          expect(thumb?.getAttribute('aria-hidden')).toBe('true');

          const groupScope = within(group);
          const allRadio = groupScope.getByRole('radio', { name: 'All' });
          const mineRadio = groupScope.getByRole('radio', { name: 'Mine' });
          const actionsRadio = groupScope.getByRole('radio', { name: 'Action Items' });

          expect(allRadio).toHaveAttribute('aria-checked', 'true');
          expect(mineRadio).toHaveAttribute('aria-checked', 'false');

          // Single roving tab stop inside the segmented control
          expect(allRadio).toHaveAttribute('tabindex', '0');
          expect(mineRadio).toHaveAttribute('tabindex', '-1');

          // Pressing the already-checked filter keeps it checked
          fireEvent.click(allRadio);
          flush();
          expect(filter()).toBe('all');
          expect(allRadio).toHaveAttribute('aria-checked', 'true');

          // Arrow keys move and check, as in any radio group
          allRadio.focus();
          fireEvent.keyDown(allRadio, { key: 'ArrowRight' });
          flush();
          expect(mineRadio).toHaveFocus();
          expect(filter()).toBe('mine');
          expect(mineRadio).toHaveAttribute('aria-checked', 'true');
          expect(allRadio).toHaveAttribute('aria-checked', 'false');

          // End jumps and checks the last filter
          fireEvent.keyDown(mineRadio, { key: 'ArrowRight' });
          flush();
          expect(filter()).toBe('voted');
          fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
          flush();
          expect(actionsRadio).toHaveFocus();
          expect(actionsRadio).toHaveAttribute('aria-checked', 'true');
          expect(filter()).toBe('action-items');
        } finally {
          view.unmount();
        }
      },
      { scenario: 'board-filter-bar-segmented-group' },
    );

    expectNoDiagnostics(artifact);
  });

  it('keeps active filter feedback and Clear filters inline in the single toolbar row (zero-CLS) and returns focus to searchbox on pointer or keyboard reset', async () => {
    const { artifact } = await captureArtifact(
      () => {
        const { view, query, filter, setMatchedCardCount, onResetSpy } = renderFilterBar({
          matchedCardCount: 5,
          totalCardCount: 5,
        });
        try {
          const section = view.getByRole('region', {
            name: 'Search, filter, and sort Board',
          });
          const innerContainer = section.firstElementChild as HTMLElement;
          expect(innerContainer.children).toHaveLength(1);

          const toolbarRow = innerContainer.firstElementChild as HTMLElement;
          const search = view.getByRole('searchbox', {
            name: 'Search Cards, Card Groups, and comments',
          });
          const disclosure = view.getByRole('button', { name: 'Filter & sort' });
          const [filterControlsId] = disclosure.getAttribute('aria-controls')!.split(' ');
          const filterControls = document.getElementById(filterControlsId)!;

          // Polite live region stays mounted while idle, with no Clear filters button
          expect(toolbarRow.querySelector('[aria-live="polite"]')).toBeInTheDocument();
          expect(view.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

          // Activate filter + search -> no second row mounts beneath the toolbar
          fireEvent.click(
            within(view.getByRole('radiogroup', { name: 'Filter cards' })).getByRole('radio', {
              name: 'Mine',
            }),
          );
          setMatchedCardCount(1);
          fireEvent.input(search, { target: { value: 'deploy' } });
          flush();

          expect(innerContainer.children).toHaveLength(1);
          const filterChip = view.getByText('Filter: Mine');
          const matchCount = view.getByText('1 match (1 of 5 cards)');
          const clearBtn = view.getByRole('button', { name: 'Clear filters' });

          expect(toolbarRow.contains(filterChip)).toBe(true);
          expect(toolbarRow.contains(matchCount)).toBe(true);
          expect(toolbarRow.contains(clearBtn)).toBe(true);

          // The desktop status stays in the toolbar regardless of the mobile disclosure state.
          expect(disclosure).toHaveAttribute('aria-expanded', 'false');
          expect(filterControls.contains(filterChip)).toBe(false);
          expect(filterControls.contains(clearBtn)).toBe(false);
          expect(filterChip).toBeVisible();
          expect(matchCount).toBeVisible();
          expect(clearBtn).toBeVisible();

          // Clicking Clear filters with a real pointer (detail: 1) resets and returns focus to searchbox
          clearBtn.focus();
          fireEvent.click(clearBtn, { detail: 1 });
          flush();

          expect(onResetSpy).toHaveBeenCalledTimes(1);
          expect(query()).toBe('');
          expect(filter()).toBe('all');
          expect(search).toHaveFocus();
          expect(view.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
          expect(innerContainer.children).toHaveLength(1);
        } finally {
          view.unmount();
        }
      },
      { scenario: 'board-filter-bar-inline-zero-cls' },
    );

    expectNoDiagnostics(artifact);
  });

  it('shows a concise match count in the collapsed Filter & sort control and exposes the full status when expanded', () => {
    const { view, setMatchedCardCount } = renderFilterBar();
    const search = view.getByRole('searchbox');
    const disclosure = view.getByRole('button', { name: 'Filter & sort' });
    expect(within(disclosure).queryByText(/matches?/)).toBeNull();

    setMatchedCardCount(0);
    fireEvent.input(search, { target: { value: 'unmatched' } });
    flush();

    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(within(disclosure).getByText('0 matches')).toBeInTheDocument();
    const controlsIds = disclosure.getAttribute('aria-controls')?.split(' ') ?? [];
    const status = view.getByText('0 matches (0 of 5 cards)').closest('[data-filter-status-slot]');
    expect(controlsIds).toContain(status?.id);
    expect(status).toHaveClass('max-sm:sr-only');

    fireEvent.click(disclosure);
    flush();

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(status).not.toHaveClass('max-sm:sr-only');
    const reset = view.getByRole('button', { name: 'Clear filters' });
    expect(reset).not.toHaveClass('max-sm:hidden');
    fireEvent.click(reset);
    flush();

    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(within(disclosure).queryByText(/matches?/)).toBeNull();
  });

  it('renders a calm Search field with placeholder, secret-search hook, and a custom-chevron native Sort select with Blind Voting pause state', async () => {
    const { artifact } = await captureArtifact(
      () => {
        const { view, query, setWidenSearch, setBlindVoting, requestedSort } = renderFilterBar();
        try {
          // Search field: sr-only label bound to input, clear placeholder, softened border, '/' hint
          const search = view.getByRole('searchbox', {
            name: 'Search Cards, Card Groups, and comments',
          });
          const searchLabel = document.querySelector(`label[for="${search.id}"]`);
          expect(searchLabel).toHaveTextContent('Search');
          expect(searchLabel).toHaveClass('sr-only');
          expect(search).toHaveAttribute('placeholder', 'Search cards…');
          expect(search).not.toHaveClass('border-control');

          const searchField = search.closest('.secret-search-field');
          expect(searchField).toBeInTheDocument();
          expect(searchField).not.toHaveClass('secret-search-wide');
          expect(searchField?.querySelector('kbd')).toHaveTextContent('/');

          // Secret search widening hook
          setWidenSearch(true);
          flush();
          expect(searchField).toHaveClass('secret-search-wide');

          // Typing replaces '/' hint with Clear search button; clicking clears & re-focuses
          fireEvent.input(search, { target: { value: 'retro' } });
          flush();
          expect(searchField?.querySelector('kbd')).toBeNull();
          const clearSearch = view.getByRole('button', { name: 'Clear search' });
          fireEvent.click(clearSearch);
          flush();
          expect(query()).toBe('');
          expect(search).toHaveFocus();

          // Escape clears & blurs search
          fireEvent.input(search, { target: { value: 'escape me' } });
          flush();
          fireEvent.keyDown(search, { key: 'Escape' });
          flush();
          expect(query()).toBe('');
          expect(search).not.toHaveFocus();

          // Sort selector: named ui-sdk combobox with custom chevrons
          const sortSelect = view.getByRole('combobox', { name: 'Sort cards' });
          expect(sortSelect).not.toHaveClass('border-control');
          expect(sortSelect.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);

          // Choose Most Voted from the list
          fireEvent.click(sortSelect);
          flush();
          fireEvent.click(view.getByRole('option', { name: 'Most Voted' }));
          flush();
          expect(requestedSort()).toBe('most-voted');
          expect(within(sortSelect).getByText('Most Voted')).toBeInTheDocument();

          // Blind Voting pauses Most Voted: falls back to Newest, option disabled
          setBlindVoting(true);
          flush();
          expect(within(sortSelect).getByText('Newest')).toBeInTheDocument();
          fireEvent.click(sortSelect);
          flush();
          expect(
            view.getByRole('option', { name: 'Most Voted (Blind Voting)' }),
          ).toHaveAttribute('aria-disabled', 'true');
          expect(
            view.getByText('Most Voted paused during Blind Voting'),
          ).toBeVisible();
          fireEvent.keyDown(document, { key: 'Escape' });
          flush();
          expect(view.queryByRole('listbox')).not.toBeInTheDocument();
        } finally {
          view.unmount();
        }
      },
      { scenario: 'board-filter-bar-search-and-sort' },
    );

    expectNoDiagnostics(artifact);
  });
});
