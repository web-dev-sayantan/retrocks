import { Button } from '@ui-sdk/solid/button';
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@ui-sdk/solid/dialog';
import { Share2 } from 'lucide';
import { Show, createSignal, createUniqueId, onSettled } from 'solid-js';

import { confirmBoardAction } from '../../lib/board-confirm';
import { pokerRoomPath } from '../../lib/poker-routes';
import { getPokerFacilitatorLink, replacePokerFacilitatorLink } from '../../lib/poker-sharing-actions';
import type { PokerFacilitatorLink } from '../../lib/poker-sharing-types';
import BoardOverlayHeader from '../BoardOverlayHeader';
import CopyLinkField from '../CopyLinkField';
import LucideIcon from '../LucideIcon';
import ShareQrCode from '../ShareQrCode';

const buttonClass = 'poker-secondary spring-press board-focus-ring aria-disabled:cursor-wait aria-disabled:opacity-65';

function FacilitatorSharing(props: { roomId: string; revision?: number }) {
  const titleId = createUniqueId();
  const [link, setLink] = createSignal<PokerFacilitatorLink>();
  const [knownRevision, setKnownRevision] = createSignal(0);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [status, setStatus] = createSignal('');
  const revision = () => Math.max(props.revision ?? 0, knownRevision());
  const visibleLink = () => {
    const current = link();
    return current?.revision === revision() ? current : undefined;
  };

  async function requestLink(replace?: number) {
    if (pending()) return;
    setPending(true);
    try {
      if (replace !== undefined) {
        const confirmed = await confirmBoardAction({
          title: 'Replace the Co-Facilitator Link?',
          description: 'The previous link will stop working. Existing Facilitators will keep their access.',
          confirmLabel: 'Replace Co-Facilitator Link',
        });
        if (!confirmed) return;
        setLink(undefined);
      }
      setError('');
      setStatus('');

      const result = replace === undefined
        ? await getPokerFacilitatorLink(props.roomId)
        : await replacePokerFacilitatorLink(props.roomId, replace);
      if (result.ok) {
        setKnownRevision(result.value.revision);
        setLink(result.value);
        setStatus(replace === undefined ? 'Co-Facilitator Link ready to copy.' : 'Co-Facilitator Link replaced.');
      } else {
        setError(result.message);
      }
    } catch {
      setError(replace === undefined
        ? 'Could not retrieve the Co-Facilitator Link. Try again.'
        : 'Could not replace the Co-Facilitator Link. Show the current link before trying again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section class="grid gap-3 border-t border-border/70 pt-4" aria-labelledby={titleId}>
      <div class="grid gap-1">
        <h3 id={titleId} class="text-sm font-semibold text-text">Co-Facilitator Link</h3>
        <p class="text-xs leading-relaxed text-text-muted">
          Anyone who opens the Co-Facilitator Link can run this Room. Share it with people you trust.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button type="button" class={buttonClass} aria-disabled={pending() ? 'true' : undefined} onClick={() => {
          if (pending()) return;
          if (visibleLink()) {
            setLink(undefined);
            setStatus('');
          } else {
            void requestLink();
          }
        }}>
          {visibleLink() ? 'Hide Co-Facilitator Link' : 'Show Co-Facilitator Link'}
        </Button>
        <Show when={revision()}>
          {(current) => (
            <Button type="button" class={buttonClass} aria-disabled={pending() ? 'true' : undefined} onClick={() => void requestLink(current())}>
              Replace link
            </Button>
          )}
        </Show>
      </div>
      <Show when={visibleLink()} keyed>
        {(current) => <CopyLinkField label="Co-Facilitator Link" href={current.href} variant="poker" />}
      </Show>
      <p role="status" class={status() ? 'text-xs text-text-muted' : 'sr-only'}>{status()}</p>
      <p role="alert" class={error() ? 'poker-error-text text-xs font-medium' : 'sr-only'}>{error()}</p>
    </section>
  );
}

export default function PokerRoomSharing(props: { roomId: string; isFacilitator: boolean; revision?: number }) {
  const [open, setOpen] = createSignal(false);
  const [origin, setOrigin] = createSignal('');
  const participantTitleId = createUniqueId();

  onSettled(() => {
    setOrigin(window.location.origin);
  });

  const participantUrl = () => `${origin()}${pokerRoomPath(props.roomId)}`;

  return (
    <Dialog open={open()} onOpenChange={setOpen}>
      <DialogTrigger class="poker-bar-pill spring-press board-focus-ring">
        <LucideIcon icon={Share2} class="size-3.5 shrink-0" strokeWidth={1.9} />
        <span>Share</span>
      </DialogTrigger>
      <DialogBackdrop class="board-dialog-backdrop z-40" />
      <DialogContent class="board-dialog-surface z-50 flex w-[min(28rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-surface text-text shadow-2xl">
        <BoardOverlayHeader closeLabel="Close Share" onClose={() => setOpen(false)}>
          <DialogTitle class="truncate">Share Room</DialogTitle>
        </BoardOverlayHeader>
        <div class="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-5">
          <section aria-labelledby={participantTitleId} class="grid gap-3">
            <div class="grid gap-1">
              <h3 id={participantTitleId} class="text-sm font-semibold text-text">Invite Participants</h3>
              <p class="text-xs leading-relaxed text-text-muted">
                Anyone with this link can join the Room with a Display Name.
              </p>
            </div>
            <CopyLinkField label="Participant link" href={pokerRoomPath(props.roomId)} primary variant="poker" />
            <Show when={origin()}>
              <ShareQrCode
                link={participantUrl()}
                label="Participant link QR code"
                description="Use your phone camera to open this Room."
                size="sm"
              />
            </Show>
          </section>
          <Show when={props.isFacilitator}>
            <FacilitatorSharing roomId={props.roomId} revision={props.revision} />
          </Show>
          <p class="border-t border-border/70 pt-3.5 text-xs leading-relaxed text-text-muted">
            This Room expires 90 days after creation or its most recent vote or content change, whichever is later.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
