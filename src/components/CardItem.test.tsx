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
});
