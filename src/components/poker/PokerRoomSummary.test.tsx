import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { flush } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import type { PokerClosedRoomView, PokerResult } from '../../lib/poker-types';
import PokerRoomSummary from './PokerRoomSummary';

const roomId = 'abcdefghijklmnopqrstuv';

vi.mock('../../lib/poker-actions', () => ({
  deletePokerRoom: vi.fn(async () => ({ ok: true })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeClosedRoom(overrides: Partial<PokerClosedRoomView> = {}): PokerClosedRoomView {
  return {
    closed: true,
    id: roomId,
    name: 'Poker Room',
    version: 3,
    canDelete: true,
    stories: [
      { title: 'Checkout flow', status: 'estimated', acceptedEstimate: '5' },
      { title: 'Refunds', status: 'skipped' },
    ],
    ...overrides,
  };
}

test('hides Reopen Room and Delete Room when viewer was not a Facilitator before close', () => {
  const onReopen = vi.fn(async (): Promise<PokerResult> => ({ ok: false, code: 'FORBIDDEN', message: 'Forbidden' }));
  const onUnavailable = vi.fn();
  const view = render(() => (
    <PokerRoomSummary
      room={makeClosedRoom({ canDelete: false })}
      onReopen={onReopen}
      onUnavailable={onUnavailable}
    />
  ));

  expect(view.queryByRole('button', { name: 'Reopen Room' })).not.toBeInTheDocument();
  expect(view.queryByRole('button', { name: 'Delete Room' })).not.toBeInTheDocument();
});

test('shows Reopen Room for a pre-close Facilitator, stays focusable while pending, and handles errors and ROOM_NOT_FOUND', async () => {
  let resolveReopen!: (result: PokerResult) => void;
  const onReopen = vi.fn(() => new Promise<PokerResult>((resolve) => {
    resolveReopen = resolve;
  }));
  const onUnavailable = vi.fn();

  const view = render(() => (
    <PokerRoomSummary
      room={makeClosedRoom({ canDelete: true })}
      onReopen={onReopen}
      onUnavailable={onUnavailable}
    />
  ));

  const agent = createAgent();
  expect(agent.snapshot().map((control) => control.label)).toContain('Reopen Room');

  const reopenButton = view.getByRole('button', { name: 'Reopen Room' });
  reopenButton.focus();
  fireEvent.click(reopenButton);
  flush();

  expect(onReopen).toHaveBeenCalledTimes(1);
  expect(reopenButton).toHaveAttribute('aria-disabled', 'true');
  expect(reopenButton).toHaveFocus();
  expect(reopenButton).toHaveTextContent('Reopening Room…');

  fireEvent.click(reopenButton);
  expect(onReopen).toHaveBeenCalledTimes(1);

  resolveReopen({ ok: false, code: 'FORBIDDEN', message: 'Facilitator access is required.' });
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('Facilitator access is required.'));
  expect(reopenButton).not.toHaveAttribute('aria-disabled', 'true');

  onReopen.mockResolvedValueOnce({
    ok: false,
    code: 'ROOM_NOT_FOUND',
    message: 'This Room is no longer available.',
  });
  fireEvent.click(reopenButton);
  await waitFor(() => expect(onUnavailable).toHaveBeenCalledOnce());
});
