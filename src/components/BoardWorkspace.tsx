import { For, Show, createEffect } from 'solid-js';

import type { BoardViewDTO } from '../lib/board-types';
import { recordRecentBoard, removeRecentBoard } from '../lib/recent-boards';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import ThemeToggle from './ThemeToggle';

export interface BoardWorkspaceProps {
  board: BoardViewDTO | null;
  boardId: string;
  homeHref?: string;
}

export default function BoardWorkspace(props: BoardWorkspaceProps) {
  createEffect(
    () => ({
      boardId: props.boardId,
      board: props.board
        ? {
            id: props.board.id,
            title: props.board.title,
            isFacilitator: props.board.isFacilitator,
          }
        : null,
    }),
    ({ boardId, board }) => {
      if (board) {
        recordRecentBoard(board);
      } else if (boardId) {
        removeRecentBoard(boardId);
      }
    },
  );

  return (
    <Show
      when={props.board}
      fallback={
        <div class="flex min-h-dvh flex-col">
          <header class="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur-sm">
            <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
              <a
                href={props.homeHref ?? '/'}
                class={[
                  'inline-flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight text-text',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                ]}
              >
                <span
                  aria-hidden="true"
                  class="inline-block h-2.5 w-2.5 rounded-sm bg-accent"
                />
                <span>Retrocks</span>
              </a>
              <ThemeToggle />
            </div>
          </header>

          <main class="mx-auto flex flex-1 max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
            <p class="text-xs font-medium tracking-wide text-text-muted uppercase tabular-nums">
              404
            </p>
            <h1 class="mt-2 text-2xl font-semibold tracking-tight text-text">
              Board not found or expired
            </h1>
            <p class="mt-3 text-sm text-text-muted">
              This Board may have been deleted by its Facilitator or expired
              after inactivity.
            </p>
            <a
              href={props.homeHref ?? '/'}
              class={[
                'mt-6 inline-flex items-center rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-contrast',
                'transition-opacity hover:opacity-90',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              ]}
            >
              Create a new board
            </a>
          </main>
        </div>
      }
    >
      {(board) => (
        <div class="flex min-h-dvh flex-col bg-canvas">
          {/* Minimal sticky Board header */}
          <header class="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur-sm">
            <div class="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
              <div class="flex min-w-0 items-center gap-3">
                <a
                  href={props.homeHref ?? '/'}
                  aria-label="Retrocks home"
                  class={[
                    'inline-flex shrink-0 items-center gap-2 rounded-md text-sm font-semibold tracking-tight text-text',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  ]}
                >
                  <span
                    aria-hidden="true"
                    class="inline-block h-2.5 w-2.5 rounded-sm bg-accent"
                  />
                  <span class="hidden sm:inline">Retrocks</span>
                </a>
                <span aria-hidden="true" class="text-border">
                  /
                </span>
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <h1 class="truncate text-sm font-semibold text-text sm:text-base">
                      {board().title}
                    </h1>
                    <Show when={board().isLocked}>
                      <span class="shrink-0 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text-muted">
                        Locked
                      </span>
                    </Show>
                    <Show when={board().isBlurred}>
                      <span class="shrink-0 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text-muted">
                        Private Mode
                      </span>
                    </Show>
                  </div>
                  <Show when={board().subtitle.length > 0}>
                    <p class="truncate text-xs text-text-muted">
                      {board().subtitle}
                    </p>
                  </Show>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <ThemeToggle />
              </div>
            </div>
          </header>

          {/* Columns workspace */}
          <main class="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
            <div class="flex gap-4 overflow-x-auto pb-4">
              <For each={board().columns}>
                {(column) => (
                  <section
                    aria-label={column.title}
                    class="flex min-w-[280px] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xs"
                  >
                    {/* Crisp 3px pastel top accent bar */}
                    <div
                      data-column-accent-bar="true"
                      class={[
                        'h-[3px] w-full',
                        COLUMN_ACCENT_STYLES[column.accent].bar,
                      ]}
                    />

                    {/* Column header with whisper-soft 5% tint */}
                    <div
                      class={[
                        'flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3',
                        COLUMN_ACCENT_STYLES[column.accent].tint,
                      ]}
                    >
                      <div class="flex min-w-0 items-center gap-2">
                        <h2 class="truncate text-sm font-semibold text-text">
                          {column.title}
                        </h2>
                        <Show when={column.isActionColumn}>
                          <span class="shrink-0 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                            Actions
                          </span>
                        </Show>
                      </div>
                      <span
                        aria-label={`${column.cardCount} cards`}
                        class="inline-flex min-w-6 items-center justify-center rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-text-muted tabular-nums"
                      >
                        {column.cardCount}
                      </span>
                    </div>

                    {/* Column Card stream body */}
                    <div class="flex flex-1 flex-col gap-2.5 p-3">
                      <p class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
                        No Cards yet
                      </p>
                    </div>
                  </section>
                )}
              </For>
            </div>
          </main>
        </div>
      )}
    </Show>
  );
}
