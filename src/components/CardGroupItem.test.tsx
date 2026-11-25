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

  it('handles Card Group title inline editing with IME Enter, container focus-out, Escape cancel, Locked/Private Mode invalidation, draft retention, and focus restoration', async () => {
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
    const pending = Promise.withResolvers<boolean>();
    const renameCardGroup = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const actions = createTestBoardMutations({ renameCardGroup });

    const { getByRole, queryByRole } = render(() => (
      <TestBoardWorkspace
        isFacilitator={true}
        isLocked={isLocked}
        isBlurred={isBlurred}
        actions={actions}
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

    fireEvent.click(getByRole('button', { name: 'Rename Card Group' }));
    flush();
    const input = getByRole('textbox', { name: 'Card Group title' });
    expect(input).toHaveFocus();
    fireEvent.input(input, { target: { value: 'Deploy Pipeline' } });

    // IME Enter is ignored
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    flush();
    expect(renameCardGroup).not.toHaveBeenCalled();

    // Focus-out into Cancel button inside container does not commit
    const cancelBtn = getByRole('button', { name: 'Cancel Card Group rename' });
    fireEvent.focusOut(input, { relatedTarget: cancelBtn });
    flush();
    expect(renameCardGroup).not.toHaveBeenCalled();

    // Escape during in-flight save cancels and restores focus to group title button
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameCardGroup).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Escape' });
    flush();
    expect(queryByRole('textbox', { name: 'Card Group title' })).toBeNull();
    expect(getByRole('button', { name: 'Release Flow — Edit Card Group title' })).toHaveFocus();
    pending.resolve(true);
    await pending.promise;
    await Promise.resolve();
    flush();

    // Failed save retains draft and succeeds on retry
    fireEvent.click(getByRole('button', { name: 'Rename Card Group' }));
    flush();
    const retryInput = getByRole('textbox', { name: 'Card Group title' });
    fireEvent.input(retryInput, { target: { value: 'CI Pipeline' } });
    fireEvent.click(getByRole('button', { name: 'Save Card Group title' }));
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(retryInput).toHaveValue('CI Pipeline');

    fireEvent.click(getByRole('button', { name: 'Save Card Group title' }));
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(renameCardGroup).toHaveBeenLastCalledWith('group_1', 'CI Pipeline');
    expect(queryByRole('textbox', { name: 'Card Group title' })).toBeNull();

    // Private Mode cancels an active rename when group has a peer card
    fireEvent.click(getByRole('button', { name: 'Rename Card Group' }));
    flush();
    expect(getByRole('textbox', { name: 'Card Group title' })).toBeInTheDocument();
    setIsBlurred(true);
    flush();
    expect(queryByRole('textbox', { name: 'Card Group title' })).toBeNull();

    // Locked cancels an active rename
    setIsBlurred(false);
    flush();
    fireEvent.click(getByRole('button', { name: 'Rename Card Group' }));
    flush();
    expect(getByRole('textbox', { name: 'Card Group title' })).toBeInTheDocument();
    setIsLocked(true);
    flush();
    expect(queryByRole('textbox', { name: 'Card Group title' })).toBeNull();
  });
});
