import { cleanup, fireEvent, render, waitFor, within } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { flush } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import { replacePokerFacilitatorLink } from '../../lib/poker-sharing-actions';
import BoardConfirmDialog from '../BoardConfirmDialog';
import PokerRoomSharing from './PokerRoomSharing';

const roomId = 'abcdefghijklmnopqrstuv';
const roomPath = `/p/${roomId}`;
const firstLink = `${roomPath}#f=${'A'.repeat(43)}`;
const secondLink = `${roomPath}#f=${'B'.repeat(43)}`;
const agent = createAgent();

vi.mock('../../lib/poker-sharing-actions', () => ({
  getPokerFacilitatorLink: vi.fn(async () => ({ ok: true, value: { href: firstLink, revision: 1 } })),
  replacePokerFacilitatorLink: vi.fn(async () => ({ ok: true, value: { href: secondLink, revision: 2 } })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('shares the participant link and QR code in a Share dialog while keeping the Co-Facilitator Link Facilitator-only', async () => {
  const visitor = render(() => <PokerRoomSharing roomId={roomId} isFacilitator={false} />);
  const visitorTrigger = visitor.getByRole('button', { name: 'Share' });
  fireEvent.click(visitorTrigger);
  flush();

  const visitorDialog = within(await visitor.findByRole('dialog', { name: 'Share Room' }));
  expect(visitorDialog.getByRole('textbox', { name: 'Participant link' })).toHaveValue(window.location.origin + roomPath);
  expect(visitorDialog.getByRole('img', { name: 'Participant link QR code' })).toBeVisible();
  expect(visitorDialog.queryByRole('button', { name: 'Show Co-Facilitator Link' })).toBeNull();
  fireEvent.click(visitorDialog.getByRole('button', { name: 'Close Share' }));
  await waitFor(() => expect(visitorTrigger).toHaveFocus());
  visitor.unmount();

  const view = render(() => (
    <>
      <PokerRoomSharing roomId={roomId} isFacilitator />
      <BoardConfirmDialog />
    </>
  ));

  const opened = await agent.act({ steps: [{ ref: 'Share', action: 'press' }] });
  expect(opened.ok, opened.error?.message).toBe(true);
  await view.findByRole('dialog', { name: 'Share Room' });
  expect(view.queryByDisplayValue(window.location.origin + firstLink)).toBeNull();

  const controls = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== 'more');
  for (const control of controls) expect(control.label).toBeTruthy();
  expect(controls.map((control) => control.label)).toEqual(expect.arrayContaining([
    'Copy participant link',
    'Show Co-Facilitator Link',
  ]));

  const result = await agent.act({ steps: [{ ref: 'Show Co-Facilitator Link', action: 'press' }] });
  expect(result.ok, result.error?.message).toBe(true);
  await waitFor(() => {
    expect(view.getByRole('textbox', { name: 'Co-Facilitator Link' })).toHaveValue(window.location.origin + firstLink);
  });
  expect(agent.snapshot().map((control) => control.label)).toContain('Copy co-facilitator link');
  expect(agent.snapshot().map((control) => control.label)).toContain('Replace link');

  const replace = view.getByRole('button', { name: 'Replace link' });
  replace.focus();
  fireEvent.click(replace);
  flush();

  const dialog = within(view.getByRole('alertdialog', { name: 'Replace the Co-Facilitator Link?' }));
  await waitFor(() => expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveFocus());
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => {
    expect(replace).toHaveFocus();
    expect(replace).not.toHaveAttribute('aria-disabled');
  });
  expect(replacePokerFacilitatorLink).not.toHaveBeenCalled();

  fireEvent.click(replace);
  flush();
  fireEvent.click(view.getByRole('button', { name: 'Replace Co-Facilitator Link' }));
  await waitFor(() => {
    expect(view.getByRole('textbox', { name: 'Co-Facilitator Link' })).toHaveValue(window.location.origin + secondLink);
  });
  expect(replacePokerFacilitatorLink).toHaveBeenCalledWith(roomId, 1);
});
