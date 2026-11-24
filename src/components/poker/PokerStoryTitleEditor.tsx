import { Button } from '@ui-sdk/solid/button';
import { usePrimitive } from '@ui-sdk/solid/primitive';
import { Check, X } from 'lucide';
import { Show, createEffect, createSignal, untrack } from 'solid-js';

import { confirmBoardAction } from '../../lib/board-confirm';
import { createDoubleTap } from '../../lib/double-tap';
import { createInlineEditSave, inlineEdit, type InlineEditOutcome } from '../../lib/inline-edit';
import { POKER_STORY_TITLE_LIMIT, type PokerStory } from '../../lib/poker-types';
import LucideIcon from '../LucideIcon';

export interface PokerStoryTitleEditorHandle {
  start: () => void;
  cancel: () => void;
  isEditing: () => boolean;
}

export default function PokerStoryTitleEditor(props: {
  story: PokerStory;
  canEdit: boolean;
  confirmRestartVoting?: boolean;
  variant: 'queue' | 'stage';
  onSave: (title: string) => Promise<InlineEditOutcome>;
  onHandle?: (handle: PokerStoryTitleEditorHandle) => void;
  fallbackFocus?: () => void;
}) {
  const canEdit = () => props.canEdit && !props.story.locked;

  const titleField = usePrimitive(inlineEdit, () => ({
    value: () => props.story.title,
    commit: (text: string) => titleSave.commit(text),
    disabled: () => !canEdit(),
  }));
  const titleEdit = titleField.api.edit;
  const titleSave = createInlineEditSave(saveTitleText, () => titleEdit.cancel());
  const isEditing = () => titleField.present('input');
  const [hasText, setHasText] = createSignal(true);
  let editorEl: HTMLDivElement | undefined;
  let inputEl: HTMLInputElement | undefined;

  const titleTap = createDoubleTap(() => canEdit(), startEdit);

  function startEdit(): void {
    titleTap.reset();
    if (!canEdit()) return;
    titleSave.resetError();
    setHasText(props.story.title.trim().length > 0);
    titleEdit.start(props.story.id);
  }

  function cancelEdit(): void {
    titleTap.reset();
    titleSave.resetError();
    titleEdit.cancel();
  }

  async function saveTitleText(text: string): Promise<InlineEditOutcome> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return 'Enter a Story title.';
    if (trimmed === props.story.title) return true;
    if (props.confirmRestartVoting) {
      const confirmed = await confirmBoardAction({
        title: 'Change active Story title?',
        description: 'Changing the title restarts the current Voting Round with empty ballots.',
        cancelLabel: 'Keep current title',
        confirmLabel: 'Save and restart voting',
        agentConfirm: 'Changes the active Story title and restarts the current Voting Round with empty ballots.',
      });
      if (!confirmed) return true;
    }
    return props.onSave(trimmed);
  }

  untrack(() => props.onHandle)?.({
    start: startEdit,
    cancel: cancelEdit,
    isEditing,
  });

  createEffect(isEditing, (editing) => {
    if (editing && inputEl) titleEdit.bindInput(inputEl);
  });

  createEffect(isEditing, (editing, wasEditing) => {
    if (!editing && wasEditing && document.activeElement === document.body) {
      props.fallbackFocus?.();
    }
  });

  createEffect(
    () => !canEdit() && isEditing(),
    (shouldCancel) => {
      if (shouldCancel) untrack(cancelEdit);
    },
  );

  createEffect(
    () => props.story.id,
    (id, previousId) => {
      if (previousId !== undefined && id !== previousId) untrack(cancelEdit);
    },
  );

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    titleEdit.inputKeydown(event);
  }

  function handleFocusOut(event: FocusEvent): void {
    if (event.relatedTarget instanceof Node && editorEl?.contains(event.relatedTarget)) return;
    titleEdit.end('focus-out', event);
  }

  return (
    <Show
      when={isEditing()}
      fallback={
        <p
          class={props.variant === 'stage' ? 'poker-active-title' : 'poker-story-title min-w-0 flex-1'}
          data-editable={canEdit() ? 'true' : undefined}
          title={canEdit() ? `${props.story.title} — Double-click to edit` : undefined}
          onDblClick={() => {
            if (!canEdit()) return;
            titleTap.reset();
            startEdit();
          }}
          onPointerDown={titleTap.onPointerDown}
          onPointerUp={titleTap.onPointerUp}
          onPointerCancel={titleTap.onPointerCancel}
        >
          {props.story.title}
        </p>
      }
    >
      <div
        ref={editorEl}
        class={props.variant === 'stage' ? 'poker-active-title-editor' : 'poker-story-inline-editor min-w-0 flex-1'}
      >
        <div class={props.variant === 'stage' ? 'flex w-full items-center justify-center gap-1.5' : 'flex min-w-0 items-center gap-1'}>
          <input
            ref={inputEl}
            type="text"
            aria-label="Edit Story title"
            aria-invalid={titleSave.error() ? 'true' : undefined}
            maxlength={POKER_STORY_TITLE_LIMIT}
            readonly={titleSave.isSaving()}
            onKeyDown={handleKeyDown}
            onFocusOut={handleFocusOut}
            onInput={(event) => {
              titleSave.resetError();
              setHasText(event.currentTarget.value.trim().length > 0);
            }}
            class={
              props.variant === 'stage'
                ? 'poker-active-title-input board-focus-ring'
                : 'poker-story-inline-input board-focus-ring'
            }
          />
          <Button
            class={[
              'poker-inline-action poker-inline-action-save spring-press board-focus-ring',
              props.variant === 'stage' ? 'poker-inline-action-stage' : '',
            ]}
            aria-label="Save Story title"
            title="Save title"
            disabled={titleSave.isSaving() || !hasText()}
            focusableWhenDisabled
            onClick={() => titleEdit.end()}
          >
            <LucideIcon icon={Check} class="size-3.5" strokeWidth={2.2} />
          </Button>
          <Button
            class={[
              'poker-inline-action spring-press board-focus-ring',
              props.variant === 'stage' ? 'poker-inline-action-stage' : '',
            ]}
            aria-label="Cancel Story title edit"
            title="Cancel"
            disabled={titleSave.isSaving()}
            onClick={cancelEdit}
          >
            <LucideIcon icon={X} class="size-3.5" strokeWidth={2} />
          </Button>
        </div>
        <Show when={titleSave.error()}>
          {(message) => (
            <p class="poker-error-text mt-1 text-xs font-medium" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </div>
    </Show>
  );
}
