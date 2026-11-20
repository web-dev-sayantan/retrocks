import { ArrowUpRight, Clock } from 'lucide';
import { For, Show, createSignal, onSettled } from 'solid-js';

import {
  formatRelativeTime,
  readRecentBoards,
  removeRecentBoard,
  type RecentBoardEntry,
} from '../lib/recent-boards';
import LucideIcon from './LucideIcon';

export default function RecentBoardsList() {
  const [entries, setEntries] = createSignal<RecentBoardEntry[]>([]);

  onSettled(() => {
    setEntries(readRecentBoards());
  });

  const handleRemove = (boardId: string) => {
    setEntries(removeRecentBoard(boardId));
  };

  return (
    <Show when={entries().length > 0}>
      <section
        aria-labelledby="recent-boards-heading"
        class="min-w-0 rounded-2xl border border-border/80 bg-surface/85 p-4 sm:p-5"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2
              id="recent-boards-heading"
              class="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-text"
            >
              <LucideIcon icon={Clock} class="size-4 text-text-muted" strokeWidth={1.8} />
              <span>Recent Boards</span>
            </h2>
            <p class="mt-0.5 text-xs text-text-muted">Saved in this browser only.</p>
          </div>
          <span
            aria-hidden="true"
            class="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-medium text-text-muted tabular-nums"
          >
            {entries().length}
          </span>
        </div>

        <ul class="mt-3 divide-y divide-border/70" role="list">
          <For each={[...entries()].sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)}>
            {(entry) => (
              <li class="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                <a
                  href={`/b/${entry.id}`}
                  aria-labelledby={`recent-board-title-${entry.id}`}
                  aria-describedby={`recent-board-details-${entry.id}`}
                  class={[
                    'spring-press group flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-2.5 py-2 [overflow-wrap:anywhere]',
                    'hover:bg-surface-subtle/80 active:bg-surface-subtle',
                    'board-focus-ring',
                  ]}
                >
                  <span class="flex min-w-0 flex-col">
                    <span
                      id={`recent-board-title-${entry.id}`}
                      class="truncate text-sm font-medium text-text group-hover:text-text"
                    >
                      {entry.title}
                    </span>
                    <span
                      id={`recent-board-details-${entry.id}`}
                      class="mt-0.5 text-xs text-text-muted tabular-nums"
                    >
                      Visited {formatRelativeTime(entry.lastVisitedAt)}
                      <Show when={entry.isFacilitator}>
                        {' · '}
                        <span class="font-medium text-text">Facilitator</span>
                      </Show>
                    </span>
                  </span>
                  <LucideIcon
                    icon={ArrowUpRight}
                    class="size-3.5 shrink-0 text-text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                    strokeWidth={1.8}
                  />
                </a>

                <button
                  type="button"
                  onClick={() => handleRemove(entry.id)}
                  aria-label={`Remove ${entry.title} from Recent Boards`}
                  class={[
                    'spring-press min-h-10 min-w-10 shrink-0 cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted',
                    'hover:bg-surface-subtle hover:text-text active:bg-surface-subtle',
                    'board-focus-ring',
                  ]}
                >
                  Remove
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
