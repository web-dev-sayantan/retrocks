import { CheckCircle2, Circle, CircleSlash } from 'lucide';
import { For, Show, createMemo, onSettled, untrack } from 'solid-js';

import { takeFacilitatorLinkToken } from '../../lib/facilitator-link';
import { pokerRoomPath } from '../../lib/poker-routes';
import type { PokerClosedRoomView } from '../../lib/poker-types';
import LucideIcon from '../LucideIcon';
import PokerRoomDeletion from './PokerRoomDeletion';
import './poker.css';

export default function PokerRoomSummary(props: { room: PokerClosedRoomView; focusHeading?: boolean; onUnavailable: () => void }) {
  let heading!: HTMLHeadingElement;

  const estimatedCount = createMemo(() => props.room.stories.filter((story) => story.status === 'estimated').length);
  const skippedCount = createMemo(() => props.room.stories.filter((story) => story.status === 'skipped').length);

  onSettled(() => {
    if (props.focusHeading) heading.focus();
    const path = pokerRoomPath(untrack(() => props.room.id));
    const scrubFragment = () => takeFacilitatorLinkToken(path);
    scrubFragment();
    window.addEventListener('hashchange', scrubFragment);
    return () => window.removeEventListener('hashchange', scrubFragment);
  });

  return (
    <main class="poker-summary">
      <header class="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2.5">
            <h1 ref={heading} tabindex={-1} class="poker-entry-title board-focus-ring rounded">
              Room summary
            </h1>
            <span class="rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-text-muted">
              Closed
            </span>
          </div>
          <p class="mt-2 text-sm leading-relaxed text-text-muted">
            This Pointing Poker Room is closed. It expires 90 days after closing.
          </p>
        </div>
        <Show when={props.room.canDelete}>
          <PokerRoomDeletion roomId={props.room.id} onUnavailable={props.onUnavailable} />
        </Show>
      </header>

      <section class="mt-6" aria-labelledby="poker-summary-stories">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="poker-summary-stories" class="text-[13px] font-semibold text-text-muted">Stories</h2>
          <Show when={props.room.stories.length > 0}>
            <p class="flex flex-wrap items-center gap-3 text-xs text-text-muted tabular-nums">
              <span><strong class="font-semibold text-text">{props.room.stories.length}</strong> total</span>
              <span><strong class="font-semibold text-text">{estimatedCount()}</strong> estimated</span>
              <Show when={skippedCount() > 0}>
                <span><strong class="font-semibold text-text">{skippedCount()}</strong> skipped</span>
              </Show>
            </p>
          </Show>
        </div>

        <Show
          when={props.room.stories.length > 0}
          fallback={<p class="mt-4 text-sm text-text-muted">No Stories were added.</p>}
        >
          <ol aria-labelledby="poker-summary-stories" class="poker-summary-list mt-3">
            <For each={props.room.stories}>
              {(story) => (
                <li class="poker-summary-row">
                  <div class="flex min-w-0 items-center gap-2.5">
                    <span class="inline-flex shrink-0" aria-hidden="true">
                      <Show
                        when={story.status === 'estimated'}
                        fallback={
                          <Show
                            when={story.status === 'skipped'}
                            fallback={<LucideIcon icon={Circle} class="size-3.5 text-text-muted/70" strokeWidth={2} />}
                          >
                            <LucideIcon icon={CircleSlash} class="size-3.5 text-text-muted/70" strokeWidth={2} />
                          </Show>
                        }
                      >
                        <LucideIcon icon={CheckCircle2} class="size-3.5 text-accent" strokeWidth={2.2} />
                      </Show>
                    </span>
                    <p
                      class={[
                        'min-w-0 text-sm font-medium [overflow-wrap:break-word] [text-wrap:pretty]',
                        story.status === 'skipped' ? 'text-text-muted line-through' : 'text-text',
                      ]}
                    >
                      {story.title}
                    </p>
                  </div>
                  <p class="shrink-0 text-xs text-text-muted tabular-nums [overflow-wrap:anywhere]">
                    {story.acceptedEstimate !== undefined
                      ? (
                        <>
                          <span class="sr-only">Accepted Estimate </span>
                          <span class="poker-est-badge">{story.acceptedEstimate}</span>
                        </>
                      )
                      : story.status === 'skipped' ? 'Skipped' : 'Pending'}
                  </p>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </section>
    </main>
  );
}
