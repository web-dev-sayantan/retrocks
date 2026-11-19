import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasOpenBoardOverlay } from '../lib/board-view';
import CardReactions from './CardReactions';

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
        onToggleReaction={() => Promise.resolve(null)}
      />
      <button type="button" onClick={onOutsideClick}>Other Card</button>
    </>
  ));
}

describe('<CardReactions /> picker dismissal', () => {
  it('clears the Board overlay when focus moves to another Card', () => {
    const view = renderPicker();
    const trigger = view.getByRole('button', { name: 'Add reaction' });
    fireEvent.click(trigger);
    flush();

    view.getByRole('button', { name: '🎉' }).focus();
    flush();
    expect(hasOpenBoardOverlay()).toBe(true);

    const nextCard = view.getByRole('button', { name: 'Other Card' });
    nextCard.focus();
    flush();
    expect(nextCard).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(hasOpenBoardOverlay()).toBe(false);
  });

  it('keeps an outside click target in place until the click is dispatched', () => {
    const onOutsideClick = vi.fn();
    const view = renderPicker(onOutsideClick);
    const trigger = view.getByRole('button', { name: 'Add reaction' });
    trigger.focus();
    fireEvent.click(trigger);
    flush();

    const nextCard = view.getByRole('button', { name: 'Other Card' });
    fireEvent.mouseDown(nextCard, { button: 0 });
    nextCard.focus();
    flush();
    expect(hasOpenBoardOverlay()).toBe(true);

    fireEvent.mouseUp(nextCard, { button: 0 });
    flush();
    expect(hasOpenBoardOverlay()).toBe(true);
    fireEvent.click(nextCard);
    flush();
    expect(onOutsideClick).toHaveBeenCalledOnce();
    expect(nextCard).toHaveFocus();
    expect(hasOpenBoardOverlay()).toBe(false);
  });

  it('clears the Board overlay when an outside press moves focus but produces no click', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const view = renderPicker();
    const trigger = view.getByRole('button', { name: 'Add reaction' });
    fireEvent.click(trigger);
    flush();

    const nextCard = view.getByRole('button', { name: 'Other Card' });
    fireEvent.mouseDown(nextCard, { button: 0 });
    nextCard.focus();
    fireEvent.mouseUp(nextCard, { button: 0 });
    vi.advanceTimersToNextFrame();
    flush();

    expect(nextCard).toHaveFocus();
    expect(hasOpenBoardOverlay()).toBe(false);
  });
});
