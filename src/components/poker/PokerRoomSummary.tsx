import { For, Show, onSettled, untrack } from 'solid-js';

import { takeFacilitatorLinkToken } from '../../lib/facilitator-link';
import { pokerRoomPath } from '../../lib/poker-routes';
import type { PokerClosedRoomView } from '../../lib/poker-types';
import PokerRoomDeletion from './PokerRoomDeletion';
import './poker.css';

export default function PokerRoomSummary(props: { room: PokerClosedRoomView; focusHeading?: boolean; onUnavailable: () => void }) {
  let heading!: HTMLHeadingElement;

  onSettled(() => {
    if (props.focusHeading) heading.focus();
    const path = pokerRoomPath(untrack(() => props.room.id));
    const scrubFragment = () => takeFacilitatorLinkToken(path);
    scrubFragment();
    window.addEventListener('hashchange', scrubFragment);
    return () => window.removeEventListener('hashchange', scrubFragment);
  });

  return (
    <main class="poker-workspace poker-summary">
      <header class="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
        <div>
          <h1 ref={heading} tabindex={-1} class="poker-title">Room summary</h1>
          <p class="mt-2 text-sm font-medium text-text-muted">This Pointing Poker Room is closed. It expires 90 days after closing.</p>
        </div>
        <Show when={props.room.canDelete}>
          <PokerRoomDeletion roomId={props.room.id} onUnavailable={props.onUnavailable} />
        </Show>
      </header>
      <section aria-labelledby="poker-summary-stories">
        <h2 id="poker-summary-stories" class="text-xl font-semibold tracking-tight">Stories</h2>
        <Show when={props.room.stories.length > 0} fallback={<p class="mt-3 text-text-muted">No Stories were added.</p>}>
          <ol aria-labelledby="poker-summary-stories" class="poker-story-list mt-3 space-y-2">
            <For each={props.room.stories}>
              {(story) => (
                <li class="poker-story bg-surface">
                  <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p class="min-w-0 font-medium [overflow-wrap:anywhere]">{story.title}</p>
                    <p class="text-sm text-text-muted [overflow-wrap:anywhere]">
                      {story.acceptedEstimate !== undefined
                        ? <>Accepted Estimate <strong class="font-semibold text-[var(--poker-highlight)]">{story.acceptedEstimate}</strong></>
                        : story.status === 'skipped' ? 'Skipped' : 'Pending'}
                    </p>
                  </div>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </section>
    </main>
  );
}
