import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

import App from './App';
import { makeBoardView } from './lib/board-fixtures';
import { FIBONACCI_DECK, type PokerLiveRoomView } from './lib/poker-types';

vi.mock('virtual:solid-env/client', () => ({ env: { VITE_APP_NAME: 'Retrocks' } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

it('navigates between Home and both tool setup pages from the header', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(() => <App />);

  const header = within(screen.getByRole('banner'));
  const tools = within(header.getByRole('navigation', { name: 'Retrocks tools' }));
  const home = header.getByRole('link', { name: 'Retrocks' });
  const retro = tools.getByRole('link', { name: 'Retrospectives' });
  const poker = tools.getByRole('link', { name: 'Pointing Poker' });

  expect(screen.getAllByRole('navigation', { name: 'Retrocks tools' })).toHaveLength(1);
  expect(home).toHaveAttribute('href', '/');
  expect(retro).toHaveAttribute('href', '/retro');
  expect(poker).toHaveAttribute('href', '/pointing-poker');
  expect(home).toHaveAttribute('aria-current', 'page');
  expect(retro).not.toHaveAttribute('aria-current');
  expect(poker).not.toHaveAttribute('aria-current');

  const { artifact } = await captureArtifact(async () => {
    fireEvent.click(retro);
    expect(await screen.findByRole('heading', { name: 'Create a board', level: 1 }))
      .toBeInTheDocument();
    expect(retro).toHaveAttribute('aria-current', 'page');
    expect(home).not.toHaveAttribute('aria-current');
    expect(poker).not.toHaveAttribute('aria-current');

    fireEvent.click(poker);
    expect(await screen.findByRole('heading', { name: 'Pointing Poker', level: 1 }))
      .toBeInTheDocument();
    expect(poker).toHaveAttribute('aria-current', 'page');
    expect(home).not.toHaveAttribute('aria-current');
    expect(retro).not.toHaveAttribute('aria-current');

    fireEvent.click(home);
    await waitFor(() => expect(home).toHaveAttribute('aria-current', 'page'));
    expect(window.location.pathname).toBe('/');
  }, { scenario: 'floating-header-tool-navigation' });

  expectNoDiagnostics(artifact);
});

it('marks Pointing Poker as current while a Participant opens a Room link', async () => {
  const room: PokerLiveRoomView = {
    id: 'abcdefghijklmnopqrstuv',
    closed: false,
    version: 1,
    viewer: null,
    participants: [],
    stories: [],
    activeStoryId: null,
    deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    deckLocked: false,
    round: null,
  };
  stubRouteResponse(room);
  window.history.replaceState(null, '', `/p/${room.id}`);
  render(() => <App />);

  expect(await screen.findByRole('heading', { name: 'Join Pointing Poker', level: 1 }))
    .toBeInTheDocument();
  const header = within(screen.getByRole('banner'));
  const tools = within(header.getByRole('navigation', { name: 'Retrocks tools' }));
  expect(tools.getByRole('link', { name: 'Pointing Poker' })).toHaveAttribute('aria-current', 'page');
  expect(tools.getByRole('link', { name: 'Retrospectives' })).not.toHaveAttribute('aria-current');
  expect(header.getByRole('link', { name: 'Retrocks' })).not.toHaveAttribute('aria-current');
});

it('retains the Board masthead on a Board route', async () => {
  const board = makeBoardView({ isFacilitator: false });
  stubRouteResponse(board);
  window.history.replaceState(null, '', `/b/${board.id}`);
  render(() => <App />);

  const heading = await screen.findByRole('heading', { name: board.title, level: 1 });
  expect(screen.getAllByRole('banner').some((banner) => banner.contains(heading))).toBe(true);
  expect(screen.queryByRole('navigation', { name: 'Retrocks tools' })).not.toBeInTheDocument();
});

it('offers tool navigation with no active destination on a 404', async () => {
  window.history.replaceState(null, '', '/p/room/unknown');
  render(() => <App />);

  expect(await screen.findByRole('heading', { name: 'Page not found', level: 1 }))
    .toBeInTheDocument();
  const header = within(screen.getByRole('banner'));
  expect(header.getByRole('navigation', { name: 'Retrocks tools' })).toBeInTheDocument();
  for (const link of header.getAllByRole('link')) {
    expect(link).not.toHaveAttribute('aria-current');
  }
});

it('opens the Board Creator directly at /retro', async () => {
  window.history.replaceState(null, '', '/retro');
  render(() => <App />);

  expect(await screen.findByRole('heading', { name: 'Create a board', level: 1 }))
    .toBeInTheDocument();
  expect(document.title).toBe('Create a Board — Retrocks');

  const { artifact } = await captureArtifact(() => {
    const advancedOptions = screen.getByRole('button', { name: 'Advanced options' });
    fireEvent.click(advancedOptions);
    flush();
    expect(advancedOptions).toHaveAttribute('aria-expanded', 'true');
  }, { scenario: 'board-setup-advanced-options' });

  expectNoDiagnostics(artifact);
});

it('opens Board setup from an unavailable Board', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  stubRouteResponse(null, 404);
  window.history.replaceState(null, '', '/b/board_expired_12345678');
  render(() => <App />);

  expect(await screen.findByRole('heading', { name: 'Board not found or expired' }))
    .toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Retrocks' })).toHaveAttribute('href', '/');

  const recoveryLink = screen.getByRole('link', { name: 'Create a new board' });
  expect(recoveryLink).toHaveAttribute('href', '/retro');
  fireEvent.click(recoveryLink);

  expect(await screen.findByRole('heading', { name: 'Create a board', level: 1 }))
    .toBeInTheDocument();
  expect(window.location.pathname).toBe('/retro');
});

function stubRouteResponse(value: unknown, status = 200) {
  vi.stubGlobal('fetch', async (resource: string) => {
    if (!new URL(resource, window.location.origin).pathname.startsWith('/_server')) {
      throw new Error(`Unexpected request: ${resource}`);
    }
    return Response.json(value, {
      status,
      headers: { 'X-Server-Function-Format': '8' }, // Solid's JSON response format.
    });
  });
}
