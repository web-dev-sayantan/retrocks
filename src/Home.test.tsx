import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, isInaccessible, render, screen, within } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { flush } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import App from './App';
import { makeBoardView } from './lib/board-fixtures';
import { recordRecentBoard } from './lib/recent-boards';
import { recordRecentPokerRoom } from './lib/recent-poker-rooms';

vi.mock('virtual:solid-env/client', () => ({ env: { VITE_APP_NAME: 'Retrocks' } }));

const agent = createAgent();

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

it('switches between Sprint Retrospectives and Pointing Poker tabs and opens their setup routes', async () => {
  render(() => <App />);
  expect(await screen.findAllByRole('heading', { level: 1 })).toHaveLength(1);

  const { artifact } = await captureArtifact(async () => {
    expect(screen.getByRole('heading', { level: 1, name: 'The Sprint rituals.' }))
      .toBeInTheDocument();
    expect(document.title).toBe('Retrocks — Sprint Retrospectives & Pointing Poker');
    expect(screen.getByText(
      'No accounts or tracking. Boards and Rooms are shared by link and expire automatically.',
    )).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create board' })).not.toBeInTheDocument();

    const tablist = screen.getByRole('tablist', { name: 'Retrocks tools' });
    const retroTab = within(tablist).getByRole('tab', { name: 'Sprint Retrospectives' });
    const pokerTab = within(tablist).getByRole('tab', { name: 'Pointing Poker' });
    expect(retroTab).toHaveAttribute('aria-selected', 'true');
    expect(pokerTab).toHaveAttribute('aria-selected', 'false');

    const retroPanel = screen.getByRole('tabpanel', { name: 'Sprint Retrospectives' });
    const createBoard = within(retroPanel).getByRole('link', { name: 'Create a Board' });
    expect(createBoard).toHaveAttribute('href', '/retro');

    fireEvent.click(createBoard);
    expect(await screen.findByRole('button', { name: 'Create board' })).toBeEnabled();
    expect(window.location.pathname).toBe('/retro');

    fireEvent.click(screen.getByRole('link', { name: 'Retrocks' }));
    const pokerTabReturn = await screen.findByRole('tab', { name: 'Pointing Poker' });
    fireEvent.click(pokerTabReturn);
    flush();

    expect(pokerTabReturn).toHaveAttribute('aria-selected', 'true');
    const pokerPanel = screen.getByRole('tabpanel', { name: 'Pointing Poker' });
    const createRoom = within(pokerPanel).getByRole('link', { name: 'Create a Room' });
    expect(createRoom).toHaveAttribute('href', '/pointing-poker');

    fireEvent.click(createRoom);
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

  const retroPanel = await screen.findByRole('tabpanel', { name: 'Sprint Retrospectives' });
  const boardSnapshot = within(retroPanel).getByText('Sprint 42 Retro').closest('[aria-hidden="true"]');

  fireEvent.click(screen.getByRole('tab', { name: 'Pointing Poker' }));
  flush();
  const pokerPanel = screen.getByRole('tabpanel', { name: 'Pointing Poker' });
  const roomSnapshot = within(pokerPanel).getByText('Story queue').closest('[aria-hidden="true"]');

  for (const snapshot of [boardSnapshot, roomSnapshot]) {
    expect(snapshot).toBeInTheDocument();
    expect(isInaccessible(snapshot!)).toBe(true);
    expect(snapshot!.querySelector(
      'a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]',
    )).toBeNull();
  }

  expect(fetch).not.toHaveBeenCalled();
});

it('shows Recent Boards and Recent Rooms only inside their matching tab view', async () => {
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
  recordRecentPokerRoom('room_1234567890abcdef1');

  render(() => <App />);

  const retroPanel = await screen.findByRole('tabpanel', { name: 'Sprint Retrospectives' });
  const recentBoards = within(retroPanel).getByRole('region', { name: 'Recent Boards' });
  const links = within(recentBoards).getAllByRole('link');
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/b/board_0123456789abcdef',
    '/b/board_fedcba9876543210',
  ]);
  expect(links[0]).toHaveAccessibleName('Team Sprint Retro');
  expect(links[1]).toHaveAccessibleName('Design Sprint Retro');
  expect(links[0]).toHaveAccessibleDescription('Visited 2m ago · Facilitator');
  expect(links[1]).toHaveAccessibleDescription('Visited 5m ago');
  expect(within(retroPanel).queryByRole('region', { name: 'Recent Rooms' })).not.toBeInTheDocument();

  const createBoard = within(retroPanel).getByRole('link', { name: 'Create a Board' });
  const privacyNote = screen.getByText(
    'No accounts or tracking. Boards and Rooms are shared by link and expire automatically.',
  );
  expect(createBoard.compareDocumentPosition(recentBoards) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
  expect(recentBoards.compareDocumentPosition(privacyNote) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();

  fireEvent.click(screen.getByRole('tab', { name: 'Pointing Poker' }));
  flush();
  const pokerPanel = screen.getByRole('tabpanel', { name: 'Pointing Poker' });
  const recentRooms = within(pokerPanel).getByRole('region', { name: 'Recent Rooms' });
  expect(within(recentRooms).getByRole('link', { name: 'Room · room_123' })).toHaveAttribute(
    'href',
    '/p/room_1234567890abcdef1',
  );
  expect(within(pokerPanel).queryByRole('region', { name: 'Recent Boards' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Sprint Retrospectives' }));
  flush();

  const { artifact } = await captureArtifact(async () => {
    const activeRetroPanel = screen.getByRole('tabpanel', { name: 'Sprint Retrospectives' });
    const recent = within(activeRetroPanel).getByRole('region', { name: 'Recent Boards' });
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
    await screen.findByRole('heading', { name: 'The Sprint rituals.' });
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

it('exposes the tool switcher tabs to ui-sdk agents', async () => {
  render(() => <App />);
  await screen.findByRole('tablist', { name: 'Retrocks tools' });
  flush();

  const components = agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== 'more');
  for (const entry of components) {
    expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  }
  const labels = components.map((entry) => entry.label);
  expect(labels).toContain('Retrocks tools');

  const result = await agent.act({
    steps: [{ ref: 'Retrocks tools', action: 'setValue', args: ['Pointing Poker'] }],
  });
  expect(result.ok, result.error?.message).toBe(true);
  flush();
  expect(screen.getByRole('tab', { name: 'Pointing Poker' })).toHaveAttribute('aria-selected', 'true');
});
