import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { ToastRegion, toast } from '@ui-sdk/solid/toast';
import { flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CopyLinkField from './CopyLinkField';
import ShareQrCode from './ShareQrCode';

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.restoreAllMocks();
});

describe('<CopyLinkField />', () => {
  it('copies the resolved URL to the clipboard and announces inline status', async () => {
    const writeText = vi.fn(async () => undefined);
    mockClipboard(writeText);

    const view = render(() => (
      <CopyLinkField label="Participant link" href="/p/abcdefghijklmnopqrstuv" primary variant="poker" />
    ));
    flush();

    const expectedUrl = `${window.location.origin}/p/abcdefghijklmnopqrstuv`;
    expect(view.getByRole('textbox', { name: 'Participant link' })).toHaveValue(expectedUrl);

    fireEvent.click(view.getByRole('button', { name: 'Copy participant link' }));
    await waitFor(() => {
      expect(view.getByRole('status')).toHaveTextContent('Participant link copied.');
    });
    expect(writeText).toHaveBeenCalledWith(expectedUrl);
  });

  it('reports clipboard success via toast when feedback="toast"', async () => {
    const writeText = vi.fn(async () => undefined);
    mockClipboard(writeText);

    const view = render(() => (
      <>
        <h3 id="share-heading">Participant Link</h3>
        <CopyLinkField
          label="Participant Link"
          labelId="share-heading"
          href="/b/board_0123456789abcdef"
          buttonLabel="Copy"
          buttonAriaLabel="Copy Participant Link"
          feedback="toast"
          primary
        />
        <ToastRegion />
      </>
    ));
    flush();

    const expectedUrl = `${window.location.origin}/b/board_0123456789abcdef`;
    fireEvent.click(view.getByRole('button', { name: 'Copy Participant Link' }));

    await waitFor(() => {
      expect(view.getByText('Participant Link copied.')).toBeVisible();
    });
    expect(writeText).toHaveBeenCalledWith(expectedUrl);
  });

  it('focuses and selects the readonly input for manual copy when clipboard write fails while button has focus', async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    });
    mockClipboard(writeText);

    const view = render(() => (
      <CopyLinkField label="Co-Facilitator Link" href="/p/room123#f=secret" variant="poker" />
    ));
    flush();

    const input = view.getByRole('textbox', { name: 'Co-Facilitator Link' }) as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');
    const button = view.getByRole('button', { name: 'Copy co-facilitator link' });

    fireEvent.click(button);

    await waitFor(() => {
      expect(view.getByRole('status')).toHaveTextContent('Copy the selected link manually.');
    });
    expect(input).toHaveFocus();
    expect(selectSpy).toHaveBeenCalled();
  });

  it('does not steal focus when clipboard write fails after focus moved away', async () => {
    const pending = Promise.withResolvers<void>();
    mockClipboard(vi.fn(() => pending.promise));

    const view = render(() => (
      <>
        <CopyLinkField label="Participant link" href="/p/room123" variant="poker" />
        <button type="button">Other control</button>
      </>
    ));
    flush();

    const input = view.getByRole('textbox', { name: 'Participant link' });
    const otherButton = view.getByRole('button', { name: 'Other control' });

    fireEvent.click(view.getByRole('button', { name: 'Copy participant link' }));
    otherButton.focus();
    pending.reject(new Error('Clipboard unavailable'));

    await waitFor(() => {
      expect(view.getByRole('status')).toHaveTextContent('Select the link to copy it manually.');
    });
    expect(otherButton).toHaveFocus();
    expect(input).not.toHaveFocus();
  });
});

describe('<ShareQrCode />', () => {
  it('renders an accessible QR code SVG with caption text', () => {
    const view = render(() => (
      <ShareQrCode
        link="https://retrocks.example/b/board_0123456789abcdef"
        label="Participant Link QR code"
        description="Use your phone camera to open this Board."
      />
    ));

    const qr = view.getByRole('img', { name: 'Participant Link QR code' });
    expect(qr).toBeInTheDocument();
    expect(qr.querySelector('path')?.getAttribute('d')).toBeTruthy();
    expect(view.getByText('Scan to join')).toBeInTheDocument();
    expect(view.getByText('Use your phone camera to open this Board.')).toBeInTheDocument();
  });
});
