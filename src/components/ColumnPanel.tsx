import { Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '@ui-sdk/solid/menu';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Flag,
  Pencil,
  Trash2,
  X,
} from 'lucide';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';

import {
  COLUMN_ACCENTS,
  MAX_CARD_CONTENT_LENGTH,
  MAX_COLUMN_TITLE_LENGTH,
  type ActionItemPatch,
  type CardGroupDTO,
  type CardViewDTO,
  type ColumnAccent,
  type ColumnDTO,
  type ReactionEmoji,
} from '../lib/board-types';
import type { ColumnStreamItem } from '../lib/board-view';
import { confirmBoardAction } from '../lib/board-confirm';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import CardGroupItem from './CardGroupItem';
import CardItem from './CardItem';
import LucideIcon from './LucideIcon';
import type { WorkspaceVoting } from './VoteControls';

export interface ColumnPanelProps {
  column: ColumnDTO;
  columnIndex: number;
  totalColumns: number;
  columns: readonly ColumnDTO[];
  cards: readonly CardViewDTO[];
  groups: readonly CardGroupDTO[];
  streamItems: readonly ColumnStreamItem[];
  visibleCardCount: number;
  hasActiveFilter: boolean;
  voting: WorkspaceVoting;
  isFacilitator: boolean;
  isLocked: boolean;
  isBlurred: boolean;
  canGroupCards: boolean;
  nowMs: number;
  isMobile: boolean;
  isMobileActive: boolean;
  isHorizontalSnap: boolean;
  draggingCardId: string | null;
  draggingGroupId: string | null;
  draggingSourceColumnId: string | null;
  onResetFilters: () => void;
  onRegisterComposer?: (
    columnId: string,
    el: HTMLTextAreaElement | null,
  ) => void;
  onActivateColumn?: (columnId: string) => void;
  onCreateCard: (columnId: string, content: string) => Promise<string | null>;
  onUpdateCard: (cardId: string, content: string) => Promise<string | null>;
  onUpdateActionItem: (
    cardId: string,
    patch: ActionItemPatch,
  ) => Promise<boolean>;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<boolean>;
  onDeleteCard: (cardId: string) => Promise<boolean>;
  onToggleReaction: (cardId: string, emoji: ReactionEmoji) => Promise<string | null>;
  onOpenCardDetail: (cardId: string, trigger: HTMLButtonElement) => void;
  onUpdateColumn: (
    columnId: string,
    patch: { title?: string; accent?: ColumnAccent; isActionColumn?: boolean },
  ) => Promise<boolean>;
  onMoveColumn: (columnId: string, direction: -1 | 1) => Promise<boolean>;
  onDeleteColumn: (columnId: string) => Promise<boolean>;
  onGroupCard: (
    cardId: string,
    targetType: 'card' | 'group',
    targetId: string,
  ) => Promise<boolean>;
  onUngroupCard: (cardId: string) => Promise<boolean>;
  onRenameCardGroup: (groupId: string, title: string) => Promise<boolean>;
  onDissolveCardGroup: (groupId: string) => Promise<boolean>;
  onMoveCardGroup: (
    groupId: string,
    targetColumnId: string,
  ) => Promise<boolean>;
  onDragStartCard: (cardId: string, sourceColumnId: string) => void;
  onDragStartGroup: (groupId: string, sourceColumnId: string) => void;
  onDragEndCard: () => void;
}

export default function ColumnPanel(props: ColumnPanelProps) {
  const [cardDraft, setCardDraft] = createSignal('');
  const [cardError, setCardError] = createSignal<string | null>(null);
  const [isCreatingCard, setIsCreatingCard] = createSignal(false);

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [isRenaming, setIsRenaming] = createSignal(false);
  const [renameDraft, setRenameDraft] = createSignal('');
  const [isSavingRename, setIsSavingRename] = createSignal(false);
  const [isDeletingColumn, setIsDeletingColumn] = createSignal(false);
  const [isDropActive, setIsDropActive] = createSignal(false);

  createEffect(
    () => props.isLocked,
    (locked) => {
      if (locked) {
        setMenuOpen(false);
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

  const streamKeys = createMemo(
    () => props.streamItems.map((item) => item.key),
    {
      equals: (prev, next) =>
        prev.length === next.length &&
        prev.every((key, index) => key === next[index]),
    },
  );
  const streamItemByKey = createMemo(() => {
    const map = new Map<string, ColumnStreamItem>();
    for (const item of props.streamItems) {
      map.set(item.key, item);
    }
    return map;
  });

  let renameInputEl: HTMLInputElement | undefined;
  let composerEl: HTMLTextAreaElement | undefined;

  createEffect(isRenaming, (renaming) => {
    if (renaming) {
      renameInputEl?.focus();
    }
  });

  createEffect(
    () => (props.isLocked ? null : props.column.id),
    (columnId) => {
      if (!columnId || !composerEl) return;
      props.onRegisterComposer?.(columnId, composerEl);
      return () => {
        props.onRegisterComposer?.(columnId, null);
      };
    },
  );

  createEffect(
    () => cardDraft(),
    (draft) => {
      if (!composerEl) return;
      if (draft.length === 0) {
        composerEl.style.height = '';
        return;
      }
      if (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content')) {
        return;
      }
      if (composerEl.scrollHeight > 0) {
        composerEl.style.height = 'auto';
        composerEl.style.height = `${Math.min(composerEl.scrollHeight, 144)}px`;
      }
    },
  );

  function canManageGroup(group: CardGroupDTO): boolean {
    if (!props.canGroupCards) return false;
    if (!props.isBlurred) return true;
    return group.cardIds.every(
      (id) => props.cards.find((card) => card.id === id)?.isMine === true,
    );
  }

  const isEligibleDropTarget = createMemo(
    () =>
      !props.isLocked &&
      (props.draggingCardId !== null || props.draggingGroupId !== null) &&
      props.draggingSourceColumnId !== props.column.id,
  );

  async function submitNewCard(): Promise<void> {
    const draft = composerEl ? composerEl.value : cardDraft();
    const trimmed = draft.trim();
    if (trimmed.length === 0 || isCreatingCard() || props.isLocked) return;
    if (cardDraft() !== draft) {
      setCardDraft(draft);
    }
    setIsCreatingCard(true);
    setCardError(null);
    try {
      const error = await props.onCreateCard(props.column.id, trimmed);
      const currentDraft = composerEl ? composerEl.value : cardDraft();
      if (currentDraft === draft) {
        setCardError(error);
        if (error === null) {
          setCardDraft('');
          if (composerEl) {
            composerEl.value = '';
            composerEl.style.height = '';
          }
        }
      }
    } finally {
      setIsCreatingCard(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submitNewCard();
    }
  }

  function startRename(): void {
    setMenuOpen(false);
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
    if (accent === props.column.accent) return;
    await props.onUpdateColumn(props.column.id, { accent });
  }

  async function handleReorder(direction: -1 | 1): Promise<void> {
    await props.onMoveColumn(props.column.id, direction);
  }

  async function requestDeleteColumn(): Promise<void> {
    if (isDeletingColumn() || !canDeleteColumn()) return;
    const count = props.column.cardCount;
    const confirmed = await confirmBoardAction({
      title: count > 0
        ? `Delete this Column and its ${count} ${count === 1 ? 'card' : 'cards'}?`
        : 'Delete this empty Column?',
      description: 'The Column and its Cards are removed for everyone on this Board.',
      confirmLabel: 'Delete column',
    });
    if (!confirmed) return;
    setIsDeletingColumn(true);
    try {
      await props.onDeleteColumn(props.column.id);
    } finally {
      setIsDeletingColumn(false);
    }
  }

  function handleDragOver(event: DragEvent): void {
    if (props.isLocked) return;
    const cardData =
      event.dataTransfer?.getData('application/x-retrocks-card') ?? '';
    const groupData =
      event.dataTransfer?.getData('application/x-retrocks-group') ?? '';
    const isGroupDrag =
      props.draggingGroupId !== null ||
      (!props.draggingCardId && Boolean(groupData) && !cardData);
    const cardId =
      props.draggingCardId ??
      (cardData || event.dataTransfer?.getData('text/plain') || '');
    if (!isGroupDrag && !cardId) return;
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
    const cardData =
      event.dataTransfer?.getData('application/x-retrocks-card') || '';
    const groupData =
      event.dataTransfer?.getData('application/x-retrocks-group') || '';
    const groupId =
      props.draggingGroupId ||
      (!props.draggingCardId && groupData && !cardData ? groupData : '');
    if (groupId) {
      if (props.draggingSourceColumnId === props.column.id) return;
      props.onDragEndCard();
      void props.onMoveCardGroup(groupId, props.column.id);
      return;
    }
    const cardId =
      props.draggingCardId ||
      cardData ||
      event.dataTransfer?.getData('text/plain') ||
      '';
    if (!cardId) return;
    if (props.draggingSourceColumnId === props.column.id) return;
    props.onDragEndCard();
    void props.onMoveCard(cardId, props.column.id);
  }

  return (
    <section
      id={`column-${props.column.id}`}
      role={props.isMobile ? 'tabpanel' : undefined}
      aria-hidden={props.isMobile && !props.isMobileActive ? 'true' : undefined}
      aria-labelledby={props.isMobile ? `column-tab-${props.column.id}` : undefined}
      aria-label={props.isMobile ? undefined : props.column.title}
      tabindex={props.isMobile && props.isMobileActive ? 0 : undefined}
      data-column-id={props.column.id}
      onFocusIn={() => props.onActivateColumn?.(props.column.id)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      class={[
        'board-column-rail flex-col rounded-2xl border transition-shadow',
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
      {/* Rounded-top accent & tint cap stays pointer-events-none so floating popovers inside the rail never clip. */}
      <div class="board-column-cap relative rounded-t-[calc(1rem-1px)] border-b border-border/60">
        <div
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 hidden overflow-hidden rounded-t-[calc(1rem-1px)] sm:block"
        >
          <div
            data-column-accent-bar="true"
            class={[
              'h-[3px] w-full transition-colors duration-200',
              COLUMN_ACCENT_STYLES[props.column.accent].bar,
            ]}
          />
          <div
            class={[
              'h-full w-full transition-colors duration-200',
              COLUMN_ACCENT_STYLES[props.column.accent].tint,
            ]}
          />
        </div>

        <div class="board-column-cap-row relative flex min-h-11 items-center justify-between gap-2 px-3.5 pt-[calc(0.625rem+3px)] pb-2.5">
          <div class="board-column-heading flex min-w-0 flex-1 items-center gap-1.5" data-renaming={isRenaming() ? "" : undefined}>
            <Show
              when={!isRenaming()}
              fallback={
                <div class="flex min-w-0 flex-1 items-center gap-1">
                  <input
                    ref={renameInputEl}
                    type="text"
                    aria-label="Column title"
                    value={renameDraft()}
                    maxlength={MAX_COLUMN_TITLE_LENGTH}
                    onInput={(e) => setRenameDraft(e.currentTarget.value)}
                    onKeyDown={handleRenameKeyDown}
                    class={[
                      'min-w-0 flex-1 rounded-lg border border-border/85 bg-surface px-2 py-1 text-[15px] leading-snug font-semibold tracking-[-0.015em] text-text',
                      'focus:border-accent focus:outline-none',
                    ]}
                  />
                  <button
                    type="button"
                    aria-label="Save column title"
                    disabled={isSavingRename() || renameDraft().trim().length === 0}
                    onClick={() => void saveRename()}
                    class="spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg bg-accent text-accent-contrast hover:opacity-90 disabled:opacity-50 sm:min-h-8 sm:min-w-8"
                  >
                    <LucideIcon icon={Check} class="size-3.5" strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel column rename"
                    onClick={cancelRename}
                    class="spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-text-muted hover:text-text sm:min-h-8 sm:min-w-8"
                  >
                    <LucideIcon icon={X} class="size-3.5" strokeWidth={2} />
                  </button>
                </div>
              }
            >
              <h2 class="min-w-0 flex-1 wrap-anywhere text-[15px] leading-snug font-semibold tracking-[-0.015em] text-text">
                <Show
                  when={canManageColumn()}
                  fallback={props.column.title}
                >
                  <button
                    type="button"
                    onClick={startRename}
                    title="Click to rename Column"
                    class={[
                      'min-h-11 w-full cursor-pointer rounded-sm text-left wrap-anywhere hover:underline sm:min-h-7',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    ]}
                  >
                    {props.column.title}
                  </button>
                </Show>
              </h2>
              <Show when={props.column.isActionColumn}>
                <span
                  title="Action Column"
                  role="img"
                  aria-label="Action Column"
                  class="inline-flex shrink-0 items-center text-col-sky"
                >
                  <LucideIcon icon={Flag} class="size-3.5" strokeWidth={2} />
                </span>
              </Show>
            </Show>
          </div>

          <div class="contents shrink-0 items-center gap-1.5 sm:flex">
            <span
              aria-label={
                props.hasActiveFilter
                  ? `${props.visibleCardCount} of ${props.column.cardCount} cards`
                  : `${props.column.cardCount} cards`
              }
              class="hidden min-w-6 items-center justify-center rounded-full bg-surface/85 sm:inline-flex px-2 py-0.5 text-xs font-medium text-text-muted tabular-nums dark:bg-surface-subtle/80"
            >
              {props.hasActiveFilter
                ? `${props.visibleCardCount}/${props.column.cardCount}`
                : props.column.cardCount}
            </span>

            <Show when={canManageColumn()}>
              <div data-print-hide="true" class="board-column-options">
                <Menu
                  open={menuOpen()}
                  onOpenChange={(next) => {
                    setMenuOpen(next);
                  }}
                >
                  <MenuTrigger
                    aria-label={`Column options for ${props.column.title}`}
                    class={[
                      'spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-text-muted sm:min-h-8 sm:min-w-8 sm:rounded-lg sm:border-transparent sm:bg-transparent',
                      'transition-colors hover:bg-surface/80 hover:text-text data-open:bg-surface data-open:text-text',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    ]}
                  >
                    <LucideIcon icon={Ellipsis} class="size-4" strokeWidth={1.9} />
                  </MenuTrigger>

                  <MenuContent
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    collisionPadding={12}
                    finalFocus={isRenaming() ? 'none' : undefined}
                    render={(contentProps) => (
                      <div
                        {...contentProps}
                        aria-labelledby={undefined}
                        aria-label={`Options for ${props.column.title}`}
                        data-board-overlay="true"
                        data-print-hide="true"
                      />
                    )}
                    class="board-popover z-30 max-h-[min(60dvh,var(--available-height))] w-56 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-border bg-surface p-2 text-text shadow-lg"
                  >
                    <MenuItem
                      value="rename"
                      onSelect={startRename}
                      class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-text hover:bg-surface-subtle data-highlighted:bg-surface-subtle sm:min-h-9"
                    >
                      <LucideIcon icon={Pencil} class="size-3.5 text-text-muted" strokeWidth={1.85} />
                      <span>Rename column</span>
                    </MenuItem>

                    <div class="mt-1 grid grid-cols-2 gap-1">
                      <MenuItem
                        value="move-left"
                        disabled={!canMoveLeft()}
                        onSelect={() => void handleReorder(-1)}
                        class="spring-press inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border/85 bg-surface px-2 py-1 text-xs font-medium text-text hover:bg-surface-subtle data-highlighted:bg-surface-subtle data-disabled:cursor-not-allowed data-disabled:opacity-40 sm:min-h-9"
                      >
                        <LucideIcon icon={ChevronLeft} class="size-3.5" strokeWidth={2} />
                        <span>Move left</span>
                      </MenuItem>
                      <MenuItem
                        value="move-right"
                        disabled={!canMoveRight()}
                        onSelect={() => void handleReorder(1)}
                        class="spring-press inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border/85 bg-surface px-2 py-1 text-xs font-medium text-text hover:bg-surface-subtle data-highlighted:bg-surface-subtle data-disabled:cursor-not-allowed data-disabled:opacity-40 sm:min-h-9"
                      >
                        <span>Move right</span>
                        <LucideIcon icon={ChevronRight} class="size-3.5" strokeWidth={2} />
                      </MenuItem>
                    </div>

                    <MenuSeparator class="my-2 border-t border-border/80" />
                    <div>
                      <p class="px-1 text-[11px] font-medium text-text-muted">
                        Accent color
                      </p>
                      <MenuRadioGroup<ColumnAccent>
                        aria-label="Accent color"
                        value={props.column.accent}
                        onValueChange={(accent) => { if (accent) void handleSelectAccent(accent); }}
                        class="mt-1.5 grid grid-cols-4 gap-1 px-1"
                      >
                        <For each={COLUMN_ACCENTS}>
                          {(accent) => (
                            <MenuRadioItem
                              value={accent}
                              aria-label={`Accent ${COLUMN_ACCENT_STYLES[accent].label}`}
                              closeOnSelect
                              class={[
                                'spring-press flex min-h-11 cursor-pointer items-center justify-center rounded-lg border transition-colors sm:min-h-8',
                                {
                                  'border-border bg-surface-subtle':
                                    props.column.accent === accent,
                                  'border-transparent hover:bg-surface-subtle data-highlighted:bg-surface-subtle':
                                    props.column.accent !== accent,
                                },
                              ]}
                            >
                              <span
                                aria-hidden="true"
                                class={[
                                  'size-3.5 rounded-full',
                                  COLUMN_ACCENT_STYLES[accent].swatch,
                                  {
                                    'ring-2 ring-text ring-offset-2 ring-offset-surface':
                                      props.column.accent === accent,
                                  },
                                ]}
                              />
                            </MenuRadioItem>
                          )}
                        </For>
                      </MenuRadioGroup>
                    </div>

                    <MenuSeparator class="my-2 border-t border-border/80" />
                    <MenuItem
                      value="delete"
                      disabled={!canDeleteColumn()}
                      title={hasHiddenCards() ? 'Reveal All before deleting a Column with hidden Cards.' : undefined}
                      onSelect={() => void requestDeleteColumn()}
                      class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-rose-700 hover:bg-surface-subtle data-highlighted:bg-surface-subtle data-disabled:cursor-not-allowed data-disabled:opacity-40 dark:text-rose-300 sm:min-h-9"
                    >
                      <LucideIcon icon={Trash2} class="size-3.5" strokeWidth={1.85} />
                      <span>Delete column</span>
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            </Show>
          </div>
        </div>
      </div>

      <Show when={!props.isLocked}>
        <div data-print-hide="true" class="hidden px-3 pt-3 sm:block">
          <div
            class={[
              'relative flex items-end gap-1.5 rounded-xl border bg-surface px-3 py-1.5 transition-colors',
              'hover:border-control/70 focus-within:border-accent',
              cardError()
                ? 'border-col-rose/75 focus-within:border-col-rose'
                : 'border-border/85',
            ]}
          >
            <textarea
              ref={composerEl}
              aria-label={`Add card to ${props.column.title}`}
              placeholder="+ Add Card"
              title="Enter to add · Shift+Enter for new line"
              value={cardDraft()}
              maxlength={MAX_CARD_CONTENT_LENGTH}
              rows={1}
              onInput={(e) => {
                setCardDraft(e.currentTarget.value);
                setCardError(null);
              }}
              onKeyDown={handleComposerKeyDown}
              class={[
                'board-composer-textarea min-h-8 max-h-36 min-w-0 flex-1 resize-none bg-transparent py-1 text-base leading-6 text-text',
                'placeholder:text-text-muted focus:outline-none',
              ]}
            />
            <Show when={cardDraft().length > 800}>
              <span
                aria-live="polite"
                class="shrink-0 self-end pb-1.5 text-[11px] font-medium text-text-muted tabular-nums"
              >
                {cardDraft().length}/{MAX_CARD_CONTENT_LENGTH}
              </span>
            </Show>
            <button
              type="button"
              disabled={isCreatingCard() || cardDraft().trim().length === 0}
              onClick={() => void submitNewCard()}
              class={[
                'spring-press mb-0.5 inline-flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-lg px-2.5 text-xs font-semibold transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                cardDraft().trim().length > 0 && !isCreatingCard()
                  ? 'bg-accent text-accent-contrast hover:opacity-90'
                  : 'bg-surface-subtle text-text-muted disabled:cursor-not-allowed disabled:opacity-55',
              ]}
            >
              {isCreatingCard() ? 'Adding…' : 'Add'}
            </button>
          </div>
          <Show when={cardError()}>
            {(error) => (
              <p role="alert" class="mt-1.5 px-1 text-xs font-medium text-rose-700 dark:text-rose-300">
                {error()}
              </p>
            )}
          </Show>
        </div>
      </Show>

      <Show when={props.isLocked}>
        <p data-print-hide="true" class="mx-3 mt-3 hidden rounded-xl bg-surface/75 px-3 py-2 text-xs text-text-muted sm:block">
          This Board is Locked. You can still read and search Cards.
        </p>
      </Show>

      {/* Column Card stream body — must stay :scope > div:last-child */}
      <div class="flex flex-1 flex-col gap-3 pt-3 pb-3 sm:px-3">
        <Show
          when={props.streamItems.length > 0}
          fallback={
            <Show
              when={props.hasActiveFilter && props.cards.length > 0}
              fallback={
                <p class="rounded-xl border border-dashed border-border/80 px-3 py-6 text-center text-sm text-text-muted">
                  No Cards yet
                </p>
              }
            >
              <div class="rounded-xl border border-dashed border-border/80 px-3 py-6 text-center text-sm text-text-muted">
                <p>No matching Cards in this Column</p>
                <button
                  type="button"
                  onClick={() => props.onResetFilters()}
                  class={[
                    'spring-press mt-2.5 inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text sm:min-h-8',
                    'transition-colors hover:bg-surface-subtle',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  ]}
                >
                  Reset filters
                </button>
              </div>
            </Show>
          }
        >
          <For each={streamKeys()}>
            {(key, streamIndex) => {
              if (key.startsWith('group:')) {
                const groupItem = createMemo(
                  () => {
                    const item = streamItemByKey().get(key);
                    return item?.kind === 'group' ? item : undefined;
                  },
                  {
                    equals: (prev, next) =>
                      prev === next ||
                      (prev !== undefined &&
                        next !== undefined &&
                        prev.group === next.group &&
                        prev.cards.length === next.cards.length &&
                        prev.cards.every((card, index) => card === next.cards[index])),
                  },
                );
                const groupCards = createMemo(
                  () => groupItem()?.cards ?? [],
                  {
                    equals: (prev, next) =>
                      prev.length === next.length &&
                      prev.every((card, index) => card === next[index]),
                  },
                );
                return (
                  <Show when={groupItem()}>
                    {(entry) => (
                      <CardGroupItem
                        group={entry().group}
                        cards={groupCards()}
                        revealIndexOffset={props.columnIndex + streamIndex()}
                        columnCards={props.cards}
                        columnGroups={props.groups}
                        columns={props.columns}
                        voting={props.voting}
                        isFacilitator={props.isFacilitator}
                        isLocked={props.isLocked}
                        isBlurred={props.isBlurred}
                        canGroupCards={props.canGroupCards}
                        canManage={canManageGroup(entry().group)}
                        nowMs={props.nowMs}
                        draggingCardId={props.draggingCardId}
                        draggingSourceColumnId={props.draggingSourceColumnId}
                        onRename={props.onRenameCardGroup}
                        onDissolve={props.onDissolveCardGroup}
                        onMoveGroup={props.onMoveCardGroup}
                        onGroupCard={props.onGroupCard}
                        onUngroupCard={props.onUngroupCard}
                        onUpdateActionItem={props.onUpdateActionItem}
                        onUpdateCard={props.onUpdateCard}
                        onMoveCard={props.onMoveCard}
                        onDeleteCard={props.onDeleteCard}
                        onToggleReaction={props.onToggleReaction}
                        onOpenCardDetail={props.onOpenCardDetail}
                        onDragStartCard={props.onDragStartCard}
                        onDragEndCard={props.onDragEndCard}
                        onDragStartGroup={props.onDragStartGroup}
                      />
                    )}
                  </Show>
                );
              }
              const cardItem = createMemo(() => {
                const item = streamItemByKey().get(key);
                return item?.kind === 'card' ? item.card : undefined;
              });
              return (
                <Show when={cardItem()}>
                  {(card) => (
                    <CardItem
                      card={card()}
                      revealIndex={props.columnIndex + streamIndex()}
                      voting={props.voting}
                      columns={props.columns}
                      columnCards={props.cards}
                      columnGroups={props.groups}
                      canGroupCards={props.canGroupCards}
                      canUngroup={
                        props.canGroupCards && (!props.isBlurred || card().isMine)
                      }
                      isFacilitator={props.isFacilitator}
                      isLocked={props.isLocked}
                      isBlurred={props.isBlurred}
                      nowMs={props.nowMs}
                      draggingCardId={props.draggingCardId}
                      draggingSourceColumnId={props.draggingSourceColumnId}
                      onGroupCard={props.onGroupCard}
                      onUngroupCard={props.onUngroupCard}
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
                </Show>
              );
            }}
          </For>
        </Show>
      </div>
    </section>
  );
}
