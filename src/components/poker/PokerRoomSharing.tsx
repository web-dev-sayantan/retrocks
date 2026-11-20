import { Button } from '@ui-sdk/solid/button';
import { Show, createSignal } from 'solid-js';

import { confirmBoardAction } from '../../lib/board-confirm';
import { pokerRoomPath } from '../../lib/poker-routes';
import { getPokerFacilitatorLink, replacePokerFacilitatorLink } from '../../lib/poker-sharing-actions';
import type { PokerFacilitatorLink } from '../../lib/poker-sharing-types';
import CopyRoomLink from './CopyRoomLink';

const buttonClass = 'poker-secondary board-focus-ring aria-disabled:cursor-wait aria-disabled:opacity-65';

function FacilitatorSharing(props: { roomId: string; revision?: number }) {
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
    <div class="grid gap-3 border-t border-border pt-4">
      <p class="text-sm leading-relaxed text-text-muted">
        Anyone who opens the Co-Facilitator Link can run this Room. Share it with people you trust.
      </p>
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
        {(current) => <CopyRoomLink label="Co-Facilitator Link" href={current.href} />}
      </Show>
      <p role="status" class={status() ? 'text-sm text-text-muted' : 'sr-only'}>{status()}</p>
      <p role="alert" class={error() ? 'text-sm font-medium text-[var(--poker-error)]' : 'sr-only'}>{error()}</p>
    </div>
  );
}

export default function PokerRoomSharing(props: { roomId: string; isFacilitator: boolean; revision?: number }) {
  return (
    <div class="mt-7 grid gap-4 border-t border-border pt-5">
      <CopyRoomLink label="Participant link" href={pokerRoomPath(props.roomId)} />
      <Show when={props.isFacilitator}>
        <FacilitatorSharing roomId={props.roomId} revision={props.revision} />
      </Show>
    </div>
  );
}
