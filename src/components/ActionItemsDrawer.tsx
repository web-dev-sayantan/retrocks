import { usePrimitive } from '@ui-sdk/solid/primitive';
import { Flag } from 'lucide';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/solid/segmented-control';

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
import { createInlineEditSave, inlineEdit, type InlineEditOutcome } from '../lib/inline-edit';
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
  /** The keyed projection's Card list — identity-stable across mutations. */
  cards: readonly CardViewDTO[];
  open: boolean;
  side: 'bottom' | 'right';
  isLocked: boolean;
  onClose: () => void;
  onRestoreFocus?: (previousFocus: HTMLElement | null) => void;
  onUpdateActionItem: (
    cardId: string,
    patch: ActionItemPatch,
  ) => Promise<boolean>;
  /** Controller-owned in-flight Action Item patch for a Card (isPending). */
  isActionItemPending?: (cardId: string) => boolean;
}

function ActionItemRow(props: {
  card: CardViewDTO;
  columnTitle: string;
  canEdit: boolean;
  isPending: boolean;
  onUpdate: ActionItemsDrawerProps['onUpdateActionItem'];
}) {
  const [doneFailed, setDoneFailed] = createSignal(false);
  let ownerInputEl: HTMLInputElement | undefined;

  // The owner input edits in place: createInlineEdit owns the draft-and-save
  // contract, with the session starting on the first change so an untouched
  // Escape still reaches the drawer.
  const ownerField = usePrimitive(inlineEdit, () => ({
    value: () => props.card.actionOwner,
    commit: (text) => ownerSave.commit(text),
    disabled: () => !props.canEdit,
  }));
  const ownerEdit = ownerField.api.edit;
  const ownerSave = createInlineEditSave(saveOwnerText, () => ownerEdit.cancel());
  const ownerEditing = () => ownerField.present('input');
  const isSaving = () => ownerSave.isSaving() || props.isPending;

  function bindOwnerInput(el: HTMLInputElement): void {
    ownerInputEl = el;
  }

  async function update(patch: ActionItemPatch): Promise<boolean> {
    if (!props.canEdit) return false;
    try {
      return await props.onUpdate(props.card.id, patch);
    } catch {
      return false;
    }
  }

  async function saveOwnerText(text: string): Promise<InlineEditOutcome> {
    if (!props.canEdit || props.isPending) return false;
    const trimmed = text.trim();
    const ok = await update({ actionOwner: trimmed });
    if (ok && ownerInputEl) ownerInputEl.value = trimmed;
    return ok ? true : 'Could not save the owner. Try again.';
  }

  async function changeDone(checked: boolean): Promise<boolean> {
    if (props.isPending) return false;
    setDoneFailed(false);
    // A click on Done can start the owner save as the input loses focus.
    const ownerInFlight = ownerSave.saving();
    if (ownerInFlight) await ownerInFlight;
    const ok = await update({ actionDone: checked });
    if (!ok) setDoneFailed(true);
    return ok;
  }

  return (
    <li class="rounded-lg border border-border bg-canvas/60 p-3">
      <div class="flex items-start gap-2.5">
        <label class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg has-disabled:cursor-not-allowed sm:size-6">
          <input
            type="checkbox"
            checked={props.card.actionDone}
            disabled={!props.canEdit || props.isPending}
            aria-label={`Mark ${props.card.content} as Done`}
            onChange={async (event) => {
              const checkbox = event.currentTarget;
              if (!await changeDone(checkbox.checked) && checkbox.isConnected) {
                checkbox.checked = props.card.actionDone;
              }
            }}
            class="size-5 cursor-inherit rounded border-border accent-accent board-focus-ring disabled:opacity-50"
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
              ref={bindOwnerInput}
              type="text"
              aria-label={`Owner for ${props.card.content}`}
              placeholder="Owner (optional)"
              // Uncontrolled: seeded once per mounted row; typing and saves live in the DOM.
              defaultValue={props.card.actionOwner}
              maxlength={MAX_ACTION_OWNER_LENGTH}
              disabled={!props.canEdit}
              readonly={isSaving()}
              onInput={(event) => {
                if (!ownerEditing() && event.currentTarget.value !== props.card.actionOwner) {
                  ownerEdit.start(props.card.id, { reason: 'type', text: event.currentTarget.value });
                  ownerEdit.bindInput(event.currentTarget);
                }
              }}
              onKeyDown={(event) => {
                if (event.isComposing || isSaving()) return;
                const input = event.currentTarget;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  ownerEdit.end('enter-key', event);
                } else if (event.key === 'Escape') {
                  // Unchanged text lets the drawer's Escape close it.
                  if (input.value === props.card.actionOwner) return;
                  event.preventDefault();
                  event.stopPropagation();
                  ownerSave.resetError();
                  ownerEdit.cancel();
                  input.value = props.card.actionOwner;
                }
              }}
              onFocusOut={(event) => ownerEdit.end('focus-out', event)}
              class={[
                'min-h-11 w-40 max-w-full rounded-md border border-control bg-surface px-2 py-1 text-base text-text sm:min-h-9 sm:text-sm',
                'placeholder:text-text-muted focus:border-focus focus:outline-none read-only:opacity-50 disabled:opacity-50',
              ]}
            />
          </div>
          <Show when={isSaving()}>
            <p role="status" class="text-xs text-text-muted">Updating Action Item…</p>
          </Show>
          <Show when={ownerSave.error()}>
            {(error) => (
              <p role="alert" class="text-xs text-rose-700 dark:text-rose-300">{error()}</p>
            )}
          </Show>
          <Show when={doneFailed()}>
            <p role="alert" class="text-xs text-rose-700 dark:text-rose-300">Could not update Done. Try again.</p>
          </Show>
        </div>
      </div>
    </li>
  );
}

export default function ActionItemsDrawer(props: ActionItemsDrawerProps) {
  let previousFocus: HTMLElement | null = null;
  let contentEl: HTMLDivElement | undefined;
  const [filter, setFilter] = createSignal<ActionItemFilter>('all');
  const [copyStatus, setCopyStatus] = createSignal('');

  // While the drawer is open its layer outranks the paused page, so the
  // same "a" that opened it closes it here.
  useShortcut('a', () => props.onClose(), {
    layer: () => contentEl,
    description: 'Toggle Action Items',
  });

  // Plain accessors, not memos: each read re-derives from the projection's
  // identity-stable Cards, so no memo re-announces an equivalent array.
  const allItems = () => filterActionItems(props.cards, 'all');
  const visibleItems = () =>
    filter() === 'all' ? allItems() : filterActionItems(allItems(), filter());
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
          <SegmentedControl<ActionItemFilter>
            aria-label="Filter Action Items"
            value={filter()}
            onValueChange={(next) => {
              if (next) setFilter(next);
            }}
            class="segmented-track relative isolate grid w-full max-w-xs grid-cols-3 rounded-xl border border-border/75 p-1"
          >
            <SegmentedControlIndicator
              aria-hidden="true"
              class="segmented-thumb pointer-events-none rounded-lg"
            />
            <For each={FILTERS}>
              {(option) => (
                <SegmentedControlItem
                  value={option.value}
                  class={[
                    'spring-press relative board-touch-target cursor-pointer whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-text-muted tabular-nums hover:text-text data-checked:text-text sm:min-h-8 sm:text-[13px]',
                    'board-focus-ring',
                  ]}
                >
                  {option.label} ({counts[option.value]()})
                </SegmentedControlItem>
              )}
            </For>
          </SegmentedControl>
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
                    isPending={props.isActionItemPending?.(card.id) ?? false}
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
              'board-focus-ring',
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
