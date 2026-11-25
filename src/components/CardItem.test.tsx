import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeBoardView, makeCard } from '../lib/board-fixtures';
import type { CardGroupDTO } from '../lib/board-types';
import CardItem from './CardItem';
import {
  TestBoardWorkspace,
  createTestBoardMutations,
} from '../lib/board-workspace-test-helper';

afterEach(() => {
  cleanup();
});

describe('<CardItem />', () => {
  it('reads ambient workspace state and emits mutations through narrowed props', async () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 5, 0);
    const card = makeCard({
      id: 'card_1',
      columnId: 'col_1',
      content: 'Shipped zero-downtime migration',
      isMine: true,
      votes: 3,
      myVotes: 1,
      commentCount: 2,
      createdAt: nowMs - 5 * 60_000,
      updatedAt: nowMs - 5 * 60_000,
    });
    const peerCard = makeCard({
      id: 'card_2',
      columnId: 'col_1',
      content: 'Peer card',
      isMine: false,
    });
    const actions = createTestBoardMutations();
    const onVote = vi.fn();
    const openCardDetail = vi.fn();

    const { getByRole, getByText } = render(() => (
      <TestBoardWorkspace
        nowMs={nowMs}
        actions={actions}
        voting={{ remainingVotes: 4, maxVotesPerCard: 2, onChange: onVote }}
        openCardDetail={openCardDetail}
      >
        <CardItem
          card={card}
          columnCards={[card, peerCard]}
          columnGroups={[]}
        />
      </TestBoardWorkspace>
    ));
    flush();

    expect(getByText('Shipped zero-downtime migration')).toBeInTheDocument();
    expect(getByText('5m ago')).toBeInTheDocument();

    const detailsButton = getByRole('button', { name: 'Open Card details' });
    fireEvent.click(detailsButton);
    expect(openCardDetail).toHaveBeenCalledWith('card_1', detailsButton);

    fireEvent.click(getByRole('button', { name: 'Cast Vote' }));
    expect(onVote).toHaveBeenCalledWith('card', 'card_1', 1);

    fireEvent.click(getByRole('button', { name: 'Card actions' }));
    flush();
    fireEvent.click(getByRole('menuitem', { name: 'Flag as Action Item' }));
    await Promise.resolve();
    expect(actions.updateActionItem).toHaveBeenCalledWith('card_1', {
      isActionItem: true,
    });
  });

  it('reacts to Locked, Private Mode, and voting updates from context without remounting', () => {
    const otherCard = makeCard({
      id: 'card_other',
      columnId: 'col_1',
      content: 'Other participant card',
      isMine: false,
      votes: 2,
      myVotes: 0,
    });
    const [isLocked, setIsLocked] = createSignal(false);
    const [isBlurred, setIsBlurred] = createSignal(false);
    const [remainingVotes, setRemainingVotes] = createSignal<number | null>(2);

    const { container, getByRole, queryByRole } = render(() => (
      <TestBoardWorkspace
        isFacilitator={true}
        isLocked={isLocked}
        isBlurred={isBlurred}
        voting={() => ({ remainingVotes: remainingVotes() })}
      >
        <CardItem
          card={otherCard}
          columnCards={[otherCard]}
          columnGroups={[]}
        />
      </TestBoardWorkspace>
    ));
    flush();

    const article = container.querySelector('article[data-card-id="card_other"]');
    expect(article).not.toBeNull();
    expect(getByRole('button', { name: 'Cast Vote' })).not.toBeDisabled();

    // Facilitator can manage another participant's card while revealed
    fireEvent.click(getByRole('button', { name: 'Card actions' }));
    flush();
    expect(getByRole('menuitem', { name: 'Edit Card' })).toBeInTheDocument();

    // Toggling Private Mode revokes Facilitator edit/delete on another participant's card
    setIsBlurred(true);
    flush();
    expect(queryByRole('menuitem', { name: 'Edit Card' })).not.toBeInTheDocument();
    expect(container.querySelector('article[data-card-id="card_other"]')).toBe(article);

    // Exhausting remaining ballots disables Cast Vote reactively
    setRemainingVotes(0);
    flush();
    expect(getByRole('button', { name: 'Cast Vote' })).toBeDisabled();

    // Toggling Locked hides Card actions and Vote buttons without remounting
    setIsLocked(true);
    flush();
    expect(queryByRole('button', { name: 'Card actions' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Cast Vote' })).not.toBeInTheDocument();
    expect(container.querySelector('article[data-card-id="card_other"]')).toBe(article);
  });

  it('derives ungroup eligibility from workspace context when canUngroup is omitted', async () => {
    const group: CardGroupDTO = {
      id: 'group_1',
      columnId: 'col_1',
      title: 'Deployments',
      cardIds: ['card_1', 'card_2'],
      votes: 0,
      myVotes: 0,
      createdAt: Date.now(),
    };
    const card = makeCard({
      id: 'card_1',
      columnId: 'col_1',
      groupId: group.id,
      isMine: true,
    });
    const actions = createTestBoardMutations();
    const board = makeBoardView({
      isFacilitator: true,
      groups: [group],
      cards: [card],
    });

    const { getByRole } = render(() => (
      <TestBoardWorkspace board={board} actions={actions}>
        <CardItem
          card={card}
          columnCards={[card]}
          columnGroups={[group]}
        />
      </TestBoardWorkspace>
    ));
    flush();

    fireEvent.click(getByRole('button', { name: 'Card actions' }));
    flush();
    fireEvent.click(getByRole('menuitem', { name: 'Ungroup Card' }));
    await Promise.resolve();
    expect(actions.ungroupCard).toHaveBeenCalledWith('card_1');
  });

  it('handles Card inline editing with IME Enter, container focus-out, Escape cancel, Private Mode/Locked invalidation, error retention, and focus restoration', async () => {
    const otherCard = makeCard({
      id: 'card_edit',
      columnId: 'col_1',
      content: 'Original card note',
      isMine: false,
    });
    const [isLocked, setIsLocked] = createSignal(false);
    const [isBlurred, setIsBlurred] = createSignal(false);
    const pending = Promise.withResolvers<string | null>();
    const updateCard = vi
      .fn<() => Promise<string | null>>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce('Could not save card.')
      .mockResolvedValueOnce(null);
    const actions = createTestBoardMutations({ updateCard });

    const { getByRole, getByText, queryByRole } = render(() => (
      <TestBoardWorkspace
        isFacilitator={true}
        isLocked={isLocked}
        isBlurred={isBlurred}
        actions={actions}
      >
        <CardItem card={otherCard} columnCards={[otherCard]} columnGroups={[]} />
      </TestBoardWorkspace>
    ));
    flush();

    // Double-click opens editor
    fireEvent.dblClick(getByText('Original card note'));
    flush();
    const textarea = getByRole('textbox', { name: 'Edit card text' });
    expect(textarea).toHaveFocus();
    fireEvent.input(textarea, { target: { value: 'Refined note' } });

    // IME Enter is ignored
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 });
    flush();
    expect(updateCard).not.toHaveBeenCalled();

    // Focus-out into Cancel button inside container does not commit
    const cancelBtn = getByRole('button', { name: 'Cancel' });
    fireEvent.focusOut(textarea, { relatedTarget: cancelBtn });
    flush();
    expect(updateCard).not.toHaveBeenCalled();

    // Escape during in-flight save cancels and restores focus to Card actions trigger
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(updateCard).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(textarea, { key: 'Escape' });
    flush();
    expect(queryByRole('textbox', { name: 'Edit card text' })).toBeNull();
    expect(getByRole('button', { name: 'Card actions' })).toHaveFocus();
    pending.resolve('Stale error');
    await pending.promise;
    await Promise.resolve();
    flush();
    expect(queryByRole('alert')).toBeNull();

    // Failed save retains draft and error message, clears on input, and succeeds on retry
    fireEvent.dblClick(getByText('Original card note'));
    flush();
    const retryBox = getByRole('textbox', { name: 'Edit card text' });
    fireEvent.input(retryBox, { target: { value: 'Retry text' } });
    fireEvent.click(getByRole('button', { name: 'Save' }));
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(getByRole('alert')).toHaveTextContent('Could not save card.');
    expect(retryBox).toHaveValue('Retry text');

    fireEvent.input(retryBox, { target: { value: 'Retry text v2' } });
    flush();
    expect(queryByRole('alert')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Save' }));
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(updateCard).toHaveBeenLastCalledWith('card_edit', 'Retry text v2');
    expect(queryByRole('textbox', { name: 'Edit card text' })).toBeNull();

    // Private Mode cancels an active edit on another participant's card
    fireEvent.dblClick(getByText('Original card note'));
    flush();
    expect(getByRole('textbox', { name: 'Edit card text' })).toBeInTheDocument();
    setIsBlurred(true);
    flush();
    expect(queryByRole('textbox', { name: 'Edit card text' })).toBeNull();

    // Locked cancels an active edit
    setIsBlurred(false);
    flush();
    fireEvent.dblClick(getByText('Original card note'));
    flush();
    expect(getByRole('textbox', { name: 'Edit card text' })).toBeInTheDocument();
    setIsLocked(true);
    flush();
    expect(queryByRole('textbox', { name: 'Edit card text' })).toBeNull();
  });
});
