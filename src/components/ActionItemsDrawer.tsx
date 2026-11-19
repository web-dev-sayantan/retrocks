import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  untrack,
} from 'solid-js';

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
import CardText from './CardText';
import { CloseIcon, FlagIcon } from './Icons';

const FILTERS: readonly { value: ActionItemFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
];

export interface ActionItemsDrawerProps {
  board: BoardViewDTO;
  open: boolean;
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
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  let saving = false;

  createEffect(
    () => props.card.actionOwner,
    (owner) => {
      setOwnerDraft(owner);
    },
  );

  async function update(patch: ActionItemPatch, failureMessage: string): Promise<boolean> {
    if (!props.canEdit || saving) return false;
    saving = true;
    setIsSaving(true);
    setError('');
    try {
      if (await props.onUpdate(props.card.id, patch)) return true;
    } catch {
      // Report rejected requests alongside unsuccessful mutation responses.
    } finally {
      saving = false;
      setIsSaving(false);
    }
    setError(failureMessage);
    return false;
  }

  async function saveOwner(value: string): Promise<void> {
    if (!props.canEdit || saving) return;
    const trimmed = value.trim();
    if (trimmed === props.card.actionOwner) {
      setOwnerDraft(trimmed);
      return;
    }
    if (await update({ actionOwner: trimmed }, 'Could not save the owner. Try again.')) {
      setOwnerDraft(trimmed);
    }
  }

  async function changeDone(checkbox: HTMLInputElement): Promise<void> {
    const ok = await update(
      { actionDone: checkbox.checked },
      'Could not update Done. Try again.',
    );
    if (!ok && checkbox.isConnected) checkbox.checked = props.card.actionDone;
  }

  return (
    <li class="rounded-lg border border-border bg-canvas/60 p-3">
      <div class="flex items-start gap-2.5">
        <label class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg has-disabled:cursor-not-allowed sm:size-6">
          <input
            type="checkbox"
            checked={props.card.actionDone}
            disabled={!props.canEdit || isSaving()}
            aria-label={`Mark ${props.card.content} as Done`}
            onChange={(event) => void changeDone(event.currentTarget)}
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
                if (event.isComposing || saving) return;
                const input = event.currentTarget;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveOwner(input.value);
                } else if (event.key === 'Escape' && input.value !== props.card.actionOwner) {
                  event.preventDefault();
                  event.stopPropagation();
                  input.value = props.card.actionOwner;
                  setOwnerDraft(input.value);
                  setError('');
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
          <Show when={error()}>
            <p role="alert" class="text-xs text-rose-700 dark:text-rose-300">{error()}</p>
          </Show>
        </div>
      </div>
    </li>
  );
}

export default function ActionItemsDrawer(props: ActionItemsDrawerProps) {
  const titleId = createUniqueId();
  let dialog!: HTMLDialogElement;
  let closeButton: HTMLButtonElement | undefined;
  let previousFocus: HTMLElement | null = null;
  let backdropPressed = false;
  const [hasOpened, setHasOpened] = createSignal(false);
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

  createEffect(() => props.open, (open) => {
    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setFilter('all');
      setCopyStatus('');
      setHasOpened(true);
      dialog.showModal();
      closeButton?.focus();
    } else if (dialog.open) {
      dialog.close();
      backdropPressed = false;
      if (props.onRestoreFocus) props.onRestoreFocus(previousFocus);
      else previousFocus?.focus({ preventScroll: true });
    }
  });

  createEffect(hasOpened, (opened) => {
    if (opened && dialog.open) closeButton?.focus();
  });

  function wrapTabFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const controls = dialog.querySelectorAll<HTMLElement>('button:enabled, input:enabled, a[href]');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

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
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      data-print-hide="true"
      class="action-items-dialog fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-text"
      onKeyDown={wrapTabFocus}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onPointerDown={(event) => {
        backdropPressed = event.target === dialog && event.button === 0;
      }}
      onClick={(event) => {
        if (backdropPressed && event.target === dialog) props.onClose();
        backdropPressed = false;
      }}
    >
      <Show when={hasOpened()}>
        <div
          class={[
            'action-items-panel absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-surface text-text shadow-xl',
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-lg sm:rounded-none sm:border-t-0 sm:border-l',
          ]}
        >
          <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <div class="flex min-w-0 items-center gap-2">
              <FlagIcon class="h-4 w-4 shrink-0 text-text-muted" />
              <h2 id={titleId} class="truncate text-sm font-semibold text-text">
                Action Items
              </h2>
              <span class="shrink-0 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text tabular-nums">
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
                'transition-colors hover:bg-surface-subtle hover:text-text active:bg-surface-subtle',
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
              class="inline-flex flex-wrap rounded-lg border border-border bg-canvas p-0.5"
            >
              <For each={FILTERS}>
                {(option) => (
                  <button
                    type="button"
                    aria-pressed={filter() === option.value ? 'true' : 'false'}
                    onClick={() => setFilter(option.value)}
                    class={[
                      'min-h-11 min-w-11 cursor-pointer rounded-md px-2 text-xs font-medium transition-colors active:bg-surface-subtle sm:min-h-9 sm:px-2.5',
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

          <div class="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
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
        </div>
      </Show>
    </dialog>
  );
}
