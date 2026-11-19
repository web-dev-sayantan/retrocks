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
      <section aria-labelledby="recent-boards-heading" class="mt-10">
        <div class="flex items-baseline justify-between gap-4">
          <h2
            id="recent-boards-heading"
            class="text-sm font-semibold tracking-tight text-text"
          >
            Recent Boards
          </h2>
          <p class="text-xs text-text-muted">
            Saved locally in this browser only
          </p>
        </div>

        <ul class="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <For each={entries()}>
            {(entry) => (
              <li class="group flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-text-muted/40">
                <a
                  href={`/b/${entry.id}`}
                  class={[
                    'min-w-0 flex-1 rounded-md',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  ]}
                >
                  <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-medium text-text group-hover:underline">
                      {entry.title}
                    </span>
                    <Show when={entry.isFacilitator}>
                      <span class="shrink-0 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text">
                        Facilitator
                      </span>
                    </Show>
                  </div>
                  <p class="mt-0.5 text-xs text-text-muted tabular-nums">
                    Visited {formatRelativeTime(entry.lastVisitedAt)}
                  </p>
                </a>

                <button
                  type="button"
                  onClick={() => handleRemove(entry.id)}
                  aria-label={`Remove ${entry.title} from recent boards`}
                  title="Remove from history"
                  class={[
                    'inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg',
                    'text-text-muted transition-colors hover:bg-surface-subtle hover:text-text',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  ]}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.75"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="h-4 w-4"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
