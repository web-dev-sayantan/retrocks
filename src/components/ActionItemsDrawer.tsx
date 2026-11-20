import { Toggle, ToggleGroup } from '@ui-sdk/solid/toggle';
import { Flag } from 'lucide';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  untrack,
} from 'solid-js';

import { useShortcut } from '@ui-sdk/solid/shortcuts';
import {
  buildActionItemsMarkdown,
  filterActionItems,
  type ActionItemFilter,
} from '../lib/action-items';
import {
  MAX_ACTION_OWNER_LENGTH,
  type ActionItemPatch,
  type BoardViewDTO,
  type CardViewDTO,
} from '../lib/board-types';
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerTitle,
} from '@ui-sdk/solid/drawer';
import { canEditActionItems } from '../lib/board-permissions';
import BoardOverlayHeader from './BoardOverlayHeader';
import CardText from './CardText';
import LucideIcon from './LucideIcon';

const FILTERS: readonly { value: ActionItemFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
];

export interface ActionItemsDrawerProps {
  board: BoardViewDTO;
  open: boolean;
  side: 'bottom' | 'right';
  isLocked: boolean;
  onClose: () => void;
  onRestoreFocus?: (previousFocus: HTMLElement | null) => void;
  onUpdateActionItem: (
    cardId: string,
    patch: ActionItemPatch,
  ) => Promise<boolean>;
}

function ActionItemRow(props: {
  card: CardViewDTO;
  columnTitle: string;
  canEdit: boolean;
  onUpdate: ActionItemsDrawerProps['onUpdateActionItem'];
}) {
  const [ownerDraft, setOwnerDraft] = createSignal(
    untrack(() => props.card.actionOwner),
  );
  const [isSavingOwner, setIsSavingOwner] = createSignal(false);
  const [pendingDone, setPendingDone] = createSignal<boolean | null>(null);
  const [ownerFailed, setOwnerFailed] = createSignal(false);
  const [doneFailed, setDoneFailed] = createSignal(false);
  const isSaving = () => isSavingOwner() || pendingDone() !== null;
  let ownerSave: Promise<boolean> | undefined;
  let savingDone = false;

  createEffect(
    () => props.card.actionOwner,
    (owner) => {
      setOwnerDraft(owner);
    },
  );

  async function update(patch: ActionItemPatch): Promise<boolean> {
    if (!props.canEdit) return false;
    try {
      return await props.onUpdate(props.card.id, patch);
    } catch {
      return false;
    }
  }

  async function saveOwner(value: string): Promise<void> {
    if (!props.canEdit || ownerSave || savingDone) return;
    const trimmed = value.trim();
    if (trimmed === props.card.actionOwner) {
      setOwnerDraft(trimmed);
      return;
    }
    setIsSavingOwner(true);
    setOwnerFailed(false);
    ownerSave = update({ actionOwner: trimmed });
    if (await ownerSave) {
      setOwnerDraft(trimmed);
    } else {
      setOwnerFailed(true);
    }
    ownerSave = undefined;
    setIsSavingOwner(false);
  }

  async function changeDone(checked: boolean): Promise<void> {
    if (savingDone) return;
    savingDone = true;
    setPendingDone(checked);
    setDoneFailed(false);
    // A click on Done can start the Owner save as the input loses focus.
    if (ownerSave) await ownerSave;
    if (!await update({ actionDone: checked })) setDoneFailed(true);
    savingDone = false;
    setPendingDone(null);
  }

  return (
    <li class="rounded-lg border border-border bg-canvas/60 p-3">
      <div class="flex items-start gap-2.5">
        <label class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg has-disabled:cursor-not-allowed sm:size-6">
          <input
            type="checkbox"
            checked={pendingDone() ?? props.card.actionDone}
            disabled={!props.canEdit || pendingDone() !== null}
            aria-label={`Mark ${props.card.content} as Done`}
            onChange={(event) => void changeDone(event.currentTarget.checked)}
            class="size-5 cursor-inherit rounded border-border accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
          />
        </label>
        <div class="min-w-0 flex-1 space-y-1.5">
          <p
            class={[
              'text-sm leading-relaxed text-text',
              props.card.actionDone && 'text-text-muted line-through',
            ]}
          >
            <CardText text={props.card.content} />
          </p>
          <div class="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
            <span class="rounded-full border border-border bg-surface px-1.5 py-0.5 font-medium">
              {props.columnTitle}
            </span>
            <input
              type="text"
              aria-label={`Owner for ${props.card.content}`}
              placeholder="Owner (optional)"
              value={ownerDraft()}
              maxlength={MAX_ACTION_OWNER_LENGTH}
              disabled={!props.canEdit}
              readonly={isSaving()}
              onInput={(event) => setOwnerDraft(event.currentTarget.value)}
              onBlur={(event) => void saveOwner(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.isComposing || ownerSave || savingDone) return;
                const input = event.currentTarget;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveOwner(input.value);
                } else if (event.key === 'Escape' && input.value !== props.card.actionOwner) {
                  event.preventDefault();
                  event.stopPropagation();
                  input.value = props.card.actionOwner;
                  setOwnerDraft(input.value);
                  setOwnerFailed(false);
                }
              }}
              class={[
                'min-h-11 w-40 max-w-full rounded-md border border-control bg-surface px-2 py-1 text-base text-text sm:min-h-9 sm:text-sm',
                'placeholder:text-text-muted focus:border-focus focus:outline-none read-only:opacity-50 disabled:opacity-50',
              ]}
            />
          </div>
          <Show when={isSaving()}>
            <p role="status" class="text-xs text-text-muted">Updating Action Item…</p>
          </Show>
          <Show when={ownerFailed()}>
            <p role="alert" class="text-xs text-rose-700 dark:text-rose-300">Could not save the owner. Try again.</p>
          </Show>
          <Show when={doneFailed()}>
            <p role="alert" class="text-xs text-rose-700 dark:text-rose-300">Could not update Done. Try again.</p>
          </Show>
        </div>
      </div>
    </li>
  );
}

function sameCards(previous: readonly CardViewDTO[], next: readonly CardViewDTO[]): boolean {
  return previous.length === next.length && previous.every((card, index) => card === next[index]);
}

export default function ActionItemsDrawer(props: ActionItemsDrawerProps) {
  let previousFocus: HTMLElement | null = null;
  let contentEl: HTMLDivElement | undefined;
  const [filter, setFilter] = createSignal<ActionItemFilter>('all');
  const [copyStatus, setCopyStatus] = createSignal('');
  const selectedFilter = createMemo(() => [filter()]);
  const activeFilterIndex = createMemo(() => FILTERS.findIndex((option) => option.value === filter()));

  // While the drawer is open its layer outranks the paused page, so the
  // same "a" that opened it closes it here.
  useShortcut('a', () => props.onClose(), {
    layer: () => contentEl,
    description: 'Toggle Action Items',
  });

  const allItems = createMemo(
    () => filterActionItems(props.board.cards, 'all'),
    { equals: sameCards },
  );
  const visibleItems = createMemo(
    () => filter() === 'all' ? allItems() : filterActionItems(allItems(), filter()),
    { equals: sameCards },
  );
  const openCount = createMemo(
    () => allItems().filter((card) => !card.actionDone).length,
  );
  const counts = {
    all: () => allItems().length,
    open: openCount,
    done: () => allItems().length - openCount(),
  };
  const columnTitles = createMemo(
    () => new Map(props.board.columns.map((column) => [column.id, column.title])),
  );
  const emptyMessage = createMemo(() => {
    const current = filter();
    if (current === 'open') return 'No open Action Items.';
    if (current === 'done') return 'No completed Action Items.';
    return 'No Action Items yet.';
  });

  createEffect(() => props.open, (open, wasOpen) => {
    if (open) {
      previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setFilter('all');
      setCopyStatus('');
    } else if (wasOpen && props.onRestoreFocus) {
      props.onRestoreFocus(previousFocus);
    }
  });

  async function copyChecklist(): Promise<void> {
    const items = visibleItems();
    if (items.length === 0) return;
    const markdown = buildActionItemsMarkdown(items);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatus(
        `Copied ${items.length} Action ${items.length === 1 ? 'Item' : 'Items'}`,
      );
    } catch {
      setCopyStatus('Could not copy to the clipboard.');
    }
  }

  return (
    <Drawer
      open={props.open}
      side={props.side}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DrawerBackdrop data-print-hide="true" class="board-drawer-backdrop" />
      <DrawerContent
        ref={contentEl}
        finalFocus="none"
        data-board-overlay="true"
        data-print-hide="true"
        class="board-drawer-panel"
      >
        <BoardOverlayHeader
          closeLabel="Close Action Items"
          onClose={() => props.onClose()}
        >
          <div class="flex min-w-0 items-center gap-2">
            <LucideIcon icon={Flag} class="size-4 shrink-0 text-text-muted" />
            <DrawerTitle class="truncate">
              Action Items
            </DrawerTitle>
            <span class="shrink-0 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text tabular-nums">
              {openCount()} open
            </span>
          </div>
        </BoardOverlayHeader>

        <div class="border-b border-border px-4 py-2 sm:px-5">
          <ToggleGroup<ActionItemFilter>
            aria-label="Filter Action Items"
            value={selectedFilter()}
            deselectable={false}
            onValueChange={(next) => {
              if (next[0]) setFilter(next[0]);
            }}
            class="segmented-track relative grid w-full max-w-xs grid-cols-3 rounded-xl border border-border/75 p-1"
          >
            <span
              aria-hidden="true"
              class="segmented-thumb pointer-events-none absolute inset-y-1 left-1 rounded-lg"
              style={{ '--seg-count': String(FILTERS.length), '--seg-index': String(activeFilterIndex()) }}
            />
            <For each={FILTERS}>
              {(option) => (
                <Toggle
                  value={option.value}
                  class={[
                    'spring-press relative min-h-11 cursor-pointer whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-text-muted tabular-nums hover:text-text data-pressed:text-text sm:min-h-8 sm:text-[13px]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  ]}
                >
                  {option.label} ({counts[option.value]()})
                </Toggle>
              )}
            </For>
          </ToggleGroup>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <Show
            when={visibleItems().length > 0}
            fallback={
              <p class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
                {emptyMessage()}
              </p>
            }
          >
            <ul class="space-y-2.5">
              <For each={visibleItems()}>
                {(card) => (
                  <ActionItemRow
                    card={card}
                    columnTitle={columnTitles().get(card.columnId) ?? ''}
                    canEdit={canEditActionItems(props.board)}
                    onUpdate={props.onUpdateActionItem}
                  />
                )}
              </For>
            </ul>
          </Show>
        </div>

        <div class="space-y-2 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <button
            type="button"
            disabled={visibleItems().length === 0}
            onClick={() => void copyChecklist()}
            class={[
              'inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-contrast sm:min-h-9',
              'transition-opacity hover:opacity-90 active:opacity-75 disabled:cursor-not-allowed disabled:opacity-50',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            ]}
          >
            Copy as Markdown Checklist
          </button>
          <Show when={copyStatus()}>
            <p role="status" class="text-xs text-text-muted">
              {copyStatus()}
            </p>
          </Show>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
