import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';

import {
  COLUMN_ACCENTS,
  MAX_CARD_CONTENT_LENGTH,
  MAX_COLUMN_TITLE_LENGTH,
  type ActionItemPatch,
  type CardViewDTO,
  type ColumnAccent,
  type ColumnDTO,
  type ReactionEmoji,
} from '../lib/board-types';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import CardItem from './CardItem';
import type { WorkspaceVoting } from './VoteControls';
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from './Icons';

export interface ColumnPanelProps {
  column: ColumnDTO;
  columnIndex: number;
  totalColumns: number;
  columns: readonly ColumnDTO[];
  cards: readonly CardViewDTO[];
  voting: WorkspaceVoting;
  isFacilitator: boolean;
  isLocked: boolean;
  isBlurred: boolean;
  nowMs: number;
  isMobileActive: boolean;
  isHorizontalSnap: boolean;
  draggingCardId: string | null;
  draggingSourceColumnId: string | null;
  onCreateCard: (columnId: string, content: string) => Promise<boolean>;
  onUpdateCard: (cardId: string, content: string) => Promise<boolean>;
  onUpdateActionItem: (
    cardId: string,
    patch: ActionItemPatch,
  ) => Promise<boolean>;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<boolean>;
  onDeleteCard: (cardId: string) => Promise<boolean>;
  onToggleReaction: (cardId: string, emoji: ReactionEmoji) => Promise<boolean>;
  onOpenCardDetail: (cardId: string) => void;
  onUpdateColumn: (
    columnId: string,
    patch: { title?: string; accent?: ColumnAccent; isActionColumn?: boolean },
  ) => Promise<boolean>;
  onMoveColumn: (columnId: string, direction: -1 | 1) => Promise<boolean>;
  onDeleteColumn: (columnId: string) => Promise<boolean>;
  onDragStartCard: (cardId: string, sourceColumnId: string) => void;
  onDragEndCard: () => void;
}

export default function ColumnPanel(props: ColumnPanelProps) {
  const [cardDraft, setCardDraft] = createSignal('');
  const [composerFocused, setComposerFocused] = createSignal(false);
  const [isCreatingCard, setIsCreatingCard] = createSignal(false);

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [isRenaming, setIsRenaming] = createSignal(false);
  const [renameDraft, setRenameDraft] = createSignal('');
  const [isSavingRename, setIsSavingRename] = createSignal(false);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [isDeletingColumn, setIsDeletingColumn] = createSignal(false);
  const [isDropActive, setIsDropActive] = createSignal(false);

  createEffect(
    () => props.isLocked,
    (locked) => {
      if (locked) {
        setMenuOpen(false);
        setConfirmingDelete(false);
        setIsRenaming(false);
        setRenameDraft('');
      }
    },
  );

  const canManageColumn = createMemo(
    () => props.isFacilitator && !props.isLocked,
  );
  const canMoveLeft = createMemo(() => props.columnIndex > 0);
  const canMoveRight = createMemo(
    () => props.columnIndex < props.totalColumns - 1,
  );
  const hasHiddenCards = createMemo(() => props.cards.some((card) => card.redacted));
  const canDeleteColumn = createMemo(() =>
    canManageColumn() && props.totalColumns > 1 && !hasHiddenCards(),
  );

  const isEligibleDropTarget = createMemo(
    () =>
      !props.isLocked &&
      props.draggingCardId !== null &&
      props.draggingSourceColumnId !== props.column.id,
  );

  async function submitNewCard(): Promise<void> {
    const trimmed = cardDraft().trim();
    if (trimmed.length === 0 || isCreatingCard() || props.isLocked) return;
    setIsCreatingCard(true);
    try {
      const ok = await props.onCreateCard(props.column.id, trimmed);
      if (ok) {
        setCardDraft('');
      }
    } finally {
      setIsCreatingCard(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitNewCard();
    }
  }

  function startRename(): void {
    setMenuOpen(false);
    setConfirmingDelete(false);
    setRenameDraft(props.column.title);
    setIsRenaming(true);
  }

  function cancelRename(): void {
    setIsRenaming(false);
    setRenameDraft('');
  }

  async function saveRename(): Promise<void> {
    const trimmed = renameDraft().trim();
    if (trimmed.length === 0 || isSavingRename()) return;
    if (trimmed === props.column.title) {
      setIsRenaming(false);
      return;
    }
    setIsSavingRename(true);
    try {
      const ok = await props.onUpdateColumn(props.column.id, {
        title: trimmed,
      });
      if (ok) {
        setIsRenaming(false);
      }
    } finally {
      setIsSavingRename(false);
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveRename();
    }
  }

  async function handleSelectAccent(accent: ColumnAccent): Promise<void> {
    setMenuOpen(false);
    if (accent === props.column.accent) return;
    await props.onUpdateColumn(props.column.id, { accent });
  }

  async function handleReorder(direction: -1 | 1): Promise<void> {
    setMenuOpen(false);
    await props.onMoveColumn(props.column.id, direction);
  }

  async function handleConfirmDeleteColumn(): Promise<void> {
    if (isDeletingColumn() || !canDeleteColumn()) return;
    setIsDeletingColumn(true);
    try {
      const ok = await props.onDeleteColumn(props.column.id);
      if (!ok) {
        setConfirmingDelete(false);
      }
    } finally {
      setIsDeletingColumn(false);
    }
  }

  function handleDragOver(event: DragEvent): void {
    if (props.isLocked) return;
    const cardId =
      props.draggingCardId ??
      event.dataTransfer?.getData('application/x-retrocks-card') ??
      event.dataTransfer?.getData('text/plain') ??
      '';
    if (!cardId) return;
    if (
      props.draggingSourceColumnId &&
      props.draggingSourceColumnId === props.column.id
    ) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setIsDropActive(true);
  }

  function handleDragLeave(event: DragEvent): void {
    const currentTarget = event.currentTarget as HTMLElement | null;
    const related = event.relatedTarget as Node | null;
    if (currentTarget && related && currentTarget.contains(related)) {
      return;
    }
    setIsDropActive(false);
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    setIsDropActive(false);
    if (props.isLocked) return;
    const cardId =
      props.draggingCardId ||
      event.dataTransfer?.getData('application/x-retrocks-card') ||
      event.dataTransfer?.getData('text/plain') ||
      '';
    if (!cardId) return;
    if (props.draggingSourceColumnId === props.column.id) return;
    props.onDragEndCard();
    void props.onMoveCard(cardId, props.column.id);
  }

  return (
    <section
      aria-label={props.column.title}
      data-column-id={props.column.id}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      class={[
        'flex-col overflow-visible rounded-xl border border-border bg-surface shadow-2xs transition-shadow',
        {
          flex: props.isMobileActive,
          'hidden sm:flex': !props.isMobileActive,
          'sm:w-[320px] sm:shrink-0 sm:snap-start': props.isHorizontalSnap,
          'min-w-0': !props.isHorizontalSnap,
          'ring-2 ring-focus/70': isDropActive(),
          'ring-1 ring-focus/30': isEligibleDropTarget() && !isDropActive(),
        },
      ]}
    >
      {/* Crisp 3px pastel top accent bar */}
      <div
        data-column-accent-bar="true"
        class={[
          'h-[3px] w-full rounded-t-xl',
          COLUMN_ACCENT_STYLES[props.column.accent].bar,
        ]}
      />

      {/* Column header with whisper-soft 5% tint */}
      <div
        class={[
          'relative flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5',
          COLUMN_ACCENT_STYLES[props.column.accent].tint,
        ]}
      >
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <Show
            when={!isRenaming()}
            fallback={
              <div class="flex min-w-0 flex-1 items-center gap-1">
                <input
                  type="text"
                  aria-label="Column title"
                  value={renameDraft()}
                  maxlength={MAX_COLUMN_TITLE_LENGTH}
                  onInput={(e) => setRenameDraft(e.currentTarget.value)}
                  onKeyDown={handleRenameKeyDown}
                  class={[
                    'min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm font-semibold text-text',
                    'focus:border-focus focus:outline-none',
                  ]}
                />
                <button
                  type="button"
                  aria-label="Save column title"
                  disabled={isSavingRename() || renameDraft().trim().length === 0}
                  onClick={() => void saveRename()}
                  class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md bg-accent text-accent-contrast hover:opacity-90 disabled:opacity-50"
                >
                  <CheckIcon />
                </button>
                <button
                  type="button"
                  aria-label="Cancel column rename"
                  onClick={cancelRename}
                  class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-text-muted hover:text-text"
                >
                  <CloseIcon />
                </button>
              </div>
            }
          >
            <h2 class="truncate text-sm font-semibold text-text">
              <Show
                when={canManageColumn()}
                fallback={props.column.title}
              >
                <button
                  type="button"
                  onClick={startRename}
                  title="Click to rename Column"
                  class={[
                    'max-w-full cursor-pointer truncate rounded-sm text-left hover:underline',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  ]}
                >
                  {props.column.title}
                </button>
              </Show>
            </h2>
            <Show when={props.column.isActionColumn}>
              <span class="shrink-0 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                Actions
              </span>
            </Show>
          </Show>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          <span
            aria-label={`${props.column.cardCount} cards`}
            class="inline-flex min-w-6 items-center justify-center rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-text-muted tabular-nums"
          >
            {props.column.cardCount}
          </span>

          <Show when={canManageColumn()}>
            <div class="relative">
              <button
                type="button"
                aria-label={`Column options for ${props.column.title}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen() ? 'true' : 'false'}
                onClick={() => {
                  setConfirmingDelete(false);
                  setMenuOpen((prev) => !prev);
                }}
                class={[
                  'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-text-muted sm:min-h-8 sm:min-w-8',
                  'transition-colors hover:bg-surface hover:text-text',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                ]}
              >
                <MoreHorizontalIcon />
              </button>

              <Show when={menuOpen()}>
                <div
                  role="menu"
                  aria-label={`Options for ${props.column.title}`}
                  class="absolute top-full right-0 z-30 mt-1 w-56 rounded-xl border border-border bg-surface p-2 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={startRename}
                    class="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-text hover:bg-surface-subtle"
                  >
                    <PencilIcon />
                    <span>Rename column</span>
                  </button>

                  <div class="mt-1 grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      disabled={!canMoveLeft()}
                      onClick={() => void handleReorder(-1)}
                      class="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs font-medium text-text hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeftIcon />
                      <span>Move left</span>
                    </button>
                    <button
                      type="button"
                      disabled={!canMoveRight()}
                      onClick={() => void handleReorder(1)}
                      class="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs font-medium text-text hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span>Move right</span>
                      <ChevronRightIcon />
                    </button>
                  </div>

                  <div class="mt-2 border-t border-border pt-2">
                    <p class="px-1 text-[11px] font-medium text-text-muted">
                      Accent color
                    </p>
                    <div class="mt-1.5 grid grid-cols-4 gap-1.5 px-1">
                      <For each={COLUMN_ACCENTS}>
                        {(accent) => (
                          <button
                            type="button"
                            aria-label={`Accent ${COLUMN_ACCENT_STYLES[accent].label}`}
                            aria-pressed={
                              props.column.accent === accent ? 'true' : 'false'
                            }
                            onClick={() => void handleSelectAccent(accent)}
                            class={[
                              'flex min-h-9 cursor-pointer items-center justify-center rounded-md border transition-colors',
                              {
                                'border-focus bg-surface-subtle':
                                  props.column.accent === accent,
                                'border-border hover:bg-surface-subtle':
                                  props.column.accent !== accent,
                              },
                            ]}
                          >
                            <span
                              aria-hidden="true"
                              class={[
                                'h-3.5 w-3.5 rounded-full',
                                COLUMN_ACCENT_STYLES[accent].swatch,
                              ]}
                            />
                          </button>
                        )}
                      </For>
                    </div>
                  </div>

                  <div class="mt-2 border-t border-border pt-2">
                    <Show
                      when={!confirmingDelete()}
                      fallback={
                        <div class="space-y-2 rounded-lg bg-surface-subtle p-2">
                          <p class="text-xs text-text">
                            <Show
                              when={props.column.cardCount > 0}
                              fallback="Delete this empty Column?"
                            >
                              Delete this Column and its{' '}
                              <span class="font-semibold tabular-nums">
                                {props.column.cardCount}{' '}
                                {props.column.cardCount === 1
                                  ? 'card'
                                  : 'cards'}
                              </span>
                              ?
                            </Show>
                          </p>
                          <div class="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isDeletingColumn() || !canDeleteColumn()}
                              onClick={() => void handleConfirmDeleteColumn()}
                              class="min-h-9 flex-1 cursor-pointer rounded-md bg-col-rose px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                            >
                              {isDeletingColumn()
                                ? 'Deleting...'
                                : 'Confirm delete'}
                            </button>
                            <button
                              type="button"
                              disabled={isDeletingColumn()}
                              onClick={() => setConfirmingDelete(false)}
                              class="min-h-9 cursor-pointer rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:text-text"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      }
                    >
                      <button
                        type="button"
                        disabled={!canDeleteColumn()}
                        title={hasHiddenCards() ? 'Reveal All before deleting a Column with hidden Cards.' : undefined}
                        onClick={() => setConfirmingDelete(true)}
                        class="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-col-rose hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <TrashIcon />
                        <span>Delete column</span>
                      </button>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* Pinned top quick inline "+ Add card" composer */}
      <Show when={!props.isLocked}>
        <div class="border-b border-border/60 bg-canvas/50 p-3">
          <textarea
            aria-label={`Add card to ${props.column.title}`}
            placeholder="+ Add card"
            value={cardDraft()}
            maxlength={MAX_CARD_CONTENT_LENGTH}
            rows={composerFocused() || cardDraft().length > 0 ? 2 : 1}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => {
              if (cardDraft().length === 0) {
                setComposerFocused(false);
              }
            }}
            onInput={(e) => setCardDraft(e.currentTarget.value)}
            onKeyDown={handleComposerKeyDown}
            class={[
              'w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text',
              'placeholder:text-text-muted focus:border-focus focus:outline-none',
            ]}
          />
          <Show when={composerFocused() || cardDraft().length > 0}>
            <div class="mt-2 flex items-center justify-between gap-2">
              <span class="text-[11px] text-text-muted">
                <Show
                  when={cardDraft().length > 800}
                  fallback="Enter to add · Shift+Enter for new line"
                >
                  <span class="tabular-nums">
                    {cardDraft().length}/{MAX_CARD_CONTENT_LENGTH}
                  </span>
                </Show>
              </span>
              <button
                type="button"
                disabled={isCreatingCard() || cardDraft().trim().length === 0}
                onClick={() => void submitNewCard()}
                class={[
                  'min-h-11 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast sm:min-h-7 sm:px-2.5 sm:py-1',
                  'cursor-pointer transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                ]}
              >
                {isCreatingCard() ? 'Adding...' : 'Add'}
              </button>
            </div>
          </Show>
        </div>
      </Show>

      {/* Column Card stream body */}
      <div class="flex flex-1 flex-col gap-2.5 p-3">
        <Show
          when={props.cards.length > 0}
          fallback={
            <p class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
              No Cards yet
            </p>
          }
        >
          <For each={props.cards}>
            {(card) => (
              <CardItem
                card={card}
                voting={props.voting}
                columns={props.columns}
                isFacilitator={props.isFacilitator}
                isLocked={props.isLocked}
                isBlurred={props.isBlurred}
                nowMs={props.nowMs}
                onUpdateCard={props.onUpdateCard}
                onUpdateActionItem={props.onUpdateActionItem}
                onMoveCard={props.onMoveCard}
                onDeleteCard={props.onDeleteCard}
                onToggleReaction={props.onToggleReaction}
                onOpenCardDetail={props.onOpenCardDetail}
                onDragStartCard={props.onDragStartCard}
                onDragEndCard={props.onDragEndCard}
              />
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}
