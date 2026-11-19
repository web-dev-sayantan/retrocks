import { For, Show, createMemo, createSignal } from 'solid-js';

import {
  MAX_CARD_CONTENT_LENGTH,
  type CardViewDTO,
  type ColumnDTO,
} from '../lib/board-types';
import { formatRelativeTime } from '../lib/recent-boards';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import CardText from './CardText';
import { ArrowRightLeftIcon, PencilIcon, TrashIcon } from './Icons';
import VoteControls, { type WorkspaceVoting } from './VoteControls';

export interface CardItemProps {
  card: CardViewDTO;
  voting: WorkspaceVoting;
  columns: readonly ColumnDTO[];
  isFacilitator: boolean;
  isLocked: boolean;
  isBlurred: boolean;
  nowMs: number;
  onUpdateCard: (cardId: string, content: string) => Promise<boolean>;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<boolean>;
  onDeleteCard: (cardId: string) => Promise<boolean>;
  onDragStartCard: (cardId: string, sourceColumnId: string) => void;
  onDragEndCard: () => void;
}

export default function CardItem(props: CardItemProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editDraft, setEditDraft] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [moveMenuOpen, setMoveMenuOpen] = createSignal(false);
  const [isMoving, setIsMoving] = createSignal(false);

  const canManage = createMemo(() => {
    if (props.isLocked || props.card.redacted) return false;
    if (props.card.isMine) return true;
    return props.isFacilitator && !props.isBlurred;
  });

  const otherColumns = createMemo(() =>
    props.columns.filter((col) => col.id !== props.card.columnId),
  );

  const canMove = createMemo(() => canManage() && otherColumns().length > 0);
  const canDrag = createMemo(() => canMove() && !isEditing());

  const relativeTimestamp = createMemo(() =>
    formatRelativeTime(props.card.createdAt, props.nowMs),
  );

  const placeholderLineWidths = createMemo(() => {
    const count = props.card.placeholderLines ?? 2;
    if (count === 1) return ['w-3/4'];
    if (count === 3) return ['w-full', 'w-11/12', 'w-2/3'];
    return ['w-full', 'w-4/5'];
  });

  function startEdit(): void {
    setEditDraft(props.card.content);
    setConfirmingDelete(false);
    setMoveMenuOpen(false);
    setIsEditing(true);
  }

  function cancelEdit(): void {
    setIsEditing(false);
    setEditDraft('');
  }

  async function saveEdit(): Promise<void> {
    const trimmed = editDraft().trim();
    if (trimmed.length === 0 || isSaving()) return;
    if (trimmed === props.card.content) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      const ok = await props.onUpdateCard(props.card.id, trimmed);
      if (ok) {
        setIsEditing(false);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleEditKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void saveEdit();
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (isDeleting()) return;
    setIsDeleting(true);
    try {
      const ok = await props.onDeleteCard(props.card.id);
      if (!ok) {
        setConfirmingDelete(false);
      }
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleSelectMoveTarget(targetColumnId: string): Promise<void> {
    if (isMoving()) return;
    setIsMoving(true);
    setMoveMenuOpen(false);
    try {
      await props.onMoveCard(props.card.id, targetColumnId);
    } finally {
      setIsMoving(false);
    }
  }

  function handleDragStart(event: DragEvent): void {
    if (!canDrag()) {
      event.preventDefault();
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', props.card.id);
      event.dataTransfer.setData('application/x-retrocks-card', props.card.id);
    }
    props.onDragStartCard(props.card.id, props.card.columnId);
  }

  function handleDragEnd(): void {
    props.onDragEndCard();
  }

  return (
    <article
      data-card-id={props.card.id}
      draggable={canDrag() ? 'true' : 'false'}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      class={[
        'group relative rounded-lg border border-border bg-surface p-3 shadow-2xs transition-colors',
        {
          'cursor-grab active:cursor-grabbing hover:border-text-muted/40':
            canDrag(),
          'bg-surface-subtle/60': props.card.redacted,
        },
      ]}
    >
      <Show
        when={!props.card.redacted}
        fallback={
          <div aria-label="Hidden Card in Private Mode" class="space-y-2 py-0.5">
            <div class="space-y-1.5" aria-hidden="true">
              <For each={placeholderLineWidths()}>
                {(widthClass) => (
                  <div
                    class={[
                      'h-3 rounded bg-border/80 blur-[2px]',
                      widthClass,
                    ]}
                  />
                )}
              </For>
            </div>
            <div class="flex items-center justify-between pt-1 text-[11px] text-text-muted">
              <span>Hidden until Reveal All</span>
              <time class="tabular-nums">{relativeTimestamp()}</time>
            </div>
          </div>
        }
      >
        <Show
          when={!isEditing()}
          fallback={
            <div class="space-y-2">
              <textarea
                aria-label="Edit card text"
                value={editDraft()}
                maxlength={MAX_CARD_CONTENT_LENGTH}
                rows={3}
                onInput={(e) => setEditDraft(e.currentTarget.value)}
                onKeyDown={handleEditKeyDown}
                class={[
                  'w-full resize-none rounded-md border border-border bg-canvas px-2.5 py-2 text-sm text-text',
                  'placeholder:text-text-muted focus:border-focus focus:outline-none',
                ]}
              />
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-[11px] text-text-muted tabular-nums">
                  {editDraft().length}/{MAX_CARD_CONTENT_LENGTH}
                </span>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={isSaving()}
                    class={[
                      'min-h-11 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-muted sm:min-h-7 sm:px-2.5 sm:py-1',
                      'cursor-pointer transition-colors hover:bg-surface-subtle hover:text-text',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    ]}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEdit()}
                    disabled={isSaving() || editDraft().trim().length === 0}
                    class={[
                      'min-h-11 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast sm:min-h-7 sm:px-2.5 sm:py-1',
                      'cursor-pointer transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    ]}
                  >
                    {isSaving() ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          }
        >
          <div class="text-sm leading-relaxed text-text">
            <CardText text={props.card.content} />
          </div>

          <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Show when={props.card.isMine}>
                <span class="rounded-full border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-text">
                  You
                </span>
              </Show>
              <Show when={props.card.isActionItem}>
                <span class="rounded-full border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                  Action Item
                </span>
              </Show>
              <time class="tabular-nums">{relativeTimestamp()}</time>
            </div>

            <Show when={props.card.groupId === null}>
              <VoteControls target={props.card} voting={props.voting} isLocked={props.isLocked} />
            </Show>

            <Show when={canManage()}>
              <div
                class={[
                  'relative flex items-center gap-1 transition-opacity',
                  {
                    'opacity-100': confirmingDelete() || moveMenuOpen(),
                    'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100':
                      !confirmingDelete() && !moveMenuOpen(),
                  },
                ]}
              >
                <Show
                  when={!confirmingDelete()}
                  fallback={
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleConfirmDelete()}
                        disabled={isDeleting()}
                        class={[
                          'min-h-11 rounded-md bg-col-rose px-2.5 py-1 text-xs font-medium text-white sm:min-h-7 sm:px-2',
                          'cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        ]}
                      >
                        {isDeleting() ? 'Deleting...' : 'Confirm?'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(false)}
                        disabled={isDeleting()}
                        class={[
                          'min-h-11 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted sm:min-h-7 sm:px-2',
                          'cursor-pointer transition-colors hover:bg-surface-subtle hover:text-text',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        ]}
                      >
                        Cancel
                      </button>
                    </div>
                  }
                >
                  <button
                    type="button"
                    aria-label="Edit card"
                    title="Edit card"
                    onClick={startEdit}
                    class={[
                      'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-text-muted sm:min-h-7 sm:min-w-7',
                      'transition-colors hover:bg-surface-subtle hover:text-text',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    ]}
                  >
                    <PencilIcon />
                  </button>

                  <Show when={canMove()}>
                    <div class="relative">
                      <button
                        type="button"
                        aria-label="Move to..."
                        aria-haspopup="menu"
                        aria-expanded={moveMenuOpen() ? 'true' : 'false'}
                        title="Move to..."
                        disabled={isMoving()}
                        onClick={() => {
                          setConfirmingDelete(false);
                          setMoveMenuOpen((prev) => !prev);
                        }}
                        class={[
                          'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-text-muted sm:min-h-7 sm:min-w-7',
                          'transition-colors hover:bg-surface-subtle hover:text-text',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        ]}
                      >
                        <ArrowRightLeftIcon />
                      </button>

                      <Show when={moveMenuOpen()}>
                        <div
                          role="menu"
                          aria-label="Move card to Column"
                          class="absolute right-0 bottom-full z-30 mb-1 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-md"
                        >
                          <p class="px-2 py-1 text-[11px] font-medium text-text-muted">
                            Move to...
                          </p>
                          <For each={otherColumns()}>
                            {(targetCol) => (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  void handleSelectMoveTarget(targetCol.id)
                                }
                                class={[
                                  'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text sm:min-h-8',
                                  'transition-colors hover:bg-surface-subtle',
                                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                                ]}
                              >
                                <span
                                  aria-hidden="true"
                                  class={[
                                    'h-2 w-2 shrink-0 rounded-full',
                                    COLUMN_ACCENT_STYLES[targetCol.accent]
                                      .swatch,
                                  ]}
                                />
                                <span class="truncate">{targetCol.title}</span>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <button
                    type="button"
                    aria-label="Delete"
                    title="Delete card"
                    onClick={() => {
                      setMoveMenuOpen(false);
                      setConfirmingDelete(true);
                    }}
                    class={[
                      'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-text-muted sm:min-h-7 sm:min-w-7',
                      'transition-colors hover:bg-surface-subtle hover:text-col-rose',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    ]}
                  >
                    <TrashIcon />
                  </button>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </article>
  );
}
