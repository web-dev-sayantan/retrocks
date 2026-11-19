import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { fireEvent, render } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RECENT_BOARDS_STORAGE_KEY,
  readRecentBoards,
  recordRecentBoard,
} from '../lib/recent-boards';
import type { CreateBoardInput } from '../lib/schemas';
import BoardCreator from './BoardCreator';
import RecentBoardsList from './RecentBoardsList';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<BoardCreator />', () => {
  it('renders all 9 curated templates with visual mini-Column previews and submits customized Board options', async () => {
    const onSubmit = vi.fn(async (_input: CreateBoardInput) => undefined);
    const { getByRole, getByLabelText, getByText } = render(() => (
      <BoardCreator onSubmit={onSubmit} />
    ));
    flush();

    // All 9 curated templates appear above the fold
    for (const name of [
      'Standard Retro',
      'Start / Stop / Continue',
      'Mad / Sad / Glad',
      '4Ls',
      'Starfish',
      'Sailboat',
      'Six Thinking Hats',
      'Pros & Cons',
      'Custom Board',
    ]) {
      expect(getByText(name)).toBeInTheDocument();
    }

    // Visual mini-Column preview includes Standard Retro's Action Items Column
    expect(getByText('Went Well')).toBeInTheDocument();
    expect(getByText('Action Items')).toBeInTheDocument();

    // Fill optional title and subtitle
    fireEvent.input(getByLabelText(/Board title/i), {
      target: { value: 'Sprint 42 Retrospective' },
    });
    fireEvent.input(getByLabelText(/Subtitle/i), {
      target: { value: 'Checkout Team' },
    });

    // Switch to Custom Board and customize Columns (add, rename, accent, reorder)
    fireEvent.click(getByRole('button', { name: /Custom Board/i }));
    flush();

    const addColumnBtn = getByRole('button', { name: /Add column/i });
    fireEvent.click(addColumnBtn);
    flush();

    const columnInputs = document.querySelectorAll<HTMLInputElement>(
      'input[data-column-title-input="true"]',
    );
    expect(columnInputs.length).toBe(4);
    fireEvent.input(columnInputs[3], { target: { value: 'Follow-ups' } });
    flush();

    // Expand collapsible advanced options
    const advancedToggle = getByRole('button', { name: /Advanced options/i });
    expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(advancedToggle);
    flush();
    expect(advancedToggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(getByRole('button', { name: '10' }));
    fireEvent.click(
      getByRole('button', { name: /1 per Card or Card Group/i }),
    );
    fireEvent.click(getByRole('button', { name: /^On$/i }));
    fireEvent.click(getByRole('button', { name: '180 days' }));
    flush();

    // Submit the form
    fireEvent.click(getByRole('button', { name: /Create Board/i }));
    flush();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.title).toBe('Sprint 42 Retrospective');
    expect(submitted.subtitle).toBe('Checkout Team');
    expect(submitted.templateId).toBe('custom');
    expect(submitted.columns).toHaveLength(4);
    expect(submitted.columns?.[3].title).toBe('Follow-ups');
    expect(submitted.voteLimit).toBe(10);
    expect(submitted.maxVotesPerCard).toBe(1);
    expect(submitted.isBlurred).toBe(true);
    expect(submitted.retentionDays).toBe(180);
  });

  it('displays server error feedback cleanly when creation fails (e.g. rate limit)', async () => {
    const onSubmit = vi.fn(async () => ({
      ok: false as const,
      code: 'RATE_LIMITED' as const,
      message: 'Too many Boards created recently.',
    }));
    const { getByRole, findByRole } = render(() => (
      <BoardCreator onSubmit={onSubmit} />
    ));
    flush();

    fireEvent.click(getByRole('button', { name: /Create Board/i }));
    flush();

    const alert = await findByRole('alert');
    expect(alert).toHaveTextContent('Too many Boards created recently.');
  });

  it('interacts with zero Solid 2.0 reactivity diagnostics', async () => {
    const noopSubmit = async () => undefined;
    const { artifact } = await captureArtifact(
      () => {
        const { getByRole } = render(() => (
          <BoardCreator onSubmit={noopSubmit} />
        ));
        flush();
        fireEvent.click(getByRole('button', { name: /Sailboat/i }));
        flush();
        fireEvent.click(getByRole('button', { name: /Advanced options/i }));
        flush();
      },
      { scenario: 'board-creator-interactions' },
    );
    expectNoDiagnostics(artifact);
  });
});

describe('<RecentBoardsList /> & localStorage persistence', () => {
  it('stores only safe metadata (never tokens), renders links, and supports one-click remove', () => {
    recordRecentBoard(
      {
        id: 'board_0123456789abcdef',
        title: 'Sprint 41 Retro',
        isFacilitator: true,
      },
      Date.now() - 120_000,
    );

    const rawStored = localStorage.getItem(RECENT_BOARDS_STORAGE_KEY) ?? '';
    expect(rawStored).toContain('board_0123456789abcdef');
    expect(rawStored).toContain('Sprint 41 Retro');
    expect(rawStored).not.toContain('token');

    const { getByRole, queryByText } = render(() => <RecentBoardsList />);
    flush();

    const link = getByRole('link', { name: /Sprint 41 Retro/i });
    expect(link).toHaveAttribute('href', '/b/board_0123456789abcdef');

    const removeBtn = getByRole('button', {
      name: /Remove Sprint 41 Retro from recent boards/i,
    });
    fireEvent.click(removeBtn);
    flush();

    expect(queryByText('Sprint 41 Retro')).toBeNull();
    expect(readRecentBoards()).toEqual([]);
  });

  it('mounts and removes Recent Boards entries with zero Solid 2.0 reactivity diagnostics', async () => {
    recordRecentBoard(
      {
        id: 'board_diag_1111111111',
        title: 'Facilitated Sprint Retro',
        isFacilitator: true,
      },
      Date.now() - 60_000,
    );
    recordRecentBoard(
      {
        id: 'board_diag_2222222222',
        title: 'Participant Design Crit',
        isFacilitator: false,
      },
      Date.now() - 120_000,
    );

    const { artifact } = await captureArtifact(
      () => {
        const { getByRole, getByText, queryByText, unmount } = render(() => (
          <RecentBoardsList />
        ));
        try {
          flush();
          expect(getByText('Facilitated Sprint Retro')).toBeInTheDocument();
          expect(getByText('Facilitator')).toBeInTheDocument();
          fireEvent.click(
            getByRole('button', {
              name: /Remove Facilitated Sprint Retro from recent boards/i,
            }),
          );
          flush();
          expect(queryByText('Facilitated Sprint Retro')).toBeNull();
          expect(getByText('Participant Design Crit')).toBeInTheDocument();
        } finally {
          unmount();
        }
      },
      { scenario: 'recent-boards-list-interactions' },
    );
    expectNoDiagnostics(artifact);
  });
});
