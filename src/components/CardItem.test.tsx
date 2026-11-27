import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardMutationResult } from '../lib/board-controller';
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

    // Toggling Private Mode revokes Facilitator edit/delete and Action Item flagging on another participant's card
    setIsBlurred(true);
    flush();
    expect(queryByRole('menuitem', { name: 'Edit Card' })).not.toBeInTheDocument();
    expect(getByRole('menuitem', { name: 'Flag as Action Item' })).toHaveAttribute('aria-disabled', 'true');
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

  it('enforces whole-Card-Group Private Mode on Ungroup Card', () => {
    const mixedGroup: CardGroupDTO = {
      id: 'group_mixed',
      columnId: 'col_1',
      title: 'Mixed Group',
      cardIds: ['card_mine', 'card_peer'],
      votes: 0,
      myVotes: 0,
      createdAt: Date.now(),
    };
    const myCard = makeCard({
      id: 'card_mine',
      columnId: 'col_1',
      groupId: mixedGroup.id,
      isMine: true,
    });
    const peerCard = makeCard({
      id: 'card_peer',
      columnId: 'col_1',
      groupId: mixedGroup.id,
      isMine: false,
      redacted: true,
    });
    const [isBlurred, setIsBlurred] = createSignal(true);

    const { getByRole, queryByRole } = render(() => (
      <TestBoardWorkspace isFacilitator={true} isBlurred={isBlurred}>
        <CardItem
          card={myCard}
          columnCards={[myCard, peerCard]}
          columnGroups={[mixedGroup]}
        />
      </TestBoardWorkspace>
    ));
    flush();

    fireEvent.click(getByRole('button', { name: 'Card actions' }));
    flush();
    expect(queryByRole('menuitem', { name: 'Ungroup Card' })).not.toBeInTheDocument();

    setIsBlurred(false);
    flush();
    expect(getByRole('menuitem', { name: 'Ungroup Card' })).toBeInTheDocument();
  });

  it('hides Group with… for a Card in a mixed-authorship Card Group during Private Mode', () => {
    const mixedGroup: CardGroupDTO = {
      id: 'group_mixed',
      columnId: 'col_1',
      title: 'Mixed Group',
      cardIds: ['card_mine', 'card_peer'],
      votes: 0,
      myVotes: 0,
      createdAt: Date.now(),
    };
    const myCard = makeCard({
      id: 'card_mine',
      columnId: 'col_1',
      groupId: mixedGroup.id,
      content: 'My grouped card',
      isMine: true,
    });
    const peerCard = makeCard({
      id: 'card_peer',
      columnId: 'col_1',
      groupId: mixedGroup.id,
      isMine: false,
      redacted: true,
    });
    const myLooseCard = makeCard({
      id: 'card_loose',
      columnId: 'col_1',
      groupId: null,
      content: 'My loose target',
      isMine: true,
    });
    const [isBlurred, setIsBlurred] = createSignal(true);

    const { getByRole, queryByRole } = render(() => (
      <TestBoardWorkspace isFacilitator={true} isBlurred={isBlurred}>
        <CardItem
          card={myCard}
          columnCards={[myCard, peerCard, myLooseCard]}
          columnGroups={[mixedGroup]}
        />
      </TestBoardWorkspace>
    ));
    flush();

    fireEvent.click(getByRole('button', { name: 'Card actions' }));
    flush();
    expect(queryByRole('menuitem', { name: /Group with/i })).not.toBeInTheDocument();

    setIsBlurred(false);
    flush();
    expect(getByRole('menuitem', { name: /Group with/i })).toBeInTheDocument();
  });

  it('excludes redacted and mixed-authorship Card Groups from the Group with… submenu during Private Mode', () => {
    const myCard = makeCard({
      id: 'card_mine',
      columnId: 'col_1',
      content: 'My loose note',
      isMine: true,
    });
    const myOwnGroupCard = makeCard({
      id: 'card_own_g',
      columnId: 'col_1',
      groupId: 'group_own',
      content: 'Own group member',
      isMine: true,
    });
    const peerGroupCard = makeCard({
      id: 'card_peer_g',
      columnId: 'col_1',
      groupId: 'group_redacted',
      content: '',
      isMine: false,
      redacted: true,
    });
    const ownGroup: CardGroupDTO = {
      id: 'group_own',
      columnId: 'col_1',
      title: 'My Own Group',
      cardIds: ['card_own_g'],
      votes: 0,
      myVotes: 0,
      createdAt: Date.now(),
    };
    const redactedGroup: CardGroupDTO = {
      id: 'group_redacted',
      columnId: 'col_1',
      title: 'Secret Group',
      cardIds: ['card_peer_g'],
      redacted: true,
      votes: 0,
      myVotes: 0,
      createdAt: Date.now(),
    };

    const { getByRole, queryByRole, unmount } = render(() => (
      <TestBoardWorkspace isFacilitator={true} isBlurred={true}>
        <CardItem
          card={myCard}
          columnCards={[myCard, myOwnGroupCard, peerGroupCard]}
          columnGroups={[ownGroup, redactedGroup]}
        />
      </TestBoardWorkspace>
    ));
    flush();

    fireEvent.click(getByRole('button', { name: 'Card actions' }));
    flush();
    const groupTrigger = getByRole('menuitem', { name: /Group with/i });
    fireEvent.click(groupTrigger);
    flush();

    expect(getByRole('menuitem', { name: 'My Own Group' })).toBeInTheDocument();
    expect(queryByRole('menuitem', { name: 'Secret Group' })).not.toBeInTheDocument();
    unmount();

    // When only a redacted Card Group exists in Private Mode, Group with… is hidden entirely.
    const onlyRedacted = render(() => (
      <TestBoardWorkspace isFacilitator={true} isBlurred={true}>
        <CardItem
          card={myCard}
          columnCards={[myCard, peerGroupCard]}
          columnGroups={[redactedGroup]}
        />
      </TestBoardWorkspace>
    ));
    flush();
    fireEvent.click(onlyRedacted.getByRole('button', { name: 'Card actions' }));
    flush();
    expect(onlyRedacted.queryByRole('menuitem', { name: /Group with/i })).not.toBeInTheDocument();
  });

  it('disables reaction, Vote, edit, move, grouping, and Action Item controls on optimistic pending Cards', () => {
    const pendingCard = makeCard({
      id: 'card_pending',
      columnId: 'col_1',
      content: 'Optimistic note',
      isMine: true,
      pending: true,
      isActionItem: true,
      actionDone: false,
      votes: 0,
      myVotes: 0,
      reactions: { '👍': 1 },
      myReactions: ['👍'],
    });
    const peerCard = makeCard({
      id: 'card_peer',
      columnId: 'col_1',
      content: 'Peer note',
      isMine: false,
    });
    const actions = createTestBoardMutations();

    const { container, getByRole, getByText, queryByRole } = render(() => (
      <TestBoardWorkspace
        isFacilitator={true}
        allowParticipantGroup={true}
        actions={actions}
        voting={{ remainingVotes: 5, maxVotesPerCard: 2 }}
      >
        <CardItem
          card={pendingCard}
          columnCards={[pendingCard, peerCard]}
          columnGroups={[]}
        />
      </TestBoardWorkspace>
    ));
    flush();

    const article = container.querySelector('article[data-card-id="card_pending"]');
    expect(article).not.toHaveAttribute('tabindex');
    expect(article).not.toHaveAttribute('aria-roledescription');

    // Reactions are disabled and Add reaction trigger is hidden
    expect(queryByRole('button', { name: 'Add reaction' })).not.toBeInTheDocument();
    expect(getByRole('button', { name: /👍/ })).toBeDisabled();

    // Vote controls are disabled
    expect(getByRole('button', { name: 'Cast Vote' })).toBeDisabled();
    expect(getByRole('button', { name: 'Remove Vote' })).toBeDisabled();

    // Action Item Done checkbox is disabled
    expect(getByRole('checkbox', { name: 'Mark Optimistic note as Done' })).toBeDisabled();

    // Card actions menu trigger (Edit, Move, Group, Flag Action Item, Delete) is disabled
    expect(getByRole('button', { name: 'Card actions' })).toBeDisabled();

    // Double-click inline edit does not open
    fireEvent.dblClick(getByText('Optimistic note'));
    flush();
    expect(queryByRole('textbox', { name: 'Edit card text' })).not.toBeInTheDocument();
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
    const pending = Promise.withResolvers<BoardMutationResult>();
    const updateCard = vi
      .fn<() => Promise<BoardMutationResult>>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce({ ok: false, message: 'Could not save card.' })
      .mockResolvedValueOnce({ ok: true });
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
    pending.resolve({ ok: false, message: 'Stale error' });
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

  it('surfaces real server rejection messages and reads controller-backed Card pending state', async () => {
    const card = makeCard({
      id: 'card_err',
      columnId: 'col_1',
      content: 'Server error card',
      isMine: true,
      isActionItem: true,
      actionDone: false,
    });
    const [moving, setMoving] = createSignal(false);
    const actions = createTestBoardMutations({
      isCardPending: (id, action) => id === card.id && action === 'move' && moving(),
      updateActionItem: vi.fn(async () => ({
        ok: false as const,
        message: 'Board was locked before Action Item saved.',
      })),
    });

    const { getByRole, getByText } = render(() => (
      <TestBoardWorkspace isFacilitator={true} actions={actions}>
        <CardItem card={card} columnCards={[card]} columnGroups={[]} />
      </TestBoardWorkspace>
    ));
    flush();

    setMoving(true);
    flush();
    expect(getByText('Moving Card…')).toBeInTheDocument();
    setMoving(false);
    flush();

    const checkbox = getByRole('checkbox', { name: 'Mark Server error card as Done' });
    fireEvent.click(checkbox);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(getByRole('alert')).toHaveTextContent('Board was locked before Action Item saved.');
    expect(checkbox).not.toBeChecked();
  });

  it('disables the inline Action Item Done checkbox while an Action Item mutation is in flight', () => {
    const card = makeCard({
      id: 'card_action_pending',
      columnId: 'col_1',
      content: 'Follow up with team',
      isMine: true,
      isActionItem: true,
      actionDone: false,
    });
    const [actionPending, setActionPending] = createSignal(false);
    const actions = createTestBoardMutations({
      isActionItemPending: (id) => id === card.id && actionPending(),
    });

    const { getByRole } = render(() => (
      <TestBoardWorkspace isFacilitator={true} actions={actions}>
        <CardItem card={card} columnCards={[card]} columnGroups={[]} />
      </TestBoardWorkspace>
    ));
    flush();

    const checkbox = getByRole('checkbox', { name: 'Mark Follow up with team as Done' });
    expect(checkbox).toBeEnabled();

    setActionPending(true);
    flush();
    expect(checkbox).toBeDisabled();

    setActionPending(false);
    flush();
    expect(checkbox).toBeEnabled();
  });
});
