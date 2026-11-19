import { For, Show, createSignal, onSettled } from 'solid-js';

import {
  formatRelativeTime,
  readRecentBoards,
  removeRecentBoard,
  type RecentBoardEntry,
} from '../lib/recent-boards';

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
        class="mt-8 min-w-0 border-t border-border pt-6 sm:mt-10 lg:mt-0 lg:border-t-0 lg:pt-1"
      >
        <h2 id="recent-boards-heading" class="text-xl font-semibold tracking-tight text-text lg:text-2xl">
          Recent Boards
        </h2>
        <p class="mt-1 text-sm text-text-muted">Saved in this browser only.</p>

        <ul class="mt-3 divide-y divide-border" role="list">
          <For each={[...entries()].sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)}>
            {(entry) => (
              <li class="flex items-center gap-2 py-2">
                <a
                  href={`/b/${entry.id}`}
                  aria-labelledby={`recent-board-title-${entry.id}`}
                  aria-describedby={`recent-board-details-${entry.id}`}
                  class={[
                    'group flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-2 py-1 [overflow-wrap:anywhere]',
                    'hover:bg-surface-subtle active:bg-surface-subtle',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  ]}
                >
                  <span
                    id={`recent-board-title-${entry.id}`}
                    class="text-base font-medium text-text group-hover:underline"
                  >
                    {entry.title}
                  </span>
                  <span
                    id={`recent-board-details-${entry.id}`}
                    class="text-sm text-text-muted tabular-nums"
                  >
                    Visited {formatRelativeTime(entry.lastVisitedAt)}
                    <Show when={entry.isFacilitator}> · <span>Facilitator</span></Show>
                  </span>
                </a>

                <button
                  type="button"
                  onClick={() => handleRemove(entry.id)}
                  aria-label={`Remove ${entry.title} from Recent Boards`}
                  class={[
                    'min-h-11 min-w-11 shrink-0 cursor-pointer rounded-lg px-2 py-1 text-sm font-medium text-text-muted',
                    'transition-colors hover:bg-surface-subtle hover:text-text active:bg-surface-subtle',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
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
