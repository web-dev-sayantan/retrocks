import { cleanup, fireEvent, render, waitFor, within } from '@solidjs/testing-library';
import { ToastRegion, toast } from '@ui-sdk/solid/toast';
import { flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BoardConfirmDialog from './BoardConfirmDialog';
import ShareBoard from './ShareBoard';
import {
  getFacilitatorLink,
  rotateFacilitatorLink,
} from '../lib/sharing-actions';

vi.mock('../lib/sharing-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sharing-actions')>();
  return {
    ...actual,
    getFacilitatorLink: vi.fn(async () => ({ ok: true as const, link: '/claim?token=old' })),
    rotateFacilitatorLink: vi.fn(async () => ({ ok: true as const, link: '/claim?token=new' })),
  };
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

function renderShare(props: { isFacilitator: boolean }) {
  return render(() => (
    <>
      <ShareBoard boardId="board_0123456789abcdef" isFacilitator={props.isFacilitator} />
      <BoardConfirmDialog />
      <ToastRegion />
    </>
  ));
}

afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.mocked(getFacilitatorLink).mockClear();
  vi.mocked(rotateFacilitatorLink).mockClear();
});

describe('<ShareBoard />', () => {
  it('opens and closes the Share dialog from the trigger with Escape and focus return', async () => {
    const view = renderShare({ isFacilitator: false });
    const share = view.getByRole('button', { name: 'Share' });

    share.focus();
    fireEvent.click(share);
    flush();

    const dialog = within(view.getByRole('dialog', { name: 'Share Board' }));
    // A press-open moves focus on the next animation frame.
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: 'Close Share' })).toHaveFocus(),
    );
    expect(dialog.getByRole('img', { name: 'Participant Link QR code' })).toBeInTheDocument();
    expect(dialog.queryByRole('region', { name: 'Co-Facilitator Link' })).toBeNull();

    fireEvent.keyDown(dialog.getByRole('button', { name: 'Copy Participant Link' }), { key: 'Escape' });
    flush();
    expect(view.queryByRole('dialog', { name: 'Share Board' })).toBeNull();
    expect(share).toHaveFocus();
  });

  it('confirms Rotate Link through the shared alert dialog instead of window.confirm', async () => {
    const view = renderShare({ isFacilitator: true });
    const share = view.getByRole('button', { name: 'Share' });
    fireEvent.click(share);
    flush();
    const dialog = within(view.getByRole('dialog', { name: 'Share Board' }));

    fireEvent.click(dialog.getByRole('button', { name: 'Show Co-Facilitator Link' }));
    await flushPromises();
    expect(getFacilitatorLink).toHaveBeenCalledWith('board_0123456789abcdef');
    expect(dialog.getByRole('textbox', { name: 'Co-Facilitator Link' })).toHaveValue(
      new URL('/claim?token=old', window.location.origin).href,
    );

    const rotate = dialog.getByRole('button', { name: 'Rotate Link' });
    rotate.focus();
    fireEvent.click(rotate);
    await flushPromises();
    expect(rotateFacilitatorLink).not.toHaveBeenCalled();

    const confirmDialog = within(view.getByRole('alertdialog', { name: 'Rotate the Co-Facilitator Link?' }));
    expect(confirmDialog.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(confirmDialog.getByText('Previously shared links will stop working.')).toBeInTheDocument();

    // Escape restores focus to the Rotate trigger without rotating.
    fireEvent.keyDown(confirmDialog.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    await flushPromises();
    expect(view.queryByRole('alertdialog')).toBeNull();
    expect(rotate).toHaveFocus();
    expect(rotateFacilitatorLink).not.toHaveBeenCalled();

    fireEvent.click(rotate);
    await flushPromises();
    const confirmAgain = within(
      view.getByRole('alertdialog', { name: 'Rotate the Co-Facilitator Link?' }),
    );
    fireEvent.click(confirmAgain.getByRole('button', { name: 'Rotate Link' }));
    await flushPromises();

    expect(rotateFacilitatorLink).toHaveBeenCalledWith('board_0123456789abcdef');
    expect(view.queryByRole('alertdialog')).toBeNull();
    // The rotation confirmation arrives as a toast.
    await waitFor(() =>
      expect(view.getByText('Co-Facilitator Link rotated.')).toBeVisible(),
    );
    expect(dialog.getByRole('textbox', { name: 'Co-Facilitator Link' })).toHaveValue(
      new URL('/claim?token=new', window.location.origin).href,
    );
  });
});
