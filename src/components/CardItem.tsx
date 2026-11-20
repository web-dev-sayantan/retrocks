import { Menu, MenuContent, MenuItem, MenuTrigger } from '@ui-sdk/solid/menu';
import { Ellipsis, Flag, MessageSquare, PanelRightOpen } from 'lucide';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';

import {
  MAX_CARD_CONTENT_LENGTH,
  type ActionItemPatch,
  type CardGroupDTO,
  type CardViewDTO,
  type ColumnDTO,
  type ReactionEmoji,
} from '../lib/board-types';
import {
  REDACTED_CARD_WHISPERS,
  REDACTED_WHISPER_DURATION_MS,
} from '../lib/easter-eggs';
import { createDoubleTap } from '../lib/double-tap';
import {
  canEditActionItemFollowUp,
  canInteractWithCard,
  canManageCard,
} from '../lib/board-permissions';
import { getEnabledMenuItems } from '../lib/menu-keyboard';
import { formatRelativeTime } from '../lib/recent-boards';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import CardReactions from './CardReactions';
import CardText from './CardText';
import LucideIcon from './LucideIcon';
import {
  ArrowRightLeftIcon,
  FlagIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from './Icons';
import VoteControls, { type WorkspaceVoting } from './VoteControls';

export interface CardItemProps {
  card: CardViewDTO;
  revealIndex?: number;
  voting: WorkspaceVoting;
  columns: readonly ColumnDTO[];
  columnCards: readonly CardViewDTO[];
  columnGroups: readonly CardGroupDTO[];
  canGroupCards: boolean;
  canUngroup: boolean;
  isFacilitator: boolean;
  isLocked: boolean;
  isBlurred: boolean;
  nowMs: number;
  draggingCardId: string | null;
  draggingSourceColumnId: string | null;
  onGroupCard: (
    cardId: string,
    targetType: 'card' | 'group',
    targetId: string,
  ) => Promise<boolean>;
  onUngroupCard: (cardId: string) => Promise<boolean>;
  onUpdateCard: (cardId: string, content: string) => Promise<string | null>;
  onUpdateActionItem: (
    cardId: string,
    patch: ActionItemPatch,
  ) => Promise<boolean>;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<boolean>;
  onDeleteCard: (cardId: string) => Promise<boolean>;
  onToggleReaction: (cardId: string, emoji: ReactionEmoji) => Promise<string | null>;
  onOpenCardDetail: (cardId: string, trigger: HTMLButtonElement) => void;
  onDragStartCard: (cardId: string, sourceColumnId: string) => void;
  onDragEndCard: () => void;
}

const menuItemClass = 'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text hover:bg-surface-subtle data-highlighted:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus data-disabled:cursor-not-allowed data-disabled:opacity-50 sm:min-h-8';
const PLACEHOLDER_LINES_1 = ['w-3/4'] as const;
const PLACEHOLDER_LINES_2 = ['w-full', 'w-4/5'] as const;
const PLACEHOLDER_LINES_3 = ['w-full', 'w-11/12', 'w-2/3'] as const;

export default function CardItem(props: CardItemProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editDraft, setEditDraft] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);
  const [editError, setEditError] = createSignal<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [isMoving, setIsMoving] = createSignal(false);
  const [isGrouping, setIsGrouping] = createSignal(false);
  const [isUngrouping, setIsUngrouping] = createSignal(false);
  const [isGroupDropActive, setIsGroupDropActive] = createSignal(false);
  const [isUpdatingAction, setIsUpdatingAction] = createSignal(false);
  const [actionDoneDraft, setActionDoneDraft] = createSignal<boolean | null>(null);
  const actionDone = () => actionDoneDraft() ?? props.card.actionDone;
  const [actionError, setActionError] = createSignal('');

  const [menuPage, setMenuPage] = createSignal<'actions' | 'move' | 'group' | null>(null);
  let menuTrigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  let editor: HTMLTextAreaElement | undefined;
  let cancelDeleteButton: HTMLButtonElement | undefined;
  const pendingAction = createMemo(() => {
    if (isMoving()) return 'Moving Card…';
    if (isGrouping()) return 'Grouping Card…';
    if (isUngrouping()) return 'Ungrouping Card…';
    if (isUpdatingAction()) return 'Updating Action Item…';
    return null;
  });

  const [peekWhisper, setPeekWhisper] = createSignal<string | null>(null);
  let peekIndex = 0;
  let peekTimer: ReturnType<typeof setTimeout> | undefined;

  function clearPeekTimer(): void {
    if (peekTimer !== undefined) {
      clearTimeout(peekTimer);
      peekTimer = undefined;
    }
  }

  function handleRedactedClick(): void {
    if (!props.card.redacted) return;
    clearPeekTimer();
    const whisper = REDACTED_CARD_WHISPERS[peekIndex % REDACTED_CARD_WHISPERS.length];
    peekIndex += 1;
    setPeekWhisper(whisper);
    peekTimer = setTimeout(() => {
      peekTimer = undefined;
      setPeekWhisper(null);
    }, REDACTED_WHISPER_DURATION_MS);
  }

  const revealState = createMemo(
    (previous?: { redacted: boolean; revealed: boolean }) => {
      const redacted = props.card.redacted;
      return {
        redacted,
        revealed: previous?.redacted === true && !redacted,
      };
    },
  );
  const wasRevealed = () => revealState().revealed;

  createEffect(
    () => props.card.redacted,
    (redacted) => {
      if (redacted) {
        setActionError('');
        cancelEdit();
        setConfirmingDelete(false);
        setMenuPage(null);
      } else {
        clearPeekTimer();
        setPeekWhisper(null);
      }
      return () => {
        clearPeekTimer();
      };
    },
  );

  createEffect(
    () => props.isLocked,
    (locked) => {
      if (locked) {
        cancelEdit();
        setConfirmingDelete(false);
        setMenuPage(null);
      }
    },
  );

  createEffect(isEditing, (editing, wasEditing) => {
    if (editing) editor?.focus();
    else if (wasEditing) menuTrigger?.focus();
  });

  createEffect(confirmingDelete, (confirming, wasConfirming) => {
    if (confirming) cancelDeleteButton?.focus();
    else if (wasConfirming) menuTrigger?.focus();
  });

  createEffect(menuPage, (page) => {
    if (page) getEnabledMenuItems(menu)[0]?.focus({ preventScroll: true });
  });

  function closeMenu(): void {
    setMenuPage(null);
    menuTrigger?.focus();
  }

  const canManage = createMemo(() => canManageCard(props, props.card));

  const otherColumns = createMemo(
    () => props.columns.filter((col) => col.id !== props.card.columnId),
    {
      equals: (prev, next) =>
        prev.length === next.length &&
        prev.every((col, index) => col === next[index]),
    },
  );

  const canMove = createMemo(() => canManage() && otherColumns().length > 0);

  const groupTargets = createMemo(
    () => ({
      cards: props.columnCards.filter(
        (other) =>
          other.id !== props.card.id &&
          !other.redacted &&
          other.groupId === null,
      ),
      groups: props.columnGroups.filter(
        (group) => group.id !== props.card.groupId,
      ),
    }),
    {
      equals: (prev, next) =>
        prev.cards.length === next.cards.length &&
        prev.groups.length === next.groups.length &&
        prev.cards.every((card, index) => card === next.cards[index]) &&
        prev.groups.every((group, index) => group === next.groups[index]),
    },
  );

  const canGroup = createMemo(
    () =>
      props.canGroupCards &&
      canInteractWithCard(props, props.card) &&
      (groupTargets().cards.length > 0 || groupTargets().groups.length > 0),
  );

  const canDrag = createMemo(() => (canMove() || canGroup()) && !isEditing());

  const draggingCard = createMemo(() => {
    if (
      !props.draggingCardId ||
      props.draggingSourceColumnId !== props.card.columnId
    ) {
      return undefined;
    }
    return props.columnCards.find(
      (card) => card.id === props.draggingCardId && !card.redacted,
    );
  });

  const canAcceptGroupDrop = createMemo(() => {
    const source = draggingCard();
    return (
      props.canGroupCards &&
      canInteractWithCard(props, props.card) &&
      source !== undefined &&
      source.id !== props.card.id &&
      (props.card.groupId === null || source.groupId !== props.card.groupId)
    );
  });

  const relativeTimestamp = createMemo(() =>
    formatRelativeTime(props.card.createdAt, props.nowMs),
  );

  const placeholderLineWidths = createMemo(() => {
    const count = props.card.placeholderLines ?? 2;
    if (count === 1) return PLACEHOLDER_LINES_1;
    if (count === 3) return PLACEHOLDER_LINES_3;
    return PLACEHOLDER_LINES_2;
  });

  const textTap = createDoubleTap(isTextEditTarget, startEdit);

  function isTextEditTarget(target: EventTarget | null): boolean {
    if (!canManage() || props.card.id.startsWith('optimistic:')) return false;
    return !(target instanceof Element && target.closest('a'));
  }

  function handleTextDoubleClick(event: MouseEvent): void {
    if (!isTextEditTarget(event.target)) return;
    textTap.reset();
    startEdit();
  }

  function startEdit(): void {
    textTap.reset();
    setEditError(null);
    setEditDraft(props.card.content);
    setConfirmingDelete(false);
    setMenuPage(null);
    setIsEditing(true);
  }

  function cancelEdit(): void {
    textTap.reset();
    setIsEditing(false);
    setEditDraft('');
    setEditError(null);
  }

  async function saveEdit(): Promise<void> {
    const trimmed = editDraft().trim();
    if (trimmed.length === 0 || isSaving() || !canManage()) return;
    if (trimmed === props.card.content) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    setEditError(null);
    try {
      const error = await props.onUpdateCard(props.card.id, trimmed);
      if (error === null) cancelEdit();
      else {
        setEditError(error);
        editor?.focus();
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

  async function runCardAction(
    request: () => Promise<boolean>,
    failureMessage: string,
    setPending: (pending: boolean) => void,
  ): Promise<boolean> {
    setPending(true);
    setActionError('');
    try {
      if (await request()) return true;
    } catch {
      // Report rejected requests alongside unsuccessful mutation responses.
    } finally {
      setPending(false);
    }
    if (!props.card.redacted) setActionError(failureMessage);
    return false;
  }

  async function handleConfirmDelete(): Promise<void> {
    if (isDeleting()) return;
    await runCardAction(
      () => props.onDeleteCard(props.card.id),
      'Could not delete the Card. Try again.',
      setIsDeleting,
    );
  }

  async function updateAction(patch: ActionItemPatch): Promise<boolean> {
    if (isUpdatingAction()) return false;
    return runCardAction(
      () => props.onUpdateActionItem(props.card.id, patch),
      'Could not update the Action Item. Try again.',
      setIsUpdatingAction,
    );
  }

  async function handleSelectMoveTarget(targetColumnId: string): Promise<void> {
    if (isMoving()) return;
    closeMenu();
    await runCardAction(
      () => props.onMoveCard(props.card.id, targetColumnId),
      'Could not move the Card. Try again.',
      setIsMoving,
    );
  }

  async function groupWith(
    cardId: string,
    targetType: 'card' | 'group',
    targetId: string,
  ): Promise<void> {
    if (isGrouping()) return;
    if (menuPage()) closeMenu();
    await runCardAction(
      () => props.onGroupCard(cardId, targetType, targetId),
      'Could not group the Card. Try again.',
      setIsGrouping,
    );
  }

  async function handleUngroup(): Promise<void> {
    if (isUngrouping()) return;
    await runCardAction(
      () => props.onUngroupCard(props.card.id),
      'Could not ungroup the Card. Try again.',
      setIsUngrouping,
    );
  }

  function handleGroupDragOver(event: DragEvent): void {
    if (!canAcceptGroupDrop()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setIsGroupDropActive(true);
  }

  function handleGroupDragLeave(event: DragEvent): void {
    const currentTarget = event.currentTarget as HTMLElement | null;
    const related = event.relatedTarget as Node | null;
    if (currentTarget && related && currentTarget.contains(related)) return;
    setIsGroupDropActive(false);
  }

  function handleGroupDrop(event: DragEvent): void {
    if (!canAcceptGroupDrop()) return;
    event.preventDefault();
    event.stopPropagation();
    setIsGroupDropActive(false);
    const source = draggingCard();
    if (source) {
      void groupWith(source.id, 'card', props.card.id);
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
      data-private-mode={props.card.redacted ? 'server-redacted-nice-try' : undefined}
      style={
        wasRevealed()
          ? { '--card-reveal-delay': `${Math.min((props.revealIndex ?? 0) * 18, 250)}ms` }
          : undefined
      }
      draggable={canDrag() ? 'true' : 'false'}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleGroupDragOver}
      onDragLeave={handleGroupDragLeave}
      onDrop={handleGroupDrop}
      class={[
        'relative min-w-0 rounded-xl border bg-surface p-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:border-control/70 sm:p-3.5',
        props.card.groupId === null ? 'border-border/80' : 'border-border/60',
        {
          'cursor-grab active:cursor-grabbing':
            canDrag(),
          'bg-surface-subtle': props.card.redacted,
          'card-revealed': wasRevealed(),
          'ring-2 ring-focus/70': isGroupDropActive(),
        },
      ]}
    >
      <Show
        when={!props.card.redacted}
        fallback={
          <div
            aria-label="Hidden Card in Private Mode"
            onClick={handleRedactedClick}
            class="cursor-pointer select-none space-y-2 py-0.5"
          >
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
            <div class="flex items-center justify-between gap-2 pt-1 text-[11px] text-text-muted">
              <span data-redacted-footer="" class="min-w-0 truncate">
                {peekWhisper() ?? 'Hidden until Reveal All'}
              </span>
              <time class="shrink-0 tabular-nums">{relativeTimestamp()}</time>
            </div>
          </div>
        }
      >
        <Show
          when={!isEditing()}
          fallback={
            <div class="space-y-2">
              <textarea
                ref={editor}
                aria-label="Edit card text"
                aria-invalid={editError() ? 'true' : undefined}
                readonly={isSaving()}
                value={editDraft()}
                maxlength={MAX_CARD_CONTENT_LENGTH}
                rows={3}
                onInput={(e) => setEditDraft(e.currentTarget.value)}
                onKeyDown={handleEditKeyDown}
                class={[
                  'w-full resize-none rounded-md border border-border bg-canvas px-2.5 py-2 text-base text-text',
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
                    {isSaving() ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
              <Show when={editError()}>
                <p role="alert" class="text-sm text-rose-700 dark:text-rose-300">{editError()}</p>
              </Show>
            </div>
          }
        >
          <div
            onDblClick={handleTextDoubleClick}
            onPointerDown={textTap.onPointerDown}
            onPointerUp={textTap.onPointerUp}
            onPointerCancel={textTap.onPointerCancel}
            class={[
              'text-base leading-relaxed sm:touch-manipulation',
              props.card.isActionItem && actionDone()
                ? 'text-text-muted line-through'
                : 'text-text',
            ]}
          >
            <CardText text={props.card.content} />
          </div>

          <Show when={props.card.isActionItem}>
            <div class="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-surface-subtle/65 px-2.5 py-1.5">
              <label class="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 sm:min-h-6">
                <input
                  type="checkbox"
                  checked={actionDone()}
                  disabled={
                    (!canEditActionItemFollowUp(props, props.card)) || isUpdatingAction()
                  }
                  aria-label={`Mark ${props.card.content} as Done`}
                  onChange={async (event) => {
                    const done = event.currentTarget.checked;
                    setActionDoneDraft(done);
                    try {
                      await updateAction({ actionDone: done });
                    } finally {
                      setActionDoneDraft(null);
                    }
                  }}
                  class="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span class="text-xs font-medium text-text-muted">
                  {actionDone() ? 'Done' : 'Open'}
                </span>
              </label>
              <Show
                when={props.card.actionOwner}
                fallback={<LucideIcon icon={Flag} class="size-3.5 shrink-0 text-col-sky" />}
              >
                <span class="min-w-0 wrap-anywhere rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted">
                  {props.card.actionOwner}
                </span>
              </Show>
            </div>
          </Show>

          <footer class="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 sm:mt-2.5 sm:grid sm:grid-flow-row-dense sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:gap-x-1.5">
            <CardReactions
              inCardFooter
              cardId={props.card.id}
              reactions={props.card.reactions}
              myReactions={props.card.myReactions}
              disabled={props.isLocked}
              onToggleReaction={props.onToggleReaction}
            />

            <div class="order-first flex min-w-0 basis-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-muted sm:order-none sm:col-start-1">
              <Show when={props.card.isMine}>
                <span class="rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-medium">
                  You
                </span>
              </Show>
              <time class="max-w-full truncate tabular-nums">{relativeTimestamp()}</time>
            </div>

            <Show when={props.card.groupId === null}>
              <div class="flex sm:col-start-3">
                <VoteControls target={props.card} voting={props.voting} isLocked={props.isLocked} />
              </div>
            </Show>

            <div data-print-hide="true" class="ms-auto flex max-w-full flex-wrap items-center justify-end gap-1 sm:col-start-4 sm:ms-0 sm:max-w-none sm:flex-nowrap">
              <Show when={props.card.commentCount > 0}>
                <button
                  type="button"
                  aria-label={`${props.card.commentCount} ${props.card.commentCount === 1 ? 'comment' : 'comments'}`}
                  onClick={(event) => props.onOpenCardDetail(props.card.id, event.currentTarget)}
                  class={[
                    'spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-full border border-border bg-surface-subtle px-2 text-[11px] font-medium text-text sm:min-h-7 sm:min-w-0',
                    'transition-colors hover:border-text-muted/50 hover:text-text',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  ]}
                >
                  <LucideIcon icon={MessageSquare} class="size-3.5" />
                  <span class="tabular-nums">{props.card.commentCount}</span>
                </button>
              </Show>
              <button
                type="button"
                aria-label="Open Card details"
                title="Open Card details"
                onClick={(event) => props.onOpenCardDetail(props.card.id, event.currentTarget)}
                class={[
                  'spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-text-muted sm:min-h-7 sm:min-w-7',
                  'transition-colors hover:bg-surface-subtle hover:text-text',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                ]}
              >
                <LucideIcon icon={PanelRightOpen} />
              </button>

              <Show when={!props.isLocked}>
                <Menu
                  open={menuPage() !== null}
                  modal={false}
                  onOpenChange={(open) => {
                    if (open) setConfirmingDelete(false);
                    setMenuPage(open ? 'actions' : null);
                  }}
                >
                  <MenuTrigger
                    ref={menuTrigger}
                    aria-label="Card actions"
                    title="Card actions"
                    class="spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-subtle hover:text-text data-open:bg-surface-subtle data-open:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:min-h-7 sm:min-w-7"
                  >
                    <LucideIcon icon={Ellipsis} class="size-4" />
                  </MenuTrigger>
                  <MenuContent
                    ref={menu}
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    collisionPadding={12}
                    finalFocus={isEditing() || confirmingDelete() ? 'none' : undefined}
                    render={(contentProps) => (
                      <div
                        {...contentProps}
                        aria-labelledby={undefined}
                        aria-label={menuPage() === 'move' ? 'Move Card to Column' : menuPage() === 'group' ? 'Group Card with' : 'Card actions'}
                        data-board-overlay={menuPage() ? 'true' : undefined}
                        data-print-hide="true"
                      />
                    )}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft' && menuPage() !== 'actions') {
                        event.preventDefault();
                        setMenuPage('actions');
                      }
                    }}
                    class="board-popover max-h-[min(50dvh,var(--available-height))] w-56 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 text-text"
                  >
                    <Show when={menuPage() === 'actions'}>
                      <Show when={canManage()}>
                        <MenuItem value="edit" class={menuItemClass} onSelect={startEdit}>
                          <PencilIcon /> Edit Card
                        </MenuItem>
                      </Show>
                      <Show when={canMove()}>
                        <MenuItem value="move" class={menuItemClass} disabled={isMoving()} closeOnSelect={false} onSelect={() => setMenuPage('move')}>
                          <ArrowRightLeftIcon /> Move to…
                        </MenuItem>
                      </Show>
                      <Show when={canGroup()}>
                        <MenuItem value="group" class={menuItemClass} disabled={isGrouping()} closeOnSelect={false} onSelect={() => setMenuPage('group')}>
                          <PlusIcon /> Group with…
                        </MenuItem>
                      </Show>
                      <Show when={props.card.groupId !== null && props.canUngroup}>
                        <MenuItem value="ungroup" class={menuItemClass} disabled={isUngrouping()} onSelect={() => { void handleUngroup(); }}>
                          Ungroup Card
                        </MenuItem>
                      </Show>
                      <MenuItem
                        value="flag"
                        class={menuItemClass}
                        disabled={isUpdatingAction()}
                        onSelect={() => { void updateAction({ isActionItem: !props.card.isActionItem }); }}
                      >
                        <FlagIcon /> {props.card.isActionItem ? 'Unflag Action Item' : 'Flag as Action Item'}
                      </MenuItem>
                      <Show when={canManage()}>
                        <MenuItem
                          value="delete"
                          class={menuItemClass}
                          disabled={isDeleting()}
                          onSelect={() => {
                            setActionError('');
                            setConfirmingDelete(true);
                          }}
                        >
                          <TrashIcon /> Delete Card
                        </MenuItem>
                      </Show>
                    </Show>
                    <Show when={menuPage() === 'move'}>
                      <For each={otherColumns()}>
                        {(target) => (
                          <MenuItem value={target.id} class={menuItemClass} onSelect={() => { void handleSelectMoveTarget(target.id); }}>
                            <span aria-hidden="true" class={['h-2 w-2 shrink-0 rounded-full', COLUMN_ACCENT_STYLES[target.accent].swatch]} />
                            <span class="min-w-0 wrap-anywhere">{target.title}</span>
                          </MenuItem>
                        )}
                      </For>
                    </Show>
                    <Show when={menuPage() === 'group'}>
                      <For each={groupTargets().cards}>
                        {(target) => (
                          <MenuItem value={`card:${target.id}`} class={menuItemClass} onSelect={() => { void groupWith(props.card.id, 'card', target.id); }}>
                            <span class="line-clamp-2 min-w-0 wrap-anywhere">{target.content}</span>
                          </MenuItem>
                        )}
                      </For>
                      <For each={groupTargets().groups}>
                        {(target) => (
                          <MenuItem value={`group:${target.id}`} class={menuItemClass} onSelect={() => { void groupWith(props.card.id, 'group', target.id); }}>
                            <span class="line-clamp-2 min-w-0 wrap-anywhere">{target.title || 'Card Group'}</span>
                          </MenuItem>
                        )}
                      </For>
                    </Show>
                    <Show when={menuPage() === 'move' || menuPage() === 'group'}>
                      <MenuItem value="back" class={menuItemClass} closeOnSelect={false} onSelect={() => setMenuPage('actions')}>
                        Back to Card actions
                      </MenuItem>
                    </Show>
                  </MenuContent>
                </Menu>
              </Show>
            </div>
          </footer>
          <Show when={canManage() && confirmingDelete()}>
            <div class="mt-2 flex flex-wrap items-center justify-end gap-1.5" data-print-hide="true">
              <span class="mr-auto text-sm text-text">Delete this Card?</span>
              <button
                ref={cancelDeleteButton}
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={isDeleting()}
                class="min-h-11 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 sm:min-h-8"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting()}
                class="min-h-11 rounded-md bg-rose-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 sm:min-h-8"
              >
                {isDeleting() ? 'Deleting…' : 'Confirm?'}
              </button>
            </div>
          </Show>
          <p class="sr-only" aria-live="polite" aria-atomic="true">{pendingAction()}</p>
          <Show when={actionError()}>
            <p role="alert" data-print-hide="true" class="mt-1 text-xs text-rose-700 dark:text-rose-300">{actionError()}</p>
          </Show>
        </Show>
      </Show>
    </article>
  );
}
