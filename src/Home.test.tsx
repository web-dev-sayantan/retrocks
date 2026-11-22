import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, isInaccessible, render, screen, within } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import App from './App';
import { makeBoardView } from './lib/board-fixtures';
import { recordRecentBoard } from './lib/recent-boards';

vi.mock('virtual:solid-env/client', () => ({ env: { VITE_APP_NAME: 'Retrocks' } }));

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('introduces both tools and opens their setup routes from Home', async () => {
  render(() => <App />);
  expect(await screen.findAllByRole('heading', { level: 1 })).toHaveLength(1);

  const { artifact } = await captureArtifact(async () => {
    expect(screen.getByRole('heading', { level: 1, name: 'Sprint rituals, ready in a link.' }))
      .toBeInTheDocument();
    expect(document.title).toBe('Retrocks — Sprint Retrospectives & Pointing Poker');
    expect(screen.getByText(
      'Retrospectives and pointing poker for agile teams. Share a link and start immediately without signing in.',
    )).toBeInTheDocument();
    expect(screen.getByText(
      'No accounts or tracking. Boards and Rooms are shared by link and expire automatically.',
    )).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create board' })).not.toBeInTheDocument();

    const retro = screen.getByRole('region', { name: 'Sprint Retrospectives' });
    const poker = screen.getByRole('region', { name: 'Pointing Poker' });
    const createBoard = within(retro).getByRole('link', { name: 'Create a Board' });
    const createRoom = within(poker).getByRole('link', { name: 'Create a Room' });

    expect(createBoard).toHaveAttribute('href', '/retro');
    expect(createRoom).toHaveAttribute('href', '/pointing-poker');

    fireEvent.click(createBoard);
    expect(await screen.findByRole('button', { name: 'Create board' })).toBeEnabled();
    expect(window.location.pathname).toBe('/retro');

    fireEvent.click(screen.getByRole('link', { name: 'Retrocks' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Create a Room' }));
    expect(await screen.findByRole('button', { name: 'Create Room' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Display Name' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/pointing-poker');
  }, { scenario: 'home-tool-navigation' });

  expectNoDiagnostics(artifact);
});

it('renders static snapshots outside the accessibility tree and tab order', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(() => <App />);

  const retro = await screen.findByRole('region', { name: 'Sprint Retrospectives' });
  const poker = screen.getByRole('region', { name: 'Pointing Poker' });
  const boardSnapshot = within(retro).getByText('Sprint 42 Retro').closest('[aria-hidden="true"]');
  const roomSnapshot = within(poker).getByText('Story queue').closest('[aria-hidden="true"]');

  for (const snapshot of [boardSnapshot, roomSnapshot]) {
    expect(snapshot).toBeInTheDocument();
    expect(isInaccessible(snapshot!)).toBe(true);
    expect(snapshot!.querySelector(
      'a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]',
    )).toBeNull();
  }

  expect(fetch).not.toHaveBeenCalled();
});

it('shows Recent Boards only when this browser has visited one', async () => {
  render(() => <App />);
  await screen.findByRole('heading', { name: 'Sprint rituals, ready in a link.' });
  flush();

  expect(screen.queryByRole('region', { name: 'Recent Boards' })).not.toBeInTheDocument();
});

it('lists the most recently visited Boards first and persists removal across Home and Board setup', async () => {
  const now = Date.now();
  recordRecentBoard({
    id: 'board_0123456789abcdef',
    title: 'Team Sprint Retro',
    isFacilitator: true,
  }, now - 120_000);
  recordRecentBoard({
    id: 'board_fedcba9876543210',
    title: 'Design Sprint Retro',
  }, now - 300_000);
  render(() => <App />);

  const recent = await screen.findByRole('region', { name: 'Recent Boards' });
  const links = within(recent).getAllByRole('link');
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/b/board_0123456789abcdef',
    '/b/board_fedcba9876543210',
  ]);
  expect(links[0]).toHaveAccessibleName('Team Sprint Retro');
  expect(links[1]).toHaveAccessibleName('Design Sprint Retro');
  expect(links[0]).toHaveAccessibleDescription('Visited 2m ago · Facilitator');
  expect(links[1]).toHaveAccessibleDescription('Visited 5m ago');

  const createRoom = screen.getByRole('link', { name: 'Create a Room' });
  const privacyNote = screen.getByText(
    'No accounts or tracking. Boards and Rooms are shared by link and expire automatically.',
  );
  expect(createRoom.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
  expect(recent.compareDocumentPosition(privacyNote) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();

  const { artifact } = await captureArtifact(async () => {
    fireEvent.click(within(recent).getByRole('button', {
      name: 'Remove Team Sprint Retro from Recent Boards',
    }));
    flush();
    expect(screen.queryByRole('link', { name: 'Team Sprint Retro' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Create a Board' }));
    expect(await screen.findByRole('button', { name: 'Create board' })).toBeEnabled();
    const setupRecent = await screen.findByRole('region', { name: 'Recent Boards' });
    expect(within(setupRecent).queryByRole('link', { name: 'Team Sprint Retro' }))
      .not.toBeInTheDocument();
    expect(within(setupRecent).getByRole('link', { name: 'Design Sprint Retro' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Retrocks' }));
    await screen.findByRole('heading', { name: 'Sprint rituals, ready in a link.' });
    const homeRecent = await screen.findByRole('region', { name: 'Recent Boards' });
    expect(within(homeRecent).queryByRole('link', { name: 'Team Sprint Retro' }))
      .not.toBeInTheDocument();
    fireEvent.click(within(homeRecent).getByRole('button', {
      name: 'Remove Design Sprint Retro from Recent Boards',
    }));
    flush();
    expect(screen.queryByRole('region', { name: 'Recent Boards' })).not.toBeInTheDocument();
  }, { scenario: 'home-recent-boards-removal' });

  expectNoDiagnostics(artifact);
});

it('reopens a saved Board from Home', async () => {
  const board = makeBoardView({ id: 'board_c81234567890abcd', title: 'Design Sprint Retro' });
  recordRecentBoard({ id: board.id, title: board.title });

  vi.stubGlobal('EventSource', class extends EventTarget {
    close() {}
  });
  vi.stubGlobal('fetch', async (resource: string) => {
    if (!new URL(resource, window.location.origin).pathname.startsWith('/_server')) {
      throw new Error(`Unexpected request: ${resource}`);
    }
    return Response.json(board, { headers: { 'X-Server-Function-Format': '8' } });
  });
  render(() => <App />);

  const recent = await screen.findByRole('region', { name: 'Recent Boards' });
  const savedBoard = within(recent).getByRole('link', { name: board.title });
  expect(savedBoard).toHaveAttribute('href', `/b/${board.id}`);
  fireEvent.click(savedBoard);

  expect(await screen.findByRole('heading', { level: 1, name: board.title })).toBeInTheDocument();
  expect(window.location.pathname).toBe(`/b/${board.id}`);
});
