import { cleanup, fireEvent, render, waitFor, within } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { flush } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import { deletePokerRoom } from '../../lib/poker-actions';
import PokerRoomDeletion from './PokerRoomDeletion';

const roomId = 'abcdefghijklmnopqrstuv';
let approve = false;
const allow = vi.fn((step: { confirm?: string }) => !step.confirm || approve);
const agent = createAgent({ allow });

vi.mock('../../lib/poker-actions', () => ({
  deletePokerRoom: vi.fn(async () => ({ ok: true })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  approve = false;
});

test('the Room deletion dialog focuses Cancel and requires explicit confirmation', async () => {
  const onUnavailable = vi.fn();
  const view = render(() => <PokerRoomDeletion roomId={roomId} onUnavailable={onUnavailable} />);
  const trigger = view.getByRole('button', { name: 'Delete Room' });
  trigger.focus();
  fireEvent.click(trigger);
  flush();

  const dialog = within(view.getByRole('alertdialog', { name: 'Delete Room?' }));
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  await waitFor(() => expect(cancel).toHaveFocus());
  fireEvent.click(cancel);
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(deletePokerRoom).not.toHaveBeenCalled();

  const controls = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== 'more');
  for (const control of controls) expect(control.label).toBeTruthy();
  expect(controls.map((control) => control.label)).toContain('Delete Room');

  const steps = [{ ref: 'Delete Room', action: 'press', args: ['Delete permanently'] }];
  expect((await agent.act({ steps })).ok).toBe(false);
  expect(allow).toHaveBeenCalledWith(expect.objectContaining({
    confirm: 'Permanently deletes the Room, its Stories, and its estimates for everyone.',
  }), expect.anything());
  expect(deletePokerRoom).not.toHaveBeenCalled();
  approve = true;
  const response = await agent.act({ steps });
  expect(response.ok, response.error?.message).toBe(true);
  expect(deletePokerRoom).toHaveBeenCalledExactlyOnceWith(roomId);
  expect(onUnavailable).toHaveBeenCalledOnce();
});
