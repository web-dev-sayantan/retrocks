import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RECENT_BOARDS_STORAGE_KEY,
  readRecentBoards,
  recordRecentBoard,
} from '../lib/recent-boards';
import type { CreateBoardInput } from '../lib/schemas';
import Home from '../routes/index';
import BoardCreator from './BoardCreator';
import RecentBoardsList from './RecentBoardsList';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<BoardCreator />', () => {
  it('shows the default Board and creates it in one action', async () => {
    const onSubmit = vi.fn(async (_input: CreateBoardInput) => undefined);
    const { getByRole, getByLabelText, getByText, queryByText } = render(() => (
      <BoardCreator onSubmit={onSubmit} />
    ));
    flush();

    expect(getByRole('heading', { name: 'Create a board' })).toBeInTheDocument();
    expect(getByLabelText('Board title (optional)')).toHaveValue('');
    expect(getByText('Standard Retro')).toBeInTheDocument();
    for (const name of ['Went Well', 'To Improve', 'Action Items']) {
      expect(getByText(name)).toBeInTheDocument();
    }
    expect(queryByText('Sailboat')).toBeNull();
    expect(queryByText('Start in Private Mode')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Create board' }));
    flush();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      title: '',
      subtitle: '',
      templateId: 'standard',
      columns: [
        { title: 'Went Well', accent: 'sage', isActionColumn: false },
        { title: 'To Improve', accent: 'rose', isActionColumn: false },
        { title: 'Action Items', accent: 'sky', isActionColumn: true },
      ],
      voteLimit: 5,
      maxVotesPerCard: null,
      isBlurred: false,
      retentionDays: 90,
    });
  });

  it('previews all nine templates and submits the selected template', async () => {
    const onSubmit = vi.fn(async (_input: CreateBoardInput) => undefined);
    const { getByRole, getByText, queryByRole } = render(() => (
      <BoardCreator onSubmit={onSubmit} />
    ));
    flush();

    const templateToggle = getByRole('button', { name: 'Change template' });
    fireEvent.click(templateToggle);
    flush();

    for (const [name, columnName] of [
      ['Standard Retro', 'Went Well'],
      ['Start / Stop / Continue', 'Continue Doing'],
      ['Mad / Sad / Glad', 'Glad'],
      ['4Ls', 'Longed For'],
      ['Starfish', 'More Of'],
      ['Sailboat', 'Anchor (Holds Us Back)'],
      ['Six Thinking Hats', 'Creativity (Green)'],
      ['Pros & Cons', 'Cons'],
      ['Custom Board', 'Column 1'],
    ]) {
      expect(getByRole('button', { name })).toHaveTextContent(columnName);
    }

    fireEvent.click(getByRole('button', { name: 'Sailboat' }));
    flush();
    expect(templateToggle).toHaveAttribute('aria-expanded', 'false');
    expect(templateToggle).toHaveFocus();
    expect(queryByRole('button', { name: 'Sailboat' })).toBeNull();
    expect(getByRole('heading', { name: 'Sailboat' })).toBeInTheDocument();
    expect(getByText('Anchor (Holds Us Back)')).toBeInTheDocument();

    fireEvent.click(getByRole('button', { name: 'Create board' }));
    flush();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      templateId: 'sailboat',
      columns: [
        { title: 'Wind (Helps Us)', accent: 'sky', isActionColumn: false },
        { title: 'Anchor (Holds Us Back)', accent: 'slate', isActionColumn: false },
        { title: 'Rocks (Risks)', accent: 'coral', isActionColumn: false },
        { title: 'Island (Goals)', accent: 'sage', isActionColumn: false },
      ],
    }));
  });

  it('opens the Column editor for Custom Board and preserves collapsed draft options', async () => {
    const onSubmit = vi.fn(async (_input: CreateBoardInput) => undefined);
    const { getByRole, getByLabelText, queryByRole } = render(() => (
      <BoardCreator onSubmit={onSubmit} />
    ));
    flush();

    fireEvent.input(getByLabelText('Board title (optional)'), {
      target: { value: 'Sprint 42 Retrospective' },
    });
    fireEvent.click(getByRole('button', { name: 'Change template' }));
    flush();
    fireEvent.click(getByRole('button', { name: 'Custom Board' }));
    flush();

    const customizeToggle = getByRole('button', { name: 'Customize board' });
    expect(customizeToggle).toHaveAttribute('aria-expanded', 'true');
    expect(customizeToggle).toHaveFocus();
    fireEvent.input(getByLabelText(/Subtitle/i), {
      target: { value: 'Checkout Team' },
    });

    const addColumnBtn = getByRole('button', { name: /Add column/i });
    fireEvent.click(addColumnBtn);
    flush();

    fireEvent.input(getByRole('textbox', { name: 'Column 4 title' }), {
      target: { value: 'Follow-ups' },
    });
    fireEvent.click(customizeToggle);
    flush();
    expect(queryByRole('textbox', { name: 'Column 4 title' })).toBeNull();
    expect(getByRole('heading', { name: 'Custom Board' })).toBeInTheDocument();

    fireEvent.click(customizeToggle);
    flush();
    expect(getByLabelText(/Subtitle/i)).toHaveValue('Checkout Team');
    expect(getByRole('textbox', { name: 'Column 4 title' })).toHaveValue('Follow-ups');
    fireEvent.click(customizeToggle);
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

    fireEvent.click(advancedToggle);
    flush();
    expect(queryByRole('button', { name: '180 days' })).toBeNull();

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

  it('keeps Board input available for retry after a creation error', async () => {
    const onSubmit = vi.fn(async () => ({
      ok: false as const,
      code: 'RATE_LIMITED' as const,
      message: 'Too many Boards created recently.',
    }));
    const { getByRole, findByRole } = render(() => (
      <BoardCreator onSubmit={onSubmit} />
    ));
    flush();

    const title = getByRole('textbox', { name: 'Board title (optional)' });
    fireEvent.input(title, { target: { value: 'Sprint 42' } });
    flush();
    fireEvent.click(getByRole('button', { name: 'Create board' }));
    flush();

    const alert = await findByRole('alert');
    expect(alert).toHaveTextContent('Too many Boards created recently.');
    expect(title).toHaveValue('Sprint 42');
    expect(getByRole('button', { name: 'Create board' })).toBeEnabled();
  });

  it('interacts with zero Solid 2.0 reactivity diagnostics', async () => {
    const noopSubmit = async () => undefined;
    const { artifact } = await captureArtifact(
      () => {
        const { getByRole } = render(() => (
          <BoardCreator onSubmit={noopSubmit} />
        ));
        flush();
        fireEvent.click(getByRole('button', { name: 'Change template' }));
        flush();
        fireEvent.click(getByRole('button', { name: 'Sailboat' }));
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
  it('links to and removes Recent Boards from home in last-visited order', () => {
    const now = Date.now();
    recordRecentBoard(
      {
        id: 'board_0123456789abcdef',
        title: 'Sprint 42 Retro',
        isFacilitator: true,
      },
      now - 120_000,
    );
    recordRecentBoard(
      { id: 'board_fedcba9876543210', title: 'Sprint 41 Retro' },
      now - 300_000,
    );

    const { getAllByRole, getByRole, getByText, queryByRole } = render(() => <Home />);
    flush();

    const links = getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/b/board_0123456789abcdef',
      '/b/board_fedcba9876543210',
    ]);
    expect(getByRole('link', { name: 'Sprint 42 Retro' })).toHaveAccessibleDescription(
      'Visited 2m ago · Facilitator',
    );
    expect(getByRole('link', { name: 'Sprint 41 Retro' })).toHaveAccessibleDescription(
      'Visited 5m ago',
    );
    expect(getByText('Saved in this browser only.')).toBeInTheDocument();

    fireEvent.click(getByRole('button', {
      name: 'Remove Sprint 42 Retro from Recent Boards',
    }));
    flush();

    expect(queryByRole('link', { name: 'Sprint 42 Retro' })).toBeNull();
    expect(readRecentBoards().map((entry) => entry.id)).toEqual([
      'board_fedcba9876543210',
    ]);
    expect(localStorage.getItem(RECENT_BOARDS_STORAGE_KEY)).not.toContain('token');
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
