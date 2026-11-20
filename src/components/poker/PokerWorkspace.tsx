import { For, Show, onSettled } from 'solid-js';

import type { PokerRoomView } from '../../lib/poker-types';
import PokerRoomSharing from './PokerRoomSharing';
import './poker.css';

export default function PokerWorkspace(props: {
  room: PokerRoomView;
  online: string[];
  status: 'connecting' | 'live' | 'reconnecting';
  focusHeading?: boolean;
  claimError?: string;
}) {
  let heading!: HTMLHeadingElement;

  onSettled(() => {
    if (props.focusHeading) heading.focus();
  });

  return (
    <main class="poker-workspace">
      <header class="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
        <h1 ref={heading} tabindex={-1} class="poker-title">Pointing Poker</h1>
        <p class="text-sm font-medium text-text-muted" aria-live="polite">
          {props.status === 'live' ? `${props.online.length} online` : 'Connecting to Room…'}
        </p>
      </header>

      <p role="alert" class={props.claimError ? 'mb-4 text-sm font-medium text-[var(--poker-error)]' : 'sr-only'}>
        {props.claimError}
      </p>
      <div class="poker-layout">
        <section class="min-w-0 rounded-xl border border-border bg-surface p-5 sm:p-7" aria-labelledby="poker-stories">
          <h2 id="poker-stories" class="text-xl font-semibold tracking-tight">Stories</h2>
          <p class="mt-2 text-sm leading-relaxed text-text-muted">There are no Stories in this Room yet.</p>
          <PokerRoomSharing
            roomId={props.room.id}
            isFacilitator={props.room.viewer?.isFacilitator ?? false}
            revision={props.room.facilitatorLinkRevision}
          />
        </section>

        <section class="min-w-0 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="poker-participants">
          <h2 id="poker-participants" class="text-xl font-semibold tracking-tight">Participants</h2>
          <ul class="mt-3 divide-y divide-border">
            <For each={props.room.participants} keyed={(participant) => participant.id}>
              {(participant) => (
                <li class="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div class="min-w-0">
                    <p class="font-medium [overflow-wrap:anywhere]">
                      {participant().displayName}
                      <Show when={participant().id === props.room.viewer?.id}> (you)</Show>
                    </p>
                    <Show when={participant().isFacilitator}>
                      <p class="text-xs text-text-muted">Facilitator</p>
                    </Show>
                  </div>
                  <span class={[
                    'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                    props.online.includes(participant().id)
                      ? 'bg-[var(--poker-pale)] text-[var(--poker-highlight)]'
                      : 'bg-surface-subtle text-text-muted',
                  ]}>
                    {props.online.includes(participant().id) ? 'Online' : 'Offline'}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </div>
    </main>
  );
}
