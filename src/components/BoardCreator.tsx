import type { JSX } from '@solidjs/web';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@ui-sdk/solid/collapsible';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/solid/segmented-control';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  EyeOff,
  Flag,
  GripVertical,
  Layers,
  LayoutGrid,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Vote,
  X,
  type IconNode,
} from 'lucide';
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
import { matchHiddenTemplate, type HiddenTemplate, type HiddenTemplateId } from '../lib/easter-eggs';
import type { CreateBoardInput } from '../lib/schemas';
import {
  BOARD_TEMPLATES,
  COLUMN_ACCENT_STYLES,
  formatDefaultBoardTitle,
  getBoardTemplate,
  type TemplateColumnDef,
} from '../lib/templates';
import LucideIcon from './LucideIcon';

interface EditableColumn {
  localId: string;
  title: string;
  accent: ColumnAccent;
  isActionColumn: boolean;
}

export interface BoardCreatorProps {
  onSubmit?: (input: CreateBoardInput) => Promise<ActionError | void>;
  secondary?: JSX.Element;
}

const focusClass = 'board-focus-ring';
const inputClass = `h-11 w-full rounded-xl border border-control/75 bg-surface px-3.5 text-base text-text placeholder:text-text-muted/80 transition-colors hover:border-control ${focusClass}`;
const compactInputClass = `h-10 w-full rounded-lg border border-border bg-canvas/55 px-3 text-sm font-medium text-text placeholder:text-text-muted/80 transition-colors hover:border-control focus-visible:bg-surface ${focusClass}`;
const columnCommandClass = `spring-press inline-flex size-10 cursor-pointer items-center justify-center bg-surface text-text-muted hover:bg-surface-subtle hover:text-text active:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-35 ${focusClass}`;

function HiddenTemplateSuggestion(props: {
  name: string;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div class="disclosure-reveal flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-surface px-3 py-2 text-sm text-text-muted">
      <span class="inline-flex min-w-0 items-center gap-2">
        <LucideIcon icon={Sparkles} class="size-4 shrink-0 text-accent" strokeWidth={1.85} />
        <span class="truncate font-medium text-text">Try {props.name}</span>
      </span>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class={`spring-press min-h-9 cursor-pointer rounded-lg bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-text hover:bg-border/45 ${focusClass}`}
          onClick={() => props.onApply()}
        >
          Apply
        </button>
        <button
          type="button"
          class={`spring-press min-h-9 cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-text-muted hover:bg-surface-subtle hover:text-text ${focusClass}`}
          onClick={() => props.onDismiss()}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function TemplateMiniBars(props: { columns: readonly TemplateColumnDef[] }) {
  return (
    <span aria-hidden="true" class="flex w-full gap-1">
      <For each={props.columns}>
        {(column) => (
          <span class={['h-1.5 flex-1 rounded-full', COLUMN_ACCENT_STYLES[column.accent].bar]} />
        )}
      </For>
    </span>
  );
}

function ColumnPreview(props: { columns: readonly TemplateColumnDef[]; id?: string }) {
  return (
    <span id={props.id} class="flex flex-wrap gap-x-2.5 gap-y-1 text-xs leading-relaxed text-text-muted">
      <For each={props.columns}>
        {(column) => (
          <span class="inline-flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              class={['size-1.5 shrink-0 rounded-full', COLUMN_ACCENT_STYLES[column.accent].bar]}
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
  summary: string;
  icon: IconNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelClass: string;
  buttonRef?: (button: HTMLButtonElement) => void;
  children: JSX.Element;
}) {
  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      <CollapsibleTrigger
        ref={props.buttonRef}
        aria-labelledby={`${props.panelId}-label`}
        aria-describedby={`${props.panelId}-summary`}
        class={`spring-press group flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:text-text ${focusClass}`}
      >
        <span class="inline-flex min-w-0 items-center gap-2.5">
          <LucideIcon icon={props.icon} class="size-4 text-text-muted transition-colors group-hover:text-text" strokeWidth={1.8} />
          <span id={`${props.panelId}-label`} class="text-sm font-medium text-text">
            {props.label}
          </span>
        </span>
        <span class="inline-flex shrink-0 items-center gap-2">
          <span
            id={`${props.panelId}-summary`}
            class="text-xs text-text-muted tabular-nums"
          >
            {props.summary}
          </span>
          <LucideIcon
            icon={ChevronDown}
            class="spring-chevron size-4 text-text-muted group-aria-expanded:rotate-180 group-aria-expanded:text-text"
            strokeWidth={1.8}
          />
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel id={props.panelId} class={props.panelClass}>
        {props.children}
      </CollapsiblePanel>
    </Collapsible>
  );
}

interface SegmentedOption<T> {
  /** The ui-sdk string key; segmented controls key their items by string. */
  key: string;
  value: T;
  label: string;
}

function SegmentedField<T>(props: {
  legend: string;
  icon: IconNode;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  hint?: string;
}) {
  const gridColsClass = () => {
    const count = props.options.length;
    if (count === 2) return 'grid-cols-2';
    if (count === 3) return 'grid-cols-3';
    return 'grid-cols-4';
  };

  const selectedKey = () =>
    props.options.find((option) => option.value === props.value)?.key ?? null;

  return (
    <fieldset class="min-w-0">
      <legend class="inline-flex items-center gap-2 text-sm font-medium text-text">
        <LucideIcon icon={props.icon} class="size-3.5 text-text-muted" strokeWidth={1.85} />
        <span>{props.legend}</span>
      </legend>
      <Show when={props.hint}>
        {(text) => <p class="mt-0.5 text-xs text-text-muted">{text()}</p>}
      </Show>
      <SegmentedControl<string>
        value={selectedKey()}
        onValueChange={(next) => {
          const option = props.options.find((item) => item.key === next);
          if (option) props.onChange(option.value);
        }}
        class={[
          'segmented-track relative isolate mt-2 grid rounded-xl border border-border/75 p-1',
          gridColsClass(),
        ]}
      >
        <SegmentedControlIndicator
          aria-hidden="true"
          class="segmented-thumb pointer-events-none rounded-lg"
        />
        <For each={props.options}>
          {(option) => (
            <SegmentedControlItem
              value={option.key}
              class={[
                'relative z-10 min-h-10 cursor-pointer rounded-lg px-2 py-1.5 text-center text-xs font-medium leading-snug transition-colors sm:text-[13px]',
                focusClass,
                'text-text-muted hover:text-text data-checked:font-semibold data-checked:text-text',
              ]}
            >
              {option.label}
            </SegmentedControlItem>
          )}
        </For>
      </SegmentedControl>
    </fieldset>
  );
}

const PREVIEW_CARD_WIDTHS: readonly [string, string][] = [
  ['w-4/5', 'w-3/5'],
  ['w-11/12', 'w-1/2'],
  ['w-3/4', 'w-2/3'],
  ['w-5/6', 'w-7/12'],
];

function BoardPreview(props: {
  title: string;
  subtitle: string;
  columns: readonly EditableColumn[];
  voteLimit: VoteLimitOption;
  maxVotesPerCard: MaxVotesPerCardOption;
  isBlurred: boolean;
  retentionDays: RetentionDaysOption;
}) {
  const columnGridClass = () => {
    const count = props.columns.length;
    if (count <= 1) return 'grid-cols-1';
    if (count === 2) return 'grid-cols-2';
    if (count === 3) return 'grid-cols-1 sm:grid-cols-3';
    if (count === 4) return 'grid-cols-2';
    return 'grid-cols-2 sm:grid-cols-3';
  };

  const voteSummary = () => {
    if (props.voteLimit === null) return 'Unlimited votes';
    return `${props.voteLimit} votes`;
  };

  return (
    <aside
      aria-label="Board preview"
      data-preview-private={props.isBlurred ? 'true' : 'false'}
      class="home-preview-frame overflow-hidden rounded-2xl border border-border bg-surface"
    >
      <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border/75 px-4 py-3.5 sm:px-5 sm:py-4">
        <div class="min-w-[12rem] flex-1">
          <p class="truncate text-base font-semibold tracking-[-0.02em] text-text">
            {props.title}
          </p>
          <Show when={props.subtitle}>
            <p class="mt-0.5 truncate text-xs text-text-muted">{props.subtitle}</p>
          </Show>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-1.5">
          <Show when={props.isBlurred}>
            <span class="preview-pill-enter inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-xs font-medium text-text">
              <LucideIcon icon={EyeOff} class="size-3 text-text-muted" strokeWidth={2} />
              <span>Private Mode</span>
            </span>
          </Show>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-text-muted tabular-nums">
            <LucideIcon icon={Vote} class="size-3" strokeWidth={1.9} />
            <span>{voteSummary()}</span>
          </span>
        </div>
      </div>

      <div class="bg-canvas/70 p-3.5 sm:p-4">
        <div class={['grid gap-2.5 sm:gap-3', columnGridClass()]}>
          <For each={props.columns}>
            {(column, index) => (
              <div class="preview-column-item flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-surface">
                <div
                  aria-hidden="true"
                  class={['h-1 w-full transition-colors duration-200', COLUMN_ACCENT_STYLES[column.accent].bar]}
                />
                <div
                  class={[
                    'flex items-center justify-between gap-1.5 border-b border-border/60 px-3 py-2 transition-colors duration-200',
                    COLUMN_ACCENT_STYLES[column.accent].tint,
                  ]}
                >
                  <span class="min-w-0 text-xs font-semibold text-text [overflow-wrap:anywhere]">
                    {column.title || 'Untitled Column'}
                  </span>
                  <Show when={column.isActionColumn}>
                    <span
                      title="Action Column"
                      class="inline-flex shrink-0 items-center text-col-sky"
                    >
                      <LucideIcon icon={Flag} class="size-3" strokeWidth={2} />
                    </span>
                  </Show>
                </div>

                <div aria-hidden="true" class="space-y-2 p-2.5">
                  <div class="preview-card-ghost rounded-lg border border-border/55 bg-canvas/85 p-2">
                    <div
                      class={[
                        'h-2 rounded-full bg-border/75',
                        PREVIEW_CARD_WIDTHS[index() % PREVIEW_CARD_WIDTHS.length][0],
                      ]}
                    />
                    <div
                      class={[
                        'mt-1.5 h-1.5 rounded-full bg-border/45',
                        PREVIEW_CARD_WIDTHS[index() % PREVIEW_CARD_WIDTHS.length][1],
                      ]}
                    />
                  </div>
                  <Show when={props.columns.length <= 4}>
                    <div class="preview-card-ghost rounded-lg border border-border/55 bg-canvas/85 p-2">
                      <div
                        class={[
                          'h-2 rounded-full bg-border/70',
                          PREVIEW_CARD_WIDTHS[(index() + 1) % PREVIEW_CARD_WIDTHS.length][0],
                        ]}
                      />
                      <div
                        class={[
                          'mt-1.5 h-1.5 rounded-full bg-border/40',
                          PREVIEW_CARD_WIDTHS[(index() + 2) % PREVIEW_CARD_WIDTHS.length][1],
                        ]}
                      />
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>

        <Show when={props.isBlurred}>
          <p class="disclosure-reveal mt-3 text-center text-xs text-text-muted">
            Cards stay hidden until the Facilitator reveals them.
          </p>
        </Show>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-surface px-4 py-2.5 text-xs text-text-muted sm:px-5">
        <span class="inline-flex items-center gap-1.5">
          <LucideIcon icon={ShieldCheck} class="size-3.5 text-accent" strokeWidth={1.9} />
          <span>No account required</span>
        </span>
        <span class="inline-flex items-center gap-1.5 tabular-nums">
          <LucideIcon icon={Clock} class="size-3.5" strokeWidth={1.8} />
          <span>Expires after {props.retentionDays} days of inactivity</span>
        </span>
      </div>
    </aside>
  );
}

const VOTE_LIMIT_ITEMS: readonly SegmentedOption<VoteLimitOption>[] = VOTE_LIMIT_OPTIONS.map((opt) => ({
  key: opt === null ? 'unlimited' : String(opt),
  value: opt,
  label: opt === null ? 'Unlimited' : String(opt),
}));

const MAX_VOTES_ITEMS: readonly SegmentedOption<MaxVotesPerCardOption>[] = [
  { key: 'unlimited', value: null, label: 'Unlimited (stackable)' },
  { key: '1', value: 1, label: '1 per Card or Card Group' },
];

const PRIVATE_MODE_ITEMS: readonly SegmentedOption<boolean>[] = [
  { key: 'off', value: false, label: 'Off' },
  { key: 'on', value: true, label: 'On' },
];

const RETENTION_ITEMS: readonly SegmentedOption<RetentionDaysOption>[] = RETENTION_DAYS_OPTIONS.map((days) => ({
  key: String(days),
  value: days,
  label: `${days} days`,
}));

let columnKeyCounter = 0;
function nextColumnLocalId(): string {
  columnKeyCounter += 1;
  return `draft_col_${columnKeyCounter}`;
}

function editableColumns(columns: readonly TemplateColumnDef[]): EditableColumn[] {
  return columns.map((col) => ({
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
  const [handledTemplates, setHandledTemplates] = createSignal<HiddenTemplateId[]>([]);
  const titleTemplate = createMemo(() => matchHiddenTemplate(title(), handledTemplates()));
  const subtitleTemplate = createMemo(() => matchHiddenTemplate(subtitle(), handledTemplates()));
  const [templateId, setTemplateId] =
    createSignal<BoardTemplateId>('standard');
  const [columns, setColumns] = createStore<EditableColumn[]>(
    editableColumns(getBoardTemplate('standard').columns),
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
  let titleInput: HTMLInputElement;
  let subtitleInput: HTMLInputElement;

  const customizeSummary = createMemo(() => {
    const colLabel = columns.length === 1 ? '1 column' : `${columns.length} columns`;
    return subtitle().trim() ? `${colLabel}, subtitle` : colLabel;
  });

  const advancedSummary = createMemo(() => {
    const parts: string[] = [];
    if (isBlurred()) parts.push('Private');
    parts.push(voteLimit() === null ? 'Unlimited' : `${voteLimit()} votes`);
    parts.push(`${retentionDays()}d`);
    return parts.join(', ');
  });

  const handleDismissTemplate = (id: HiddenTemplateId, input: HTMLInputElement) => {
    setHandledTemplates((ids) => [...ids, id]);
    input.focus();
  };

  const handleApplyTemplate = (template: HiddenTemplate) => {
    setHandledTemplates((ids) => [...ids, template.id]);
    setTemplateId('custom');
    setColumns(() => editableColumns(template.columns));
    setErrorMessage(null);
    setTemplatesOpen(false);
    setCustomizeOpen(true);
    customizeToggle.focus();
  };

  const handleSelectTemplate = (nextTemplateId: BoardTemplateId) => {
    if (nextTemplateId !== templateId()) {
      setTemplateId(nextTemplateId);
      setColumns(() => editableColumns(getBoardTemplate(nextTemplateId).columns));
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
    <form
      class="grid min-w-0 grid-cols-1 gap-y-8 lg:grid-cols-[minmax(0,26.5rem)_minmax(0,1fr)] lg:items-start lg:gap-x-12 xl:gap-x-16"
      onSubmit={handleSubmit}
      novalidate
    >
      {/* Left creation rail — quiet, flush-aligned controls directly on the canvas */}
      <div class="min-w-0 lg:col-start-1">
        <h1 class="text-[2rem] leading-[1.12] font-semibold tracking-[-0.03em] text-text sm:text-[2.25rem]">
          Create a board
        </h1>
        <p class="mt-2 max-w-[42ch] text-[15px] leading-relaxed text-text-muted">
          Name your retrospective, pick a column layout, and share the link to begin.
        </p>

        <div class="mt-7 grid gap-2">
          <label for="board-title-input" class="text-sm font-medium text-text">
            Board title <span class="font-normal text-text-muted">(optional)</span>
          </label>
          <input
            ref={(element) => { titleInput = element; }}
            id="board-title-input"
            type="text"
            maxlength={120}
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder={defaultTitlePlaceholder}
            class={inputClass}
          />
          <Show when={titleTemplate() ?? (!customizeOpen() && subtitleTemplate())} keyed>
            {(template) => (
              <HiddenTemplateSuggestion
                name={template.name}
                onApply={() => handleApplyTemplate(template)}
                onDismiss={() => handleDismissTemplate(template.id, titleInput)}
              />
            )}
          </Show>
        </div>

        <div class="mt-5">
          <span class="block text-sm font-medium text-text">Template</span>
          <Collapsible open={templatesOpen()} onOpenChange={setTemplatesOpen}>
            <div class="mt-2 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5">
              <div class="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-text-muted"
                >
                  <LucideIcon icon={LayoutGrid} class="size-4" strokeWidth={1.8} />
                </span>
                <div class="min-w-0">
                  <h2 class="truncate text-sm font-semibold text-text">
                    {getBoardTemplate(templateId()).name}
                  </h2>
                  <p class="truncate text-xs text-text-muted tabular-nums">
                    {columns.length} {columns.length === 1 ? 'column' : 'columns'}
                  </p>
                </div>
              </div>
              <CollapsibleTrigger
                ref={(element) => { templateToggle = element; }}
                aria-label="Change template"
                class={[
                  'spring-press inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border/80 bg-surface-subtle/60 px-3 py-1.5 text-xs font-medium text-text',
                  'hover:border-control/70 hover:bg-surface-subtle active:bg-surface-subtle aria-expanded:border-accent/50 aria-expanded:bg-surface-subtle',
                  focusClass,
                ]}
              >
                <span>Change</span>
                <LucideIcon
                  icon={ChevronDown}
                  class="spring-chevron size-3.5 text-text-muted data-open:rotate-180"
                  strokeWidth={2}
                />
              </CollapsibleTrigger>
            </div>

            <CollapsiblePanel id="board-templates" class="disclosure-reveal mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <For each={BOARD_TEMPLATES}>
                {(template) => (
                  <button
                    type="button"
                    aria-label={template.name}
                    aria-pressed={templateId() === template.id ? 'true' : 'false'}
                    aria-describedby={`template-${template.id}-columns`}
                    onClick={() => handleSelectTemplate(template.id)}
                    class={[
                      'spring-press flex min-h-11 min-w-0 cursor-pointer flex-col items-start justify-start gap-2 rounded-xl border p-3 text-left',
                      focusClass,
                      template.id === 'custom' ? 'sm:col-span-2 border-dashed' : '',
                      templateId() === template.id
                        ? 'border-accent bg-surface ring-1 ring-accent'
                        : 'border-border bg-surface hover:border-control/80 hover:bg-surface-subtle/45',
                    ]}
                  >
                    <span class="flex w-full items-center justify-between gap-2">
                      <span class="text-sm font-semibold text-text">{template.name}</span>
                      <Show when={templateId() === template.id}>
                        <LucideIcon icon={Check} class="size-3.5 shrink-0 text-accent" strokeWidth={2.4} />
                      </Show>
                    </span>
                    <TemplateMiniBars columns={template.columns} />
                    <ColumnPreview id={`template-${template.id}-columns`} columns={template.columns} />
                  </button>
                )}
              </For>
            </CollapsiblePanel>
          </Collapsible>
        </div>

        <Show when={errorMessage()}>
          {(msg) => (
            <p
              role="alert"
              class="disclosure-reveal mt-4 rounded-xl border border-col-rose bg-col-rose-tint px-3.5 py-2.5 text-sm text-text"
            >
              {msg()}
            </p>
          )}
        </Show>

        <button
          type="submit"
          disabled={submitting()}
          class={[
            'spring-press mt-5 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-base font-semibold text-accent-contrast',
            'hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60',
            focusClass,
          ]}
        >
          {submitting() ? 'Creating board…' : 'Create board'}
        </button>

        <div class="mt-6 border-t border-border/75 pt-2">
          <DisclosureButton
            panelId="board-customize"
            label="Customize board"
            summary={customizeSummary()}
            icon={SlidersHorizontal}
            open={customizeOpen()}
            onOpenChange={setCustomizeOpen}
            panelClass="disclosure-reveal space-y-5 pt-3 pb-4"
            buttonRef={(element) => { customizeToggle = element; }}
          >
            <div class="grid gap-2">
                <label for="board-subtitle-input" class="text-sm font-medium text-text">
                  Subtitle / context <span class="font-normal text-text-muted">(optional)</span>
                </label>
                <input
                  ref={(element) => { subtitleInput = element; }}
                  id="board-subtitle-input"
                  type="text"
                  maxlength={240}
                  value={subtitle()}
                  onInput={(e) => setSubtitle(e.currentTarget.value)}
                  placeholder="e.g., Sprint 42 · Checkout Team"
                  class={inputClass}
                />
                <Show when={!titleTemplate() && subtitleTemplate()} keyed>
                  {(template) => (
                    <HiddenTemplateSuggestion
                      name={template.name}
                      onApply={() => handleApplyTemplate(template)}
                      onDismiss={() => handleDismissTemplate(template.id, subtitleInput)}
                    />
                  )}
                </Show>
              </div>

              <div>
                <div class="flex items-center justify-between gap-2">
                  <h2 class="text-sm font-semibold text-text">
                    Columns{' '}
                    <span class="font-normal text-text-muted tabular-nums">({columns.length} / 10)</span>
                  </h2>
                  <button
                    type="button"
                    disabled={columns.length >= 10}
                    onClick={handleAddColumn}
                    class={`spring-press inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text hover:border-control hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40 ${focusClass}`}
                  >
                    <LucideIcon icon={Plus} class="size-3.5" strokeWidth={2} />
                    <span>Add Column</span>
                  </button>
                </div>

                <ul class="mt-2.5 space-y-2.5" role="list">
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
                        class="space-y-2.5 rounded-xl border border-border bg-surface p-3"
                      >
                        <div class="flex items-center gap-2">
                          <LucideIcon
                            icon={GripVertical}
                            class="size-4 shrink-0 cursor-grab text-text-muted/60 active:cursor-grabbing"
                            strokeWidth={1.75}
                          />
                          <span
                            aria-hidden="true"
                            class={['h-5 w-1 shrink-0 rounded-full transition-colors duration-200', COLUMN_ACCENT_STYLES[col.accent].bar]}
                          />
                          <input
                            type="text"
                            aria-label={`Column ${index() + 1} title`}
                            maxlength={60}
                            value={col.title}
                            onInput={(e) =>
                              handleRenameColumn(index(), e.currentTarget.value)
                            }
                            class={`min-w-0 flex-1 ${compactInputClass}`}
                          />
                          <div class="inline-flex shrink-0 divide-x divide-border overflow-hidden rounded-lg border border-border bg-surface">
                            <button
                              type="button"
                              disabled={index() === 0}
                              onClick={() => handleMoveColumn(index(), index() - 1)}
                              aria-label={`Move Column ${index() + 1} up`}
                              class={columnCommandClass}
                            >
                              <LucideIcon icon={ArrowUp} class="size-3.5" strokeWidth={1.9} />
                            </button>
                            <button
                              type="button"
                              disabled={index() === columns.length - 1}
                              onClick={() => handleMoveColumn(index(), index() + 1)}
                              aria-label={`Move Column ${index() + 1} down`}
                              class={columnCommandClass}
                            >
                              <LucideIcon icon={ArrowDown} class="size-3.5" strokeWidth={1.9} />
                            </button>
                            <button
                              type="button"
                              disabled={columns.length <= 1}
                              onClick={() => handleRemoveColumn(index())}
                              aria-label={`Remove Column ${index() + 1}`}
                              class={columnCommandClass}
                            >
                              <LucideIcon icon={X} class="size-3.5" strokeWidth={1.9} />
                            </button>
                          </div>
                        </div>

                        <div class="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                          <div
                            class="grid grid-cols-8 gap-0.5"
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
                                    'spring-press inline-grid size-8 cursor-pointer place-items-center rounded-lg border border-transparent hover:bg-surface-subtle',
                                    focusClass,
                                    { 'border-border bg-surface-subtle': col.accent === accent },
                                  ]}
                                >
                                  <span
                                    aria-hidden="true"
                                    class={[
                                      'size-4 rounded-full',
                                      COLUMN_ACCENT_STYLES[accent].swatch,
                                      { 'ring-2 ring-text ring-offset-2 ring-offset-surface': col.accent === accent },
                                    ]}
                                  />
                                </button>
                              )}
                            </For>
                          </div>

                          <button
                            type="button"
                            aria-pressed={col.isActionColumn ? 'true' : 'false'}
                            onClick={() => handleToggleActionColumn(index())}
                            title="Auto-flag new Cards in this Column as Action Items"
                            class={[
                              'spring-press inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium',
                              focusClass,
                              col.isActionColumn
                                ? 'border-col-sky/60 bg-col-sky-tint text-text'
                                : 'border-border bg-surface text-text-muted hover:bg-surface-subtle hover:text-text',
                            ]}
                          >
                            <LucideIcon
                              icon={Flag}
                              class={['size-3.5', col.isActionColumn ? 'text-col-sky' : 'text-text-muted']}
                              strokeWidth={1.9}
                            />
                            <span>Action Column</span>
                          </button>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
          </DisclosureButton>
        </div>

        <div class="border-t border-border/75 pt-2">
          <DisclosureButton
            panelId="board-advanced"
            label="Advanced options"
            summary={advancedSummary()}
            icon={Settings2}
            open={advancedOpen()}
            onOpenChange={setAdvancedOpen}
            panelClass="disclosure-reveal space-y-5 pt-3 pb-2"
          >
              <SegmentedField
                legend="Votes per Participant"
                icon={Vote}
                options={VOTE_LIMIT_ITEMS}
                value={voteLimit()}
                onChange={setVoteLimit}
              />

              <SegmentedField
                legend="Max Votes per Card or Card Group"
                icon={Layers}
                options={MAX_VOTES_ITEMS}
                value={maxVotesPerCard()}
                onChange={setMaxVotesPerCard}
              />

              <SegmentedField
                legend="Start in Private Mode"
                icon={EyeOff}
                options={PRIVATE_MODE_ITEMS}
                value={isBlurred()}
                onChange={setIsBlurred}
                hint="Redacts other Participants' Cards until the Facilitator reveals them."
              />

              <SegmentedField
                legend="Auto-expiry on inactivity"
                icon={Clock}
                options={RETENTION_ITEMS}
                value={retentionDays()}
                onChange={setRetentionDays}
              />
          </DisclosureButton>
        </div>
      </div>

      {/* Right studio stage — Live Board Preview + Recent Boards */}
      <div class="min-w-0 space-y-6 lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1">
        <BoardPreview
          title={title().trim() || defaultTitlePlaceholder}
          subtitle={subtitle().trim()}
          columns={columns}
          voteLimit={voteLimit()}
          maxVotesPerCard={maxVotesPerCard()}
          isBlurred={isBlurred()}
          retentionDays={retentionDays()}
        />
        {props.secondary}
      </div>
    </form>
  );
}
