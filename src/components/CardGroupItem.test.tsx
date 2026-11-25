import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeBoardView, makeCard } from '../lib/board-fixtures';
import type { CardGroupDTO } from '../lib/board-types';
import CardGroupItem from './CardGroupItem';
import {
  TestBoardWorkspace,
  createTestBoardMutations,
} from '../lib/board-workspace-test-helper';

afterEach(() => {
  cleanup();
});

describe('<CardGroupItem />', () => {
  it('reads ambient workspace state and emits group mutations through narrowed props', async () => {
    const group: CardGroupDTO = {
      id: 'group_1',
      columnId: 'col_1',
      title: 'CI Speed',
      cardIds: ['card_1', 'card_2'],
      votes: 4,
      myVotes: 1,
      createdAt: Date.now(),
    };
    const card1 = makeCard({
      id: 'card_1',
      columnId: 'col_1',
      groupId: group.id,
      content: 'Cached pnpm store',
      isMine: true,
    });
    const card2 = makeCard({
      id: 'card_2',
      columnId: 'col_1',
      groupId: group.id,
      content: 'Parallel test shards',
      isMine: false,
    });
    const board = makeBoardView({
      isFacilitator: true,
      groups: [group],
      cards: [card1, card2],
    });
    const actions = createTestBoardMutations();
    const onVote = vi.fn();

    const { getByRole, getByText } = render(() => (
      <TestBoardWorkspace
        board={board}
        actions={actions}
        voting={{ onChange: onVote }}
      >
        <CardGroupItem
          group={group}
          cards={[card1, card2]}
          columnCards={[card1, card2]}
          columnGroups={[group]}
        />
      </TestBoardWorkspace>
    ));
    flush();

    expect(getByText('CI Speed')).toBeInTheDocument();
    expect(getByText('2 cards')).toBeInTheDocument();

    // Group voting delegates through workspace voting handler
    fireEvent.click(getByRole('button', { name: 'Cast Vote' }));
    expect(onVote).toHaveBeenCalledWith('group', 'group_1', 1);

    // Move group to another column from workspace columns
    fireEvent.click(getByRole('button', { name: 'Move Card Group to...' }));
    flush();
    fireEvent.click(getByRole('menuitem', { name: 'To Improve' }));
    await Promise.resolve();
    expect(actions.moveCardGroup).toHaveBeenCalledWith('group_1', 'col_2');

    // Dissolve group
    fireEvent.click(getByRole('button', { name: 'Dissolve Card Group' }));
    await Promise.resolve();
    expect(actions.dissolveCardGroup).toHaveBeenCalledWith('group_1');
  });

  it('reacts to Locked and Private Mode changes without remounting group or nested cards', () => {
    const group: CardGroupDTO = {
      id: 'group_1',
      columnId: 'col_1',
      title: 'Release Flow',
      cardIds: ['card_1', 'card_2'],
      votes: 1,
      myVotes: 0,
      createdAt: Date.now(),
    };
    const myCard = makeCard({
      id: 'card_1',
      columnId: 'col_1',
      groupId: group.id,
      content: 'My card',
      isMine: true,
    });
    const peerCard = makeCard({
      id: 'card_2',
      columnId: 'col_1',
      groupId: group.id,
      content: 'Peer card',
      isMine: false,
    });
    const [isLocked, setIsLocked] = createSignal(false);
    const [isBlurred, setIsBlurred] = createSignal(false);

    const { container, queryByRole } = render(() => (
      <TestBoardWorkspace
        isFacilitator={true}
        isLocked={isLocked}
        isBlurred={isBlurred}
      >
        <CardGroupItem
          group={group}
          cards={[myCard, peerCard]}
          columnCards={[myCard, peerCard]}
          columnGroups={[group]}
        />
      </TestBoardWorkspace>
    ));
    flush();

    const groupArticle = container.querySelector('article[data-group-id="group_1"]');
    const cardArticle = container.querySelector('article[data-card-id="card_1"]');
    expect(groupArticle).not.toBeNull();
    expect(cardArticle).not.toBeNull();
    expect(queryByRole('button', { name: 'Dissolve Card Group' })).toBeInTheDocument();

    // Private Mode hides group management when a group contains another participant's card
    setIsBlurred(true);
    flush();
    expect(queryByRole('button', { name: 'Dissolve Card Group' })).not.toBeInTheDocument();
    expect(container.querySelector('article[data-group-id="group_1"]')).toBe(groupArticle);
    expect(container.querySelector('article[data-card-id="card_1"]')).toBe(cardArticle);

    // Revealing restores group management controls
    setIsBlurred(false);
    flush();
    expect(queryByRole('button', { name: 'Dissolve Card Group' })).toBeInTheDocument();

    // Locking hides group management and voting controls without remounting
    setIsLocked(true);
    flush();
    expect(queryByRole('button', { name: 'Dissolve Card Group' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Cast Vote' })).not.toBeInTheDocument();
    expect(container.querySelector('article[data-group-id="group_1"]')).toBe(groupArticle);
    expect(container.querySelector('article[data-card-id="card_1"]')).toBe(cardArticle);
  });
});
