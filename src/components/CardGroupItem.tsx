import { Menu, MenuContent, MenuItem, MenuTrigger } from '@ui-sdk/solid/menu';
import { ArrowRightLeft, Check, ChevronRight, Pencil, Ungroup, X } from 'lucide';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';

import type {
  CardGroupDTO,
  CardViewDTO,
  ColumnDTO,
} from '../lib/board-types';
import { MAX_GROUP_TITLE_LENGTH } from '../lib/board-types';
import { isGroupRedacted } from '../lib/board-permissions';
import type { BoardMutations } from '../lib/board-session';
import type { BoardTransferHandle } from '../lib/board-transfer';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import CardItem from './CardItem';
import LucideIcon from './LucideIcon';
import type { WorkspaceVoting } from '../lib/board-session';
import VoteControls from './VoteControls';

export interface CardGroupItemProps {
  group: CardGroupDTO;
  cards: readonly CardViewDTO[];
  revealIndexOffset?: number;
  columnCards: readonly CardViewDTO[];
  columnGroups: readonly CardGroupDTO[];
  columns: readonly ColumnDTO[];
  voting: WorkspaceVoting;
  isFacilitator: boolean;
  isLocked: boolean;
  isBlurred: boolean;
  canGroupCards: boolean;
  canManage: boolean;
  nowMs: number;
  /** The Board's createTransfer instance: this Group's header is one of its items. */
  transfer: BoardTransferHandle;
  /** Controller-shaped Card/Group mutations (the workspace passes its session). */
  actions: Pick<
    BoardMutations,
    | 'updateCard'
    | 'updateActionItem'
    | 'moveCard'
    | 'deleteCard'
    | 'toggleReaction'
    | 'groupCard'
    | 'ungroupCard'
    | 'renameCardGroup'
    | 'dissolveCardGroup'
    | 'moveCardGroup'
  >;
  onOpenCardDetail: (cardId: string, trigger: HTMLButtonElement) => void;
}

const actionButtonClass = 'spring-press inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-muted hover:bg-surface hover:text-text active:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 sm:size-7';
const titleTextClass = 'line-clamp-2 wrap-anywhere text-sm leading-5 font-semibold text-ellipsis text-text';

export default function CardGroupItem(props: CardGroupItemProps) {
  const [expanded, setExpanded] = createSignal(true);
  const [isRenaming, setIsRenaming] = createSignal(false);
  const [renameDraft, setRenameDraft] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);
  const [moveMenuOpen, setMoveMenuOpen] = createSignal(false);
  const [isMoving, setIsMoving] = createSignal(false);
  const [moveFailed, setMoveFailed] = createSignal(false);
  const [isDissolving, setIsDissolving] = createSignal(false);
  let moveTrigger: HTMLButtonElement | undefined;

  createEffect(isMoving, (moving, wasMoving) => {
    if (!moving && wasMoving && moveFailed()) moveTrigger?.focus({ preventScroll: true });
  });

  const otherColumns = createMemo(
    () => props.columns.filter((column) => column.id !== props.group.columnId),
    {
      equals: (prev, next) =>
        prev.length === next.length &&
        prev.every((col, index) => col === next[index]),
    },
  );

  const groupTitle = () => props.group.title || 'Card Group';
  const isRedacted = createMemo(() => Boolean(props.group.redacted));
  const canManageGroup = createMemo(
    () => props.canManage && !isGroupRedacted(props.group),
  );

  function startRename(): void {
    setRenameDraft(props.group.title);
    setMoveMenuOpen(false);
    setIsRenaming(true);
  }

  function cancelRename(): void {
    setIsRenaming(false);
    setRenameDraft('');
  }

  async function saveRename(): Promise<void> {
    const title = renameDraft().trim();
    if (title.length === 0 || isSaving()) return;
    if (title === props.group.title) {
      setIsRenaming(false);
      return;
    }
    setIsSaving(true);
    try {
      const ok = await props.actions.renameCardGroup(props.group.id, title);
      if (ok) setIsRenaming(false);
    } finally {
      setIsSaving(false);
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

  async function handleSelectMoveTarget(targetColumnId: string): Promise<void> {
    if (isMoving()) return;
    setIsMoving(true);
    setMoveFailed(false);
    try {
      const ok = await props.actions.moveCardGroup(props.group.id, targetColumnId);
      setMoveFailed(!ok);
    } catch {
      setMoveFailed(true);
    } finally {
      setIsMoving(false);
    }
  }

  async function handleDissolve(): Promise<void> {
    if (isDissolving()) return;
    setIsDissolving(true);
    try {
      await props.actions.dissolveCardGroup(props.group.id);
    } finally {
      setIsDissolving(false);
    }
  }

  return (
    <article
      {...props.transfer.slot('group-target', () => ({ value: `group:${props.group.id}` }))}
      data-group-id={props.group.id}
      class={[
        'relative min-w-0 rounded-xl border border-border/80 bg-surface-subtle/50 p-1.5 transition-shadow',
        'data-drop-active:ring-2 data-drop-active:ring-focus/70',
      ]}
    >
      <div
        {...props.transfer.slot('group-item', () => ({ value: `group:${props.group.id}` }))}
        /* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex --
           grab–move–drop (APG): transfer items are focusable. */
        tabindex={canManageGroup() && !props.isLocked ? 0 : undefined}
        aria-roledescription={canManageGroup() && !props.isLocked ? 'draggable' : undefined}
        class={[
          'grid min-w-0 gap-1 px-0.5',
          {
            'cursor-grab active:cursor-grabbing touch-none':
              canManageGroup() && !props.isLocked,
          },
          'data-dragging:opacity-50',
        ]}
      >
        <div class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-1.5">
          <button
            type="button"
            data-print-hide="true"
            aria-label={expanded() ? 'Collapse Card Group' : 'Expand Card Group'}
            aria-expanded={expanded() ? 'true' : 'false'}
            onClick={() => setExpanded((prev) => !prev)}
            class={actionButtonClass}
          >
            <LucideIcon
              icon={ChevronRight}
              class={expanded()
                ? 'spring-chevron size-4 rotate-90 motion-reduce:transition-none'
                : 'spring-chevron size-4 motion-reduce:transition-none'}
            />
          </button>

          <Show
            when={!isRenaming() || !canManageGroup()}
            fallback={
              <div class="col-span-2 flex min-w-0 items-center gap-1">
                <input
                  type="text"
                  aria-label="Card Group title"
                  value={renameDraft()}
                  readonly={isSaving()}
                  maxlength={MAX_GROUP_TITLE_LENGTH}
                  onInput={(event) => setRenameDraft(event.currentTarget.value)}
                  onKeyDown={handleRenameKeyDown}
                  class="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-base font-semibold text-text focus:border-focus focus:outline-none sm:min-h-7"
                />
                <button
                  type="button"
                  aria-label="Save Card Group title"
                  disabled={isSaving() || renameDraft().trim().length === 0}
                  onClick={() => void saveRename()}
                  class="spring-press inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-accent text-accent-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 sm:size-7"
                >
                  <LucideIcon icon={Check} />
                </button>
                <button
                  type="button"
                  aria-label="Cancel Card Group rename"
                  onClick={cancelRename}
                  class={actionButtonClass}
                >
                  <LucideIcon icon={X} />
                </button>
              </div>
            }
          >
            <Show
              when={!isRedacted()}
              fallback={
                <span class="truncate py-3 text-xs leading-5 font-medium text-text-muted italic sm:py-1">
                  Hidden until Reveal All
                </span>
              }
            >
              <Show
                when={canManageGroup()}
                fallback={
                  <div class="min-w-0 py-3 sm:py-1" title={groupTitle()}>
                    <span class={titleTextClass}>{groupTitle()}</span>
                  </div>
                }
              >
                <button
                  type="button"
                  aria-label={`${groupTitle()} — Edit Card Group title`}
                  title={groupTitle()}
                  onClick={startRename}
                  class="min-w-0 cursor-pointer rounded-sm py-3 text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:py-1"
                >
                  <span class={titleTextClass}>{groupTitle()}</span>
                </button>
              </Show>
            </Show>
            <span
              aria-label={`${props.cards.length} cards`}
              class="mt-3.5 rounded-full border border-border/75 bg-surface px-2 py-px text-[11px] leading-4 font-medium whitespace-nowrap text-text-muted tabular-nums sm:mt-1.5"
            >
              {props.cards.length} {props.cards.length === 1 ? 'card' : 'cards'}
            </span>
          </Show>
        </div>

        <Show when={!isRedacted()}>
          <div class="flex flex-wrap items-center justify-between gap-1">
            <VoteControls
              target={props.group}
              targetType="group"
              voting={props.voting}
              isLocked={props.isLocked}
            />

            <Show when={canManageGroup()}>
              <div data-print-hide="true" class="ml-auto flex items-center gap-0.5">
                <Show when={otherColumns().length > 0}>
                  <Menu open={moveMenuOpen()} onOpenChange={setMoveMenuOpen} modal={false}>
                    <MenuTrigger
                      ref={moveTrigger}
                      aria-label="Move Card Group to..."
                      title="Move Card Group to..."
                      disabled={isMoving()}
                      class={[actionButtonClass, 'data-open:bg-surface data-open:text-text']}
                    >
                      <LucideIcon icon={ArrowRightLeft} />
                    </MenuTrigger>
                    <MenuContent
                      side="bottom"
                      align="end"
                      sideOffset={6}
                      collisionPadding={12}
                      render={(contentProps) => (
                        <div
                          {...contentProps}
                          aria-labelledby={undefined}
                          aria-label="Move Card Group to Column"
                          data-board-overlay={moveMenuOpen() ? 'true' : undefined}
                        />
                      )}
                      class="board-popover max-h-[min(50dvh,var(--available-height))] w-56 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 text-text"
                    >
                      <For each={otherColumns()}>
                        {(targetColumn) => (
                          <MenuItem
                            value={targetColumn.id}
                            onSelect={() => { void handleSelectMoveTarget(targetColumn.id); }}
                            class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text hover:bg-surface-subtle data-highlighted:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus sm:min-h-8"
                          >
                            <span
                              aria-hidden="true"
                              class={[
                                'h-2 w-2 shrink-0 rounded-full',
                                COLUMN_ACCENT_STYLES[targetColumn.accent].swatch,
                              ]}
                            />
                            <span class="min-w-0 wrap-anywhere">{targetColumn.title}</span>
                          </MenuItem>
                        )}
                      </For>
                    </MenuContent>
                  </Menu>
                </Show>

                <button
                  type="button"
                  aria-label="Rename Card Group"
                  title="Rename Card Group"
                  onClick={startRename}
                  class={actionButtonClass}
                >
                  <LucideIcon icon={Pencil} />
                </button>

                <button
                  type="button"
                  aria-label="Dissolve Card Group"
                  title="Dissolve Card Group"
                  disabled={isDissolving()}
                  onClick={() => void handleDissolve()}
                  class={[actionButtonClass, 'hover:text-rose-700 dark:hover:text-rose-300']}
                >
                  <LucideIcon icon={Ungroup} />
                </button>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={canManageGroup()}>
          <Show when={moveFailed()}>
            <p role="alert" data-print-hide="true" class="text-xs text-rose-700 dark:text-rose-300">
              Could not move the Card Group. Try again.
            </p>
          </Show>
          <p role="status" class="sr-only">
            {isSaving() ? 'Saving Card Group title…' : isMoving() ? 'Moving Card Group…' : isDissolving() ? 'Dissolving Card Group…' : ''}
          </p>
        </Show>
      </div>

      <Show when={expanded()}>
        <div class="mt-1.5 flex flex-col gap-1.5">
          <For each={props.cards}>
            {(card, cardIndex) => (
              <CardItem
                card={card}
                revealIndex={(props.revealIndexOffset ?? 0) + cardIndex()}
                voting={props.voting}
                columns={props.columns}
                columnCards={props.columnCards}
                columnGroups={props.columnGroups}
                canGroupCards={props.canGroupCards}
                canUngroup={canManageGroup()}
                isFacilitator={props.isFacilitator}
                isLocked={props.isLocked}
                isBlurred={props.isBlurred}
                nowMs={props.nowMs}
                transfer={props.transfer}
                actions={props.actions}
                onOpenCardDetail={props.onOpenCardDetail}
              />
            )}
          </For>
        </div>
      </Show>
    </article>
  );
}
