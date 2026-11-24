import { Button } from '@ui-sdk/solid/button';
import { Field, FieldLabel } from '@ui-sdk/solid/field';
import { Input } from '@ui-sdk/solid/input';
import { useShortcut } from '@ui-sdk/solid/shortcuts';
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
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide';
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, flush, onSettled } from 'solid-js';

import { confirmBoardAction } from '../../lib/board-confirm';
import type { InlineEditOutcome } from '../../lib/inline-edit';
import {
  POKER_STORY_TITLE_LIMIT,
  type PokerResult,
  type PokerStory,
  type PokerStoryCommand,
} from '../../lib/poker-types';
import LucideIcon from '../LucideIcon';
import PokerEstimateForm from './PokerEstimateForm';
import PokerStoryTitleEditor, { type PokerStoryTitleEditorHandle } from './PokerStoryTitleEditor';

const storyStatuses = {
  pending: 'Pending',
  estimated: 'Estimated',
  skipped: 'Skipped',
};

function QuickAddStoryForm(props: {
  busy: boolean;
  smartEnterMakesActive: boolean;
  onAdd: (title: string, makeActive: boolean) => Promise<boolean>;
}) {
  const [title, setTitle] = createSignal('');
  const [ready, setReady] = createSignal(false);
  let formEl!: HTMLFormElement;

  onSettled(() => {
    setReady(true);
  });

  async function submit(makeActive: boolean) {
    if (!ready() || props.busy) return;
    if (!formEl.reportValidity()) return;
    if (!title().trim()) return;
    if (await props.onAdd(title(), makeActive)) {
      setTitle('');
      formEl.reset();
    }
  }

  return (
    <form
      ref={formEl}
      class="poker-form px-3 pb-2.5"
      method="post"
      aria-label="Add a Story"
      aria-busy={props.busy ? 'true' : 'false'}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(props.smartEnterMakesActive);
      }}
    >
      <div class="poker-quick-add">
        <Field name="title" class="min-w-0">
          <FieldLabel class="sr-only">Story title</FieldLabel>
          <Input
            class="poker-quick-add-input board-focus-ring"
            placeholder="Add a Story…"
            value={title()}
            onValueChange={(value) => setTitle(value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // Ignore Enter while confirming IME composition.
              if (event.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              void submit(props.smartEnterMakesActive);
            }}
            readonly={props.busy || !ready()}
            required
            maxlength={POKER_STORY_TITLE_LIMIT}
            pattern={'.*\\S.*'}
          />
        </Field>
        <div class="poker-quick-add-actions">
          <Button
            class={[
              'poker-quick-add-btn spring-press board-focus-ring',
              !props.smartEnterMakesActive ? 'poker-quick-add-btn-primary' : '',
            ]}
            type="button"
            disabled={props.busy || !ready()}
            focusableWhenDisabled={ready()}
            onClick={() => void submit(false)}
          >
            <LucideIcon icon={Plus} class="size-3.5 shrink-0" strokeWidth={2.2} />
            <span>Add to queue</span>
          </Button>
          <Button
            class={[
              'poker-quick-add-btn spring-press board-focus-ring',
              props.smartEnterMakesActive ? 'poker-quick-add-btn-primary' : '',
            ]}
            type="button"
            disabled={props.busy || !ready()}
            focusableWhenDisabled={ready()}
            onClick={() => void submit(true)}
          >
            <LucideIcon icon={Play} class="size-3.5 shrink-0" strokeWidth={2.1} />
            <span>Add &amp; make active</span>
          </Button>
        </div>
      </div>
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
  const [editingEstimate, setEditingEstimate] = createSignal<
    { storyId: string; expectedEstimate: string } | null
  >(null);
  const [deletingStoryId, setDeletingStoryId] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [announcement, setAnnouncement] = createSignal('');
  const [confirming, setConfirming] = createSignal(false);
  const [mobileOpen, setMobileOpen] = createSignal(false);

  let activeConfirmGroup: HTMLElement | undefined;
  let activeRestoreDeleteFocus: (() => void) | undefined;

  function cancelDelete(restoreFocus = false) {
    const restore = restoreFocus ? activeRestoreDeleteFocus : undefined;
    activeConfirmGroup = undefined;
    activeRestoreDeleteFocus = undefined;
    setDeletingStoryId(null);
    if (restore) {
      flush();
      restore();
    }
  }

  useShortcut(
    () => (deletingStoryId() !== null ? 'Escape' : null),
    () => cancelDelete(true),
  );

  createEffect(
    () => deletingStoryId() !== null,
    (isDeleting) => {
      if (!isDeleting || typeof document === 'undefined') return;
      const onOutside = (event: Event) => {
        const target = event.target;
        if (target instanceof Node && activeConfirmGroup?.contains(target)) return;
        cancelDelete(false);
      };
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('click', onOutside, true);
      document.addEventListener('focusin', onOutside, true);
      return () => {
        document.removeEventListener('pointerdown', onOutside, true);
        document.removeEventListener('click', onOutside, true);
        document.removeEventListener('focusin', onOutside, true);
      };
    },
  );

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

  async function addStory(title: string, makeActive: boolean) {
    if (busy() || confirming()) return false;
    cancelDelete(false);
    if (!makeActive) {
      return Boolean(await change({ type: 'add-story', title }));
    }
    const discardRoundId = props.activeRoundWithVotesId;
    if (discardRoundId !== undefined) {
      setConfirming(true);
      try {
        if (!await confirmBoardAction({
          title: 'Make new Story active?',
          description: 'Making this Story active discards the current Voting Round and its votes, then locks the previous Story.',
          cancelLabel: 'Keep voting',
          confirmLabel: 'Lock previous & make active',
          agentConfirm: 'Discards the current Voting Round and its votes, locks the previous Story, and makes the new Story active.',
        })) return false;
      } finally {
        setConfirming(false);
      }
    }
    return Boolean(await change({
      type: 'add-story',
      title,
      makeActive: true,
      ...(discardRoundId === undefined ? {} : { discardRoundId }),
    }));
  }

  async function selectStory(story: PokerStory) {
    if (story.locked || busy() || confirming()) return;
    cancelDelete(false);
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
    cancelDelete(false);
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
    if (locking && editingEstimate()?.storyId === story.id) setEditingEstimate(null);
    await change({
      type: 'set-story-lock',
      storyId: story.id,
      locked: locking,
      ...(discardRoundId === undefined ? {} : { discardRoundId }),
    });
  }

  function startDelete(story: PokerStory) {
    if (story.locked || busy() || confirming()) return;
    if (editingEstimate()?.storyId === story.id) setEditingEstimate(null);
    setDeletingStoryId(story.id);
  }

  async function confirmDelete(story: PokerStory, discardRoundId?: string) {
    if (story.locked || busy() || confirming()) return;
    const room = await change({
      type: 'delete-story',
      storyId: story.id,
      ...(discardRoundId === undefined ? {} : { discardRoundId }),
    });
    cancelDelete(false);
    if (room) {
      setAnnouncement(`${story.title} deleted.`);
    }
  }

  async function editStoryTitle(
    storyId: string,
    title: string,
    discardRoundId?: string,
  ): Promise<InlineEditOutcome> {
    if (busy()) return false;
    cancelDelete(false);
    setBusy(true);
    setError('');
    try {
      const result = await props.onChange({
        type: 'edit-story',
        storyId,
        title,
        ...(discardRoundId === undefined ? {} : { discardRoundId }),
      });
      if (result.ok) return true;
      return result.message;
    } catch {
      return 'Could not update the Story title. Try again.';
    } finally {
      setBusy(false);
    }
  }

  async function move(story: PokerStory, index: number, offset: -1 | 1, control: HTMLElement) {
    cancelDelete(false);
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
          <QuickAddStoryForm
            busy={busy() || confirming()}
            smartEnterMakesActive={props.discardRoundId === undefined}
            onAdd={addStory}
          />
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
                  const estimateEditor = createMemo(() => {
                    const current = editingEstimate();
                    return current?.storyId === story().id ? current : undefined;
                  });
                  let selectButton: HTMLButtonElement | undefined;
                  let editTitleButton: HTMLButtonElement | undefined;
                  let editEstimateButton: HTMLButtonElement | undefined;
                  let deleteButton: HTMLButtonElement | undefined;
                  let confirmGroup: HTMLDivElement | undefined;
                  let cancelDeleteButton: HTMLButtonElement | undefined;
                  let titleEditor: PokerStoryTitleEditorHandle | undefined;

                  function finishEditingEstimate() {
                    setEditingEstimate(null);
                    editEstimateButton?.focus();
                  }

                  async function saveEstimate(expectedEstimate: string, choice: string) {
                    if (await change({ type: 'correct-estimate', storyId: story().id, expectedEstimate, choice })) {
                      finishEditingEstimate();
                    }
                  }

                  async function returnStory(control: HTMLElement) {
                    if (story().locked) return;
                    cancelDelete(false);
                    const doc = control.ownerDocument;
                    const hadFocus = doc.activeElement === control;
                    if (await change({ type: 'return-story', storyId: story().id })) {
                      if (hadFocus && !control.isConnected && doc.activeElement === doc.body) selectButton?.focus();
                    }
                  }

                  const locked = () => Boolean(story().locked);
                  const confirmingDelete = () => deletingStoryId() === story().id && !locked();
                  const deleteDiscardRoundId = () => (active() ? props.activeRoundWithVotesId : undefined);

                  createEffect(
                    confirmingDelete,
                    (isConfirming) => {
                      if (!isConfirming) return;
                      activeConfirmGroup = confirmGroup;
                      activeRestoreDeleteFocus = () => deleteButton?.focus();
                      cancelDeleteButton?.focus();
                      return () => {
                        if (activeConfirmGroup === confirmGroup) {
                          activeConfirmGroup = undefined;
                          activeRestoreDeleteFocus = undefined;
                        }
                      };
                    },
                  );

                  return (
                    <li
                      class="poker-story-row"
                      data-status={story().status}
                      data-locked={locked() ? 'true' : undefined}
                      data-confirming-delete={confirmingDelete() ? 'true' : undefined}
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

                        <PokerStoryTitleEditor
                          story={story()}
                          canEdit={props.canManage}
                          discardRoundId={deleteDiscardRoundId()}
                          variant="queue"
                          onSave={(title, discardRoundId) => editStoryTitle(story().id, title, discardRoundId)}
                          onHandle={(handle) => { titleEditor = handle; }}
                          fallbackFocus={() => editTitleButton?.focus()}
                        />

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
                            when={confirmingDelete()}
                            fallback={
                              <>
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
                                  aria-expanded={titleEditor?.isEditing() ? 'true' : 'false'}
                                  disabled={locked() || busy()}
                                  focusableWhenDisabled
                                  onClick={() => {
                                    if (!locked()) {
                                      cancelDelete(false);
                                      setEditingEstimate(null);
                                      titleEditor?.start();
                                    }
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
                                      aria-expanded={estimateEditor() ? 'true' : 'false'}
                                      disabled={locked() || busy()}
                                      focusableWhenDisabled
                                      onClick={() => {
                                        if (!locked()) {
                                          cancelDelete(false);
                                          titleEditor?.cancel();
                                          setEditingEstimate({ storyId: story().id, expectedEstimate: estimate() });
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

                                <Button
                                  ref={deleteButton}
                                  class="poker-row-btn poker-row-btn-danger board-focus-ring"
                                  aria-label={`Delete ${story().title}`}
                                  title={locked() ? 'Unlock Story to delete' : 'Delete Story'}
                                  disabled={locked() || busy() || confirming()}
                                  focusableWhenDisabled
                                  onClick={() => startDelete(story())}
                                >
                                  <LucideIcon icon={Trash2} class="size-3" strokeWidth={2} />
                                  <span class="sr-only">Delete Story</span>
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
                              </>
                            }
                          >
                            <div
                              ref={confirmGroup}
                              class="poker-row-confirm"
                              role="group"
                              aria-label={`Confirm deleting ${story().title}`}
                            >
                              <span
                                class="poker-row-confirm-note"
                                data-warning={deleteDiscardRoundId() !== undefined ? 'true' : undefined}
                              >
                                {deleteDiscardRoundId() !== undefined
                                  ? 'Delete? Active votes will be discarded.'
                                  : 'Delete Story?'}
                              </span>
                              <div class="ms-auto flex items-center gap-1">
                                <Button
                                  ref={cancelDeleteButton}
                                  class="poker-row-btn board-focus-ring"
                                  aria-label={`Cancel deleting ${story().title}`}
                                  disabled={busy()}
                                  focusableWhenDisabled
                                  onClick={() => cancelDelete(true)}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  class="poker-row-btn poker-row-btn-danger-solid board-focus-ring"
                                  aria-label={`Confirm delete ${story().title}`}
                                  data-agent-confirm={
                                    deleteDiscardRoundId() !== undefined
                                      ? 'Deletes this Story and discards the current Voting Round and its votes.'
                                      : 'Deletes this Story from the queue.'
                                  }
                                  disabled={busy()}
                                  focusableWhenDisabled
                                  onClick={() => void confirmDelete(story(), deleteDiscardRoundId())}
                                >
                                  Confirm
                                </Button>
                              </div>
                            </div>
                          </Show>
                        </div>

                        <Show when={!locked() ? estimateEditor() : undefined} keyed>
                          {(edit) => (
                            <PokerEstimateForm
                              deck={props.deck}
                              busy={busy()}
                              initialChoice={edit.expectedEstimate}
                              onSave={(choice) => void saveEstimate(edit.expectedEstimate, choice)}
                              onCancel={finishEditingEstimate}
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
