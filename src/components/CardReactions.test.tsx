import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardMutationResult } from '../lib/board-controller';
import CardReactions from './CardReactions';

const ok = async (): Promise<BoardMutationResult> => ({ ok: true });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderPicker(onOutsideClick = vi.fn()) {
  return render(() => (
    <>
      <CardReactions
        cardId="card_1"
        reactions={{}}
        myReactions={[]}
        disabled={false}
        onToggleReaction={ok}
      />
      <button type="button" onClick={onOutsideClick}>Other Card</button>
    </>
  ));
}

describe('<CardReactions /> picker dismissal', () => {
  it('opens a floating picker and announces pending updates without adding a text row', async () => {
    const { artifact } = await captureArtifact(() => {
      const onToggleReaction = vi.fn(() => new Promise<BoardMutationResult>(() => {}));
      const view = render(() => (
        <CardReactions
          cardId="card_1"
          reactions={{}}
          myReactions={[]}
          disabled={false}
          onToggleReaction={onToggleReaction}
        />
      ));
      fireEvent.click(view.getByRole('button', { name: 'Add reaction' }));
      flush();

      const picker = view.getByRole('group', { name: 'Choose a reaction' });
      expect(picker.closest('[popover]')).toBeInTheDocument();
      expect(within(picker).getAllByRole('button')).toHaveLength(6);
      fireEvent.click(within(picker).getByRole('button', { name: '🎉' }));
      flush();
      expect(onToggleReaction).toHaveBeenCalledExactlyOnceWith('card_1', '🎉');
      const pending = view.getByText('Updating reaction…');
      expect(pending).toHaveAttribute('aria-live', 'polite');
      expect(pending).toHaveClass('sr-only');
    }, { scenario: 'card-reactions-popup' });
    expectNoDiagnostics(artifact);
  });

  it('starts closed when reactions become available again', () => {
    const [disabled, setDisabled] = createSignal(false);
    const view = render(() => (
      <CardReactions
        cardId="card_1"
        reactions={{}}
        myReactions={[]}
        disabled={disabled()}
        onToggleReaction={ok}
      />
    ));
    const trigger = () => view.getByRole('button', { name: 'Add reaction' });
    fireEvent.click(trigger());
    flush();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    setDisabled(true);
    flush();
    expect(view.queryByRole('button', { name: 'Add reaction' })).toBeNull();

    setDisabled(false);
    flush();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('clears the Board overlay when focus moves to another Card', () => {
    const view = renderPicker();
    const trigger = view.getByRole('button', { name: 'Add reaction' });
    fireEvent.click(trigger);
    flush();

    view.getByRole('button', { name: '🎉' }).focus();
    flush();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const nextCard = view.getByRole('button', { name: 'Other Card' });
    nextCard.focus();
    flush();
    expect(nextCard).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('lets an outside press dismiss the picker while the click still reaches its target', () => {
    const onOutsideClick = vi.fn();
    const view = renderPicker(onOutsideClick);
    const trigger = view.getByRole('button', { name: 'Add reaction' });
    trigger.focus();
    fireEvent.click(trigger);
    flush();

    const nextCard = view.getByRole('button', { name: 'Other Card' });
    fireEvent.pointerDown(nextCard, { button: 0 });
    // A real pointer press focuses the target; jsdom clicks do not.
    nextCard.focus();
    flush();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(nextCard);
    flush();
    expect(onOutsideClick).toHaveBeenCalledOnce();
    expect(nextCard).toHaveFocus();
  });

  it('dismisses the picker on an outside pointer press even without a click', () => {
    const view = renderPicker();
    const trigger = view.getByRole('button', { name: 'Add reaction' });
    fireEvent.click(trigger);
    flush();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const nextCard = view.getByRole('button', { name: 'Other Card' });
    fireEvent.pointerDown(nextCard, { button: 0 });
    flush();
    expect(nextCard).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
