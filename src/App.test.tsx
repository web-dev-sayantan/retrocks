import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

import App from './App';

vi.mock('virtual:solid-env/client', () => ({ env: { VITE_APP_NAME: 'Retrocks' } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
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
  vi.stubGlobal('fetch', async (resource: string) => {
    if (!new URL(resource, window.location.origin).pathname.startsWith('/_server')) {
      throw new Error(`Unexpected request: ${resource}`);
    }
    return Response.json(null, {
      status: 404,
      headers: { 'X-Server-Function-Format': '8' }, // Solid's JSON response format.
    });
  });
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
