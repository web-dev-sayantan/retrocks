import { Show, createMemo, createSignal, createUniqueId } from 'solid-js';
import { encode } from 'uqr';

import { getFacilitatorLink, rotateFacilitatorLink } from '../lib/sharing-actions';
import { CloseIcon } from './Icons';

const buttonClass = [
  'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text sm:min-h-9',
  'transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
];

function CopyLink(props: { label: string; link: string }) {
  const inputId = createUniqueId();
  const [status, setStatus] = createSignal('');

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(props.link);
      setStatus('Copied!');
    } catch {
      setStatus('Select the link to copy it manually.');
    }
  }

  return (
    <div>
      <label for={inputId} class="text-sm font-medium text-text">
        {props.label}
      </label>
      <div class="mt-1.5 flex gap-2">
        <input
          id={inputId}
          class="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-3 text-sm text-text focus:border-focus focus:outline-none"
          type="text"
          value={props.link}
          readonly
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          class={buttonClass}
          aria-label={`Copy ${props.label}`}
          onClick={() => void copyLink()}
        >
          Copy
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        class={status() ? 'mt-1.5 text-xs text-text-muted' : 'sr-only'}
      >
        {status()}
      </p>
    </div>
  );
}

function ParticipantQrCode(props: { link: string }) {
  const qr = createMemo(() => {
    const { data, size } = encode(props.link, { border: 4, ecc: 'M' });
    const modules: string[] = [];
    for (const [y, row] of data.entries()) {
      for (const [x, dark] of row.entries()) {
        if (dark) modules.push(`M${x} ${y}h1v1h-1z`);
      }
    }
    return { size, path: modules.join('') };
  });

  return (
    <svg
      role="img"
      aria-label="Participant Link QR code"
      class="mx-auto block h-44 w-44 rounded-md bg-white"
      viewBox={`0 0 ${qr().size} ${qr().size}`}
      shape-rendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="white" />
      <path d={qr().path} fill="black" />
    </svg>
  );
}

function FacilitatorSharing(props: { boardId: string }) {
  const [link, setLink] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');

  async function requestLink(rotate: boolean) {
    if (pending()) return;
    if (
      rotate &&
      !window.confirm('Rotate the Co-Facilitator Link? Previously shared links will stop working.')
    ) {
      return;
    }

    setPending(true);
    setError('');
    if (rotate) setLink('');

    try {
      const fetchLink = rotate ? rotateFacilitatorLink : getFacilitatorLink;
      const result = await fetchLink(props.boardId);
      if (result.ok) {
        setLink(new URL(result.link, window.location.origin).href);
      } else {
        setError(result.message);
      }
    } catch {
      setError(
        rotate
          ? 'Could not rotate the link. Try again.'
          : 'Could not retrieve the link. Try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section class="space-y-3 border-t border-border pt-4" aria-label="Facilitator sharing">
      <Show when={link()} keyed>
        {(currentLink) => <CopyLink label="Co-Facilitator Link" link={currentLink} />}
      </Show>
      <p class="text-xs text-text-muted">
        Anyone with this link can become a Facilitator. Share it only with people you trust.
      </p>
      <div class="flex flex-wrap gap-2">
        <Show when={!link()}>
          <button
            type="button"
            class={buttonClass}
            disabled={pending()}
            onClick={() => void requestLink(false)}
          >
            Show Co-Facilitator Link
          </button>
        </Show>
        <button
          type="button"
          class={buttonClass}
          disabled={pending()}
          onClick={() => void requestLink(true)}
        >
          Rotate Link
        </button>
      </div>
      <Show when={pending()}>
        <p role="status" class="text-xs text-text-muted">Working…</p>
      </Show>
      <Show when={error()}>
        <p role="alert" class="text-xs text-text">
          {error()}
        </p>
      </Show>
    </section>
  );
}

export default function ShareBoard(props: {
  boardId: string;
  isFacilitator: boolean;
}) {
  let dialog!: HTMLDialogElement;
  const titleId = createUniqueId();
  const [participantLink, setParticipantLink] = createSignal('');

  function openDialog() {
    const link = new URL(`/b/${props.boardId}`, window.location.origin).href;
    setParticipantLink(link);
    dialog.showModal();
  }

  function clearDialog() {
    if (!dialog.open) setParticipantLink('');
  }

  return (
    <>
      <button
        type="button"
        class={buttonClass}
        onClick={openDialog}
        aria-haspopup="dialog"
      >
        Share
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={clearDialog}
        class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-4 text-text shadow-xl backdrop:bg-black/50 sm:p-5"
      >
        <div class="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} class="text-base font-semibold">
            Share Board
          </h2>
          <button
            type="button"
            aria-label="Close Share"
            class={buttonClass}
            onClick={() => dialog.close()}
          >
            <CloseIcon />
          </button>
        </div>
        <Show when={participantLink()}>
          {(link) => (
            <div class="space-y-4">
              <CopyLink label="Participant Link" link={link()} />
              <ParticipantQrCode link={link()} />
              <Show when={props.isFacilitator}>
                <FacilitatorSharing boardId={props.boardId} />
              </Show>
            </div>
          )}
        </Show>
      </dialog>
    </>
  );
}
