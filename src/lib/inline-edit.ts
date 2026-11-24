import { createInlineEdit, definePrimitive } from '@ui-sdk/core';
import { createSignal } from 'solid-js';

/** What a save reports back: `true` saved, `false` keeps the editor open silently, a string keeps it open as the error message. */
export type InlineEditOutcome = true | false | string;

interface InlineEditFieldOptions {
  /** The committed text the input starts from when editing begins. */
  value: () => string;
  /** Saves the input's text; returning false keeps the editor open. */
  commit: (text: string) => boolean;
  /** True when the value cannot be edited right now. */
  disabled?: () => boolean;
}

/**
 * The one inline-editing session every rename surface shares: createInlineEdit
 * owns the editing id and the keyboard contract (Enter saves, Escape cancels,
 * blur saves). `present('input')` is the tracked "is editing" read; each
 * surface renders its own input element and calls `edit.bindInput`,
 * `edit.inputKeydown`, and `edit.end('focus-out')` — the Solid adapter can
 * recreate part-bound elements mid-session, which would wipe a draft in
 * progress, so the input slot carries presence only. Surfaces keep a thin
 * focus-fallback effect for when the originating control disappears.
 */
export const inlineEdit = definePrimitive({
  name: 'inline-edit',
  options: { value: 'callback', commit: 'action', disabled: 'callback' },
  state: (_options: InlineEditFieldOptions) => ({ editing: null as string | null }),
  api: (context) => ({
    // createInlineEdit must live on the api: every surface calls it from there.
    edit: createInlineEdit(context, {
      key: 'editing',
      value: () => context.options().value(),
      commit: (_id, text) => context.options().commit(text),
      disabled: () => context.options().disabled?.() ?? false,
    }),
  }),
  slots: (slot) => ({
    input: slot({
      present: (state) => state.editing !== null,
    }),
  }),
});

export interface InlineEditSave {
  /** createInlineEdit's `commit`: starts the save, then answers false until the save's own result closes the editor. */
  commit(text: string): boolean;
  /** True while a save is in flight. */
  isSaving(): boolean;
  /** The failure message of the last save attempt. */
  error(): string | null;
  /** Clears the failure message, on cancel or retry. */
  resetError(): void;
  reset(): void;
  /** The in-flight save, for callers that must serialize with it. */
  saving(): Promise<boolean> | undefined;
}

/**
 * Bridges createInlineEdit's synchronous `commit` contract to the app's async
 * mutations: `commit` fires the save and keeps the editor open; when the save
 * lands, `finish()` closes the session on success and the error shows on failure.
 */
export function createInlineEditSave(
  save: (text: string, isCurrent: () => boolean) => Promise<InlineEditOutcome>,
  finish: () => void,
  isActive: () => boolean = () => true,
): InlineEditSave {
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // A save in flight must block the next commit within the same task, before the signal catches up.
  let attempt: object | undefined;
  let pending: Promise<boolean> | undefined;
  return {
    commit(text) {
      if (attempt || !isActive()) return false;
      const current = {};
      attempt = current;
      const isCurrent = () => attempt === current && isActive();
      setError(null);
      setIsSaving(true);
      pending = (async () => {
        try {
          const outcome = await save(text, isCurrent);
          if (!isCurrent()) return false;
          if (outcome === true) finish();
          else if (typeof outcome === 'string') setError(outcome);
          return outcome === true;
        } catch {
          return false;
        } finally {
          if (attempt === current) {
            attempt = undefined;
            pending = undefined;
            if (isActive()) setIsSaving(false);
          }
        }
      })();
      return false;
    },
    isSaving: () => isSaving(),
    error: () => error(),
    resetError: () => setError(null),
    reset() {
      attempt = undefined;
      pending = undefined;
      setError(null);
      setIsSaving(false);
    },
    saving: () => pending,
  };
}
