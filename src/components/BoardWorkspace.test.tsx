import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { render } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';

import type { BoardViewDTO } from '../lib/board-types';
import { readRecentBoards, recordRecentBoard } from '../lib/recent-boards';
import BoardWorkspace from './BoardWorkspace';

function makeBoardView(): BoardViewDTO {
  const now = Date.now();
  return {
    id: 'board_0123456789abcdef',
    title: 'Sprint 42 Retro',
    subtitle: 'Checkout Team',
    templateId: 'standard',
    isBlurred: false,
    blindVoting: false,
    isLocked: false,
    allowParticipantGroup: false,
    voteLimit: 5,
    maxVotesPerCard: null,
    remainingVotes: 5,
    isFacilitator: true,
    timer: { endsAt: null, remainingMs: null, durationMs: null },
    version: 1,
    retentionDays: 90,
    createdAt: now,
    lastActiveAt: now,
    columns: [
      {
        id: 'col_1',
        title: 'Went Well',
        accent: 'sage',
        position: 0,
        isActionColumn: false,
        cardCount: 3,
      },
      {
        id: 'col_2',
        title: 'To Improve',
        accent: 'rose',
        position: 1,
        isActionColumn: false,
        cardCount: 1,
      },
      {
        id: 'col_3',
        title: 'Action Items',
        accent: 'sky',
        position: 2,
        isActionColumn: true,
        cardCount: 0,
      },
    ],
    groups: [],
    cards: [],
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('<BoardWorkspace />', () => {
  it('renders sticky header, Columns with 3px pastel accent bar and Card count badge, and records Recent Board', () => {
    const board = makeBoardView();
    const { getByRole, getByText } = render(() => (
      <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
    ));
    flush();

    expect(getByRole('link', { name: /Retrocks/i })).toHaveAttribute('href', '/');
    expect(
      getByRole('heading', { level: 1, name: 'Sprint 42 Retro' }),
    ).toBeInTheDocument();
    expect(getByText('Checkout Team')).toBeInTheDocument();

    // Columns with pastel 3px accent bars & Card count badges
    expect(getByText('Went Well')).toBeInTheDocument();
    expect(getByText('To Improve')).toBeInTheDocument();
    expect(getByText('Action Items')).toBeInTheDocument();
    expect(
      document.querySelectorAll('[data-column-accent-bar="true"]').length,
    ).toBe(3);
    expect(getByText('3')).toBeInTheDocument();

    // Recorded into localStorage Recent Boards
    const recent = readRecentBoards();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      id: board.id,
      title: 'Sprint 42 Retro',
      isFacilitator: true,
    });
  });

  it('renders clean missing/expired state with CTA and removes stale Board ID from localStorage Recent Boards', () => {
    const staleId = 'board_expired_12345678';
    recordRecentBoard({ id: staleId, title: 'Old Expired Retro' });
    recordRecentBoard({
      id: 'board_still_alive_1234',
      title: 'Active Retro',
    });

    const { getByRole, getByText } = render(() => (
      <BoardWorkspace board={null} boardId={staleId} homeHref="/" />
    ));
    flush();

    expect(getByText(/Board not found or expired/i)).toBeInTheDocument();
    const cta = getByRole('link', { name: /Create a new board/i });
    expect(cta).toHaveAttribute('href', '/');

    // Automatically scrubbed from localStorage Recent Boards
    const remaining = readRecentBoards();
    expect(remaining.map((b) => b.id)).toEqual(['board_still_alive_1234']);
  });

  it('renders with zero Solid 2.0 reactivity diagnostics', async () => {
    const board = makeBoardView();
    const { artifact } = await captureArtifact(
      () => {
        render(() => (
          <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
        ));
        flush();
      },
      { scenario: 'board-workspace-render' },
    );
    expectNoDiagnostics(artifact);
  });
});
