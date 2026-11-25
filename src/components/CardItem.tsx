import { Menu, MenuItem, MenuSub, MenuSubTrigger, MenuTrigger } from '@ui-sdk/solid/menu';
import { ChevronRight, Ellipsis, Flag, MessageSquare, PanelRightOpen } from 'lucide';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';

import {
  MAX_CARD_CONTENT_LENGTH,
  type ActionItemPatch,
  type CardGroupDTO,
  type CardViewDTO,
} from '../lib/board-types';
import {
  REDACTED_CARD_WHISPERS,
  REDACTED_WHISPER_DURATION_MS,
} from '../lib/easter-eggs';
import {
  canEditActionItemFollowUp,
  canInteractWithCard,
  canManageCard,
  passesPrivateMode,
} from '../lib/board-permissions';
import { confirmBoardAction } from '../lib/board-confirm';
import { createInlineEditSession, type InlineEditOutcome } from '../lib/inline-edit';
import { formatRelativeTime } from '../lib/recent-boards';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import BoardMenuContent from './BoardMenuContent';
import { useBoardWorkspace } from './BoardWorkspaceContext';
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
import VoteControls from './VoteControls';

export interface CardItemProps {
  card: CardViewDTO;
  revealIndex?: number;
  columnCards: readonly CardViewDTO[];
  columnGroups: readonly CardGroupDTO[];
  canUngroup?: boolean;
}

const menuItemClass = 'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text hover:bg-surface-subtle data-highlighted:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus data-disabled:cursor-not-allowed data-disabled:opacity-50 sm:min-h-8';
const PLACEHOLDER_LINES_1 = ['w-3/4'] as const;
const PLACEHOLDER_LINES_2 = ['w-full', 'w-4/5'] as const;
const PLACEHOLDER_LINES_3 = ['w-full', 'w-11/12', 'w-2/3'] as const;

export default function CardItem(props: CardItemProps) {
  const workspace = useBoardWorkspace();
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [isMoving, setIsMoving] = createSignal(false);
  const [isGrouping, setIsGrouping] = createSignal(false);
  const [isUngrouping, setIsUngrouping] = createSignal(false);
  const isUpdatingAction = createMemo(() => workspace.actions.isActionItemPending(props.card.id));
  // The optimistic store is the draft: the pending value is the checkbox value.
  const actionDone = () => props.card.actionDone;
  const [actionError, setActionError] = createSignal('');

  const [menuOpen, setMenuOpen] = createSignal(false);
  let menuTrigger: HTMLButtonElement | undefined;
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
        setMenuOpen(false);
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
    () => workspace.isLocked,
    (locked) => {
      if (locked) {
        setMenuOpen(false);
      }
    },
  );

  const canManage = createMemo(() => canManageCard(workspace, props.card));

  // Card text inline editing: unified session owns edit, input, IME, focus-out, and fallback focus.
  const cardEdit = createInlineEditSession({
    value: () => props.card.content,
    target: () => props.card.id,
    disabled: () => !canManage(),
    save: saveCardText,
    fallbackFocus: () => menuTrigger?.focus(),
    acceptsTarget: (target) => !(target instanceof Element && target.closest('a')),
  });

  const otherColumns = createMemo(
    () => workspace.columns.filter((col) => col.id !== props.card.columnId),
  );

  const canMove = createMemo(() => canManage() && otherColumns().length > 0);

  const groupTargets = createMemo(
    () => ({
      cards: props.columnCards.filter(
        (other) =>
          other.id !== props.card.id &&
          !other.redacted &&
          !other.pending &&
          other.groupId === null,
      ),
      groups: props.columnGroups.filter(
        (group) => group.id !== props.card.groupId,
      ),
    }),
  );

  const canGroup = createMemo(
    () =>
      workspace.canGroupCards &&
      canInteractWithCard(workspace, props.card) &&
      (groupTargets().cards.length > 0 || groupTargets().groups.length > 0),
  );

  const canUngroup = createMemo(
    () =>
      props.canUngroup ??
      (workspace.canGroupCards && passesPrivateMode(workspace, props.card)),
  );

  const canDrag = createMemo(() => (canMove() || canGroup()) && !cardEdit.isEditing());

  const relativeTimestamp = createMemo(() =>
    formatRelativeTime(props.card.createdAt, workspace.nowMs),
  );

  const placeholderLineWidths = createMemo(() => {
    const count = props.card.placeholderLines ?? 2;
    if (count === 1) return PLACEHOLDER_LINES_1;
    if (count === 3) return PLACEHOLDER_LINES_3;
    return PLACEHOLDER_LINES_2;
  });

  function startEdit(): void {
    setMenuOpen(false);
    cardEdit.start();
  }

  async function saveCardText(text: string): Promise<InlineEditOutcome> {
    if (!canManage()) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const error = await workspace.actions.updateCard(props.card.id, trimmed);
    return error === null ? true : error;
  }

  async function runCardAction(
    request: () => Promise<boolean>,
    failureMessage: string,
    setPending?: (pending: boolean) => void,
  ): Promise<boolean> {
    setPending?.(true);
    setActionError('');
    try {
      if (await request()) return true;
    } catch {
      // Report rejected requests alongside unsuccessful mutation responses.
    } finally {
      setPending?.(false);
    }
    if (!props.card.redacted) setActionError(failureMessage);
    return false;
  }

  async function handleDeleteCard(): Promise<void> {
    if (isDeleting()) return;
    const confirmed = await confirmBoardAction({
      title: 'Delete this Card?',
      description: 'The Card and its comments are removed for everyone on this Board.',
      confirmLabel: 'Delete Card',
    });
    if (!confirmed) return;
    await runCardAction(
      () => workspace.actions.deleteCard(props.card.id),
      'Could not delete the Card. Try again.',
      setIsDeleting,
    );
  }

  function updateAction(patch: ActionItemPatch): Promise<boolean> {
    return runCardAction(
      // eslint-disable-next-line solid/reactivity -- invoked from event handlers only
      () => workspace.actions.updateActionItem(props.card.id, patch),
      'Could not update the Action Item. Try again.',
    );
  }

  async function handleSelectMoveTarget(targetColumnId: string): Promise<void> {
    if (isMoving()) return;
    await runCardAction(
      () => workspace.actions.moveCard(props.card.id, targetColumnId),
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
    await runCardAction(
      () => workspace.actions.groupCard(cardId, targetType, targetId),
      'Could not group the Card. Try again.',
      setIsGrouping,
    );
  }

  async function handleUngroup(): Promise<void> {
    if (isUngrouping()) return;
    await runCardAction(
      () => workspace.actions.ungroupCard(props.card.id),
      'Could not ungroup the Card. Try again.',
      setIsUngrouping,
    );
  }

  return (
    <article
      {...workspace.transfer.slot('card', () => ({ value: `card:${props.card.id}` }))}
      data-card-id={props.card.id}
      data-private-mode={props.card.redacted ? 'server-redacted-nice-try' : undefined}
      style={
        wasRevealed()
          ? { '--card-reveal-delay': `${Math.min((props.revealIndex ?? 0) * 18, 250)}ms` }
          : undefined
      }
      /* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex --
         grab–move–drop (APG): transfer items are focusable. */
      tabindex={canDrag() ? 0 : undefined}
      aria-roledescription={canDrag() ? 'draggable' : undefined}
      class={[
        'relative min-w-0 border bg-surface p-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:border-control/70 sm:p-3.5',
        props.card.groupId === null ? 'rounded-lg border-border/80' : 'rounded-md border-border/60',
        {
          'cursor-grab active:cursor-grabbing':
            canDrag(),
          'bg-surface-subtle': props.card.redacted,
          'card-revealed': wasRevealed(),
        },
        'data-drop-active:ring-2 data-drop-active:ring-focus/70 data-moving:opacity-50 data-dragging:opacity-50',
      ]}
    >
      <Show
        when={!props.card.redacted}
        fallback={
          <button
            type="button"
            aria-label="Hidden Card in Private Mode"
            onClick={handleRedactedClick}
            class="block w-full cursor-pointer select-none space-y-2 py-0.5 text-left"
          >
            <div class="space-y-1.5" aria-hidden="true">
              <For each={placeholderLineWidths()}>
                {(widthClass) => (
                  <div
                    class={[
                      'h-3 rounded-sm bg-border/80 blur-[2px]',
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
          </button>
        }
      >
        <Show
          when={!cardEdit.isEditing()}
          fallback={
            <div ref={cardEdit.containerRef} class="space-y-2">
              <textarea
                ref={cardEdit.inputRef}
                aria-label="Edit card text"
                aria-invalid={cardEdit.error() ? 'true' : undefined}
                readonly={cardEdit.isSaving()}
                maxlength={MAX_CARD_CONTENT_LENGTH}
                rows={3}
                {...cardEdit.inputProps}
                class={[
                  'w-full resize-none rounded-md border border-border bg-canvas px-2.5 py-2 text-base text-text',
                  'placeholder:text-text-muted board-focus-ring',
                ]}
              />
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-[11px] text-text-muted tabular-nums">
                  {cardEdit.draftLength()}/{MAX_CARD_CONTENT_LENGTH}
                </span>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={cardEdit.cancel}
                    class={[
                      'min-h-11 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-muted sm:min-h-7 sm:px-2.5 sm:py-1',
                      'cursor-pointer transition-colors hover:bg-surface-subtle hover:text-text',
                      'board-focus-ring',
                    ]}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={cardEdit.submit}
                    disabled={cardEdit.isSaving() || !cardEdit.hasText()}
                    class={[
                      'min-h-11 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast sm:min-h-7 sm:px-2.5 sm:py-1',
                      'cursor-pointer transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
                      'board-focus-ring',
                    ]}
                  >
                    {cardEdit.isSaving() ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
              <Show when={cardEdit.error()}>
                <p role="alert" class="text-sm text-rose-700 dark:text-rose-300">{cardEdit.error()}</p>
              </Show>
            </div>
          }
        >
          <div
            {...cardEdit.triggerProps}
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
            <div class="mt-2.5 flex items-center justify-between gap-2 rounded-sm bg-surface-subtle/65 px-2.5 py-1.5">
              <label class="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 sm:min-h-6">
                <input
                  type="checkbox"
                  checked={actionDone()}
                  disabled={!canEditActionItemFollowUp(workspace, props.card)}
                  aria-label={`Mark ${props.card.content} as Done`}
                  onChange={async (event) => {
                    const checkbox = event.currentTarget;
                    if (!await updateAction({ actionDone: checkbox.checked }) && checkbox.isConnected) {
                      checkbox.checked = props.card.actionDone;
                    }
                  }}
                  class="h-4 w-4 shrink-0 cursor-pointer rounded-sm border-border accent-accent disabled:cursor-not-allowed disabled:opacity-50"
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
              disabled={workspace.isLocked}
              onToggleReaction={workspace.actions.toggleReaction}
            />

            <div class="order-first flex min-w-0 basis-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-muted sm:order-0 sm:col-start-1">
              <Show when={props.card.isMine}>
                <span class="rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-medium">
                  You
                </span>
              </Show>
              <time class="max-w-full truncate tabular-nums">{relativeTimestamp()}</time>
            </div>

            <Show when={props.card.groupId === null}>
              <div class="flex sm:col-start-3">
                <VoteControls target={props.card} voting={workspace.voting} isLocked={workspace.isLocked} />
              </div>
            </Show>

            <div data-print-hide="true" class="ms-auto flex max-w-full flex-wrap items-center justify-end gap-1 sm:col-start-4 sm:ms-0 sm:max-w-none sm:flex-nowrap">
              <Show when={props.card.commentCount > 0}>
                <button
                  type="button"
                  aria-label={`${props.card.commentCount} ${props.card.commentCount === 1 ? 'comment' : 'comments'}`}
                  onClick={(event) => workspace.openCardDetail(props.card.id, event.currentTarget)}
                  class={[
                    'spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-full border border-border bg-surface-subtle px-2 text-[11px] font-medium text-text sm:min-h-7 sm:min-w-0',
                    'transition-colors hover:border-text-muted/50 hover:text-text',
                    'board-focus-ring',
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
                onClick={(event) => workspace.openCardDetail(props.card.id, event.currentTarget)}
                class={[
                  'spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-text-muted sm:min-h-7 sm:min-w-7',
                  'transition-colors hover:bg-surface-subtle hover:text-text',
                  'board-focus-ring',
                ]}
              >
                <LucideIcon icon={PanelRightOpen} />
              </button>

              <Show when={!workspace.isLocked}>
                <Menu
                  open={menuOpen()}
                  modal={false}
                  onOpenChange={(open) => setMenuOpen(open)}
                >
                  <MenuTrigger
                    ref={menuTrigger}
                    aria-label="Card actions"
                    title="Card actions"
                    class="spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-subtle hover:text-text data-open:bg-surface-subtle data-open:text-text board-focus-ring sm:min-h-7 sm:min-w-7"
                  >
                    <LucideIcon icon={Ellipsis} class="size-4" />
                  </MenuTrigger>
                  <BoardMenuContent
                    aria-label="Card actions"
                    finalFocus={cardEdit.isEditing() ? 'none' : undefined}
                    class="board-popover max-h-[min(50dvh,var(--available-height))] w-56 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border border-border bg-surface p-1 text-text"
                  >
                    <Show when={canManage()}>
                      <MenuItem value="edit" class={menuItemClass} onSelect={startEdit}>
                        <PencilIcon /> Edit Card
                      </MenuItem>
                    </Show>
                    <Show when={canMove()}>
                      <MenuSub>
                        <MenuSubTrigger class={menuItemClass} disabled={isMoving()}>
                          <ArrowRightLeftIcon /> Move to…
                          <LucideIcon icon={ChevronRight} class="ml-auto size-3.5 text-text-muted" />
                        </MenuSubTrigger>
                        <BoardMenuContent
                          aria-label="Move Card to Column"
                          class="board-popover max-h-[min(50dvh,var(--available-height))] w-56 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border border-border bg-surface p-1 text-text"
                        >
                          <For each={otherColumns()}>
                            {(target) => (
                              <MenuItem value={target.id} class={menuItemClass} onSelect={() => { void handleSelectMoveTarget(target.id); }}>
                                <span aria-hidden="true" class={['h-2 w-2 shrink-0 rounded-full', COLUMN_ACCENT_STYLES[target.accent].swatch]} />
                                <span class="min-w-0 wrap-anywhere">{target.title}</span>
                              </MenuItem>
                            )}
                          </For>
                        </BoardMenuContent>
                      </MenuSub>
                    </Show>
                    <Show when={canGroup()}>
                      <MenuSub>
                        <MenuSubTrigger class={menuItemClass} disabled={isGrouping()}>
                          <PlusIcon /> Group with…
                          <LucideIcon icon={ChevronRight} class="ml-auto size-3.5 text-text-muted" />
                        </MenuSubTrigger>
                        <BoardMenuContent
                          aria-label="Group Card with"
                          class="board-popover max-h-[min(50dvh,var(--available-height))] w-56 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border border-border bg-surface p-1 text-text"
                        >
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
                        </BoardMenuContent>
                      </MenuSub>
                    </Show>
                    <Show when={props.card.groupId !== null && canUngroup()}>
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
                          void handleDeleteCard();
                        }}
                      >
                        <TrashIcon /> Delete Card
                      </MenuItem>
                    </Show>
                  </BoardMenuContent>
                </Menu>
              </Show>
            </div>
          </footer>
          <p class="sr-only" aria-live="polite" aria-atomic="true">{pendingAction()}</p>
          <Show when={actionError()}>
            <p role="alert" data-print-hide="true" class="mt-1 text-xs text-rose-700 dark:text-rose-300">{actionError()}</p>
          </Show>
        </Show>
      </Show>
    </article>
  );
}
