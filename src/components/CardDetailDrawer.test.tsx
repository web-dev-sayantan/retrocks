import { cleanup, fireEvent, render, waitFor, within } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

import { makeBoardView, makeCard } from '../lib/board-fixtures';
import type { ColumnDTO, CommentViewDTO } from '../lib/board-types';
import {
  TestBoardWorkspace,
  createTestBoardMutations,
} from '../lib/board-workspace-test-helper';
import BoardConfirmDialog from './BoardConfirmDialog';
import CardDetailDrawer from './CardDetailDrawer';

afterEach(() => {
  cleanup();
});

describe('<CardDetailDrawer />', () => {
  it('reads ambient workspace state and emits Action Item, reaction, and comment mutations through narrowed props', async () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 10, 0);
    const myComment: CommentViewDTO = {
      id: 'comment_1',
      cardId: 'card_1',
      content: 'Let us automate this check.',
      isMine: true,
      createdAt: nowMs - 2 * 60_000,
    };
    const card = makeCard({
      id: 'card_1',
      columnId: 'col_1',
      content: 'Automate release checklist',
      isMine: true,
      isActionItem: true,
      actionDone: false,
      actionOwner: 'Platform',
      reactions: { '👍': 1 },
      myReactions: [],
      commentCount: 1,
      comments: [myComment],
      createdAt: nowMs - 10 * 60_000,
      updatedAt: nowMs - 10 * 60_000,
    });
    const board = makeBoardView({ isFacilitator: true, cards: [card] });
    const actions = createTestBoardMutations();

    const { getByLabelText, getByRole, getByText } = render(() => (
      <TestBoardWorkspace board={board} nowMs={nowMs} actions={actions}>
        <CardDetailDrawer
          card={card}
          isOpen={true}
          side="right"
          onClose={() => {}}
          onExit={() => {}}
          restoreFocusTarget={() => undefined}
        />
        <BoardConfirmDialog />
      </TestBoardWorkspace>
    ));
    flush();

    expect(getByRole('heading', { name: 'Went Well' })).toBeInTheDocument();
    expect(getByText('Automate release checklist')).toBeInTheDocument();
    expect(getByText('10m ago')).toBeInTheDocument();
    expect(getByText('Let us automate this check.')).toBeInTheDocument();

    // Toggle reaction via workspace action
    fireEvent.click(getByRole('button', { name: /👍/ }));
    await Promise.resolve();
    expect(actions.toggleReaction).toHaveBeenCalledWith('card_1', '👍');

    // Toggle Action Item Done
    fireEvent.click(getByRole('checkbox', { name: 'Done' }));
    await Promise.resolve();
    expect(actions.updateActionItem).toHaveBeenCalledWith('card_1', { actionDone: true });

    // Post a new comment
    const commentBox = getByLabelText('Comment') as HTMLTextAreaElement;
    commentBox.value = 'Added to sprint backlog';
    fireEvent.input(commentBox);
    flush();
    fireEvent.click(getByRole('button', { name: 'Post comment' }));
    await Promise.resolve();
    expect(actions.createComment).toHaveBeenCalledWith('card_1', 'Added to sprint backlog');

    // Delete comment via confirmation dialog
    fireEvent.click(getByRole('button', { name: 'Delete' }));
    flush();
    const alertDialog = getByRole('alertdialog');
    fireEvent.click(within(alertDialog).getByRole('button', { name: 'Delete comment' }));
    await waitFor(() => {
      expect(actions.deleteComment).toHaveBeenCalledWith('card_1', 'comment_1');
    });
  });

  it('reacts to Locked, Facilitator, Private Mode, and column updates without remounting', () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 10, 0);
    const initialBoard = makeBoardView({ isFacilitator: true });
    const peerComment: CommentViewDTO = {
      id: 'comment_peer',
      cardId: 'card_1',
      content: 'Peer observation',
      isMine: false,
      createdAt: nowMs - 60_000,
    };
    const card = makeCard({
      id: 'card_1',
      columnId: 'col_1',
      content: 'Follow up on flaky test',
      isMine: true,
      isActionItem: true,
      actionDone: false,
      actionOwner: 'QA',
      commentCount: 1,
      comments: [peerComment],
      createdAt: nowMs - 5 * 60_000,
      updatedAt: nowMs - 5 * 60_000,
    });

    const [isLocked, setIsLocked] = createSignal(false);
    const [isFacilitator, setIsFacilitator] = createSignal(true);
    const [isBlurred, setIsBlurred] = createSignal(false);
    const [columns, setColumns] = createSignal<readonly ColumnDTO[]>(initialBoard.columns);

    const { getByLabelText, getByRole, queryByLabelText, queryByRole } = render(() => (
      <TestBoardWorkspace
        columns={columns}
        isFacilitator={isFacilitator}
        isLocked={isLocked}
        isBlurred={isBlurred}
        nowMs={nowMs}
      >
        <CardDetailDrawer
          card={card}
          isOpen={true}
          side="right"
          onClose={() => {}}
          onExit={() => {}}
          restoreFocusTarget={() => undefined}
        />
      </TestBoardWorkspace>
    ));
    flush();

    const drawer = getByRole('dialog', { name: 'Card details' });
    expect(getByRole('heading', { name: 'Went Well' })).toBeInTheDocument();
    expect(queryByLabelText('Comment')).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Delete' })).toBeInTheDocument();

    // Renaming the column in workspace context updates the drawer header reactively
    setColumns([
      { ...initialBoard.columns[0], title: 'Highlights' },
      ...initialBoard.columns.slice(1),
    ]);
    flush();
    expect(getByRole('heading', { name: 'Highlights' })).toBeInTheDocument();
    expect(getByRole('dialog', { name: 'Card details' })).toBe(drawer);

    // Private Mode revokes Facilitator delete on another participant's comment
    setIsBlurred(true);
    flush();
    expect(queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    // Revealing restores Facilitator delete
    setIsBlurred(false);
    flush();
    expect(queryByRole('button', { name: 'Delete' })).toBeInTheDocument();

    // Locking hides comment composer and disables Action Item flag toggle,
    // while Facilitator can still follow up on Done and Owner
    setIsLocked(true);
    flush();
    expect(queryByLabelText('Comment')).not.toBeInTheDocument();
    expect(getByRole('checkbox', { name: 'Action Item' })).toBeDisabled();
    expect(getByRole('checkbox', { name: 'Done' })).not.toBeDisabled();
    expect(getByLabelText('Action owner')).not.toBeDisabled();
    expect(getByRole('dialog', { name: 'Card details' })).toBe(drawer);

    // Non-facilitator cannot edit Action Item follow-up while Locked
    setIsFacilitator(false);
    flush();
    expect(getByRole('checkbox', { name: 'Done' })).toBeDisabled();
    expect(getByLabelText('Action owner')).toBeDisabled();
    expect(getByRole('dialog', { name: 'Card details' })).toBe(drawer);
  });
});
