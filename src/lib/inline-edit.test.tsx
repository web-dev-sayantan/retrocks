import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { Show, createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createInlineEditSession,
  type InlineEditOutcome,
  type InlineEditSession,
} from './inline-edit';

afterEach(() => {
  cleanup();
});

function fireTouchTap(target: Element) {
  const init = {
    pointerType: 'touch',
    isPrimary: true,
    pointerId: 1,
    clientX: 24,
    clientY: 24,
    bubbles: true,
    cancelable: true,
  };
  fireEvent.pointerDown(target, init);
  fireEvent.pointerUp(target, init);
}

function mountHarness(options: {
  initialValue?: string;
  initialTarget?: string | undefined;
  initialDisabled?: boolean;
  save?: (text: string, isCurrent: () => boolean) => Promise<InlineEditOutcome>;
  acceptsTarget?: (target: EventTarget | null) => boolean;
} = {}) {
  const [value, setValue] = createSignal(options.initialValue ?? 'Original title');
  const [target, setTarget] = createSignal<string | undefined>(
    'initialTarget' in options ? options.initialTarget : 'item-1',
  );
  const [disabled, setDisabled] = createSignal(options.initialDisabled ?? false);
  const save = vi.fn(
    options.save ?? (async (text: string): Promise<InlineEditOutcome> => {
      setValue(text);
      return true;
    }),
  );
  let fallbackEl: HTMLHeadingElement | undefined;
  const fallbackFocus = vi.fn(() => {
    fallbackEl?.focus();
  });
  let session!: InlineEditSession;

  const view = render(() => {
    session = createInlineEditSession({
      value,
      target,
      disabled,
      save,
      fallbackFocus,
      acceptsTarget: options.acceptsTarget,
    });

    return (
      <div>
        <h1 ref={fallbackEl} tabindex={-1}>
          Heading
        </h1>
        <button type="button">Outside control</button>
        <Show
          when={session.isEditing()}
          fallback={
            <div data-testid="trigger" {...session.triggerProps}>
              <span>{value()}</span>
              <button type="button">Nested action</button>
            </div>
          }
        >
          <div ref={session.containerRef} data-testid="editor">
            <input
              ref={session.inputRef}
              type="text"
              aria-label="Edit value"
              readonly={session.isSaving()}
              {...session.inputProps}
            />
            <button
              type="button"
              aria-label="Save"
              disabled={session.isSaving() || !session.hasText()}
              onClick={() => session.submit()}
            >
              Save
            </button>
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => session.cancel()}
            >
              Cancel
            </button>
            <span data-testid="draft-length">{session.draftLength()}</span>
            <Show when={session.error()}>
              {(message) => <p role="alert">{message()}</p>}
            </Show>
          </div>
        </Show>
      </div>
    );
  });

  return {
    view,
    session,
    save,
    fallbackFocus,
    setValue,
    setTarget,
    setDisabled,
  };
}

describe('createInlineEditSession', () => {
  it('opens on double-click and touch double-tap, respects acceptsTarget and disabled, and tracks draft state', () => {
    const h = mountHarness({
      initialValue: 'Alpha',
      acceptsTarget: (t) => !(t instanceof Element && t.closest('button')),
    });

    fireEvent.dblClick(screen.getByRole('button', { name: 'Nested action' }));
    flush();
    expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull();

    fireEvent.dblClick(screen.getByText('Alpha'));
    flush();
    const input = screen.getByRole('textbox', { name: 'Edit value' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Alpha');
    expect(screen.getByTestId('draft-length')).toHaveTextContent('5');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    fireEvent.input(input, { target: { value: '   ' } });
    flush();
    expect(screen.getByTestId('draft-length')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    flush();
    expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull();

    // Touch double-tap opens editing
    const label = screen.getByText('Alpha');
    fireTouchTap(label);
    flush();
    expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull();
    fireTouchTap(label);
    flush();
    expect(screen.getByRole('textbox', { name: 'Edit value' })).toHaveFocus();

    h.session.cancel();
    flush();

    // Disabled blocks double-click, double-tap, and programmatic start
    h.setDisabled(true);
    flush();
    fireEvent.dblClick(screen.getByText('Alpha'));
    fireTouchTap(screen.getByText('Alpha'));
    fireTouchTap(screen.getByText('Alpha'));
    h.session.start();
    flush();
    expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull();
  });

  it('suppresses Enter and Escape during IME composition and commits on plain Enter', async () => {
    const h = mountHarness({ initialValue: 'Draft' });

    fireEvent.dblClick(screen.getByText('Draft'));
    flush();
    const input = screen.getByRole('textbox', { name: 'Edit value' });
    fireEvent.input(input, { target: { value: 'Updated' } });

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
    flush();

    expect(h.save).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('Updated');

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull());
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0]?.[0]).toBe('Updated');
    expect(screen.getByText('Updated')).toBeInTheDocument();
  });

  it('cancels on Escape with default prevented and propagation stopped while idle and while a save is in flight', async () => {
    const pending = Promise.withResolvers<InlineEditOutcome>();
    const h = mountHarness({
      initialValue: 'Original',
      save: () => pending.promise,
    });

    const parentKeyDown = vi.fn();
    document.body.addEventListener('keydown', parentKeyDown);
    try {
      // Idle Escape
      fireEvent.dblClick(screen.getByText('Original'));
      flush();
      const input = screen.getByRole('textbox', { name: 'Edit value' });
      fireEvent.input(input, { target: { value: 'Unsaved' } });

      const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      input.dispatchEvent(escEvent);
      flush();
      expect(escEvent.defaultPrevented).toBe(true);
      expect(parentKeyDown).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull();
      expect(h.save).not.toHaveBeenCalled();

      // In-flight Escape
      fireEvent.dblClick(screen.getByText('Original'));
      flush();
      const savingInput = screen.getByRole('textbox', { name: 'Edit value' });
      fireEvent.input(savingInput, { target: { value: 'Slow save' } });
      fireEvent.keyDown(savingInput, { key: 'Enter' });
      expect(h.save).toHaveBeenCalledTimes(1);
      const isCurrent = h.save.mock.calls[0]?.[1];
      expect(isCurrent?.()).toBe(true);

      fireEvent.keyDown(savingInput, { key: 'Escape' });
      flush();
      expect(isCurrent?.()).toBe(false);
      expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull();

      // Reopen before late error resolves
      fireEvent.dblClick(screen.getByText('Original'));
      flush();
      const freshInput = screen.getByRole('textbox', { name: 'Edit value' });
      fireEvent.input(freshInput, { target: { value: 'Fresh draft' } });

      pending.resolve('Stale error');
      await pending.promise;
      await Promise.resolve();
      flush();

      expect(screen.queryByRole('alert')).toBeNull();
      expect(freshInput).toHaveFocus();
      expect(freshInput).toHaveValue('Fresh draft');
    } finally {
      document.body.removeEventListener('keydown', parentKeyDown);
    }
  });

  it('ignores focus-out inside the editor container and commits on focus-out outside', async () => {
    const h = mountHarness({ initialValue: 'Title' });

    fireEvent.dblClick(screen.getByText('Title'));
    flush();
    const input = screen.getByRole('textbox', { name: 'Edit value' });
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.input(input, { target: { value: 'Edited' } });

    // Moving focus to Cancel inside container does not commit
    fireEvent.focusOut(input, { relatedTarget: cancelBtn });
    flush();
    expect(h.save).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();

    // Clicking Cancel discards without saving
    fireEvent.click(cancelBtn);
    flush();
    expect(h.save).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull();

    // Moving focus outside container commits
    fireEvent.dblClick(screen.getByText('Title'));
    flush();
    const secondInput = screen.getByRole('textbox', { name: 'Edit value' });
    fireEvent.input(secondInput, { target: { value: 'Committed on blur' } });
    fireEvent.focusOut(secondInput, { relatedTarget: screen.getByRole('button', { name: 'Outside control' }) });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull());
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0]?.[0]).toBe('Committed on blur');
  });

  it.each(['disable', 'target-change', 'unmount'] as const)(
    'invalidates an active session and in-flight save on %s',
    async (reason) => {
      const pending = Promise.withResolvers<InlineEditOutcome>();
      const h = mountHarness({
        initialValue: 'Before',
        save: () => pending.promise,
      });

      fireEvent.dblClick(screen.getByText('Before'));
      flush();
      const input = screen.getByRole('textbox', { name: 'Edit value' });
      fireEvent.input(input, { target: { value: 'Pending edit' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      const isCurrent = h.save.mock.calls[0]?.[1];
      expect(isCurrent?.()).toBe(true);

      if (reason === 'disable') {
        h.setDisabled(true);
        flush();
      } else if (reason === 'target-change') {
        h.setTarget('item-2');
        flush();
      } else {
        h.view.unmount();
      }

      expect(isCurrent?.()).toBe(false);
      expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull();

      pending.resolve('Late failure');
      await pending.promise;
      await Promise.resolve();
      flush();
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );

  it('resets touch double-tap state when disabled toggles between taps', () => {
    const h = mountHarness({ initialValue: 'Tap target' });
    const label = screen.getByText('Tap target');

    fireTouchTap(label);
    h.setDisabled(true);
    flush();
    h.setDisabled(false);
    flush();
    fireTouchTap(label);
    flush();

    expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull();
  });

  it('serializes concurrent save attempts, retains the draft on error, clears error on input, and retries', async () => {
    const first = Promise.withResolvers<InlineEditOutcome>();
    let call = 0;
    const h = mountHarness({
      initialValue: 'Initial',
      save: async (text) => {
        call += 1;
        if (call === 1) return first.promise;
        if (call === 2) return false;
        h.setValue(text);
        return true;
      },
    });

    fireEvent.dblClick(screen.getByText('Initial'));
    flush();
    const input = screen.getByRole('textbox', { name: 'Edit value' });
    fireEvent.input(input, { target: { value: 'Attempt 1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.focusOut(input, { relatedTarget: document.body });
    expect(h.save).toHaveBeenCalledTimes(1);

    first.resolve('Save failed');
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    expect(input).toHaveValue('Attempt 1');

    // Typing clears the error
    fireEvent.input(input, { target: { value: 'Attempt 2' } });
    flush();
    expect(screen.queryByRole('alert')).toBeNull();

    // Returning false keeps the editor open silently
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input).toBeInTheDocument();

    // Retry succeeds and closes
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull());
    expect(h.save).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Attempt 2')).toBeInTheDocument();
  });

  it('restores fallback focus only when focus would fall back to document.body', async () => {
    const h = mountHarness({ initialValue: 'Focusable' });

    // Escape from input moves focus to document.body -> fallbackFocus restores to heading
    fireEvent.dblClick(screen.getByText('Focusable'));
    flush();
    const input = screen.getByRole('textbox', { name: 'Edit value' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    flush();
    expect(h.fallbackFocus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Heading' })).toHaveFocus();

    // Moving focus to another control before closing does NOT steal focus back
    h.fallbackFocus.mockClear();
    fireEvent.dblClick(screen.getByText('Focusable'));
    flush();
    const secondInput = screen.getByRole('textbox', { name: 'Edit value' });
    const outside = screen.getByRole('button', { name: 'Outside control' });
    outside.focus();
    fireEvent.focusOut(secondInput, { relatedTarget: outside });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit value' })).toBeNull());
    expect(h.fallbackFocus).not.toHaveBeenCalled();
    expect(outside).toHaveFocus();
  });

  it('supports alwaysMounted inputs with lazy start, idle live sync, Escape pass-through, IME guard, and target invalidation', async () => {
    const pending = Promise.withResolvers<InlineEditOutcome>();
    let call = 0;
    const [value, setValue] = createSignal('Platform');
    const [target, setTarget] = createSignal<string | undefined>('card_1');
    const [disabled, setDisabled] = createSignal(false);
    const save = vi.fn(async (text: string, _isCurrent: () => boolean): Promise<InlineEditOutcome> => {
      call += 1;
      if (call === 1) return pending.promise;
      setValue(text);
      return true;
    });
    let session!: InlineEditSession;

    render(() => {
      session = createInlineEditSession({
        value,
        target,
        disabled,
        save,
        alwaysMounted: true,
      });
      return (
        <div>
          <input
            ref={session.inputRef}
            type="text"
            aria-label="Owner"
            defaultValue={value()}
            readonly={session.isSaving()}
            {...session.inputProps}
          />
          <Show when={session.error()}>
            {(message) => <p role="alert">{message()}</p>}
          </Show>
        </div>
      );
    });
    flush();

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Owner' });
    expect(input).toHaveValue('Platform');

    // Live updates sync while idle
    setValue('Infra');
    flush();
    expect(input).toHaveValue('Infra');

    // Escape while idle bubbles without preventDefault
    const parentKeyDown = vi.fn();
    document.body.addEventListener('keydown', parentKeyDown);
    try {
      const idleEsc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      input.dispatchEvent(idleEsc);
      flush();
      expect(idleEsc.defaultPrevented).toBe(false);
      expect(parentKeyDown).toHaveBeenCalledTimes(1);

      // Typing starts the session and preserves draft/caret across live updates
      input.focus();
      fireEvent.input(input, { target: { value: 'API squad' } });
      input.setSelectionRange(3, 3);
      flush();
      setValue('SRE');
      flush();
      expect(input).toHaveValue('API squad');
      expect(input.selectionStart).toBe(3);

      // IME Enter is ignored
      fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
      flush();
      expect(save).not.toHaveBeenCalled();

      // Escape while editing stops propagation and restores committed value
      parentKeyDown.mockClear();
      const editEsc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      input.dispatchEvent(editEsc);
      flush();
      expect(editEsc.defaultPrevented).toBe(true);
      expect(parentKeyDown).not.toHaveBeenCalled();
      expect(input).toHaveValue('SRE');

      // In-flight save is invalidated when target changes
      fireEvent.input(input, { target: { value: 'Core' } });
      flush();
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(save).toHaveBeenCalledTimes(1);
      expect(session.saving()).toBeDefined();
      const isCurrent = save.mock.calls[0]?.[1];
      expect(isCurrent?.()).toBe(true);

      setValue('Mobile');
      setTarget('card_2');
      flush();
      expect(isCurrent?.()).toBe(false);
      expect(input).toHaveValue('Mobile');

      pending.resolve('Stale error');
      await pending.promise;
      await Promise.resolve();
      flush();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(input).toHaveValue('Mobile');

      // Disabled prevents starting a new edit
      setDisabled(true);
      flush();
      fireEvent.input(input, { target: { value: 'Blocked' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      flush();
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeEventListener('keydown', parentKeyDown);
    }
  });
});
