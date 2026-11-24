import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { flush } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

import App from './App';
import { makeBoardView } from './lib/board-fixtures';
import { FIBONACCI_DECK, type PokerLiveRoomView } from './lib/poker-types';
import { readRecentPokerRooms, recordRecentPokerRoom } from './lib/recent-poker-rooms';

vi.mock('virtual:solid-env/client', () => ({ env: { VITE_APP_NAME: 'Retrocks' } }));

afterEach(() => {
  cleanup();
  localStorage.clear();
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
  expect(retro).not.toHaveAttribute('aria-current', 'page');
  expect(poker).not.toHaveAttribute('aria-current', 'page');

  const { artifact } = await captureArtifact(async () => {
    fireEvent.click(retro);
    expect(await screen.findByRole('heading', { name: 'Create a board', level: 1 }))
      .toBeInTheDocument();
    expect(retro).toHaveAttribute('aria-current', 'page');
    expect(home).not.toHaveAttribute('aria-current', 'page');
    expect(poker).not.toHaveAttribute('aria-current', 'page');

    fireEvent.click(poker);
    expect(await screen.findByRole('heading', { name: 'Pointing Poker', level: 1 }))
      .toBeInTheDocument();
    expect(poker).toHaveAttribute('aria-current', 'page');
    expect(home).not.toHaveAttribute('aria-current', 'page');
    expect(retro).not.toHaveAttribute('aria-current', 'page');

    fireEvent.click(home);
    await waitFor(() => expect(home).toHaveAttribute('aria-current', 'page'));
    expect(window.location.pathname).toBe('/');
  }, { scenario: 'floating-header-tool-navigation' });

  expectNoDiagnostics(artifact);
});

it.each([
  ['/retro/?source=link', 'Create a board', 'Retrospectives'],
  ['/pointing-poker/?source=link', 'Pointing Poker', 'Pointing Poker'],
])('marks the active destination when opening %s directly', async (path, heading, activeTool) => {
  window.history.replaceState(null, '', path);
  render(() => <App />);

  expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
  const header = within(screen.getByRole('banner'));
  const tools = within(header.getByRole('navigation', { name: 'Retrocks tools' }));
  const activeLink = tools.getByRole('link', { name: activeTool });
  expect(activeLink).toHaveAttribute('aria-current', 'page');
  for (const link of header.getAllByRole('link').filter((link) => link !== activeLink)) {
    expect(link).not.toHaveAttribute('aria-current', 'page');
  }
});

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

it.each(['p', 'P'])(
  'marks Pointing Poker as current while a Participant opens a Room link under /%s',
  async (segment) => {
    stubRouteResponse(room);
    window.history.replaceState(null, '', `/${segment}/${room.id}`);
    render(() => <App />);

    expect(await screen.findByRole('heading', { name: 'Join Pointing Poker', level: 1 }))
      .toBeInTheDocument();
    expect(readRecentPokerRooms()).toEqual([]);
    const header = within(screen.getByRole('banner'));
    const tools = within(header.getByRole('navigation', { name: 'Retrocks tools' }));
    expect(tools.getByRole('link', { name: 'Pointing Poker' })).toHaveAttribute('aria-current', 'page');
    expect(tools.getByRole('link', { name: 'Retrospectives' })).not.toHaveAttribute('aria-current', 'page');
    expect(header.getByRole('link', { name: 'Retrocks' })).not.toHaveAttribute('aria-current', 'page');
  },
);

it('reopens a created Room from Home and Pointing Poker setup', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const viewer = { id: 'sam', displayName: 'Sam', isFacilitator: true };
  vi.stubGlobal('EventSource', class extends EventTarget { close() {} });
  stubRouteResponse({ ...room, viewer, participants: [viewer] }, 200, `/p/${room.id}`);
  render(() => <App />);

  const tools = within(screen.getByRole('navigation', { name: 'Retrocks tools' }));
  const poker = tools.getByRole('link', { name: 'Pointing Poker' });
  fireEvent.click(poker);
  const setup = await screen.findByRole('form', { name: 'Pointing Poker' });
  expect(poker).toHaveAttribute('aria-current', 'page');

  fireEvent.input(within(setup).getByRole('textbox', { name: 'Display Name' }), {
    target: { value: 'Sam' },
  });
  fireEvent.submit(setup);
  await screen.findByRole('heading', { name: 'Pointing Poker', level: 1 });
  await waitFor(() => expect(window.location.pathname).toBe(`/p/${room.id}`));
  expect(poker).toHaveAttribute('aria-current', 'page');

  const home = screen.getByRole('link', { name: 'Retrocks' });
  const label = 'Room · abcdefgh';
  const openSavedRoom = async () => {
    const list = await screen.findByRole('region', { name: 'Recent Rooms' });
    const link = within(list).getByRole('link', { name: label });
    expect(link).toHaveAttribute('href', `/p/${room.id}`);
    fireEvent.click(link);
    await waitFor(() => expect(window.location.pathname).toBe(`/p/${room.id}`));
  };

  fireEvent.click(home);
  fireEvent.click(await screen.findByRole('tab', { name: 'Poker' }));
  flush();
  await openSavedRoom();
  fireEvent.click(poker);
  await openSavedRoom();
  fireEvent.click(home);
  fireEvent.click(await screen.findByRole('tab', { name: 'Poker' }));
  flush();

  const list = await screen.findByRole('region', { name: 'Recent Rooms' });
  const remove = 'Remove Room · abcdefgh from Recent Rooms';
  expect(within(list).getByRole('button', { name: remove })).toBeEnabled();
  const agent = createAgent();
  expect(agent.snapshot().some((control) => control.label === remove)).toBe(true);
  expect((await agent.act({ steps: [{ ref: remove, action: 'press' }] })).ok).toBe(true);
  await waitFor(() => expect(list).not.toBeInTheDocument());
  expect(readRecentPokerRooms()).toEqual([]);
});

it.each([
  ['closed', { id: 'c'.repeat(22), version: 2, closed: true, canDelete: false, stories: [] }, 'Room summary', true],
  ['unavailable', null, 'Room unavailable', false],
] as const)('handles a saved Room that is %s', async (_, response, heading, saved) => {
  const id = response?.id ?? 'u'.repeat(22);
  recordRecentPokerRoom(id);
  stubRouteResponse(response);
  window.history.replaceState(null, '', `/p/${id}`);
  render(() => <App />);

  await screen.findByRole('heading', { name: heading, level: 1 });
  await waitFor(() => expect(readRecentPokerRooms().some((entry) => entry.id === id)).toBe(saved));
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

it.each(['/p/room/unknown', '/b', '/b/board_expired_12345678/unknown'])(
  'offers tool navigation with no active destination on a 404 at %s',
  async (path) => {
    window.history.replaceState(null, '', path);
    render(() => <App />);

    expect(await screen.findByRole('heading', { name: 'Page not found', level: 1 }))
      .toBeInTheDocument();
    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('navigation', { name: 'Retrocks tools' })).toBeInTheDocument();
    for (const link of header.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current', 'page');
    }
  },
);

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

it('opens Pointing Poker directly at /pointing-poker', async () => {
  window.history.replaceState(null, '', '/pointing-poker');
  render(() => <App />);

  expect(await screen.findByRole('heading', { name: 'Pointing Poker', level: 1 }))
    .toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Display Name' })).toBeInTheDocument();
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

function stubRouteResponse(value: unknown, status = 200, redirect?: string) {
  vi.stubGlobal('fetch', async (resource: string, init?: RequestInit) => {
    if (!new URL(resource, window.location.origin).pathname.startsWith('/_server')) {
      throw new Error(`Unexpected request: ${resource}`);
    }
    if (redirect && init?.method === 'POST') {
      return new Response(null, {
        headers: { 'X-Server-Function-Redirect': `302 ${new URL(redirect, window.location.origin)}` },
      });
    }
    return Response.json(value, {
      status,
      headers: { 'X-Server-Function-Format': '8' }, // Solid's JSON response format.
    });
  });
}
