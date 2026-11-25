import { createInlineEdit, definePrimitive } from '@ui-sdk/core';
import { usePrimitive } from '@ui-sdk/solid/primitive';
import { createEffect, createSignal, onCleanup } from 'solid-js';

import { createDoubleTap } from './double-tap';

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
  let attempt: { valid: boolean } | undefined;
  let pending: Promise<boolean> | undefined;
  return {
    commit(text) {
      if (attempt || !isActive()) return false;
      const current = { valid: true };
      attempt = current;
      const isCurrent = () => current.valid && isActive();
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
          attempt = undefined;
          pending = undefined;
          setIsSaving(false);
        }
      })();
      return false;
    },
    isSaving: () => isSaving(),
    error: () => error(),
    resetError: () => setError(null),
    reset() {
      // Ignore the outcome but keep saves serialized until the promise settles.
      if (attempt) attempt.valid = false;
      setError(null);
    },
    saving: () => pending,
  };
}

type EditorElement = HTMLInputElement | HTMLTextAreaElement;

export interface InlineEditSessionOptions {
  /** The committed text the input starts from when editing begins. */
  value: () => string;
  /** Identity key for the current editable entity; undefined disables and invalidates editing. */
  target: () => string | undefined;
  /** True when the surface cannot be edited right now (e.g. locked or missing permission). */
  disabled?: () => boolean;
  /** Persists the edited text. `isCurrent()` stays true only while this attempt still belongs to the active session. */
  save: (text: string, isCurrent: () => boolean) => Promise<InlineEditOutcome>;
  /** Restores focus when editing ends and focus would otherwise fall back to `document.body`. */
  fallbackFocus?: () => void;
  /** Optional predicate filtering double-click and touch double-tap targets on the trigger wrapper. */
  acceptsTarget?: (target: EventTarget | null) => boolean;
}

export interface InlineEditSession {
  /** True while the inline editor is open. */
  isEditing(): boolean;
  /** True while an async save attempt is in flight. */
  isSaving(): boolean;
  /** Error message from the last failed save attempt, or null. */
  error(): string | null;
  /** True when the current draft contains non-whitespace characters. */
  hasText(): boolean;
  /** Raw character length of the current draft. */
  draftLength(): number;
  /** Opens the editor for the current target when enabled and not already editing. */
  start(): void;
  /** Commits the current input value. */
  submit(): void;
  /** Cancels editing, invalidates any in-flight save, and clears errors. */
  cancel(): void;
  /** Clears the current error message without closing the editor. */
  resetError(): void;
  /** Ref callback for the editor wrapper container (used for container-aware focus-out). */
  containerRef(element: HTMLElement): void;
  /** Ref callback for the `<input>` or `<textarea>` element; owns `bindInput` and cleanup. */
  inputRef(element: EditorElement): void;
  /** Event handlers to spread onto the editable trigger wrapper (double-click + touch double-tap). */
  triggerProps: {
    onDblClick: (event: MouseEvent) => void;
    onPointerDown: (event: PointerEvent) => void;
    onPointerUp: (event: PointerEvent) => void;
    onPointerCancel: (event: PointerEvent) => void;
  };
  /** Event handlers to spread onto the `<input>` or `<textarea>` element. */
  inputProps: {
    onKeyDown: (event: KeyboardEvent) => void;
    onFocusOut: (event: FocusEvent) => void;
    onInput: (event: InputEvent) => void;
  };
}

export function createInlineEditSession(options: InlineEditSessionOptions): InlineEditSession {
  const effectiveTarget = () => (options.disabled?.() ? undefined : options.target());
  const field = usePrimitive(inlineEdit, () => ({
    value: options.value,
    commit: (text: string) => save.commit(text),
    disabled: () => effectiveTarget() === undefined,
  }));
  const edit = field.api.edit;
  const isEditing = () => field.present('input');

  let activeTarget: string | undefined;
  let disposed = false;
  let inputEl: EditorElement | undefined;
  let containerEl: HTMLElement | undefined;

  const [hasText, setHasText] = createSignal(true);
  const [draftLength, setDraftLength] = createSignal(0);

  const save = createInlineEditSave(
    options.save,
    cancel,
    () => !disposed && isEditing() && activeTarget !== undefined && effectiveTarget() === activeTarget,
  );

  const acceptsTriggerTarget = (eventTarget: EventTarget | null) =>
    effectiveTarget() !== undefined && (options.acceptsTarget?.(eventTarget) ?? true);

  const tap = createDoubleTap(acceptsTriggerTarget, () => start());

  function start(): void {
    tap.reset();
    const next = effectiveTarget();
    if (disposed || next === undefined || isEditing()) return;
    save.resetError();
    const currentValue = options.value();
    setHasText(currentValue.trim().length > 0);
    setDraftLength(currentValue.length);
    if (edit.start(next)) activeTarget = next;
  }

  function submit(): void {
    edit.end();
  }

  function cancel(): void {
    activeTarget = undefined;
    tap.reset();
    save.reset();
    edit.cancel();
  }

  createEffect(isEditing, (editing, wasEditing) => {
    if (editing) {
      if (inputEl?.isConnected) {
        const unbind = edit.bindInput(inputEl);
        return () => {
          unbind();
        };
      }
      return;
    }
    activeTarget = undefined;
    inputEl = undefined;
    containerEl = undefined;
    if (wasEditing && document.activeElement === document.body) {
      options.fallbackFocus?.();
    }
  });

  createEffect(effectiveTarget, (current, previous) => {
    if (previous !== undefined && current !== previous && (activeTarget === undefined || activeTarget !== current)) {
      cancel();
    }
  });

  onCleanup(() => {
    disposed = true;
    activeTarget = undefined;
    inputEl = undefined;
    containerEl = undefined;
    tap.reset();
    save.reset();
  });

  return {
    isEditing,
    isSaving: save.isSaving,
    error: save.error,
    hasText: () => hasText(),
    draftLength: () => draftLength(),
    start,
    submit,
    cancel,
    resetError: save.resetError,
    containerRef(element: HTMLElement) {
      containerEl = element;
    },
    inputRef(element: EditorElement) {
      inputEl = element;
    },
    triggerProps: {
      onDblClick(event: MouseEvent) {
        if (!acceptsTriggerTarget(event.target)) return;
        tap.reset();
        start();
      },
      onPointerDown: tap.onPointerDown,
      onPointerUp: tap.onPointerUp,
      onPointerCancel: tap.onPointerCancel,
    },
    inputProps: {
      onKeyDown(event: KeyboardEvent) {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancel();
          return;
        }
        edit.inputKeydown(event);
      },
      onFocusOut(event: FocusEvent) {
        if (event.relatedTarget instanceof Node && containerEl?.contains(event.relatedTarget)) return;
        edit.end('focus-out', event);
      },
      onInput(event: InputEvent) {
        save.resetError();
        const el = event.currentTarget ?? event.target;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          setHasText(el.value.trim().length > 0);
          setDraftLength(el.value.length);
        }
      },
    },
  };
}
