import { cleanup, render, screen } from '@solidjs/testing-library';
import { Show, createSignal, flush } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import PageMessage from './PageMessage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('focuses the heading from a reactive focusHeading prop without untracked read warnings', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const [unavailable, setUnavailable] = createSignal(false);
  const [hasTransitionedPhase, setHasTransitionedPhase] = createSignal(false);

  render(() => (
    <Show when={unavailable()}>
      <PageMessage
        title="Room unavailable"
        message="This link does not lead to an available Pointing Poker Room."
        focusHeading={hasTransitionedPhase()}
      />
    </Show>
  ));

  setHasTransitionedPhase(true);
  setUnavailable(true);
  flush();

  const heading = screen.getByRole('heading', { level: 1, name: 'Room unavailable' });
  expect(heading).toHaveAttribute('tabindex', '-1');
  expect(heading).toHaveFocus();
  expect(warn).not.toHaveBeenCalled();
});

test('does not make the heading focusable when neither focusHeading nor headingRef is provided', () => {
  render(() => (
    <PageMessage
      title="Room unavailable"
      message="This link does not lead to an available Pointing Poker Room."
    />
  ));

  const heading = screen.getByRole('heading', { level: 1, name: 'Room unavailable' });
  expect(heading).not.toHaveAttribute('tabindex');
  expect(heading).not.toHaveFocus();
});
