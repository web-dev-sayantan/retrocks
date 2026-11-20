import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@ui-sdk/solid/dialog';
import { Share2 } from 'lucide';
import { Show, createMemo, createSignal, createUniqueId } from 'solid-js';
import { encode } from 'uqr';

import { confirmBoardAction } from '../lib/board-confirm';
import { getFacilitatorLink, rotateFacilitatorLink } from '../lib/sharing-actions';
import BoardOverlayHeader from './BoardOverlayHeader';
import LucideIcon from './LucideIcon';

const buttonClass = [
  'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium',
  'transition-colors board-focus-ring aria-disabled:cursor-wait aria-disabled:opacity-60',
];
const secondaryButtonClass = [buttonClass, 'border-control bg-surface text-text hover:bg-surface-subtle active:bg-surface-subtle'];

function CopyLink(props: { label: string; labelId: string; link: string; primary?: boolean }) {
  const [status, setStatus] = createSignal('');
  let input!: HTMLInputElement;

  async function copyLink(button: HTMLButtonElement) {
    button.focus();
    setStatus('');
    try {
      await navigator.clipboard.writeText(props.link);
      setStatus(`${props.label} copied.`);
    } catch {
      if (document.activeElement === button && input.isConnected) {
        input.focus();
        setStatus('Copy the selected link manually.');
      } else {
        setStatus('Select the link to copy it manually.');
      }
    }
  }

  return (
    <div>
      <div class="flex gap-2">
        <input
          ref={input}
          aria-labelledby={props.labelId}
          class="board-modal-field min-h-11 min-w-0 flex-1 px-3 text-base"
          type="text"
          value={props.link}
          readonly
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          class={[
            'shrink-0',
            props.primary
              ? [buttonClass, 'border-transparent bg-accent text-accent-contrast hover:opacity-90 active:opacity-80']
              : secondaryButtonClass,
          ]}
          aria-label={`Copy ${props.label}`}
          onClick={(event) => void copyLink(event.currentTarget)}
        >
          Copy
        </button>
      </div>
      <p role="status" class={status() ? 'mt-2 text-sm text-text-muted' : 'sr-only'}>
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
    <figure class="flex items-center gap-3 rounded-2xl bg-surface-subtle p-3 sm:gap-4">
      <svg
        role="img"
        aria-label="Participant Link QR code"
        class="aspect-square w-28 max-w-[45%] shrink-0 rounded-lg bg-white sm:w-32"
        viewBox={`0 0 ${qr().size} ${qr().size}`}
        shape-rendering="crispEdges"
      >
        <rect width="100%" height="100%" fill="white" />
        <path d={qr().path} fill="black" />
      </svg>
      <figcaption class="min-w-0 text-sm text-text-muted">
        <strong class="block text-base font-semibold text-text">Scan to join</strong>
        Use your phone camera to open this Board.
      </figcaption>
    </figure>
  );
}

function FacilitatorSharing(props: { boardId: string }) {
  const titleId = createUniqueId();
  const [link, setLink] = createSignal('');
  const [pending, setPending] = createSignal<'show' | 'rotate' | null>(null);
  const [status, setStatus] = createSignal('');
  const [error, setError] = createSignal('');
  let heading!: HTMLHeadingElement;

  async function requestLink(rotate: boolean, button: HTMLButtonElement) {
    if (pending()) return;
    if (rotate) {
      const confirmed = await confirmBoardAction({
        title: 'Rotate the Co-Facilitator Link?',
        description: 'Previously shared links will stop working.',
        confirmLabel: 'Rotate Link',
      });
      if (!confirmed) return;
    }

    const failure = rotate
      ? 'Could not rotate the link. Try again.'
      : 'Could not retrieve the link. Try again.';
    setPending(rotate ? 'rotate' : 'show');
    setStatus('');
    setError('');
    if (rotate) setLink('');

    try {
      const fetchLink = rotate ? rotateFacilitatorLink : getFacilitatorLink;
      const result = await fetchLink(props.boardId);
      if (result.ok) {
        const nextLink = new URL(result.link, window.location.origin).href;
        if (!rotate && document.activeElement === button) heading.focus();
        setLink(nextLink);
        setStatus(rotate ? 'Co-Facilitator Link rotated.' : 'Co-Facilitator Link ready to copy.');
      } else {
        setError(result.message);
      }
    } catch {
      setError(failure);
    } finally {
      setPending(null);
    }
  }

  return (
    <section class="space-y-3 border-t border-border pt-4" aria-labelledby={titleId}>
      <div class="space-y-1">
        <h3 ref={heading} id={titleId} tabindex={-1} class="text-base font-semibold board-focus-ring">
          Co-Facilitator Link
        </h3>
        <p class="text-sm text-text-muted">
          This link grants Facilitator access and control over Board settings. Share it only with people you trust.
        </p>
      </div>
      <Show when={link()} keyed>
        {(currentLink) => <CopyLink label="Co-Facilitator Link" labelId={titleId} link={currentLink} />}
      </Show>
      <div class="flex flex-wrap gap-2">
        <Show when={!link()}>
          <button
            type="button"
            class={secondaryButtonClass}
            aria-disabled={pending() ? 'true' : 'false'}
            onClick={(event) => void requestLink(false, event.currentTarget)}
          >
            Show Co-Facilitator Link
          </button>
        </Show>
        <button
          type="button"
          class={secondaryButtonClass}
          aria-disabled={pending() ? 'true' : 'false'}
          onClick={(event) => void requestLink(true, event.currentTarget)}
        >
          Rotate Link
        </button>
      </div>
      <p role="status" class={pending() || status() ? 'text-sm text-text-muted' : 'sr-only'}>
        {pending() === 'rotate' ? 'Rotating link…' : pending() ? 'Retrieving link…' : status()}
      </p>
      <p role="alert" class={error() ? 'rounded-lg border border-col-rose bg-col-rose-tint p-3 text-sm text-text' : 'sr-only'}>
        {error()}
      </p>
    </section>
  );
}

export default function ShareBoard(props: {
  boardId: string;
  isFacilitator: boolean;
  emphasis?: 'primary' | 'secondary';
}) {
  const [open, setOpen] = createSignal(false);
  const participantTitleId = createUniqueId();
  const participantLink = () => new URL(`/b/${props.boardId}`, window.location.origin).href;
  const emphasis = () => props.emphasis ?? 'primary';

  return (
    <Dialog open={open()} onOpenChange={setOpen}>
      <DialogTrigger
        data-cta-emphasis={emphasis()}
        class={[
          'spring-press inline-flex board-touch-target min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3.5 text-[13px] leading-none font-medium max-[30rem]:px-2 sm:h-9',
          'board-focus-ring',
          emphasis() === 'primary'
            ? 'border-transparent bg-accent text-accent-contrast shadow-xs hover:opacity-92 active:opacity-85'
            : 'border-border/80 bg-surface text-text hover:bg-surface-subtle active:bg-surface-subtle',
        ]}
      >
        <LucideIcon icon={Share2} class="size-3.5 shrink-0" strokeWidth={1.9} />
        <span class="max-[30rem]:sr-only">Share</span>
      </DialogTrigger>
      <DialogBackdrop data-print-hide="true" class="board-dialog-backdrop z-40" />
      <DialogContent
        data-board-overlay="true"
        data-print-hide="true"
        class="board-dialog-surface z-50 flex w-[min(28rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-2xl"
      >
        <BoardOverlayHeader
          closeLabel="Close Share"
          onClose={() => setOpen(false)}
        >
          <DialogTitle class="truncate">Share Board</DialogTitle>
        </BoardOverlayHeader>
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5">
          <section aria-labelledby={participantTitleId} class="space-y-3">
            <div class="space-y-1">
              <h3 id={participantTitleId} class="text-base font-semibold">Participant Link</h3>
              <p class="text-sm text-text-muted">Anyone with this link can join the Board as a Participant.</p>
            </div>
            <CopyLink label="Participant Link" labelId={participantTitleId} link={participantLink()} primary />
            <ParticipantQrCode link={participantLink()} />
          </section>
          <Show when={props.isFacilitator}>
            <FacilitatorSharing boardId={props.boardId} />
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
}
