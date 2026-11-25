import { Button } from '@ui-sdk/solid/button';
import { Check, X } from 'lucide';
import { Show, untrack } from 'solid-js';

import { createInlineEditSession, type InlineEditOutcome } from '../../lib/inline-edit';
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
  busy?: boolean;
  variant: 'queue' | 'stage';
  onSave: (storyId: string, title: string, isCurrent: () => boolean) => Promise<InlineEditOutcome>;
  onHandle?: (handle: PokerStoryTitleEditorHandle) => void;
  fallbackFocus?: () => void;
}) {
  const canEdit = () => props.canEdit && !props.story.locked;

  const titleEdit = createInlineEditSession({
    value: () => props.story.title,
    target: () => props.story.id,
    disabled: () => !canEdit(),
    save: saveTitleText,
    fallbackFocus: () => props.fallbackFocus?.(),
  });

  const saving = () => titleEdit.isSaving() || Boolean(props.busy);

  async function saveTitleText(text: string, isCurrent: () => boolean): Promise<InlineEditOutcome> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return 'Enter a Story title.';
    if (trimmed === props.story.title) return true;
    return props.onSave(props.story.id, trimmed, isCurrent);
  }

  untrack(() => props.onHandle)?.({
    start: titleEdit.start,
    cancel: titleEdit.cancel,
    isEditing: titleEdit.isEditing,
  });

  return (
    <Show
      when={titleEdit.isEditing()}
      fallback={
        <p
          class={props.variant === 'stage' ? 'poker-active-title' : 'poker-story-title min-w-0 flex-1'}
          data-editable={canEdit() ? 'true' : undefined}
          title={canEdit() ? `${props.story.title} — Double-click to edit` : undefined}
          {...titleEdit.triggerProps}
        >
          {props.story.title}
        </p>
      }
    >
      <div
        ref={titleEdit.containerRef}
        class={props.variant === 'stage' ? 'poker-active-title-editor' : 'poker-story-inline-editor min-w-0 flex-1'}
      >
        <div class={props.variant === 'stage' ? 'flex w-full items-center justify-center gap-1.5' : 'flex min-w-0 items-center gap-1'}>
          <input
            ref={titleEdit.inputRef}
            type="text"
            aria-label="Edit Story title"
            aria-invalid={titleEdit.error() ? 'true' : undefined}
            maxlength={POKER_STORY_TITLE_LIMIT}
            readonly={saving()}
            {...titleEdit.inputProps}
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
            disabled={saving() || !titleEdit.hasText()}
            focusableWhenDisabled
            onClick={titleEdit.submit}
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
            onClick={titleEdit.cancel}
          >
            <LucideIcon icon={X} class="size-3.5" strokeWidth={2} />
          </Button>
        </div>
        <Show when={titleEdit.error()}>
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
