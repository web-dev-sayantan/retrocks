import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardWorkspaceActions } from '../lib/board-actions';
import type { BoardLiveMessage } from '../lib/board-live-protocol';
import type { BoardViewDTO, CardViewDTO, ColumnDTO } from '../lib/board-types';
import { readRecentBoards, recordRecentBoard } from '../lib/recent-boards';
import BoardWorkspace from './BoardWorkspace';

function makeCard(overrides?: Partial<CardViewDTO>): CardViewDTO {
  const now = Date.now() - 120_000; // 2m ago
  return {
    id: 'card_1',
    columnId: 'col_1',
    groupId: null,
    content: 'Fast deploy pipeline',
    redacted: false,
    isMine: true,
    isActionItem: false,
    actionDone: false,
    actionOwner: '',
    votes: 0,
    myVotes: 0,
    reactions: {},
    myReactions: [],
    commentCount: 0,
    comments: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBoardView(overrides?: Partial<BoardViewDTO>): BoardViewDTO {
  const now = Date.now();
  return {
    id: 'board_0123456789abcdef',
    title: 'Sprint 42 Retro',
    subtitle: 'Checkout Team',
    templateId: 'standard',
    isBlurred: false,
    blindVoting: false,
    isLocked: false,
    allowParticipantGroup: false,
    voteLimit: 5,
    maxVotesPerCard: null,
    remainingVotes: 5,
    isFacilitator: true,
    timer: { endsAt: null, remainingMs: null, durationMs: null },
    version: 1,
    retentionDays: 90,
    createdAt: now,
    lastActiveAt: now,
    columns: [
      {
        id: 'col_1',
        title: 'Went Well',
        accent: 'sage',
        position: 0,
        isActionColumn: false,
        cardCount: 3,
      },
      {
        id: 'col_2',
        title: 'To Improve',
        accent: 'rose',
        position: 1,
        isActionColumn: false,
        cardCount: 1,
      },
      {
        id: 'col_3',
        title: 'Action Items',
        accent: 'sky',
        position: 2,
        isActionColumn: true,
        cardCount: 0,
      },
    ],
    groups: [],
    cards: [],
    ...overrides,
  };
}

function createFakeActions(initialBoard: BoardViewDTO): {
  actions: BoardWorkspaceActions;
  spies: Record<keyof BoardWorkspaceActions, ReturnType<typeof vi.fn>>;
} {
  let version = initialBoard.version;
  let seq = 1;
  const cards = new Map<string, CardViewDTO>(
    initialBoard.cards.map((c) => [c.id, { ...c }]),
  );
  const columns = new Map<string, ColumnDTO>(
    initialBoard.columns.map((c) => [c.id, { ...c }]),
  );

  const renameBoard = vi.fn(async (input) => {
    version += 1;
    return {
      ok: true as const,
      version,
      events: [
        {
          type: 'board:updated' as const,
          version,
          patch: { title: input.title.trim() },
        },
      ],
    };
  });

  const createCard = vi.fn(async (input) => {
    version += 1;
    seq += 1;
    const col = columns.get(input.columnId);
    const card = makeCard({
      id: `card_new_${seq}`,
      columnId: input.columnId,
      content: input.content.trim(),
      isMine: true,
      isActionItem: Boolean(col?.isActionColumn),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    cards.set(card.id, card);
    return {
      ok: true as const,
      version,
      events: [{ type: 'card:upserted' as const, version, card }],
    };
  });

  const updateCard = vi.fn(async (input) => {
    version += 1;
    const existing = cards.get(input.cardId)!;
    const updated: CardViewDTO = {
      ...existing,
      content: input.content.trim(),
      updatedAt: Date.now(),
    };
    cards.set(updated.id, updated);
    return {
      ok: true as const,
      version,
      events: [{ type: 'card:upserted' as const, version, card: updated }],
    };
  });

  const moveCard = vi.fn(async (input) => {
    version += 1;
    const existing = cards.get(input.cardId)!;
    const moved: CardViewDTO = {
      ...existing,
      columnId: input.targetColumnId,
      updatedAt: Date.now(),
    };
    cards.set(moved.id, moved);
    return {
      ok: true as const,
      version,
      events: [{ type: 'card:upserted' as const, version, card: moved }],
    };
  });

  const deleteCard = vi.fn(async (input) => {
    version += 1;
    cards.delete(input.cardId);
    return {
      ok: true as const,
      version,
      events: [{ type: 'card:deleted' as const, version, cardId: input.cardId }],
    };
  });

  const addColumn = vi.fn(async (input) => {
    version += 1;
    seq += 1;
    const column: ColumnDTO = {
      id: `col_new_${seq}`,
      title: input.title.trim(),
      accent: input.accent ?? 'slate',
      position: columns.size,
      isActionColumn: Boolean(input.isActionColumn),
      cardCount: 0,
    };
    columns.set(column.id, column);
    return {
      ok: true as const,
      version,
      events: [{ type: 'column:upserted' as const, version, column }],
    };
  });

  const updateColumn = vi.fn(async (input) => {
    version += 1;
    const existing = columns.get(input.columnId)!;
    const updated: ColumnDTO = {
      ...existing,
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.accent !== undefined ? { accent: input.accent } : {}),
      ...(input.isActionColumn !== undefined
        ? { isActionColumn: input.isActionColumn }
        : {}),
    };
    columns.set(updated.id, updated);
    return {
      ok: true as const,
      version,
      events: [{ type: 'column:upserted' as const, version, column: updated }],
    };
  });

  const reorderColumns = vi.fn(async (input) => {
    version += 1;
    return {
      ok: true as const,
      version,
      events: [
        {
          type: 'columns:reordered' as const,
          version,
          columnIds: input.columnIds,
        },
      ],
    };
  });

  const deleteColumn = vi.fn(async (input) => {
    version += 1;
    columns.delete(input.columnId);
    return {
      ok: true as const,
      version,
      events: [
        {
          type: 'column:deleted' as const,
          version,
          columnId: input.columnId,
        },
      ],
    };
  });

  const setPrivateMode = vi.fn<BoardWorkspaceActions['setPrivateMode']>();
  const toggleReaction = vi.fn<BoardWorkspaceActions['toggleReaction']>();
  const createComment = vi.fn<BoardWorkspaceActions['createComment']>();
  const deleteComment = vi.fn<BoardWorkspaceActions['deleteComment']>();
  const actions: BoardWorkspaceActions = {
    setPrivateMode,
    renameBoard,
    createCard,
    updateCard,
    moveCard,
    deleteCard,
    toggleReaction,
    createComment,
    deleteComment,
    addColumn,
    updateColumn,
    reorderColumns,
    deleteColumn,
  };

  return {
    actions,
    spies: {
      setPrivateMode,
      renameBoard,
      createCard,
      updateCard,
      moveCard,
      deleteCard,
      toggleReaction,
      createComment,
      deleteComment,
      addColumn,
      updateColumn,
      reorderColumns,
      deleteColumn,
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe('<BoardWorkspace />', () => {
  it('applies live deltas and requests a new stream snapshot after a version gap without clearing the composer', () => {
    const streams: FakeEventSource[] = [];
    class FakeEventSource extends EventTarget {
      closed = false;
      constructor(readonly url: string) {
        super();
        streams.push(this);
      }
      close() {
        this.closed = true;
      }
      receive(message: BoardLiveMessage) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
        flush();
      }
    }

    vi.stubGlobal('EventSource', FakeEventSource);
    const board = makeBoardView();
    const { getByRole, getByText, queryByText, unmount } = render(() => (
      <BoardWorkspace board={board} boardId={board.id} />
    ));
    try {
      flush();
      expect(streams).toHaveLength(1);
      expect(streams[0].url).toBe(`/api/boards/${board.id}/live`);
      streams[0].receive({ type: 'board:snapshot', version: 1, serverNow: 100, board });
      streams[0].receive({ type: 'presence:count', count: 2 });
      expect(getByRole('status')).toHaveTextContent('2 online');

      fireEvent.click(getByRole('tab', { name: /To Improve/ }));
      flush();
      const composer = getByRole('textbox', { name: 'Quick add card to To Improve' });
      fireEvent.input(composer, { target: { value: 'Still typing' } });
      flush();

      const incoming = makeCard({ content: 'Added from another tab', isMine: false });
      streams[0].receive({
        type: 'board:mutation',
        version: 2,
        events: [{ type: 'card:upserted', version: 2, card: incoming }],
      });
      expect(getByText(incoming.content)).toBeInTheDocument();
      streams[0].receive({
        type: 'board:mutation',
        version: 4,
        events: [{ type: 'board:updated', version: 4, patch: { title: 'Out-of-order title' } }],
      });
      expect(queryByText('Out-of-order title')).not.toBeInTheDocument();
      expect(getByRole('status')).toHaveTextContent('Reconnecting');
      expect(streams).toHaveLength(2);
      expect(streams[0].closed).toBe(true);
      streams[1].receive({
        type: 'board:snapshot',
        version: 4,
        serverNow: 200,
        board: makeBoardView({ title: 'Recovered title', cards: [incoming], version: 4 }),
      });
      streams[1].receive({ type: 'presence:count', count: 2 });

      expect(getByRole('heading', { name: 'Recovered title' })).toBeInTheDocument();
      expect(getByText(incoming.content)).toBeInTheDocument();
      expect(getByRole('status')).toHaveTextContent('2 online');
      expect(getByRole('tab', { name: /To Improve/ })).toHaveAttribute('aria-selected', 'true');
      expect(composer).toHaveValue('Still typing');
    } finally {
      unmount();
      vi.unstubAllGlobals();
    }
    expect(streams[1].closed).toBe(true);
  });

  it('shows anonymous discussion in a Card detail, and applies reactions and comments from the live stream', async () => {
    const streams: EventTarget[] = [];
    vi.stubGlobal('EventSource', class extends EventTarget {
      constructor() {
        super();
        streams.push(this);
      }
      close() {}
    });
    const card = makeCard({
      comments: [{ id: 'first', cardId: 'card_1', content: 'First comment', isMine: false, createdAt: 100 }],
      commentCount: 1,
    });
    const board = makeBoardView({ cards: [card], isFacilitator: false });
    const { actions } = createFakeActions(board);
    const toggleReaction = vi.fn(async () => ({
      ok: true as const,
      version: 2,
      events: [{
        type: 'reaction:updated' as const, version: 2, cardId: card.id, counts: { '🎉': 1 }, myReactions: ['🎉'],
      }],
    }));
    const createComment = vi.fn(async () => ({
      ok: true as const,
      version: 4,
      events: [{
        type: 'comment:created' as const,
        version: 4,
        cardId: card.id,
        comment: { id: 'mine', cardId: card.id, content: 'My reply', isMine: true, createdAt: 300 },
      }],
    }));
    const deleteComment = vi.fn(async () => ({
      ok: true as const,
      version: 5,
      events: [{ type: 'comment:deleted' as const, version: 5, cardId: card.id, commentId: 'mine' }],
    }));
    Object.assign(actions, { toggleReaction, createComment, deleteComment });
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} actions={actions} />);
    function receive(message: BoardLiveMessage) {
      streams[0].dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
      flush();
    }
    try {
      flush();
      receive({ type: 'board:snapshot', version: 1, serverNow: 100, board });
      expect(view.queryByText('First comment')).not.toBeInTheDocument();
      fireEvent.click(view.getByRole('button', { name: 'Add reaction' }));
      flush();
      expect(view.getByRole('group', { name: 'Choose a reaction' }).querySelectorAll('button')).toHaveLength(6);
      fireEvent.click(view.getByRole('button', { name: '🎉' }));
      await flushPromises();
      expect(toggleReaction).toHaveBeenCalledWith({ boardId: board.id, cardId: card.id, emoji: '🎉' });
      expect(view.getByRole('button', { name: '🎉 1 reaction' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(view.getByRole('button', { name: '1 comment' }));
      flush();
      const drawer = within(view.getByRole('dialog', { name: 'Card details' }));
      expect(drawer.getByText(card.content)).toBeInTheDocument();
      expect(drawer.getByText('First comment')).toBeInTheDocument();
      expect(drawer.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
      receive({
        type: 'board:mutation',
        version: 3,
        events: [
          { type: 'reaction:updated', version: 3, cardId: card.id, counts: { '🎉': 2 }, myReactions: ['🎉'] },
          { type: 'comment:created', version: 3, cardId: card.id, comment: {
            id: 'live', cardId: card.id, content: '<b>Live reply</b>', isMine: false, createdAt: 200,
          } },
          { type: 'comment:deleted', version: 3, cardId: card.id, commentId: 'first' },
        ],
      });
      expect(drawer.getByRole('button', { name: '🎉 2 reactions' })).toHaveAttribute('aria-pressed', 'true');
      expect(drawer.getByText('<b>Live reply</b>')).toBeInTheDocument();
      expect(drawer.queryByText('First comment')).not.toBeInTheDocument();

      const input = drawer.getByRole('textbox', { name: 'Comment' });
      expect(input).toHaveAttribute('maxlength', '500');
      fireEvent.input(input, { target: { value: 'My reply' } });
      flush();
      fireEvent.click(drawer.getByRole('button', { name: 'Post comment' }));
      await flushPromises();
      expect(createComment).toHaveBeenCalledWith({ boardId: board.id, cardId: card.id, content: 'My reply' });
      expect(drawer.getByText('My reply')).toBeInTheDocument();
      fireEvent.click(drawer.getByRole('button', { name: 'Delete' }));
      flush();
      expect(deleteComment).not.toHaveBeenCalled();
      fireEvent.click(drawer.getByRole('button', { name: 'Confirm?' }));
      await flushPromises();
      expect(deleteComment).toHaveBeenCalledWith({ boardId: board.id, cardId: card.id, commentId: 'mine' });
      expect(drawer.queryByText('My reply')).not.toBeInTheDocument();

      receive({
        type: 'board:snapshot',
        version: 6,
        serverNow: 200,
        board: {
          ...board, version: 6, isBlurred: true,
          cards: [{ ...card, redacted: true, isMine: false, content: '', reactions: {}, comments: [], commentCount: 0 }],
        },
      });
      expect(view.queryByRole('dialog')).not.toBeInTheDocument();
      expect(view.queryByRole('button', { name: 'Open Card details' })).not.toBeInTheDocument();
      expect(view.queryByRole('button', { name: 'Add reaction' })).not.toBeInTheDocument();
      expect(view.queryByText('<b>Live reply</b>')).not.toBeInTheDocument();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('allows Facilitators to delete any revealed comment with inline confirmation and closes Card details on Escape without Solid diagnostics', async () => {
    const card = makeCard({
      isMine: false,
      comments: [
        {
          id: 'other_comment',
          cardId: 'card_1',
          content: 'Needs follow-up',
          isMine: false,
          createdAt: 100,
        },
      ],
      commentCount: 1,
    });
    const board = makeBoardView({ cards: [card], isFacilitator: true });
    const { actions } = createFakeActions(board);
    const deleteComment = vi.fn(async () => ({
      ok: true as const,
      version: 2,
      events: [
        {
          type: 'comment:deleted' as const,
          version: 2,
          cardId: card.id,
          commentId: 'other_comment',
        },
      ],
    }));
    Object.assign(actions, { deleteComment });

    const { artifact } = await captureArtifact(async () => {
      const view = render(() => (
        <BoardWorkspace board={board} boardId={board.id} actions={actions} />
      ));
      try {
        flush();
        fireEvent.click(view.getByRole('button', { name: 'Open Card details' }));
        flush();
        const drawer = within(
          view.getByRole('dialog', { name: 'Card details' }),
        );
        expect(drawer.getByText('Needs follow-up')).toBeInTheDocument();
        fireEvent.click(drawer.getByRole('button', { name: 'Delete' }));
        flush();
        fireEvent.click(drawer.getByRole('button', { name: 'Confirm?' }));
        await flushPromises();
        expect(deleteComment).toHaveBeenCalledWith({
          boardId: board.id,
          cardId: card.id,
          commentId: 'other_comment',
        });
        expect(drawer.queryByText('Needs follow-up')).not.toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });
        flush();
        expect(view.queryByRole('dialog')).not.toBeInTheDocument();
      } finally {
        view.unmount();
      }
    });
    expectNoDiagnostics(artifact);
  });

  it('renders sticky header, Columns with 3px pastel accent bar and Card count badge, and records Recent Board', () => {
    const board = makeBoardView();
    const { getByRole, getByText } = render(() => (
      <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
    ));
    flush();

    expect(getByRole('link', { name: /Retrocks/i })).toHaveAttribute('href', '/');
    expect(
      getByRole('heading', { level: 1, name: 'Sprint 42 Retro' }),
    ).toBeInTheDocument();
    expect(getByText('Checkout Team')).toBeInTheDocument();

    // Columns with pastel 3px accent bars & Card count badges
    expect(
      getByRole('heading', { level: 2, name: 'Went Well' }),
    ).toBeInTheDocument();
    expect(
      getByRole('heading', { level: 2, name: 'To Improve' }),
    ).toBeInTheDocument();
    expect(
      getByRole('heading', { level: 2, name: 'Action Items' }),
    ).toBeInTheDocument();
    expect(
      document.querySelectorAll('[data-column-accent-bar="true"]').length,
    ).toBe(3);

    const wentWellRegion = getByRole('region', { name: 'Went Well' });
    expect(within(wentWellRegion).getByText('3')).toBeInTheDocument();

    // Recorded into localStorage Recent Boards
    const recent = readRecentBoards();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      id: board.id,
      title: 'Sprint 42 Retro',
      isFacilitator: true,
    });
  });

  it('renders clean missing/expired state with CTA and removes stale Board ID from localStorage Recent Boards', () => {
    const staleId = 'board_expired_12345678';
    recordRecentBoard({ id: staleId, title: 'Old Expired Retro' });
    recordRecentBoard({
      id: 'board_still_alive_1234',
      title: 'Active Retro',
    });

    const { getByRole, getByText } = render(() => (
      <BoardWorkspace board={null} boardId={staleId} homeHref="/" />
    ));
    flush();

    expect(getByText(/Board not found or expired/i)).toBeInTheDocument();
    const cta = getByRole('link', { name: /Create a new board/i });
    expect(cta).toHaveAttribute('href', '/');

    // Automatically scrubbed from localStorage Recent Boards
    const remaining = readRecentBoards();
    expect(remaining.map((b) => b.id)).toEqual(['board_still_alive_1234']);
  });

  it('supports quick inline "+ Add card" composer (Enter/Cmd+Enter submit, Shift+Enter newline) and mobile bottom quick-add', async () => {
    const board = makeBoardView({
      columns: [
        {
          id: 'col_1',
          title: 'Went Well',
          accent: 'sage',
          position: 0,
          isActionColumn: false,
          cardCount: 0,
        },
        {
          id: 'col_2',
          title: 'To Improve',
          accent: 'rose',
          position: 1,
          isActionColumn: false,
          cardCount: 0,
        },
      ],
      cards: [],
    });
    const { actions, spies } = createFakeActions(board);

    const { getByLabelText, getByRole } = render(() => (
      <BoardWorkspace
        board={board}
        boardId={board.id}
        homeHref="/"
        actions={actions}
      />
    ));
    flush();

    const composer = getByLabelText(
      'Add card to Went Well',
    ) as HTMLTextAreaElement;
    fireEvent.input(composer, {
      target: {
        value: 'Shipped `v2` cleanly\nDocs: https://retrocks.app/docs',
      },
    });
    flush();

    // Shift+Enter does NOT submit
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    await flushPromises();
    expect(spies.createCard).not.toHaveBeenCalled();

    // Enter submits the Card
    fireEvent.keyDown(composer, { key: 'Enter' });
    await flushPromises();

    expect(spies.createCard).toHaveBeenCalledWith({
      boardId: board.id,
      columnId: 'col_1',
      content: 'Shipped `v2` cleanly\nDocs: https://retrocks.app/docs',
    });

    const wentWell = getByRole('region', { name: 'Went Well' });
    expect(within(wentWell).getByText('v2')).toBeInTheDocument();
    expect(
      within(wentWell).getByRole('link', { name: 'https://retrocks.app/docs' }),
    ).toHaveAttribute('target', '_blank');
    expect(within(wentWell).getByText('You')).toBeInTheDocument();
    expect(within(wentWell).getByText('Just now')).toBeInTheDocument();

    // Switch mobile tab to "To Improve" and submit via mobile bottom quick-add bar
    const tab2 = getByRole('tab', { name: /To Improve/i });
    fireEvent.click(tab2);
    flush();
    expect(tab2).toHaveAttribute('aria-selected', 'true');

    const mobileComposer = getByLabelText(
      'Quick add card to To Improve',
    ) as HTMLTextAreaElement;
    fireEvent.input(mobileComposer, {
      target: { value: 'Reduce flaky CI retries' },
    });
    flush();
    fireEvent.keyDown(mobileComposer, { key: 'Enter', ctrlKey: true });
    await flushPromises();

    expect(spies.createCard).toHaveBeenLastCalledWith({
      boardId: board.id,
      columnId: 'col_2',
      content: 'Reduce flaky CI retries',
    });
    const toImprove = getByRole('region', { name: 'To Improve' });
    expect(
      within(toImprove).getByText('Reduce flaky CI retries'),
    ).toBeInTheDocument();

    // Horizontal swipe right returns to the previous Column ("Went Well")
    const main = getByRole('main');
    fireEvent.touchStart(main, {
      changedTouches: [{ clientX: 60, clientY: 120 }],
    });
    fireEvent.touchEnd(main, {
      changedTouches: [{ clientX: 200, clientY: 125 }],
    });
    flush();
    expect(getByRole('tab', { name: /Went Well/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('supports inline Card edit, cross-Column move via "Move to..." and drag-and-drop, and inline Delete -> Confirm? confirmation', async () => {
    const myCard = makeCard({
      id: 'card_mine',
      columnId: 'col_1',
      content: 'My retro note',
      isMine: true,
    });
    const otherCard = makeCard({
      id: 'card_other',
      columnId: 'col_1',
      content: 'Teammate note',
      isMine: false,
    });
    const board = makeBoardView({
      isFacilitator: false,
      columns: [
        {
          id: 'col_1',
          title: 'Went Well',
          accent: 'sage',
          position: 0,
          isActionColumn: false,
          cardCount: 2,
        },
        {
          id: 'col_2',
          title: 'To Improve',
          accent: 'rose',
          position: 1,
          isActionColumn: false,
          cardCount: 0,
        },
      ],
      cards: [myCard, otherCard],
    });
    const { actions, spies } = createFakeActions(board);

    const { getByRole, queryByText } = render(() => (
      <BoardWorkspace
        board={board}
        boardId={board.id}
        homeHref="/"
        actions={actions}
      />
    ));
    flush();

    const wentWell = getByRole('region', { name: 'Went Well' });
    // Only myCard shows "You" badge and author action buttons
    expect(within(wentWell).getAllByText('You')).toHaveLength(1);
    expect(
      within(wentWell).getAllByRole('button', { name: 'Edit card' }),
    ).toHaveLength(1);

    // Inline edit myCard
    fireEvent.click(within(wentWell).getByRole('button', { name: 'Edit card' }));
    flush();
    const editBox = within(wentWell).getByLabelText(
      'Edit card text',
    ) as HTMLTextAreaElement;
    fireEvent.input(editBox, { target: { value: 'Refined retro note' } });
    flush();
    fireEvent.click(within(wentWell).getByRole('button', { name: 'Save' }));
    await flushPromises();

    expect(spies.updateCard).toHaveBeenCalledWith({
      boardId: board.id,
      cardId: 'card_mine',
      content: 'Refined retro note',
    });
    expect(within(wentWell).getByText('Refined retro note')).toBeInTheDocument();

    // Move myCard across Columns using "Move to..." menu
    fireEvent.click(within(wentWell).getByRole('button', { name: 'Move to...' }));
    flush();
    fireEvent.click(
      within(wentWell).getByRole('menuitem', { name: /To Improve/i }),
    );
    await flushPromises();

    expect(spies.moveCard).toHaveBeenCalledWith({
      boardId: board.id,
      cardId: 'card_mine',
      targetColumnId: 'col_2',
    });
    const toImprove = getByRole('region', { name: 'To Improve' });
    expect(
      within(toImprove).getByText('Refined retro note'),
    ).toBeInTheDocument();

    // Move back via native HTML5 Drag and Drop
    const draggableCard = within(toImprove)
      .getByText('Refined retro note')
      .closest('[data-card-id="card_mine"]') as HTMLElement;
    expect(draggableCard).toHaveAttribute('draggable', 'true');
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => 'card_mine'),
      effectAllowed: 'move',
      dropEffect: 'move',
    };
    fireEvent.dragStart(draggableCard, { dataTransfer });
    fireEvent.dragOver(wentWell, { dataTransfer });
    fireEvent.drop(wentWell, { dataTransfer });
    await flushPromises();

    expect(spies.moveCard).toHaveBeenLastCalledWith({
      boardId: board.id,
      cardId: 'card_mine',
      targetColumnId: 'col_1',
    });

    // Inline delete confirmation: Delete -> Confirm?
    fireEvent.click(within(wentWell).getByRole('button', { name: 'Delete' }));
    flush();
    expect(spies.deleteCard).not.toHaveBeenCalled();

    const confirmBtn = within(wentWell).getByRole('button', {
      name: 'Confirm?',
    });
    fireEvent.click(confirmBtn);
    await flushPromises();

    expect(spies.deleteCard).toHaveBeenCalledWith({
      boardId: board.id,
      cardId: 'card_mine',
    });
    expect(queryByText('Refined retro note')).not.toBeInTheDocument();
  });

  it('allows Facilitators to inline-rename Board and add, rename, reorder, change accent, and delete Columns (with non-empty confirmation)', async () => {
    const existingCard = makeCard({
      id: 'card_in_col2',
      columnId: 'col_2',
      content: 'Needs improvement',
      isMine: false,
    });
    const board = makeBoardView({
      isFacilitator: true,
      columns: [
        {
          id: 'col_1',
          title: 'Went Well',
          accent: 'sage',
          position: 0,
          isActionColumn: false,
          cardCount: 0,
        },
        {
          id: 'col_2',
          title: 'To Improve',
          accent: 'rose',
          position: 1,
          isActionColumn: false,
          cardCount: 1,
        },
      ],
      cards: [existingCard],
    });
    const { actions, spies } = createFakeActions(board);

    const { getByLabelText, getByRole, queryByRole } = render(() => (
      <BoardWorkspace
        board={board}
        boardId={board.id}
        homeHref="/"
        actions={actions}
      />
    ));
    flush();

    // Inline rename Board
    fireEvent.click(getByRole('button', { name: 'Rename Board' }));
    flush();
    const boardTitleInput = getByLabelText('Board title') as HTMLInputElement;
    fireEvent.input(boardTitleInput, {
      target: { value: 'Sprint 43 Retro' },
    });
    flush();
    fireEvent.keyDown(boardTitleInput, { key: 'Enter' });
    await flushPromises();

    expect(spies.renameBoard).toHaveBeenCalledWith({
      boardId: board.id,
      title: 'Sprint 43 Retro',
    });
    expect(
      getByRole('heading', { level: 1, name: 'Sprint 43 Retro' }),
    ).toBeInTheDocument();

    // Add Column
    fireEvent.click(getByRole('button', { name: /\+ Add column/i }));
    flush();
    const newColInput = getByLabelText('New column title') as HTMLInputElement;
    fireEvent.input(newColInput, { target: { value: 'Kudos' } });
    flush();
    fireEvent.click(getByRole('button', { name: 'Add column' }));
    await flushPromises();

    expect(spies.addColumn).toHaveBeenCalledWith({
      boardId: board.id,
      title: 'Kudos',
      accent: 'slate',
      isActionColumn: false,
    });
    expect(
      getByRole('heading', { level: 2, name: 'Kudos' }),
    ).toBeInTheDocument();

    // Open Column settings for "To Improve", change accent to "amber"
    const col2Region = getByRole('region', { name: 'To Improve' });
    fireEvent.click(
      within(col2Region).getByRole('button', {
        name: 'Column options for To Improve',
      }),
    );
    flush();
    fireEvent.click(
      within(col2Region).getByRole('button', { name: 'Accent Amber' }),
    );
    await flushPromises();
    expect(spies.updateColumn).toHaveBeenCalledWith({
      boardId: board.id,
      columnId: 'col_2',
      accent: 'amber',
    });

    // Reorder Column left
    fireEvent.click(
      within(col2Region).getByRole('button', {
        name: 'Column options for To Improve',
      }),
    );
    flush();
    fireEvent.click(
      within(col2Region).getByRole('button', { name: 'Move left' }),
    );
    await flushPromises();
    expect(spies.reorderColumns).toHaveBeenCalledWith({
      boardId: board.id,
      columnIds: ['col_2', 'col_1', 'col_new_2'],
    });

    // Delete non-empty Column -> requires confirmation showing Card count
    fireEvent.click(
      within(col2Region).getByRole('button', {
        name: 'Column options for To Improve',
      }),
    );
    flush();
    fireEvent.click(
      within(col2Region).getByRole('button', { name: 'Delete column' }),
    );
    flush();
    expect(spies.deleteColumn).not.toHaveBeenCalled();
    expect(within(col2Region).getByText(/1 card/i)).toBeInTheDocument();

    fireEvent.click(
      within(col2Region).getByRole('button', { name: 'Confirm delete' }),
    );
    await flushPromises();

    expect(spies.deleteColumn).toHaveBeenCalledWith({
      boardId: board.id,
      columnId: 'col_2',
    });
    expect(
      queryByRole('heading', { level: 2, name: 'To Improve' }),
    ).not.toBeInTheDocument();
  });

  it('toggles Private Mode and reveals all Cards through one HTTP snapshot while preserving local drafts', async () => {
    const own = makeCard({ id: 'own', content: 'My existing Card' });
    const hidden = [
      makeCard({ id: 'secret1', content: 'Another Participant’s first Card', isMine: false }),
      makeCard({ id: 'secret2', content: 'Another Participant’s second Card', isMine: false }),
    ];
    const board = makeBoardView({ cards: [own, ...hidden] });
    const { actions, spies } = createFakeActions(board);
    spies.setPrivateMode.mockImplementation(async (input) => {
      const version = input.isBlurred ? 3 : 4;
      const cards = input.isBlurred
        ? [own, ...hidden.map((card) => ({ ...card, content: '', redacted: true, placeholderLines: 2 }))]
        : board.cards;
      return {
        ok: true,
        version,
        events: [{
          type: 'board:snapshot',
          version,
          serverNow: Date.now(),
          board: { ...board, version, cards, isBlurred: input.isBlurred },
        }],
      };
    });
    const { getByRole, getByText, queryByText, getAllByLabelText } = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();

    const ownCard = getByText(own.content).closest('article')!;
    fireEvent.click(within(ownCard).getByRole('button', { name: 'Edit card' }));
    flush();
    const editor = getByRole('textbox', { name: 'Edit card text' });
    fireEvent.input(editor, { target: { value: 'Editing my Card' } });
    const composer = getByRole('textbox', { name: 'Add card to Went Well' });
    fireEvent.input(composer, { target: { value: 'Composing a new Card' } });
    flush();

    fireEvent.click(getByRole('button', { name: 'Private Mode' }));
    await flushPromises();
    expect(spies.setPrivateMode).toHaveBeenCalledWith({ boardId: board.id, isBlurred: true });
    expect(getAllByLabelText('Hidden Card in Private Mode')).toHaveLength(2);
    for (const card of hidden) {
      expect(queryByText(card.content)).toBeNull();
    }
    expect(getByRole('button', { name: 'Reveal All' })).toBeEnabled();
    expect(editor).toHaveValue('Editing my Card');
    expect(composer).toHaveValue('Composing a new Card');

    fireEvent.keyDown(composer, { key: 'b' });
    await flushPromises();
    expect(spies.setPrivateMode).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'b' });
    await flushPromises();
    expect(spies.setPrivateMode).toHaveBeenLastCalledWith({ boardId: board.id, isBlurred: false });
    for (const card of hidden) {
      expect(getByText(card.content)).toBeInTheDocument();
    }
    expect(getByText('All Cards revealed.')).toHaveAttribute('aria-live', 'polite');
    expect(getByRole('textbox', { name: 'Edit card text' })).toBe(editor);
    expect(getByRole('textbox', { name: 'Add card to Went Well' })).toBe(composer);
  });

  it('hides Facilitator edit/move/delete controls on redacted Cards during Private Mode', () => {
    const redactedCard = makeCard({
      id: 'card_secret',
      columnId: 'col_1',
      content: '',
      redacted: true,
      placeholderLines: 2,
      isMine: false,
    });
    const board = makeBoardView({
      isBlurred: true,
      isFacilitator: true,
      columns: [
        {
          id: 'col_1',
          title: 'Went Well',
          accent: 'sage',
          position: 0,
          isActionColumn: false,
          cardCount: 1,
        },
      ],
      cards: [redactedCard],
    });

    const { getByRole } = render(() => (
      <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
    ));
    flush();

    const col1 = getByRole('region', { name: 'Went Well' });
    expect(
      within(col1).queryByRole('button', { name: 'Edit card' }),
    ).toBeNull();
    expect(within(col1).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('renders with zero Solid 2.0 reactivity diagnostics', async () => {
    const board = makeBoardView({
      cards: [makeCard()],
    });
    const { artifact } = await captureArtifact(
      () => {
        render(() => (
          <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
        ));
        flush();
      },
      { scenario: 'board-workspace-render' },
    );
    expectNoDiagnostics(artifact);
  });
});
