import { For, Show, createSignal, createStore } from 'solid-js';

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
import type { CreateBoardInput } from '../lib/schemas';
import {
  BOARD_TEMPLATES,
  COLUMN_ACCENT_STYLES,
  formatDefaultBoardTitle,
  getBoardTemplate,
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
  const [templateId, setTemplateId] =
    createSignal<BoardTemplateId>('standard');
  const [columns, setColumns] = createStore<EditableColumn[]>(
    columnsFromTemplate('standard'),
  );
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

  const handleSelectTemplate = (nextTemplateId: BoardTemplateId) => {
    setTemplateId(nextTemplateId);
    setColumns(() => columnsFromTemplate(nextTemplateId));
    if (nextTemplateId === 'custom') {
      setCustomizeOpen(true);
    }
    setErrorMessage(null);
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
    <form
      onSubmit={handleSubmit}
      class="rounded-2xl border border-border bg-surface p-5 shadow-xs sm:p-8"
      novalidate
    >
      <div class="flex flex-col gap-1">
        <p class="text-xs font-medium tracking-wide text-text-muted uppercase">
          Zero login · Privacy-first · Free
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-text sm:text-3xl">
          Create a retrospective Board in seconds
        </h1>
      </div>

      {/* Board metadata */}
      <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            for="board-title-input"
            class="block text-xs font-medium text-text-muted"
          >
            Board title <span class="font-normal">(optional)</span>
          </label>
          <input
            id="board-title-input"
            type="text"
            maxlength={120}
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder={defaultTitlePlaceholder}
            class={[
              'mt-1.5 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text',
              'placeholder:text-text-muted/70',
              'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
            ]}
          />
        </div>

        <div>
          <label
            for="board-subtitle-input"
            class="block text-xs font-medium text-text-muted"
          >
            Subtitle / context <span class="font-normal">(optional)</span>
          </label>
          <input
            id="board-subtitle-input"
            type="text"
            maxlength={240}
            value={subtitle()}
            onInput={(e) => setSubtitle(e.currentTarget.value)}
            placeholder="e.g., Sprint 42 · Checkout Team"
            class={[
              'mt-1.5 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text',
              'placeholder:text-text-muted/70',
              'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
            ]}
          />
        </div>
      </div>

      {/* Curated Templates with visual mini-Column previews */}
      <div class="mt-6">
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs font-medium text-text-muted">
            Choose a template
          </span>
          <button
            type="button"
            aria-expanded={
              customizeOpen() || templateId() === 'custom' ? 'true' : 'false'
            }
            onClick={() => setCustomizeOpen((prev) => !prev)}
            class={[
              'cursor-pointer text-xs font-medium text-text-muted underline-offset-4 hover:text-text hover:underline',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            ]}
          >
            {customizeOpen() || templateId() === 'custom'
              ? 'Hide Column editor'
              : `Customize Columns (${columns.length})`}
          </button>
        </div>

        <div class="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <For each={BOARD_TEMPLATES}>
            {(template) => (
              <button
                type="button"
                aria-pressed={templateId() === template.id ? 'true' : 'false'}
                onClick={() => handleSelectTemplate(template.id)}
                class={[
                  'flex cursor-pointer flex-col rounded-xl border p-3.5 text-left transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  {
                    'border-focus bg-surface-subtle/70 ring-1 ring-focus/30':
                      templateId() === template.id,
                    'border-border bg-surface hover:border-text-muted/50 hover:bg-surface-subtle/40':
                      templateId() !== template.id,
                  },
                ]}
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-medium text-text">
                    {template.name}
                  </span>
                  <span class="text-[11px] text-text-muted tabular-nums">
                    {template.id === 'custom'
                      ? '1–10 cols'
                      : `${template.columns.length} cols`}
                  </span>
                </div>
                <p class="mt-1 line-clamp-1 text-xs text-text-muted">
                  {template.description}
                </p>

                {/* Visual mini-Column preview */}
                <div
                  class="mt-3 grid gap-1.5"
                  style={{
                    'grid-template-columns': `repeat(${Math.min(template.columns.length, 6)}, minmax(0, 1fr))`,
                  }}
                >
                  <For each={template.columns}>
                    {(col) => (
                      <div class="overflow-hidden rounded-md border border-border/80 bg-canvas">
                        <div
                          class={[
                            'h-[3px] w-full',
                            COLUMN_ACCENT_STYLES[col.accent].bar,
                          ]}
                        />
                        <div
                          class={[
                            'px-1.5 py-1',
                            COLUMN_ACCENT_STYLES[col.accent].tint,
                          ]}
                        >
                          <p class="truncate text-[10px] font-medium text-text">
                            {col.title}
                          </p>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Editable Columns (always shown for Custom Board or when expanded) */}
      <Show when={customizeOpen() || templateId() === 'custom'}>
        <div class="mt-5 rounded-xl border border-border bg-canvas p-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-xs font-semibold tracking-wide text-text uppercase">
                Columns ({columns.length} / 10)
              </h2>
              <p class="mt-0.5 text-xs text-text-muted">
                Edit titles, pick pastel accents, or drag to reorder.
              </p>
            </div>
            <button
              type="button"
              disabled={columns.length >= 10}
              onClick={handleAddColumn}
              class={[
                'inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text transition-colors',
                'hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              ]}
            >
              + Add Column
            </button>
          </div>

          <ul class="mt-3 space-y-2">
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
                  class="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2.5"
                >
                  <span
                    aria-hidden="true"
                    class={[
                      'h-6 w-1.5 shrink-0 rounded-full',
                      COLUMN_ACCENT_STYLES[col.accent].bar,
                    ]}
                  />
                  <input
                    type="text"
                    data-column-title-input="true"
                    aria-label={`Column ${index() + 1} title`}
                    maxlength={60}
                    value={col.title}
                    onInput={(e) =>
                      handleRenameColumn(index(), e.currentTarget.value)
                    }
                    class={[
                      'min-w-[140px] flex-1 rounded-md border border-border bg-canvas px-2.5 py-1.5 text-sm text-text',
                      'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
                    ]}
                  />

                  {/* Pastel accent swatches */}
                  <div
                    class="flex items-center gap-1"
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
                            'h-5 w-5 cursor-pointer rounded-full transition-transform',
                            COLUMN_ACCENT_STYLES[accent].swatch,
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                            {
                              'scale-110 ring-2 ring-text ring-offset-2 ring-offset-surface':
                                col.accent === accent,
                              'opacity-70 hover:opacity-100':
                                col.accent !== accent,
                            },
                          ]}
                        />
                      )}
                    </For>
                  </div>

                  {/* Action column flag */}
                  <button
                    type="button"
                    aria-pressed={col.isActionColumn ? 'true' : 'false'}
                    onClick={() => handleToggleActionColumn(index())}
                    title="Auto-flag new Cards in this Column as Action Items"
                    class={[
                      'cursor-pointer rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                      {
                        'border-focus bg-surface-subtle text-text':
                          col.isActionColumn,
                        'border-border bg-canvas text-text-muted hover:text-text':
                          !col.isActionColumn,
                      },
                    ]}
                  >
                    Action Column
                  </button>

                  {/* Reorder & Remove controls */}
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={index() === 0}
                      onClick={() => handleMoveColumn(index(), index() - 1)}
                      aria-label={`Move Column ${index() + 1} up`}
                      class={[
                        'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border text-xs text-text-muted',
                        'hover:bg-surface-subtle hover:text-text disabled:cursor-not-allowed disabled:opacity-35',
                      ]}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index() === columns.length - 1}
                      onClick={() => handleMoveColumn(index(), index() + 1)}
                      aria-label={`Move Column ${index() + 1} down`}
                      class={[
                        'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border text-xs text-text-muted',
                        'hover:bg-surface-subtle hover:text-text disabled:cursor-not-allowed disabled:opacity-35',
                      ]}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={columns.length <= 1}
                      onClick={() => handleRemoveColumn(index())}
                      aria-label={`Remove Column ${index() + 1}`}
                      class={[
                        'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border text-xs text-text-muted',
                        'hover:bg-surface-subtle hover:text-text disabled:cursor-not-allowed disabled:opacity-35',
                      ]}
                    >
                      ×
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      {/* Collapsible Advanced Options */}
      <div class="mt-5 border-t border-border pt-4">
        <button
          type="button"
          aria-expanded={advancedOpen() ? 'true' : 'false'}
          onClick={() => setAdvancedOpen((prev) => !prev)}
          class={[
            'flex w-full cursor-pointer items-center justify-between text-left text-xs font-medium text-text-muted transition-colors hover:text-text',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          ]}
        >
          <span>Advanced options</span>
          <span class="tabular-nums">
            {voteLimit() === null ? 'Unlimited votes' : `${voteLimit()} votes`} ·{' '}
            {isBlurred() ? 'Private Mode on' : 'Private Mode off'} ·{' '}
            {retentionDays()}d expiry
          </span>
        </button>

        <Show when={advancedOpen()}>
          <div class="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-border bg-canvas p-4 sm:grid-cols-2">
            {/* Votes per Participant */}
            <div>
              <span class="block text-xs font-medium text-text">
                Votes per Participant
              </span>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <For each={VOTE_LIMIT_OPTIONS}>
                  {(opt) => (
                    <button
                      type="button"
                      aria-pressed={voteLimit() === opt ? 'true' : 'false'}
                      onClick={() => setVoteLimit(opt)}
                      class={[
                        'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        {
                          'border-accent bg-accent text-accent-contrast':
                            voteLimit() === opt,
                          'border-border bg-surface text-text-muted hover:text-text':
                            voteLimit() !== opt,
                        },
                      ]}
                    >
                      {opt === null ? 'Unlimited' : String(opt)}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Max Votes per Card or Card Group */}
            <div>
              <span class="block text-xs font-medium text-text">
                Max Votes per Card or Card Group
              </span>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  aria-pressed={maxVotesPerCard() === null ? 'true' : 'false'}
                  onClick={() => setMaxVotesPerCard(null)}
                  class={[
                    'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    {
                      'border-accent bg-accent text-accent-contrast':
                        maxVotesPerCard() === null,
                      'border-border bg-surface text-text-muted hover:text-text':
                        maxVotesPerCard() !== null,
                    },
                  ]}
                >
                  Unlimited (stackable)
                </button>
                <button
                  type="button"
                  aria-pressed={maxVotesPerCard() === 1 ? 'true' : 'false'}
                  onClick={() => setMaxVotesPerCard(1)}
                  class={[
                    'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    {
                      'border-accent bg-accent text-accent-contrast':
                        maxVotesPerCard() === 1,
                      'border-border bg-surface text-text-muted hover:text-text':
                        maxVotesPerCard() !== 1,
                    },
                  ]}
                >
                  1 per Card or Card Group
                </button>
              </div>
            </div>

            {/* Start in Private Mode */}
            <div>
              <span class="block text-xs font-medium text-text">
                Start in Private Mode
              </span>
              <div class="mt-2 flex gap-1.5">
                <button
                  type="button"
                  aria-pressed={!isBlurred() ? 'true' : 'false'}
                  onClick={() => setIsBlurred(false)}
                  class={[
                    'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    {
                      'border-accent bg-accent text-accent-contrast':
                        !isBlurred(),
                      'border-border bg-surface text-text-muted hover:text-text':
                        isBlurred(),
                    },
                  ]}
                >
                  Off
                </button>
                <button
                  type="button"
                  aria-pressed={isBlurred() ? 'true' : 'false'}
                  onClick={() => setIsBlurred(true)}
                  class={[
                    'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    {
                      'border-accent bg-accent text-accent-contrast':
                        isBlurred(),
                      'border-border bg-surface text-text-muted hover:text-text':
                        !isBlurred(),
                    },
                  ]}
                >
                  On
                </button>
              </div>
            </div>

            {/* Auto-expiry on inactivity */}
            <div>
              <span class="block text-xs font-medium text-text">
                Auto-expiry on inactivity
              </span>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <For each={RETENTION_DAYS_OPTIONS}>
                  {(days) => (
                    <button
                      type="button"
                      aria-pressed={retentionDays() === days ? 'true' : 'false'}
                      onClick={() => setRetentionDays(days)}
                      class={[
                        'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        {
                          'border-accent bg-accent text-accent-contrast':
                            retentionDays() === days,
                          'border-border bg-surface text-text-muted hover:text-text':
                            retentionDays() !== days,
                        },
                      ]}
                    >
                      {days} days
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>
      </div>

      {/* Inline error feedback */}
      <Show when={errorMessage()}>
        {(msg) => (
          <p
            role="alert"
            class="mt-4 rounded-lg border border-col-rose/40 bg-col-rose-tint px-3.5 py-2.5 text-sm text-text"
          >
            {msg()}
          </p>
        )}
      </Show>

      {/* Primary CTA */}
      <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-text-muted">
          Share the link right away — no signup required for Participants.
        </p>
        <button
          type="submit"
          disabled={submitting()}
          class={[
            'inline-flex cursor-pointer items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-contrast',
            'transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          ]}
        >
          {submitting() ? 'Creating Board…' : 'Create Board'}
        </button>
      </div>
    </form>
  );
}
