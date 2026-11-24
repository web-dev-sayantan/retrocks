import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '@ui-sdk/solid/menu';
import { usePrimitive } from '@ui-sdk/solid/primitive';
import { Textarea } from '@ui-sdk/solid/textarea';
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
  type CardGroupDTO,
  type ColumnAccent,
  type ColumnDTO,
} from '../lib/board-types';
import type { BoardMutations } from '../lib/board-controller';
import type { BoardTransferHandle } from '../lib/board-transfer';
import type { ColumnViewProjection } from '../lib/board-view';
import { confirmBoardAction } from '../lib/board-confirm';
import { inlineEdit, createInlineEditSave, type InlineEditOutcome } from '../lib/inline-edit';
import {
  areAllGroupCardsMine,
  canContribute,
  canControlFacilitation,
  canDeleteColumn as canDeleteColumnPermission,
  passesPrivateMode,
} from '../lib/board-permissions';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import CardGroupItem from './CardGroupItem';
import BoardMenuContent from './BoardMenuContent';
import CardItem from './CardItem';
import { InlineEditorMount } from './InlineEditorMount';
import LucideIcon from './LucideIcon';
import type { WorkspaceVoting } from '../lib/board-controller';

export interface ColumnPanelProps {
  /** The keyed projection's Column bucket: the Column DTO plus its complete
   *  Card and Card Group lists, the filtered stream, and the counts. */
  view: ColumnViewProjection;
  columnIndex: number;
  totalColumns: number;
  columns: readonly ColumnDTO[];
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
  /** The Board's createTransfer instance; Columns are its drop lists. */
  transfer: BoardTransferHandle;
  /** Controller-shaped Board mutations (the workspace passes its session). */
  actions: BoardMutations;
  onResetFilters: () => void;
  onRegisterComposer?: (
    columnId: string,
    el: HTMLTextAreaElement | null,
  ) => void;
  onActivateColumn?: (columnId: string) => void;
  onOpenCardDetail: (cardId: string, trigger: HTMLButtonElement) => void;
}

export default function ColumnPanel(props: ColumnPanelProps) {
  const [cardDraft, setCardDraft] = createSignal('');
  const [cardError, setCardError] = createSignal<string | null>(null);
  const [isCreatingCard, setIsCreatingCard] = createSignal(false);

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [isDeletingColumn, setIsDeletingColumn] = createSignal(false);

  createEffect(
    () => props.isLocked,
    (locked) => {
      if (locked) {
        setMenuOpen(false);
        cancelRename();
      }
    },
  );

  const canManageColumn = createMemo(
    () => canControlFacilitation(props),
  );
  const canMoveLeft = createMemo(() => props.columnIndex > 0);
  const canMoveRight = createMemo(
    () => props.columnIndex < props.totalColumns - 1,
  );
  const hasHiddenCards = createMemo(() => props.view.cards.some((card) => card.redacted));
  const canDeleteColumn = createMemo(() =>
    canDeleteColumnPermission(props, props.totalColumns, props.view.cards),
  );

  // Inline title editing: createInlineEdit owns the session, input, and keyboard contract.
  const titleField = usePrimitive(inlineEdit, () => ({
    value: () => props.view.column.title,
    commit: (text) => titleSave.commit(text),
    disabled: () => !canManageColumn(),
  }));
  const columnEdit = titleField.api.edit;
  const titleSave = createInlineEditSave(saveColumnTitle, () => columnEdit.cancel());
  const isRenaming = () => titleField.present('input');
  const [hasTitleText, setHasTitleText] = createSignal(true);
  let titleButtonEl: HTMLButtonElement | undefined;

  // The title button re-mounts while editing ends, so guide focus back when nothing took it.
  createEffect(isRenaming, (renaming, wasRenaming) => {
    if (!renaming && wasRenaming && document.activeElement === document.body) {
      titleButtonEl?.focus();
    }
  });

  let composerEl: HTMLTextAreaElement | undefined;

  createEffect(
    () => (props.isLocked ? null : props.view.column.id),
    (columnId) => {
      if (!columnId || !composerEl) return;
      props.onRegisterComposer?.(columnId, composerEl);
      return () => {
        props.onRegisterComposer?.(columnId, null);
      };
    },
  );

  function canManageGroup(group: CardGroupDTO): boolean {
    return props.canGroupCards && areAllGroupCardsMine(props, group, props.view.cards);
  }

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
      const error = await props.actions.createCard(props.view.column.id, trimmed);
      const currentDraft = composerEl ? composerEl.value : cardDraft();
      if (currentDraft === draft) {
        setCardError(error);
        if (error === null) {
          setCardDraft('');
          if (composerEl) composerEl.value = '';
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
    setHasTitleText(props.view.column.title.trim().length > 0);
    columnEdit.start(props.view.column.id);
  }

  function cancelRename(): void {
    titleSave.resetError();
    columnEdit.cancel();
  }

  async function saveColumnTitle(text: string): Promise<InlineEditOutcome> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    return (await props.actions.updateColumn(props.view.column.id, { title: trimmed }))
      ? true
      : false;
  }

  async function handleSelectAccent(accent: ColumnAccent): Promise<void> {
    if (accent === props.view.column.accent) return;
    await props.actions.updateColumn(props.view.column.id, { accent });
  }

  async function handleReorder(direction: -1 | 1): Promise<void> {
    await props.actions.moveColumn(props.view.column.id, direction);
  }

  async function requestDeleteColumn(): Promise<void> {
    if (isDeletingColumn() || !canDeleteColumn()) return;
    const count = props.view.column.cardCount;
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
      await props.actions.deleteColumn(props.view.column.id);
    } finally {
      setIsDeletingColumn(false);
    }
  }

  return (
    <section
      {...props.transfer.slot('column', () => ({ value: props.view.column.id }))}
      id={`column-${props.view.column.id}`}
      role={props.isMobile ? 'tabpanel' : undefined}
      aria-hidden={props.isMobile && !props.isMobileActive ? 'true' : undefined}
      aria-labelledby={props.isMobile ? `column-tab-${props.view.column.id}` : undefined}
      aria-label={props.isMobile ? undefined : props.view.column.title}
      tabindex={props.isMobile && props.isMobileActive ? 0 : undefined}
      data-column-id={props.view.column.id}
      onFocusIn={() => props.onActivateColumn?.(props.view.column.id)}
      class={[
        'board-column-rail flex-col rounded-2xl border transition-shadow',
        {
          flex: props.isMobileActive,
          'hidden sm:flex': !props.isMobileActive,
          'sm:w-[320px] sm:shrink-0 sm:snap-start': props.isHorizontalSnap,
          'min-w-0': !props.isHorizontalSnap,
        },
        'data-drop-armed:ring-1 data-drop-armed:ring-focus/30 data-drop-active:ring-2 data-drop-active:ring-focus/70',
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
              COLUMN_ACCENT_STYLES[props.view.column.accent].bar,
            ]}
          />
          <div
            class={[
              'h-full w-full transition-colors duration-200',
              COLUMN_ACCENT_STYLES[props.view.column.accent].tint,
            ]}
          />
        </div>

        <div class="board-column-cap-row relative flex min-h-11 items-center justify-between gap-2 px-3.5 pt-[calc(0.625rem+3px)] pb-2.5">
          <div class="board-column-heading flex min-w-0 flex-1 items-center gap-1.5" data-renaming={isRenaming() ? "" : undefined}>
            <Show
              when={!isRenaming()}
              fallback={
                <div class="flex min-w-0 flex-1 items-center gap-1">
                  <InlineEditorMount bind={(el) => columnEdit.bindInput(el)}>
                    {(ref) => (
                      <input
                        ref={ref}
                        type="text"
                        aria-label="Column title"
                        maxlength={MAX_COLUMN_TITLE_LENGTH}
                        onKeyDown={(event) => columnEdit.inputKeydown(event)}
                        onFocusOut={(event) => columnEdit.end('focus-out', event)}
                        onInput={(e) =>
                          setHasTitleText(e.currentTarget.value.trim().length > 0)
                        }
                        class={[
                          'min-w-0 flex-1 rounded-lg border border-border/85 bg-surface px-2 py-1 text-[15px] leading-snug font-semibold tracking-[-0.015em] text-text',
                          'board-focus-ring',
                        ]}
                      />
                    )}
                  </InlineEditorMount>
                  <button
                    type="button"
                    aria-label="Save column title"
                    disabled={titleSave.isSaving() || !hasTitleText()}
                    onClick={() => columnEdit.end()}
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
                  fallback={props.view.column.title}
                >
                  <button
                    ref={titleButtonEl}
                    type="button"
                    onClick={startRename}
                    title="Click to rename Column"
                    class={[
                      'min-h-11 w-full cursor-pointer rounded-sm text-left wrap-anywhere hover:underline sm:min-h-7',
                      'board-focus-ring',
                    ]}
                  >
                    {props.view.column.title}
                  </button>
                </Show>
              </h2>
              <Show when={props.view.column.isActionColumn}>
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
                  ? `${props.view.visibleCardCount} of ${props.view.column.cardCount} cards`
                  : `${props.view.column.cardCount} cards`
              }
              class="hidden min-w-6 items-center justify-center rounded-full bg-surface/85 sm:inline-flex px-2 py-0.5 text-xs font-medium text-text-muted tabular-nums dark:bg-surface-subtle/80"
            >
              {props.hasActiveFilter
                ? `${props.view.visibleCardCount}/${props.view.column.cardCount}`
                : props.view.column.cardCount}
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
                    aria-label={`Column options for ${props.view.column.title}`}
                    class={[
                      'spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-text-muted sm:min-h-8 sm:min-w-8 sm:rounded-lg sm:border-transparent sm:bg-transparent',
                      'transition-colors hover:bg-surface/80 hover:text-text data-open:bg-surface data-open:text-text',
                      'board-focus-ring',
                    ]}
                  >
                    <LucideIcon icon={Ellipsis} class="size-4" strokeWidth={1.9} />
                  </MenuTrigger>

                  <BoardMenuContent
                    finalFocus={isRenaming() ? 'none' : undefined}
                    aria-label={`Options for ${props.view.column.title}`}
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
                        value={props.view.column.accent}
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
                                    props.view.column.accent === accent,
                                  'border-transparent hover:bg-surface-subtle data-highlighted:bg-surface-subtle':
                                    props.view.column.accent !== accent,
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
                                      props.view.column.accent === accent,
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
                  </BoardMenuContent>
                </Menu>
              </div>
            </Show>
          </div>
        </div>
      </div>

      <Show when={canContribute(props)}>
        <div data-print-hide="true" class="hidden px-3 pt-3 sm:block">
          <div
            class={[
              'relative flex items-end gap-1.5 rounded-xl border bg-surface px-3 py-1.5 transition-colors',
              'hover:border-control/70 focus-within:border-focus focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-focus',
              cardError()
                ? 'border-col-rose/75 focus-within:border-col-rose'
                : 'border-border/85',
            ]}
          >
            <Textarea
              ref={composerEl}
              autoResize
              aria-label={`Add card to ${props.view.column.title}`}
              placeholder="+ Add Card"
              title="Enter to add · Shift+Enter for new line"
              value={cardDraft()}
              maxlength={MAX_CARD_CONTENT_LENGTH}
              rows={1}
              onValueChange={(value) => {
                setCardDraft(value);
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
                'board-focus-ring',
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
          when={props.view.items.length > 0}
          fallback={
            <Show
              when={props.hasActiveFilter && props.view.cards.length > 0}
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
                    'board-focus-ring',
                  ]}
                >
                  Reset filters
                </button>
              </div>
            </Show>
          }
        >
          <For each={props.view.items}>
            {(item, streamIndex) => (
              <Show
                when={item.kind === 'group' ? item : undefined}
                fallback={
                  <Show when={item.kind === 'card' ? item.card : undefined}>
                    {(card) => (
                      <CardItem
                        card={card()}
                        revealIndex={props.columnIndex + streamIndex()}
                        voting={props.voting}
                        columns={props.columns}
                        columnCards={props.view.cards}
                        columnGroups={props.view.groups}
                        canGroupCards={props.canGroupCards}
                        canUngroup={
                          props.canGroupCards && passesPrivateMode(props, card())
                        }
                        isFacilitator={props.isFacilitator}
                        isLocked={props.isLocked}
                        isBlurred={props.isBlurred}
                        nowMs={props.nowMs}
                        transfer={props.transfer}
                        actions={props.actions}
                        onOpenCardDetail={props.onOpenCardDetail}
                      />
                    )}
                  </Show>
                }
              >
                {(group) => (
                  <CardGroupItem
                    group={group().group}
                    cards={group().cards}
                    revealIndexOffset={props.columnIndex + streamIndex()}
                    columnCards={props.view.cards}
                    columnGroups={props.view.groups}
                    columns={props.columns}
                    voting={props.voting}
                    isFacilitator={props.isFacilitator}
                    isLocked={props.isLocked}
                    isBlurred={props.isBlurred}
                    canGroupCards={props.canGroupCards}
                    canManage={canManageGroup(group().group)}
                    nowMs={props.nowMs}
                    transfer={props.transfer}
                    actions={props.actions}
                    onOpenCardDetail={props.onOpenCardDetail}
                  />
                )}
              </Show>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}
