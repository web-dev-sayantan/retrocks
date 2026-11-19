import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onSettled,
  untrack,
} from 'solid-js';

import {
  buildActionItemsMarkdown,
  filterActionItems,
  type ActionItemFilter,
} from '../lib/action-items';
import {
  MAX_ACTION_OWNER_LENGTH,
  type BoardViewDTO,
  type CardViewDTO,
} from '../lib/board-types';
import CardText from './CardText';
import { CloseIcon, FlagIcon } from './Icons';

const FILTERS: readonly { value: ActionItemFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
];

export interface ActionItemsDrawerProps {
  board: BoardViewDTO;
  isLocked: boolean;
  onClose: () => void;
  onUpdateActionItem: (
    cardId: string,
    patch: { isActionItem?: boolean; actionDone?: boolean; actionOwner?: string },
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
  const [isSaving, setIsSaving] = createSignal(false);

  createEffect(
    () => props.card.actionOwner,
    (owner) => {
      setOwnerDraft(owner);
    },
  );

  async function saveOwner(): Promise<void> {
    if (!props.canEdit || isSaving()) return;
    const trimmed = ownerDraft().trim();
    if (trimmed === props.card.actionOwner) {
      setOwnerDraft(props.card.actionOwner);
      return;
    }
    setIsSaving(true);
    try {
      const ok = await props.onUpdate(props.card.id, { actionOwner: trimmed });
      setOwnerDraft(ok ? trimmed : props.card.actionOwner);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <li class="rounded-lg border border-border bg-canvas/60 p-3">
      <div class="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={props.card.actionDone}
          disabled={!props.canEdit}
          aria-label={`Mark ${props.card.content} as Done`}
          onChange={(event) =>
            void props.onUpdate(props.card.id, {
              actionDone: event.currentTarget.checked,
            })
          }
          class="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-accent disabled:cursor-not-allowed disabled:opacity-50"
        />
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
              disabled={!props.canEdit || isSaving()}
              onInput={(event) => setOwnerDraft(event.currentTarget.value)}
              onBlur={() => void saveOwner()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveOwner();
                } else if (event.key === 'Escape') {
                  setOwnerDraft(props.card.actionOwner);
                }
              }}
              class={[
                'min-h-9 w-40 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text',
                'placeholder:text-text-muted focus:border-focus focus:outline-none disabled:opacity-50',
              ]}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

export default function ActionItemsDrawer(props: ActionItemsDrawerProps) {
  const titleId = createUniqueId();
  let closeButton: HTMLButtonElement | undefined;
  const [filter, setFilter] = createSignal<ActionItemFilter>('all');
  const [copyStatus, setCopyStatus] = createSignal('');

  const allItems = createMemo(() => filterActionItems(props.board.cards, 'all'));
  const visibleItems = createMemo(() =>
    filterActionItems(props.board.cards, filter()),
  );
  const openCount = createMemo(
    () => allItems().filter((card) => !card.actionDone).length,
  );
  const counts = createMemo(() => ({
    all: allItems().length,
    open: openCount(),
    done: allItems().length - openCount(),
  }));
  const columnTitles = createMemo(
    () => new Map(props.board.columns.map((column) => [column.id, column.title])),
  );
  const canEditActionItems = createMemo(
    () => !props.isLocked || props.board.isFacilitator,
  );
  const emptyMessage = createMemo(() => {
    const current = filter();
    if (current === 'open') return 'No open Action Items.';
    if (current === 'done') return 'No completed Action Items.';
    return 'No Action Items yet.';
  });

  onSettled(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButton?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
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
    <div class="fixed inset-0 z-40">
      <div
        aria-hidden="true"
        onClick={() => props.onClose()}
        class="fixed inset-0 bg-black/40 backdrop-blur-[1px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-board-overlay="true"
        class={[
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-surface text-text shadow-xl',
          'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-lg sm:rounded-none sm:border-t-0 sm:border-l',
        ]}
      >
        <div class="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <div class="h-1 w-10 rounded-full bg-border" />
        </div>

        <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div class="flex min-w-0 items-center gap-2">
            <FlagIcon class="h-4 w-4 shrink-0 text-text-muted" />
            <h2 id={titleId} class="truncate text-sm font-semibold text-text">
              Action Items
            </h2>
            <span class="shrink-0 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text-muted tabular-nums">
              {openCount()} open
            </span>
          </div>
          <button
            ref={closeButton}
            type="button"
            aria-label="Close Action Items"
            onClick={() => props.onClose()}
            class={[
              'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-text-muted sm:min-h-8 sm:min-w-8',
              'transition-colors hover:bg-surface-subtle hover:text-text',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            ]}
          >
            <CloseIcon />
          </button>
        </div>

        <div class="border-b border-border px-4 py-2 sm:px-5">
          <div
            role="group"
            aria-label="Filter Action Items"
            class="inline-flex rounded-lg border border-border bg-canvas p-0.5"
          >
            <For each={FILTERS}>
              {(option) => (
                <button
                  type="button"
                  aria-pressed={filter() === option.value ? 'true' : 'false'}
                  onClick={() => setFilter(option.value)}
                  class={[
                    'min-h-9 cursor-pointer rounded-md px-2.5 text-xs font-medium transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    filter() === option.value
                      ? 'bg-surface text-text shadow-2xs'
                      : 'text-text-muted hover:text-text',
                  ]}
                >
                  {option.label} ({counts()[option.value]})
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
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
                    canEdit={canEditActionItems()}
                    onUpdate={props.onUpdateActionItem}
                  />
                )}
              </For>
            </ul>
          </Show>
        </div>

        <div class="space-y-2 border-t border-border bg-surface px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={visibleItems().length === 0}
            onClick={() => void copyChecklist()}
            class={[
              'inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-contrast sm:min-h-9',
              'transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
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
      </div>
    </div>
  );
}
