import { For, Show, createMemo, createSignal, createStore } from 'solid-js';

import { createBoard } from '../lib/board-actions';
import {
  COLUMN_ACCENTS,
  RETENTION_DAYS_OPTIONS,
  VOTE_LIMIT_OPTIONS,
  type ActionError,
  type BoardTemplateId,
  type ColumnAccent,
  type MaxVotesPerCardOption,
  type RetentionDaysOption,
  type VoteLimitOption,
} from '../lib/board-types';
import { matchHiddenTemplate } from '../lib/easter-eggs';
import type { CreateBoardInput } from '../lib/schemas';
import {
  BOARD_TEMPLATES,
  COLUMN_ACCENT_STYLES,
  formatDefaultBoardTitle,
  getBoardTemplate,
  type TemplateColumnDef,
} from '../lib/templates';

interface EditableColumn {
  localId: string;
  title: string;
  accent: ColumnAccent;
  isActionColumn: boolean;
}

export interface BoardCreatorProps {
  onSubmit?: (input: CreateBoardInput) => Promise<ActionError | void>;
}

const focusClass = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const inputClass = `min-h-11 w-full rounded-lg border border-control bg-surface px-3 py-2 text-base text-text placeholder:text-text-muted ${focusClass}`;

const optionClass = (selected: boolean) => [
  'min-h-11 min-w-11 cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium transition-colors active:bg-surface-subtle active:text-text',
  focusClass,
  selected
    ? 'border-accent bg-accent text-accent-contrast'
    : 'border-control bg-surface text-text hover:bg-surface-subtle',
];
const columnCommandClass = `inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-control bg-surface text-base text-text hover:bg-surface-subtle active:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40 ${focusClass}`;

function ColumnPreview(props: { columns: readonly TemplateColumnDef[]; id?: string }) {
  return (
    <span id={props.id} class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-text-muted">
      <For each={props.columns}>
        {(column) => (
          <span class="flex min-w-0 items-baseline gap-2">
            <span
              aria-hidden="true"
              class={['relative -top-0.5 size-2 shrink-0 rounded-full', COLUMN_ACCENT_STYLES[column.accent].bar]}
            />
            <span class="min-w-0 [overflow-wrap:anywhere]">{column.title || 'Untitled Column'}</span>
          </span>
        )}
      </For>
    </span>
  );
}

function DisclosureButton(props: {
  panelId: string;
  label: string;
  open: boolean;
  onClick: () => void;
  buttonRef?: (button: HTMLButtonElement) => void;
}) {
  return (
    <button
      ref={props.buttonRef}
      type="button"
      aria-expanded={props.open ? 'true' : 'false'}
      aria-controls={props.open ? props.panelId : undefined}
      onClick={() => props.onClick()}
      class={`group flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-base font-medium text-text transition-colors hover:bg-surface-subtle active:bg-surface-subtle ${focusClass}`}
    >
      {props.label}
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-4 shrink-0 group-aria-expanded:rotate-180"
      >
        <path d="m4 6 4 4 4-4" />
      </svg>
    </button>
  );
}

let columnKeyCounter = 0;
function nextColumnLocalId(): string {
  columnKeyCounter += 1;
  return `draft_col_${columnKeyCounter}`;
}

function columnsFromTemplate(templateId: BoardTemplateId): EditableColumn[] {
  const template = getBoardTemplate(templateId);
  return template.columns.map((col) => ({
    localId: nextColumnLocalId(),
    title: col.title,
    accent: col.accent,
    isActionColumn: Boolean(col.isActionColumn),
  }));
}

export default function BoardCreator(props: BoardCreatorProps) {
  const defaultTitlePlaceholder = formatDefaultBoardTitle();

  const [title, setTitle] = createSignal('');
  const [subtitle, setSubtitle] = createSignal('');
  const hiddenTemplate = createMemo(() => matchHiddenTemplate(title()));
  const [templateId, setTemplateId] =
    createSignal<BoardTemplateId>('standard');
  const [columns, setColumns] = createStore<EditableColumn[]>(
    columnsFromTemplate('standard'),
  );
  const [templatesOpen, setTemplatesOpen] = createSignal(false);
  const [customizeOpen, setCustomizeOpen] = createSignal(false);
  const [advancedOpen, setAdvancedOpen] = createSignal(false);

  const [voteLimit, setVoteLimit] = createSignal<VoteLimitOption>(5);
  const [maxVotesPerCard, setMaxVotesPerCard] =
    createSignal<MaxVotesPerCardOption>(null);
  const [isBlurred, setIsBlurred] = createSignal(false);
  const [retentionDays, setRetentionDays] =
    createSignal<RetentionDaysOption>(90);

  const [submitting, setSubmitting] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [dragIndex, setDragIndex] = createSignal<number | null>(null);

  let templateToggle: HTMLButtonElement;
  let customizeToggle: HTMLButtonElement;

  const handleSelectTemplate = (nextTemplateId: BoardTemplateId) => {
    if (nextTemplateId !== templateId()) {
      setTemplateId(nextTemplateId);
      setColumns(() => columnsFromTemplate(nextTemplateId));
      setErrorMessage(null);
    }
    setTemplatesOpen(false);
    if (nextTemplateId === 'custom') {
      setCustomizeOpen(true);
      customizeToggle.focus();
    } else {
      templateToggle.focus();
    }
  };

  const handleAddColumn = () => {
    if (columns.length >= 10) return;
    const nextAccent = COLUMN_ACCENTS[columns.length % COLUMN_ACCENTS.length];
    const nextNumber = columns.length + 1;
    setColumns((draft) => {
      draft.push({
        localId: nextColumnLocalId(),
        title: `Column ${nextNumber}`,
        accent: nextAccent,
        isActionColumn: false,
      });
    });
  };

  const handleRemoveColumn = (index: number) => {
    if (columns.length <= 1) return;
    setColumns((draft) => {
      draft.splice(index, 1);
    });
  };

  const handleMoveColumn = (fromIndex: number, toIndex: number) => {
    if (
      toIndex < 0 ||
      toIndex >= columns.length ||
      fromIndex === toIndex ||
      fromIndex < 0
    ) {
      return;
    }
    setColumns((draft) => {
      const [moved] = draft.splice(fromIndex, 1);
      draft.splice(toIndex, 0, moved);
    });
  };

  const handleRenameColumn = (index: number, nextTitle: string) => {
    setColumns((draft) => {
      if (draft[index]) {
        draft[index].title = nextTitle;
      }
    });
  };

  const handleColumnAccent = (index: number, nextAccent: ColumnAccent) => {
    setColumns((draft) => {
      if (draft[index]) {
        draft[index].accent = nextAccent;
      }
    });
  };

  const handleToggleActionColumn = (index: number) => {
    setColumns((draft) => {
      if (draft[index]) {
        draft[index].isActionColumn = !draft[index].isActionColumn;
      }
    });
  };

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (submitting()) return;

    const trimmedColumns = columns.map((col) => ({
      title: col.title.trim(),
      accent: col.accent,
      isActionColumn: col.isActionColumn,
    }));

    if (trimmedColumns.some((col) => col.title.length === 0)) {
      setErrorMessage('Every Column must have a title.');
      return;
    }

    setErrorMessage(null);
    setSubmitting(true);

    const payload: CreateBoardInput = {
      title: title().trim(),
      subtitle: subtitle().trim(),
      templateId: templateId(),
      columns: trimmedColumns,
      voteLimit: voteLimit(),
      maxVotesPerCard: maxVotesPerCard(),
      isBlurred: isBlurred(),
      retentionDays: retentionDays(),
    };

    try {
      const submitFn = props.onSubmit ?? createBoard;
      const result = await submitFn(payload);
      if (result && result.ok === false) {
        setErrorMessage(result.message);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not create the Board. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form class="min-w-0" onSubmit={handleSubmit} novalidate>
      <h1 class="text-3xl font-semibold tracking-tight text-text sm:text-4xl">
        Create a board
      </h1>

      <div class="mt-5 grid gap-2">
        <label for="board-title-input" class="text-base font-medium text-text">
          Board title <span class="font-normal text-text-muted">(optional)</span>
        </label>
        <input
          id="board-title-input"
          type="text"
          maxlength={120}
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
          placeholder={defaultTitlePlaceholder}
          class={inputClass}
        />
        <Show when={hiddenTemplate()}>
          {(template) => <span class="text-sm text-text-muted">Try {template().name}</span>}
        </Show>
      </div>

      <div class="mt-4">
        <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border border-border bg-surface px-3 py-2">
          <h2 class="text-base font-semibold text-text [overflow-wrap:anywhere]">
            {getBoardTemplate(templateId()).name}
          </h2>
          <button
            ref={(element) => { templateToggle = element; }}
            type="button"
            aria-label="Change template"
            aria-expanded={templatesOpen() ? 'true' : 'false'}
            aria-controls={templatesOpen() ? 'board-templates' : undefined}
            onClick={() => setTemplatesOpen((open) => !open)}
            class={[
              'min-h-11 min-w-11 cursor-pointer rounded-lg px-2 py-2 text-sm font-medium text-text-muted',
              'hover:bg-surface-subtle hover:text-text active:bg-surface-subtle aria-expanded:bg-surface-subtle aria-expanded:text-text',
              'sm:col-start-2 sm:row-span-2 sm:row-start-1',
              focusClass,
            ]}
          >
            Change
          </button>
          <div class="col-span-2 pb-1 sm:col-span-1 sm:col-start-1 sm:row-start-2">
            <ColumnPreview columns={columns} />
          </div>
        </div>
        <Show when={templatesOpen()}>
          <div id="board-templates" class="mt-2 grid gap-2 sm:grid-cols-2">
            <For each={BOARD_TEMPLATES}>
              {(template) => (
                <button
                  type="button"
                  aria-label={template.name}
                  aria-pressed={templateId() === template.id ? 'true' : 'false'}
                  aria-describedby={`template-${template.id}-columns`}
                  onClick={() => handleSelectTemplate(template.id)}
                  class={[
                    'min-h-11 min-w-0 cursor-pointer space-y-2 rounded-xl border p-3 text-left transition-colors hover:bg-surface-subtle active:bg-surface-subtle',
                    focusClass,
                    templateId() === template.id
                      ? 'border-accent bg-surface-subtle'
                      : 'border-control bg-surface',
                  ]}
                >
                  <span class="block text-base font-semibold text-text">{template.name}</span>
                  <ColumnPreview id={`template-${template.id}-columns`} columns={template.columns} />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show when={errorMessage()}>
        {(msg) => (
          <p
            role="alert"
            class="mt-4 rounded-lg border border-col-rose bg-col-rose-tint px-3 py-2 text-base text-text"
          >
            {msg()}
          </p>
        )}
      </Show>
      <button
        type="submit"
        disabled={submitting()}
        class={[
          'mt-4 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-accent px-5 py-2 text-base font-semibold text-accent-contrast sm:w-auto',
          'transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60',
          focusClass,
        ]}
      >
        {submitting() ? 'Creating board…' : 'Create board'}
      </button>

      <div class="mt-5 space-y-1">
        <DisclosureButton
          panelId="board-customize"
          label="Customize board"
          open={customizeOpen()}
          onClick={() => setCustomizeOpen((open) => !open)}
          buttonRef={(element) => { customizeToggle = element; }}
        />
        <Show when={customizeOpen()}>
          <div id="board-customize" class="space-y-4 px-2 py-3">
            <div class="grid gap-2">
              <label for="board-subtitle-input" class="text-base font-medium text-text">
                Subtitle / context <span class="font-normal text-text-muted">(optional)</span>
              </label>
              <input
                id="board-subtitle-input"
                type="text"
                maxlength={240}
                value={subtitle()}
                onInput={(e) => setSubtitle(e.currentTarget.value)}
                placeholder="e.g., Sprint 42 · Checkout Team"
                class={inputClass}
              />
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-base font-semibold text-text">
                Columns <span class="font-normal text-text-muted tabular-nums">({columns.length} / 10)</span>
              </h2>
              <button
                type="button"
                disabled={columns.length >= 10}
                onClick={handleAddColumn}
                class={`min-h-11 cursor-pointer rounded-lg border border-control bg-surface px-3 py-2 text-sm font-medium text-text hover:bg-surface-subtle active:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40 ${focusClass}`}
              >
                Add Column
              </button>
            </div>

            <ul class="space-y-2" role="list">
              <For each={columns}>
                {(col, index) => (
                  <li
                    draggable="true"
                    onDragStart={() => setDragIndex(index())}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      const from = dragIndex();
                      if (from !== null) {
                        handleMoveColumn(from, index());
                      }
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    class="space-y-3 rounded-xl border border-border bg-surface p-3"
                  >
                    <div class="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        class={['h-6 w-1 shrink-0 rounded-full', COLUMN_ACCENT_STYLES[col.accent].bar]}
                      />
                      <input
                        type="text"
                        aria-label={`Column ${index() + 1} title`}
                        maxlength={60}
                        value={col.title}
                        onInput={(e) =>
                          handleRenameColumn(index(), e.currentTarget.value)
                        }
                        class={`min-w-0 ${inputClass}`}
                      />
                    </div>

                    <div
                      class="flex flex-wrap gap-1"
                      role="group"
                      aria-label={`Column ${index() + 1} accent color`}
                    >
                      <For each={COLUMN_ACCENTS}>
                        {(accent) => (
                          <button
                            type="button"
                            onClick={() => handleColumnAccent(index(), accent)}
                            aria-label={`${COLUMN_ACCENT_STYLES[accent].label} accent`}
                            aria-pressed={col.accent === accent ? 'true' : 'false'}
                            class={[
                              'inline-grid size-11 cursor-pointer place-items-center rounded-lg border border-transparent hover:bg-surface-subtle active:bg-surface-subtle',
                              focusClass,
                              { 'border-control bg-surface-subtle': col.accent === accent },
                            ]}
                          >
                            <span
                              aria-hidden="true"
                              class={[
                                'size-5 rounded-full',
                                COLUMN_ACCENT_STYLES[accent].swatch,
                                { 'ring-2 ring-text ring-offset-2 ring-offset-surface': col.accent === accent },
                              ]}
                            />
                          </button>
                        )}
                      </For>
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        aria-pressed={col.isActionColumn ? 'true' : 'false'}
                        onClick={() => handleToggleActionColumn(index())}
                        title="Auto-flag new Cards in this Column as Action Items"
                        class={optionClass(col.isActionColumn)}
                      >
                        Action Column
                      </button>

                      <div class="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={index() === 0}
                          onClick={() => handleMoveColumn(index(), index() - 1)}
                          aria-label={`Move Column ${index() + 1} up`}
                          class={columnCommandClass}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index() === columns.length - 1}
                          onClick={() => handleMoveColumn(index(), index() + 1)}
                          aria-label={`Move Column ${index() + 1} down`}
                          class={columnCommandClass}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={columns.length <= 1}
                          onClick={() => handleRemoveColumn(index())}
                          aria-label={`Remove Column ${index() + 1}`}
                          class={columnCommandClass}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </div>

      <div class="mt-1 space-y-1 border-t border-border pt-1">
        <DisclosureButton
          panelId="board-advanced"
          label="Advanced options"
          open={advancedOpen()}
          onClick={() => setAdvancedOpen((open) => !open)}
        />

        <Show when={advancedOpen()}>
          <div id="board-advanced" class="grid gap-4 px-2 py-3 sm:grid-cols-2">
            <fieldset class="min-w-0">
              <legend class="text-base font-medium text-text">Votes per Participant</legend>
              <div class="mt-2 flex flex-wrap gap-1">
                <For each={VOTE_LIMIT_OPTIONS}>
                  {(opt) => (
                    <button
                      type="button"
                      aria-pressed={voteLimit() === opt ? 'true' : 'false'}
                      onClick={() => setVoteLimit(opt)}
                      class={optionClass(voteLimit() === opt)}
                    >
                      {opt === null ? 'Unlimited' : String(opt)}
                    </button>
                  )}
                </For>
              </div>
            </fieldset>

            <fieldset class="min-w-0">
              <legend class="text-base font-medium text-text">Max Votes per Card or Card Group</legend>
              <div class="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  aria-pressed={maxVotesPerCard() === null ? 'true' : 'false'}
                  onClick={() => setMaxVotesPerCard(null)}
                  class={optionClass(maxVotesPerCard() === null)}
                >
                  Unlimited (stackable)
                </button>
                <button
                  type="button"
                  aria-pressed={maxVotesPerCard() === 1 ? 'true' : 'false'}
                  onClick={() => setMaxVotesPerCard(1)}
                  class={optionClass(maxVotesPerCard() === 1)}
                >
                  1 per Card or Card Group
                </button>
              </div>
            </fieldset>

            <fieldset class="min-w-0">
              <legend class="text-base font-medium text-text">Start in Private Mode</legend>
              <div class="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  aria-pressed={!isBlurred() ? 'true' : 'false'}
                  onClick={() => setIsBlurred(false)}
                  class={optionClass(!isBlurred())}
                >
                  Off
                </button>
                <button
                  type="button"
                  aria-pressed={isBlurred() ? 'true' : 'false'}
                  onClick={() => setIsBlurred(true)}
                  class={optionClass(isBlurred())}
                >
                  On
                </button>
              </div>
            </fieldset>

            <fieldset class="min-w-0">
              <legend class="text-base font-medium text-text">Auto-expiry on inactivity</legend>
              <div class="mt-2 flex flex-wrap gap-1">
                <For each={RETENTION_DAYS_OPTIONS}>
                  {(days) => (
                    <button
                      type="button"
                      aria-pressed={retentionDays() === days ? 'true' : 'false'}
                      onClick={() => setRetentionDays(days)}
                      class={optionClass(retentionDays() === days)}
                    >
                      {days} days
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
          </div>
        </Show>
      </div>

    </form>
  );
}
