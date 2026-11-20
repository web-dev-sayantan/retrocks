import { Button } from '@ui-sdk/solid/button';
import { Field, FieldLabel } from '@ui-sdk/solid/field';
import { Input } from '@ui-sdk/solid/input';
import { ChevronDown, ChevronUp } from 'lucide';
import { For, Show, createSignal, createUniqueId, onSettled, untrack } from 'solid-js';

import {
  POKER_STORY_TITLE_LIMIT,
  type PokerResult,
  type PokerStory,
  type PokerStoryCommand,
} from '../../lib/poker-types';
import { confirmBoardAction } from '../../lib/board-confirm';
import LucideIcon from '../LucideIcon';

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
      class="poker-story-form poker-form"
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
      <Field name="title" class="min-w-0">
        <FieldLabel class="mb-1 block text-sm font-semibold">Story title</FieldLabel>
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
      <div class="flex flex-wrap gap-2">
        <Button
          class="poker-primary board-focus-ring"
          type="submit"
          disabled={props.busy || !ready()}
          focusableWhenDisabled={ready()}
        >
          {editing() ? 'Save title' : 'Add Story'}
        </Button>
        <Show when={props.onCancel}>
          <Button class="poker-secondary board-focus-ring" onClick={() => props.onCancel?.()} disabled={props.busy}>
            Cancel
          </Button>
        </Show>
      </div>
    </form>
  );
}

export default function PokerStoryQueue(props: {
  stories: PokerStory[];
  activeStoryId: string | null;
  canManage: boolean;
  discardRoundId?: string;
  onChange: (command: PokerStoryCommand) => Promise<PokerResult>;
}) {
  const headingId = createUniqueId();
  const [editing, setEditing] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [announcement, setAnnouncement] = createSignal('');
  const [confirming, setConfirming] = createSignal(false);

  async function change(command: PokerStoryCommand) {
    if (busy()) return null;
    setBusy(true);
    setError('');
    try {
      const result = await props.onChange(command);
      if (result.ok) return result.room;
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
    if (busy() || confirming()) return;
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

  async function move(story: PokerStory, index: number, offset: -1 | 1, control: HTMLElement) {
    const target = props.stories[index + offset];
    if (!target) return;
    const document = control.ownerDocument;
    const hadFocus = document.activeElement === control;
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
    if (hadFocus && document.activeElement === document.body && control.isConnected) {
      control.focus({ preventScroll: true });
    }
  }

  return (
    <section class="poker-queue min-w-0 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby={headingId}>
      <h2 id={headingId} class="text-xl font-semibold tracking-tight">Story queue</h2>
      <Show when={props.canManage}>
        <StoryTitleForm busy={busy()} onSave={addStory} />
      </Show>
      <Show when={props.stories.length} fallback={
        <p class="mt-4 text-sm leading-relaxed text-text-muted">No Stories have been added yet.</p>
      }>
        <ol class="poker-story-list mt-4 grid gap-2" aria-labelledby={headingId}>
          <For each={props.stories} keyed={(story) => story.id}>
            {(story, index) => {
              const active = () => props.activeStoryId === story().id;
              const selected = () => active() && props.discardRoundId !== undefined;
              let editButton: HTMLButtonElement | undefined;
              function finishEditing() {
                setEditing(null);
                editButton?.focus();
              }
              async function saveTitle(title: string) {
                const room = await change({ type: 'edit-story', storyId: story().id, title });
                if (room) finishEditing();
                return Boolean(room);
              }

              return (
                <li class="poker-story" aria-current={active() ? 'true' : undefined}>
                  <div class="flex items-start justify-between gap-3">
                    <p class="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{story().title}</p>
                    <span class="poker-story-status">
                      {storyStatuses[story().status]}
                      <Show when={story().acceptedEstimate}>
                        {(estimate) => <> · {estimate()}</>}
                      </Show>
                    </span>
                  </div>
                  <Show when={props.canManage}>
                    <div class="mt-2 flex flex-wrap items-center gap-1">
                      <Show when={story().status === 'pending'}>
                        <Button
                          class="poker-story-control board-focus-ring"
                          aria-label={`${selected() ? 'Selected' : 'Select'} ${story().title}`}
                          disabled={selected() || busy() || confirming()}
                          focusableWhenDisabled
                          onClick={() => selectStory(story())}
                        >
                          {selected() ? 'Selected' : 'Select'}
                        </Button>
                        <Button
                          ref={editButton}
                          class="poker-story-control board-focus-ring"
                          aria-label={`Edit ${story().title}`}
                          aria-expanded={editing() === story().id ? 'true' : 'false'}
                          disabled={busy()}
                          focusableWhenDisabled
                          onClick={() => setEditing(story().id)}
                        >
                          Edit
                        </Button>
                      </Show>
                      <div class="poker-move-controls">
                        <Button
                          class="poker-story-control board-focus-ring"
                          aria-label={`Move ${story().title} up`}
                          disabled={index() === 0 || busy()}
                          focusableWhenDisabled
                          onClick={(event) => move(story(), index(), -1, event.currentTarget)}
                        >
                          <LucideIcon icon={ChevronUp} />
                        </Button>
                        <Button
                          class="poker-story-control board-focus-ring"
                          aria-label={`Move ${story().title} down`}
                          disabled={index() === props.stories.length - 1 || busy()}
                          focusableWhenDisabled
                          onClick={(event) => move(story(), index(), 1, event.currentTarget)}
                        >
                          <LucideIcon icon={ChevronDown} />
                        </Button>
                      </div>
                    </div>
                    <Show when={story().status === 'pending' && editing() === story().id}>
                      <StoryTitleForm
                        initialTitle={story().title}
                        busy={busy()}
                        onSave={saveTitle}
                        onCancel={finishEditing}
                      />
                    </Show>
                  </Show>
                </li>
              );
            }}
          </For>
        </ol>
      </Show>
      <p class="sr-only" role="status">{announcement()}</p>
      <p class="text-sm font-medium text-[var(--poker-error)] [&:not(:empty)]:mt-3" role="alert">{error()}</p>
    </section>
  );
}
