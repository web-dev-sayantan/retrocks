import { Button } from '@ui-sdk/solid/button';
import { Field, FieldLabel } from '@ui-sdk/solid/field';
import { Input } from '@ui-sdk/solid/input';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDot,
  CircleSlash,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide';
import { For, Show, createMemo, createSignal, createUniqueId, onSettled, untrack } from 'solid-js';

import { confirmBoardAction } from '../../lib/board-confirm';
import {
  POKER_STORY_TITLE_LIMIT,
  type PokerResult,
  type PokerStory,
  type PokerStoryCommand,
} from '../../lib/poker-types';
import LucideIcon from '../LucideIcon';
import PokerEstimateForm from './PokerEstimateForm';

const storyStatuses = {
  pending: 'Pending',
  estimated: 'Estimated',
  skipped: 'Skipped',
};

function StoryTitleForm(props: {
  initialTitle?: string;
  busy: boolean;
  onSave: (title: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = createSignal(untrack(() => props.initialTitle ?? ''));
  const editing = () => Boolean(props.onCancel);
  const [ready, setReady] = createSignal(false);
  let input!: HTMLInputElement;

  onSettled(() => {
    setReady(true);
    if (editing()) {
      input.focus();
      input.select();
    }
  });

  return (
    <form
      class={['poker-form', editing() ? 'mt-2.5 grid gap-2' : 'px-3 pb-2']}
      method="post"
      aria-label={editing() ? 'Edit Story title' : 'Add a Story'}
      aria-busy={props.busy ? 'true' : 'false'}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (ready() && !props.busy && await props.onSave(title())) {
          setTitle('');
          form.reset();
        }
      }}
    >
      <Show
        when={editing()}
        fallback={
          <div class="poker-quick-add">
            <Field name="title" class="min-w-0 flex-1">
              <FieldLabel class="sr-only">Story title</FieldLabel>
              <Input
                ref={input}
                class="poker-quick-add-input"
                placeholder="Add a Story…"
                value={title()}
                onValueChange={(value) => setTitle(value)}
                readonly={props.busy || !ready()}
                required
                maxlength={POKER_STORY_TITLE_LIMIT}
                pattern={'.*\\S.*'}
              />
            </Field>
            <Button
              class="poker-quick-add-submit spring-press board-focus-ring"
              type="submit"
              aria-label="Add Story"
              title="Add Story"
              disabled={props.busy || !ready()}
              focusableWhenDisabled={ready()}
            >
              <LucideIcon icon={Plus} class="size-4" strokeWidth={2.2} />
            </Button>
          </div>
        }
      >
        <Field name="title" class="min-w-0">
          <FieldLabel class="mb-1 block text-xs font-semibold text-text-muted">Story title</FieldLabel>
          <Input
            ref={input}
            class="poker-input board-focus-ring"
            value={title()}
            onValueChange={(value) => setTitle(value)}
            readonly={props.busy || !ready()}
            required
            maxlength={POKER_STORY_TITLE_LIMIT}
            pattern={'.*\\S.*'}
          />
        </Field>
        <div class="flex flex-wrap gap-1.5">
          <Button
            class="poker-primary spring-press board-focus-ring"
            type="submit"
            disabled={props.busy || !ready()}
            focusableWhenDisabled={ready()}
          >
            Save title
          </Button>
          <Button
            type="button"
            class="poker-ghost spring-press board-focus-ring"
            onClick={() => props.onCancel?.()}
            disabled={props.busy}
          >
            Cancel
          </Button>
        </div>
      </Show>
    </form>
  );
}

export default function PokerStoryQueue(props: {
  stories: PokerStory[];
  activeStoryId: string | null;
  canManage: boolean;
  deck: readonly string[];
  roundId?: string;
  discardRoundId?: string;
  activeRoundWithVotesId?: string;
  onChange: (command: PokerStoryCommand) => Promise<PokerResult>;
}) {
  const headingId = createUniqueId();
  const listPanelId = createUniqueId();
  const [editing, setEditing] = createSignal<
    { storyId: string; type: 'title' } | { storyId: string; type: 'estimate'; expectedEstimate: string } | null
  >(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [announcement, setAnnouncement] = createSignal('');
  const [confirming, setConfirming] = createSignal(false);
  const [mobileOpen, setMobileOpen] = createSignal(false);

  const estimatedCount = createMemo(() => props.stories.filter((story) => story.status === 'estimated').length);
  const activeStoryTitle = createMemo(() => props.stories.find((story) => story.id === props.activeStoryId)?.title);

  async function change(command: PokerStoryCommand) {
    if (busy()) return null;
    setBusy(true);
    setError('');
    try {
      const result = await props.onChange(command);
      if (result.ok) return result.room.closed ? null : result.room;
      setError(result.message);
    } catch {
      setError('Could not update the Story queue. Try again.');
    } finally {
      setBusy(false);
    }
    return null;
  }

  async function addStory(title: string) {
    return Boolean(await change({ type: 'add-story', title }));
  }

  async function selectStory(story: PokerStory) {
    if (story.locked || busy() || confirming()) return;
    const discardRoundId = props.discardRoundId;
    if (discardRoundId !== undefined) {
      setConfirming(true);
      try {
        if (!await confirmBoardAction({
          title: 'Switch Stories?',
          description: 'Switching Stories discards the current Voting Round and its votes.',
          cancelLabel: 'Stay with this Story',
          confirmLabel: 'Switch Story',
        })) return;
      } finally {
        setConfirming(false);
      }
    }
    await change({
      type: 'select-story',
      storyId: story.id,
      ...(discardRoundId === undefined ? {} : { discardRoundId }),
    });
  }

  async function toggleStoryLock(story: PokerStory) {
    if (busy() || confirming()) return;
    const locking = !story.locked;
    const discardRoundId = locking && props.activeStoryId === story.id
      ? props.activeRoundWithVotesId
      : undefined;
    if (discardRoundId !== undefined) {
      setConfirming(true);
      try {
        if (!await confirmBoardAction({
          title: 'Lock active Story?',
          description: 'Locking this Story discards the current Voting Round and its votes, then clears the stage.',
          cancelLabel: 'Keep voting',
          confirmLabel: 'Lock and discard votes',
          agentConfirm: 'Locks the active Story and discards the current Voting Round and its votes.',
        })) return;
      } finally {
        setConfirming(false);
      }
    }
    if (locking && editing()?.storyId === story.id) setEditing(null);
    await change({
      type: 'set-story-lock',
      storyId: story.id,
      locked: locking,
      ...(discardRoundId === undefined ? {} : { discardRoundId }),
    });
  }

  async function move(story: PokerStory, index: number, offset: -1 | 1, control: HTMLElement) {
    const target = props.stories[index + offset];
    if (!target) return;
    const doc = control.ownerDocument;
    const hadFocus = doc.activeElement === control;
    const room = await change({
      type: 'move-story',
      storyId: story.id,
      targetId: target.id,
      placement: offset < 0 ? 'before' : 'after',
    });
    if (!room) return;
    const position = room.stories.findIndex((entry) => entry.id === story.id);
    if (position >= 0 && position !== index) {
      setAnnouncement(`${story.title} moved to position ${position + 1} of ${room.stories.length}.`);
    }
    if (hadFocus && doc.activeElement === doc.body && control.isConnected) {
      control.focus({ preventScroll: true });
    }
  }

  return (
    <div class="poker-queue-pane min-w-0">
      <button
        type="button"
        class="poker-mobile-queue-toggle board-focus-ring"
        aria-expanded={mobileOpen() ? 'true' : 'false'}
        aria-controls={listPanelId}
        onClick={() => setMobileOpen((open) => !open)}
      >
        <span class="flex min-w-0 items-center gap-2">
          <span>Story queue</span>
          <span class="text-xs font-medium text-text-muted tabular-nums">
            {estimatedCount()}/{props.stories.length}
          </span>
          <Show when={activeStoryTitle()}>
            {(title) => <span class="truncate text-xs font-normal text-text-muted">{title()}</span>}
          </Show>
        </span>
        <LucideIcon
          icon={ChevronDown}
          class={['spring-chevron size-4 shrink-0 text-text-muted', mobileOpen() ? 'rotate-180' : '']}
          strokeWidth={2}
        />
      </button>

      <section
        id={listPanelId}
        class="poker-queue-body min-w-0"
        data-mobile-collapsed={mobileOpen() ? 'false' : 'true'}
        aria-labelledby={headingId}
      >
        <div class="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5">
          <h2 id={headingId} class="text-[13px] font-semibold text-text-muted">Story queue</h2>
          <Show when={props.stories.length > 0}>
            <span class="text-xs font-medium text-text-muted tabular-nums" aria-hidden="true">
              {estimatedCount()} / {props.stories.length}
            </span>
          </Show>
        </div>

        <Show when={props.canManage}>
          <StoryTitleForm busy={busy()} onSave={addStory} />
        </Show>

        <div class="poker-queue-scroll">
          <Show
            when={props.stories.length}
            fallback={
              <p class="px-4 py-3 text-sm leading-relaxed text-text-muted">
                No Stories have been added yet.
              </p>
            }
          >
            <ol class="poker-story-list" aria-labelledby={headingId}>
              <For each={props.stories} keyed={(story) => story.id}>
                {(story, index) => {
                  const active = () => props.activeStoryId === story().id;
                  const selected = () => active() && props.roundId !== undefined;
                  const editor = createMemo(() => {
                    const current = editing();
                    return current?.storyId === story().id ? current : null;
                  });
                  const estimateEditor = createMemo(() => {
                    const current = editor();
                    return current?.type === 'estimate' ? current : undefined;
                  });
                  let selectButton: HTMLButtonElement | undefined;
                  let editTitleButton: HTMLButtonElement | undefined;
                  let editEstimateButton: HTMLButtonElement | undefined;

                  function finishEditing() {
                    const trigger = editor()?.type === 'estimate' ? editEstimateButton : editTitleButton;
                    setEditing(null);
                    trigger?.focus();
                  }

                  async function saveTitle(title: string) {
                    const room = await change({ type: 'edit-story', storyId: story().id, title });
                    if (room) finishEditing();
                    return Boolean(room);
                  }

                  async function saveEstimate(expectedEstimate: string, choice: string) {
                    if (await change({ type: 'correct-estimate', storyId: story().id, expectedEstimate, choice })) {
                      finishEditing();
                    }
                  }

                  async function returnStory(control: HTMLElement) {
                    if (story().locked) return;
                    const doc = control.ownerDocument;
                    const hadFocus = doc.activeElement === control;
                    if (await change({ type: 'return-story', storyId: story().id })) {
                      if (hadFocus && !control.isConnected && doc.activeElement === doc.body) selectButton?.focus();
                    }
                  }

                  const locked = () => Boolean(story().locked);

                  return (
                    <li
                      class="poker-story-row"
                      data-status={story().status}
                      data-locked={locked() ? 'true' : undefined}
                      aria-current={active() ? 'true' : undefined}
                    >
                      <div class="flex items-start gap-2.5">
                        <span class="mt-0.5 inline-flex shrink-0" aria-hidden="true">
                          <Show
                            when={story().status === 'estimated'}
                            fallback={
                              <Show
                                when={story().status === 'skipped'}
                                fallback={
                                  <Show
                                    when={active()}
                                    fallback={<LucideIcon icon={Circle} class="size-3.5 text-text-muted/70" strokeWidth={2} />}
                                  >
                                    <LucideIcon icon={CircleDot} class="size-3.5 text-accent" strokeWidth={2.2} />
                                  </Show>
                                }
                              >
                                <LucideIcon icon={CircleSlash} class="size-3.5 text-text-muted/70" strokeWidth={2} />
                              </Show>
                            }
                          >
                            <LucideIcon icon={CheckCircle2} class="size-3.5 text-accent" strokeWidth={2.2} />
                          </Show>
                        </span>

                        <p class="poker-story-title min-w-0 flex-1">{story().title}</p>

                        <span class="flex shrink-0 items-center gap-1.5">
                          <Show when={locked()}>
                            <span class="poker-lock-cue" title="Locked Story">
                              <LucideIcon icon={Lock} class="size-3.5" strokeWidth={2} />
                              <span class="sr-only">Locked</span>
                            </span>
                          </Show>
                          <Show
                            when={story().acceptedEstimate}
                            fallback={
                              <span class={story().status === 'skipped' ? 'text-xs font-medium text-text-muted' : 'sr-only'}>
                                {storyStatuses[story().status]}
                              </span>
                            }
                          >
                            {(estimate) => (
                              <>
                                <span class="sr-only">{storyStatuses[story().status]} · </span>
                                <span class="poker-est-badge">{estimate()}</span>
                              </>
                            )}
                          </Show>
                        </span>
                      </div>

                      <Show when={props.canManage}>
                        <div class="poker-row-actions">
                          <Show
                            when={story().status !== 'skipped'}
                            fallback={
                              <Button
                                class="poker-row-btn poker-row-btn-primary board-focus-ring"
                                aria-label={`Return ${story().title} to queue`}
                                disabled={locked() || busy()}
                                focusableWhenDisabled
                                onClick={(event) => void returnStory(event.currentTarget)}
                              >
                                <LucideIcon icon={RotateCcw} class="size-3" strokeWidth={2} />
                                <span>Return to queue</span>
                              </Button>
                            }
                          >
                            <Button
                              ref={selectButton}
                              class="poker-row-btn poker-row-btn-primary board-focus-ring"
                              aria-label={`${selected() ? 'Selected' : story().status === 'estimated' ? 'Reconsider' : 'Select'} ${story().title}`}
                              disabled={locked() || selected() || busy() || confirming()}
                              focusableWhenDisabled
                              onClick={() => selectStory(story())}
                            >
                              {selected() ? 'Selected' : story().status === 'estimated' ? 'Reconsider' : 'Select'}
                            </Button>
                          </Show>

                          <Button
                            ref={editTitleButton}
                            class="poker-row-btn board-focus-ring"
                            aria-label={`Edit title for ${story().title}`}
                            title="Edit title"
                            aria-expanded={editor()?.type === 'title' ? 'true' : 'false'}
                            disabled={locked() || busy()}
                            focusableWhenDisabled
                            onClick={() => {
                              if (!locked()) setEditing({ storyId: story().id, type: 'title' });
                            }}
                          >
                            <LucideIcon icon={Pencil} class="size-3" strokeWidth={2} />
                            <span class="sr-only">Edit title</span>
                          </Button>

                          <Show when={story().acceptedEstimate}>
                            {(estimate) => (
                              <Button
                                ref={editEstimateButton}
                                class="poker-row-btn board-focus-ring"
                                aria-label={`Edit estimate for ${story().title}`}
                                aria-expanded={editor()?.type === 'estimate' ? 'true' : 'false'}
                                disabled={locked() || busy()}
                                focusableWhenDisabled
                                onClick={() => {
                                  if (!locked()) {
                                    setEditing({ storyId: story().id, type: 'estimate', expectedEstimate: estimate() });
                                  }
                                }}
                              >
                                Edit estimate
                              </Button>
                            )}
                          </Show>

                          <Button
                            class="poker-row-btn board-focus-ring"
                            aria-label={locked() ? `Unlock ${story().title}` : `Lock ${story().title}`}
                            title={locked() ? 'Unlock Story' : 'Lock Story'}
                            disabled={busy() || confirming()}
                            focusableWhenDisabled
                            onClick={() => void toggleStoryLock(story())}
                          >
                            <LucideIcon icon={locked() ? LockOpen : Lock} class="size-3" strokeWidth={2} />
                            <span class="sr-only">{locked() ? 'Unlock Story' : 'Lock Story'}</span>
                          </Button>

                          <div class="ms-auto flex items-center gap-0.5">
                            <Button
                              class="poker-row-btn board-focus-ring !px-1.5"
                              aria-label={`Move ${story().title} up`}
                              title="Move up"
                              disabled={index() === 0 || busy()}
                              focusableWhenDisabled
                              onClick={(event) => move(story(), index(), -1, event.currentTarget)}
                            >
                              <LucideIcon icon={ChevronUp} class="size-3.5" strokeWidth={2} />
                            </Button>
                            <Button
                              class="poker-row-btn board-focus-ring !px-1.5"
                              aria-label={`Move ${story().title} down`}
                              title="Move down"
                              disabled={index() === props.stories.length - 1 || busy()}
                              focusableWhenDisabled
                              onClick={(event) => move(story(), index(), 1, event.currentTarget)}
                            >
                              <LucideIcon icon={ChevronDown} class="size-3.5" strokeWidth={2} />
                            </Button>
                          </div>
                        </div>

                        <Show when={editor()?.type === 'title' && !locked()}>
                          <StoryTitleForm
                            initialTitle={story().title}
                            busy={busy()}
                            onSave={saveTitle}
                            onCancel={finishEditing}
                          />
                        </Show>
                        <Show when={!locked() ? estimateEditor() : undefined} keyed>
                          {(edit) => (
                            <PokerEstimateForm
                              deck={props.deck}
                              busy={busy()}
                              initialChoice={edit.expectedEstimate}
                              onSave={(choice) => void saveEstimate(edit.expectedEstimate, choice)}
                              onCancel={finishEditing}
                            />
                          )}
                        </Show>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ol>
          </Show>
        </div>

        <p class="sr-only" role="status">{announcement()}</p>
        <p class="poker-error-text px-4 text-xs font-medium [&:not(:empty)]:py-2" role="alert">{error()}</p>
        <p class="poker-rail-foot">
          This Room expires 90 days after creation or its most recent vote or content change, whichever is later.
        </p>
      </section>
    </div>
  );
}
