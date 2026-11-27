import { createMemo, createSignal, onCleanup } from 'solid-js';

import type { BoardMutationResult } from './board-controller';
import type { ActionItemPatch } from './board-types';
import { createInlineEditSession, type InlineEditOutcome } from './inline-edit';

interface ActionItemFollowUpOptions {
  target: () => string | undefined;
  open: () => boolean;
  owner: () => string;
  done: () => boolean;
  pending: () => boolean;
  update: (cardId: string, patch: ActionItemPatch) => Promise<BoardMutationResult>;
  ownerError: string;
  doneError?: string;
}

export function createActionItemFollowUp(options: ActionItemFollowUpOptions) {
  const targetId = createMemo(options.target);
  const target = createMemo(() => {
    const cardId = targetId();
    return cardId === undefined ? undefined : { cardId };
  });
  type Target = NonNullable<ReturnType<typeof target>>;
  const [queuedDone, setQueuedDone] = createSignal<{ target: Target; checked: boolean }>();
  const [doneFailure, setDoneFailure] = createSignal<{ target: Target; message: string }>();
  let activeDone: Target | undefined;
  let ownerInput: HTMLInputElement | undefined;
  let disposed = false;
  onCleanup(() => { disposed = true; });

  const ownerEdit = createInlineEditSession({
    value: options.owner,
    target: () => options.open() ? targetId() : undefined,
    alwaysMounted: true,
    async save(text, isCurrent): Promise<InlineEditOutcome> {
      const current = target();
      if (!current || options.pending()) return false;
      setDoneFailure(undefined);
      const trimmed = text.trim();
      try {
        const result = await options.update(current.cardId, { actionOwner: trimmed });
        if (!isCurrent()) return false;
        if (result.ok && ownerInput) ownerInput.value = trimmed;
        return result.ok ? true : result.message;
      } catch {
        return isCurrent() ? options.ownerError : false;
      }
    },
  });

  function bindOwnerInput(input: HTMLInputElement): void {
    ownerInput = input;
    ownerEdit.inputRef(input);
  }

  function doneChecked(): boolean {
    const queued = queuedDone();
    return queued && queued.target === target() ? queued.checked : options.done();
  }

  function clearDoneError(): void {
    setDoneFailure(undefined);
  }

  async function changeDone(checkbox: HTMLInputElement): Promise<void> {
    const current = target();
    if (!options.open() || !current || activeDone || (options.pending() && !ownerEdit.saving())) {
      checkbox.checked = doneChecked();
      return;
    }
    const checked = checkbox.checked;
    activeDone = current;
    setDoneFailure(undefined);
    try {
      // Stage the queued Done state before triggering an owner submit so the
      // controller's flush commits it before any Solid transition opens.
      if (ownerEdit.saving() || ownerInput?.matches(':focus')) {
        setQueuedDone({ target: current, checked });
      }
      // Some browsers let a checkbox click leave focus on the owner field.
      if (!ownerEdit.saving() && ownerInput?.matches(':focus')) ownerEdit.submit();
      const ownerSave = ownerEdit.saving();
      if (ownerSave) {
        await ownerSave;
      } else if (!disposed) {
        setQueuedDone(undefined);
      }
      if ((!disposed && target() !== current) || options.target() !== current.cardId) {
        if (checkbox.isConnected) checkbox.checked = options.done();
        return;
      }
      const pendingUpdate = options.update(current.cardId, { actionDone: checked });
      if (!disposed) setQueuedDone(undefined);
      const result = await pendingUpdate;
      if (!result.ok) {
        if (checkbox.isConnected) checkbox.checked = options.done();
        if (!disposed && target() === current) {
          setDoneFailure({ target: current, message: result.message });
        }
      }
    } catch {
      if (checkbox.isConnected) checkbox.checked = options.done();
      if (!disposed && target() === current) {
        setDoneFailure({
          target: current,
          message: options.doneError ?? 'Could not update Done. Try again.',
        });
      }
    } finally {
      activeDone = undefined;
      if (!disposed) setQueuedDone(undefined);
    }
  }

  return {
    ownerEdit,
    bindOwnerInput,
    changeDone,
    clearDoneError,
    doneChecked,
    isSaving: () => ownerEdit.isSaving() || options.pending(),
    doneDisabled: () =>
      !options.open() ||
      targetId() === undefined ||
      queuedDone()?.target === target() ||
      (options.pending() && !ownerEdit.isSaving()),
    doneError: () => {
      const failure = doneFailure();
      return failure && failure.target === target() ? failure.message : null;
    },
  };
}
