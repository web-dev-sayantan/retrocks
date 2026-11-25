import { cleanup, fireEvent, render, waitFor, within } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeBoardView, makeCard } from '../lib/board-fixtures';
import type { CardViewDTO, ColumnDTO } from '../lib/board-types';
import type { ColumnViewProjection } from '../lib/board-view';
import {
  TestBoardWorkspace,
  createTestBoardMutations,
} from '../lib/board-workspace-test-helper';
import BoardConfirmDialog from './BoardConfirmDialog';
import ColumnPanel from './ColumnPanel';

afterEach(() => {
  cleanup();
});

function makeColumnView(
  column: ColumnDTO,
  cards: CardViewDTO[] = [],
): ColumnViewProjection {
  return {
    id: column.id,
    column: { ...column, cardCount: cards.length },
    cards,
    groups: [],
    items: cards.map((card) => ({
      kind: 'card' as const,
      key: `card:${card.id}`,
      card,
    })),
    visibleCardCount: cards.length,
    totalCardCount: cards.length,
  };
}

describe('<ColumnPanel />', () => {
  it('reads ambient workspace state and emits column and nested card mutations through narrowed props', async () => {
    const board = makeBoardView({ isFacilitator: true });
    const card = makeCard({
      id: 'card_1',
      columnId: 'col_1',
      content: 'Zero-downtime deploy',
      isMine: true,
      votes: 2,
      myVotes: 1,
    });
    const view = makeColumnView(board.columns[0], [card]);
    const actions = createTestBoardMutations();
    const onVote = vi.fn();
    const openCardDetail = vi.fn();

    const { getByLabelText, getByRole, getByText } = render(() => (
      <TestBoardWorkspace
        board={board}
        actions={actions}
        voting={{ remainingVotes: 3, maxVotesPerCard: 2, onChange: onVote }}
        openCardDetail={openCardDetail}
      >
        <ColumnPanel
          view={view}
          columnIndex={0}
          hasActiveFilter={false}
          isMobile={false}
          isMobileActive={true}
          isHorizontalSnap={false}
          onResetFilters={() => {}}
        />
        <BoardConfirmDialog />
      </TestBoardWorkspace>
    ));
    flush();

    expect(getByText('Went Well')).toBeInTheDocument();
    expect(getByText('Zero-downtime deploy')).toBeInTheDocument();

    // Create a card via column composer
    const composer = getByLabelText('Add card to Went Well') as HTMLTextAreaElement;
    composer.value = 'Great pairing session';
    fireEvent.input(composer);
    flush();
    fireEvent.click(getByRole('button', { name: 'Add' }));
    await Promise.resolve();
    expect(actions.createCard).toHaveBeenCalledWith('col_1', 'Great pairing session');

    // Nested Card Vote and detail drawer delegate through workspace context
    fireEvent.click(getByRole('button', { name: 'Cast Vote' }));
    expect(onVote).toHaveBeenCalledWith('card', 'card_1', 1);

    const detailTrigger = getByRole('button', { name: 'Open Card details' });
    fireEvent.click(detailTrigger);
    expect(openCardDetail).toHaveBeenCalledWith('card_1', detailTrigger);

    // Column actions: reorder right, change accent, delete column
    fireEvent.click(getByRole('button', { name: 'Column options for Went Well' }));
    flush();
    fireEvent.click(getByRole('menuitem', { name: 'Move right' }));
    await Promise.resolve();
    expect(actions.moveColumn).toHaveBeenCalledWith('col_1', 1);

    fireEvent.click(getByRole('button', { name: 'Column options for Went Well' }));
    flush();
    fireEvent.click(getByRole('menuitemradio', { name: 'Accent Amber' }));
    await Promise.resolve();
    expect(actions.updateColumn).toHaveBeenCalledWith('col_1', { accent: 'amber' });

    fireEvent.click(getByRole('button', { name: 'Column options for Went Well' }));
    flush();
    fireEvent.click(getByRole('menuitem', { name: 'Delete column' }));
    flush();
    const alertDialog = getByRole('alertdialog');
    fireEvent.click(within(alertDialog).getByRole('button', { name: 'Delete column' }));
    await waitFor(() => {
      expect(actions.deleteColumn).toHaveBeenCalledWith('col_1');
    });
  });

  it('reacts to Locked, Facilitator, Private Mode, Blind Voting, column count, and voting updates from context without remounting', () => {
    const initialBoard = makeBoardView({ isFacilitator: true });
    const card = makeCard({
      id: 'card_1',
      columnId: 'col_1',
      content: 'Fast builds',
      isMine: false,
      votes: 3,
      myVotes: 1,
    });
    const view = makeColumnView(initialBoard.columns[0], [card]);

    const [isLocked, setIsLocked] = createSignal(false);
    const [isFacilitator, setIsFacilitator] = createSignal(true);
    const [isBlurred, setIsBlurred] = createSignal(false);
    const [blindVoting, setBlindVoting] = createSignal(false);
    const [columns, setColumns] = createSignal<readonly ColumnDTO[]>(initialBoard.columns);
    const [remainingVotes, setRemainingVotes] = createSignal<number | null>(2);

    const { container, getByRole, queryByLabelText, queryByRole, queryByText } = render(() => (
      <TestBoardWorkspace
        columns={columns}
        isFacilitator={isFacilitator}
        isLocked={isLocked}
        isBlurred={isBlurred}
        blindVoting={blindVoting}
        voting={() => ({ remainingVotes: remainingVotes() })}
      >
        <ColumnPanel
          view={view}
          columnIndex={0}
          hasActiveFilter={false}
          isMobile={false}
          isMobileActive={true}
          isHorizontalSnap={false}
          onResetFilters={() => {}}
        />
      </TestBoardWorkspace>
    ));
    flush();

    const section = container.querySelector('section[data-column-id="col_1"]');
    expect(section).not.toBeNull();
    expect(queryByLabelText('Add card to Went Well')).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Column options for Went Well' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Cast Vote' })).not.toBeDisabled();

    // Private Mode revokes Facilitator card actions on another participant's card
    fireEvent.click(getByRole('button', { name: 'Card actions' }));
    flush();
    expect(getByRole('menuitem', { name: 'Edit Card' })).toBeInTheDocument();
    setIsBlurred(true);
    flush();
    expect(queryByRole('menuitem', { name: 'Edit Card' })).not.toBeInTheDocument();
    setIsBlurred(false);
    flush();

    // Blind Voting propagates through workspace context without remounting
    setBlindVoting(true);
    flush();
    expect(container.querySelector('section[data-column-id="col_1"]')).toBe(section);

    // Shrinking board to 1 column disables Move right and Delete column reactively
    setColumns([initialBoard.columns[0]]);
    flush();
    fireEvent.click(getByRole('button', { name: 'Column options for Went Well' }));
    flush();
    expect(getByRole('menuitem', { name: 'Move right' })).toHaveAttribute('aria-disabled', 'true');
    expect(getByRole('menuitem', { name: 'Delete column' })).toHaveAttribute('aria-disabled', 'true');
    expect(container.querySelector('section[data-column-id="col_1"]')).toBe(section);

    // Exhausting votes disables nested Card Cast Vote
    setRemainingVotes(0);
    flush();
    expect(getByRole('button', { name: 'Cast Vote' })).toBeDisabled();

    // Revoking Facilitator hides column management menu
    setIsFacilitator(false);
    flush();
    expect(queryByRole('button', { name: 'Column options for Went Well' })).not.toBeInTheDocument();
    expect(container.querySelector('section[data-column-id="col_1"]')).toBe(section);

    // Locking hides composer, shows Locked banner, and hides nested Vote buttons without remounting
    setIsLocked(true);
    flush();
    expect(queryByLabelText('Add card to Went Well')).not.toBeInTheDocument();
    expect(queryByText('This Board is Locked. You can still read and search Cards.')).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Cast Vote' })).not.toBeInTheDocument();
    expect(container.querySelector('section[data-column-id="col_1"]')).toBe(section);
  });
});
