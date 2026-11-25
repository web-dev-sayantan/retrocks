import { createMemo, createSignal, onCleanup } from 'solid-js';

import type { ActionItemPatch } from './board-types';
import { createInlineEditSession, type InlineEditOutcome } from './inline-edit';

interface ActionItemFollowUpOptions {
  target: () => string | undefined;
  open: () => boolean;
  owner: () => string;
  done: () => boolean;
  pending: () => boolean;
  update: (cardId: string, patch: ActionItemPatch) => Promise<boolean>;
  ownerError: string;
}

export function createActionItemFollowUp(options: ActionItemFollowUpOptions) {
  const targetId = createMemo(options.target);
  const target = createMemo(() => {
    const cardId = targetId();
    return cardId === undefined ? undefined : { cardId };
  });
  type Target = NonNullable<ReturnType<typeof target>>;
  const [doneSaving, setDoneSaving] = createSignal<{ target: Target; checked: boolean }>();
  const [doneFailure, setDoneFailure] = createSignal<Target>();
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
      const trimmed = text.trim();
      try {
        const saved = await options.update(current.cardId, { actionOwner: trimmed });
        if (!isCurrent()) return false;
        if (saved && ownerInput) ownerInput.value = trimmed;
        return saved ? true : options.ownerError;
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
    const pending = doneSaving();
    return pending && pending.target === target() ? pending.checked : options.done();
  }

  async function changeDone(checkbox: HTMLInputElement): Promise<void> {
    const current = target();
    if (!options.open() || !current || activeDone || (options.pending() && !ownerEdit.saving())) {
      checkbox.checked = doneChecked();
      return;
    }
    const checked = checkbox.checked;
    activeDone = current;
    setDoneSaving({ target: current, checked });
    setDoneFailure(undefined);
    try {
      // Some browsers let a checkbox click leave focus on the owner field.
      if (!ownerEdit.saving() && ownerInput?.matches(':focus')) ownerEdit.submit();
      const ownerSave = ownerEdit.saving();
      if (ownerSave) await ownerSave;
      if ((!disposed && target() !== current) || options.target() !== current.cardId) return;
      if (!await options.update(current.cardId, { actionDone: checked }) && !disposed && target() === current) {
        setDoneFailure(current);
      }
    } catch {
      if (!disposed && target() === current) setDoneFailure(current);
    } finally {
      activeDone = undefined;
      if (!disposed) setDoneSaving(undefined);
    }
  }

  return {
    ownerEdit,
    bindOwnerInput,
    changeDone,
    doneChecked,
    isSaving: () => doneSaving() !== undefined || ownerEdit.isSaving() || options.pending(),
    doneDisabled: () => !options.open() || targetId() === undefined || doneSaving() !== undefined ||
      (options.pending() && !ownerEdit.isSaving()),
    doneFailed: () => doneFailure() !== undefined && doneFailure() === target(),
  };
}
