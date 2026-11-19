import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';

import type {
  ActionItemPatch,
  CardGroupDTO,
  CardViewDTO,
  ColumnDTO,
  ReactionEmoji,
} from '../lib/board-types';
import { MAX_GROUP_TITLE_LENGTH } from '../lib/board-types';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import CardItem from './CardItem';
import {
  ArrowRightLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  PencilIcon,
  TrashIcon,
} from './Icons';
import VoteControls, { type WorkspaceVoting } from './VoteControls';

export interface CardGroupItemProps {
  group: CardGroupDTO;
  cards: readonly CardViewDTO[];
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
  draggingCardId: string | null;
  draggingSourceColumnId: string | null;
  onRename: (groupId: string, title: string) => Promise<boolean>;
  onDissolve: (groupId: string) => Promise<boolean>;
  onMoveGroup: (groupId: string, targetColumnId: string) => Promise<boolean>;
  onGroupCard: (
    cardId: string,
    targetType: 'card' | 'group',
    targetId: string,
  ) => Promise<boolean>;
  onUngroupCard: (cardId: string) => Promise<boolean>;
  onUpdateCard: (cardId: string, content: string) => Promise<boolean>;
  onUpdateActionItem: (
    cardId: string,
    patch: ActionItemPatch,
  ) => Promise<boolean>;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<boolean>;
  onDeleteCard: (cardId: string) => Promise<boolean>;
  onToggleReaction: (cardId: string, emoji: ReactionEmoji) => Promise<boolean>;
  onOpenCardDetail: (cardId: string) => void;
  onDragStartCard: (cardId: string, sourceColumnId: string) => void;
  onDragEndCard: () => void;
  onDragStartGroup: (groupId: string, sourceColumnId: string) => void;
}

export default function CardGroupItem(props: CardGroupItemProps) {
  const [expanded, setExpanded] = createSignal(true);
  const [isRenaming, setIsRenaming] = createSignal(false);
  const [renameDraft, setRenameDraft] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);
  const [moveMenuOpen, setMoveMenuOpen] = createSignal(false);
  const [isMoving, setIsMoving] = createSignal(false);
  const [isDissolving, setIsDissolving] = createSignal(false);
  const [isDropActive, setIsDropActive] = createSignal(false);

  createEffect(moveMenuOpen, (isOpen) => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMoveMenuOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  const otherColumns = createMemo(() =>
    props.columns.filter((column) => column.id !== props.group.columnId),
  );

  const draggingCard = createMemo(() => {
    if (
      !props.draggingCardId ||
      props.draggingSourceColumnId !== props.group.columnId
    ) {
      return undefined;
    }
    return props.columnCards.find(
      (card) => card.id === props.draggingCardId && !card.redacted,
    );
  });

  const canAcceptDrop = createMemo(() => {
    const card = draggingCard();
    return (
      props.canGroupCards &&
      !props.isLocked &&
      card !== undefined &&
      !props.group.cardIds.includes(card.id)
    );
  });

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
      const ok = await props.onRename(props.group.id, title);
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
    setMoveMenuOpen(false);
    try {
      await props.onMoveGroup(props.group.id, targetColumnId);
    } finally {
      setIsMoving(false);
    }
  }

  async function handleDissolve(): Promise<void> {
    if (isDissolving()) return;
    setIsDissolving(true);
    try {
      await props.onDissolve(props.group.id);
    } finally {
      setIsDissolving(false);
    }
  }

  function handleDragStart(event: DragEvent): void {
    if (!props.canManage || props.isLocked) {
      event.preventDefault();
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', props.group.id);
      event.dataTransfer.setData('application/x-retrocks-group', props.group.id);
    }
    props.onDragStartGroup(props.group.id, props.group.columnId);
  }

  function handleDragOver(event: DragEvent): void {
    if (!canAcceptDrop()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setIsDropActive(true);
  }

  function handleDragLeave(event: DragEvent): void {
    const currentTarget = event.currentTarget as HTMLElement | null;
    const related = event.relatedTarget as Node | null;
    if (currentTarget && related && currentTarget.contains(related)) return;
    setIsDropActive(false);
  }

  function handleDrop(event: DragEvent): void {
    if (!canAcceptDrop()) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDropActive(false);
    const card = draggingCard();
    if (card) {
      void props.onGroupCard(card.id, 'group', props.group.id);
    }
  }

  return (
    <article
      data-group-id={props.group.id}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      class={[
        'rounded-xl border border-border bg-canvas/60 transition-shadow',
        {
          'ring-2 ring-focus/70': isDropActive(),
        },
      ]}
    >
      <div
        draggable={props.canManage && !props.isLocked ? 'true' : 'false'}
        onDragStart={handleDragStart}
        onDragEnd={() => props.onDragEndCard()}
        class={[
          'flex flex-wrap items-center gap-2 rounded-t-xl border-b border-border/70 bg-surface-subtle/70 px-2.5 py-2',
          {
            'cursor-grab active:cursor-grabbing':
              props.canManage && !props.isLocked,
          },
        ]}
      >
        <button
          type="button"
          aria-label={expanded() ? 'Collapse Card Group' : 'Expand Card Group'}
          aria-expanded={expanded() ? 'true' : 'false'}
          onClick={() => setExpanded((prev) => !prev)}
          class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span
            class={[
              'inline-flex transition-transform',
              { 'rotate-90': expanded() },
            ]}
          >
            <ChevronRightIcon />
          </span>
        </button>

        <Show
          when={!isRenaming()}
          fallback={
            <div class="flex min-w-0 flex-1 items-center gap-1">
              <input
                type="text"
                aria-label="Card Group title"
                value={renameDraft()}
                maxlength={MAX_GROUP_TITLE_LENGTH}
                onInput={(event) => setRenameDraft(event.currentTarget.value)}
                onKeyDown={handleRenameKeyDown}
                class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm font-semibold text-text focus:border-focus focus:outline-none"
              />
              <button
                type="button"
                aria-label="Save Card Group title"
                disabled={isSaving() || renameDraft().trim().length === 0}
                onClick={() => void saveRename()}
                class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md bg-accent text-accent-contrast hover:opacity-90 disabled:opacity-50"
              >
                <CheckIcon />
              </button>
              <button
                type="button"
                aria-label="Cancel Card Group rename"
                onClick={cancelRename}
                class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-text-muted hover:text-text"
              >
                <CloseIcon />
              </button>
            </div>
          }
        >
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <Show
              when={props.canManage}
              fallback={
                <span class="truncate text-sm font-semibold text-text">
                  {props.group.title || 'Card Group'}
                </span>
              }
            >
              <button
                type="button"
                aria-label="Edit Card Group title"
                title="Edit Card Group title"
                onClick={startRename}
                class="min-w-0 cursor-pointer truncate rounded-sm text-left text-sm font-semibold text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {props.group.title || 'Card Group'}
              </button>
            </Show>
            <span
              aria-label={`${props.cards.length} cards`}
              class="inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted tabular-nums"
            >
              {props.cards.length} {props.cards.length === 1 ? 'card' : 'cards'}
            </span>
          </div>
        </Show>

        <VoteControls
          target={props.group}
          targetType="group"
          voting={props.voting}
          isLocked={props.isLocked}
        />

        <Show when={props.canManage}>
          <div class="flex items-center gap-0.5">
            <Show when={otherColumns().length > 0}>
              <div class="relative">
                <button
                  type="button"
                  aria-label="Move Card Group to..."
                  aria-haspopup="menu"
                  aria-expanded={moveMenuOpen() ? 'true' : 'false'}
                  title="Move Card Group to..."
                  disabled={isMoving()}
                  onClick={() => setMoveMenuOpen((prev) => !prev)}
                  class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <ArrowRightLeftIcon />
                </button>

                <Show when={moveMenuOpen()}>
                  <div
                    role="menu"
                    aria-label="Move Card Group to Column"
                    data-board-overlay="true"
                    class="absolute right-0 bottom-full z-30 mb-1 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-md"
                  >
                    <p class="px-2 py-1 text-[11px] font-medium text-text-muted">
                      Move group to...
                    </p>
                    <For each={otherColumns()}>
                      {(targetColumn) => (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleSelectMoveTarget(targetColumn.id)}
                          class="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          <span
                            aria-hidden="true"
                            class={[
                              'h-2 w-2 shrink-0 rounded-full',
                              COLUMN_ACCENT_STYLES[targetColumn.accent].swatch,
                            ]}
                          />
                          <span class="truncate">{targetColumn.title}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>

            <button
              type="button"
              aria-label="Rename Card Group"
              title="Rename Card Group"
              onClick={startRename}
              class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <PencilIcon />
            </button>

            <button
              type="button"
              aria-label="Dissolve Card Group"
              title="Dissolve Card Group"
              disabled={isDissolving()}
              onClick={() => void handleDissolve()}
              class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface hover:text-col-rose disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <TrashIcon />
            </button>
          </div>
        </Show>
      </div>

      <Show when={expanded()}>
        <div class="flex flex-col gap-2 p-2">
          <For each={props.cards}>
            {(card) => (
              <CardItem
                card={card}
                voting={props.voting}
                columns={props.columns}
                columnCards={props.columnCards}
                columnGroups={props.columnGroups}
                canGroupCards={props.canGroupCards}
                canUngroup={props.canManage}
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
          </For>
        </div>
      </Show>
    </article>
  );
}
