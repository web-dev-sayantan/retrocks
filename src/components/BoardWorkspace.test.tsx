import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardWorkspaceActions } from '../lib/board-actions';
import type { BoardLiveMessage } from '../lib/board-live-protocol';
import type { BoardEvent, BoardMutationResponse, BoardViewDTO, CardGroupDTO, CardViewDTO, ColumnDTO } from '../lib/board-types';
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
  const groups = new Map<string, CardGroupDTO>(
    initialBoard.groups.map((g) => [g.id, { ...g, cardIds: [...g.cardIds] }] as const),
  );

  const groupView = (group: CardGroupDTO): CardGroupDTO => {
    const members = group.cardIds
      .map((id) => cards.get(id))
      .filter((card): card is CardViewDTO => card !== undefined);
    return {
      ...group,
      cardIds: [...group.cardIds],
      votes:
        group.votes === null
          ? null
          : group.votes + members.reduce((sum, card) => sum + (card.votes ?? 0), 0),
      myVotes:
        group.myVotes + members.reduce((sum, card) => sum + card.myVotes, 0),
    };
  };

  const updateTimer = vi.fn<BoardWorkspaceActions['updateTimer']>();

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

  const updateActionItem = vi.fn(async (input) => {
    version += 1;
    const existing = cards.get(input.cardId)!;
    const updated: CardViewDTO = {
      ...existing,
      ...(input.isActionItem !== undefined
        ? {
            isActionItem: input.isActionItem,
            ...(input.isActionItem
              ? {}
              : { actionDone: false, actionOwner: '' }),
          }
        : {}),
      ...(input.actionDone !== undefined
        ? { actionDone: input.actionDone }
        : {}),
      ...(input.actionOwner !== undefined
        ? { actionOwner: input.actionOwner }
        : {}),
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

  const groupCards = vi.fn(async (input) => {
    version += 1;
    const targetCard =
      input.targetType === 'card' ? cards.get(input.targetId) : undefined;
    let group =
      input.targetType === 'group'
        ? groups.get(input.targetId)
        : [...groups.values()].find((item) =>
            item.cardIds.includes(input.targetId),
          );
    const moved = cards.get(input.cardId)!;
    if (!group) {
      if (!targetCard) throw new Error('Missing target Card');
      seq += 1;
      group = {
        id: `group_new_${seq}`,
        columnId: targetCard.columnId,
        title: targetCard.content,
        cardIds: [targetCard.id],
        votes: 0,
        myVotes: 0,
        createdAt: Date.now(),
      };
      groups.set(group.id, group);
      targetCard.groupId = group.id;
    }
    const previousGroupId = moved.groupId;
    if (previousGroupId && previousGroupId !== group.id) {
      const previous = groups.get(previousGroupId);
      if (previous) {
        previous.cardIds = previous.cardIds.filter((id) => id !== moved.id);
        if (previous.cardIds.length < 2) {
          for (const id of previous.cardIds) {
            const member = cards.get(id);
            if (member) member.groupId = null;
          }
          groups.delete(previousGroupId);
        }
      }
    }
    moved.groupId = group.id;
    if (!group.cardIds.includes(moved.id)) group.cardIds.push(moved.id);
    return {
      ok: true as const,
      version,
      events: [
        { type: 'group:upserted' as const, version, group: groupView(group) },
        ...(targetCard && targetCard.id !== moved.id
          ? [
              {
                type: 'card:upserted' as const,
                version,
                card: { ...targetCard },
              },
            ]
          : []),
        {
          type: 'card:upserted' as const,
          version,
          card: { ...moved },
        },
      ],
    };
  });

  const renameCardGroup = vi.fn(async (input) => {
    version += 1;
    const group = groups.get(input.groupId)!;
    group.title = input.title.trim();
    return {
      ok: true as const,
      version,
      events: [
        { type: 'group:upserted' as const, version, group: groupView(group) },
      ],
    };
  });

  const ungroupCard = vi.fn(async (input) => {
    version += 1;
    const card = cards.get(input.cardId)!;
    const group = card.groupId ? groups.get(card.groupId) : undefined;
    const events: BoardEvent[] = [];
    card.groupId = null;
    if (group) {
      group.cardIds = group.cardIds.filter((id) => id !== card.id);
      if (group.cardIds.length < 2) {
        for (const id of group.cardIds) {
          const member = cards.get(id);
          if (member) member.groupId = null;
        }
        groups.delete(group.id);
        events.push({ type: 'group:dissolved', version, groupId: group.id });
      }
    }
    events.push({ type: 'card:upserted', version, card: { ...card } });
    return { ok: true as const, version, events };
  });

  const dissolveCardGroup = vi.fn(async (input) => {
    version += 1;
    const group = groups.get(input.groupId)!;
    for (const id of group.cardIds) {
      const member = cards.get(id);
      if (member) member.groupId = null;
    }
    groups.delete(input.groupId);
    return {
      ok: true as const,
      version,
      events: [
        { type: 'group:dissolved' as const, version, groupId: input.groupId },
      ],
    };
  });

  const moveCardGroup = vi.fn(async (input) => {
    version += 1;
    const group = groups.get(input.groupId)!;
    group.columnId = input.targetColumnId;
    const events: BoardEvent[] = [
      { type: 'group:upserted' as const, version, group: groupView(group) },
    ];
    for (const id of group.cardIds) {
      const card = cards.get(id)!;
      card.columnId = input.targetColumnId;
      events.push({ type: 'card:upserted' as const, version, card: { ...card } });
    }
    return { ok: true as const, version, events };
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
  const changeVote = vi.fn<BoardWorkspaceActions['changeVote']>();
  const updateVotingSettings = vi.fn<BoardWorkspaceActions['updateVotingSettings']>();
  const resetVotes = vi.fn<BoardWorkspaceActions['resetVotes']>();
  const actions: BoardWorkspaceActions = {
    changeVote,
    updateVotingSettings,
    resetVotes,
    setPrivateMode,
    renameBoard,
    updateTimer,
    createCard,
    updateCard,
    updateActionItem,
    moveCard,
    deleteCard,
    toggleReaction,
    createComment,
    deleteComment,
    addColumn,
    updateColumn,
    reorderColumns,
    deleteColumn,
    groupCards,
    renameCardGroup,
    ungroupCard,
    dissolveCardGroup,
    moveCardGroup,
  };

  return {
    actions,
    spies: {
      changeVote,
      updateVotingSettings,
      resetVotes,
      setPrivateMode,
      renameBoard,
      updateTimer,
      createCard,
      updateCard,
      updateActionItem,
      moveCard,
      deleteCard,
      toggleReaction,
      createComment,
      deleteComment,
      addColumn,
      updateColumn,
      reorderColumns,
      deleteColumn,
      groupCards,
      renameCardGroup,
      ungroupCard,
      dissolveCardGroup,
      moveCardGroup,
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
  it('optimistically updates the Card and toolbar balance, then restores both on rejection', async () => {
    const card = makeCard({ isMine: false, votes: 2 });
    const board = makeBoardView({
      cards: [card],
      isFacilitator: false,
      voteLimit: 3,
      remainingVotes: 3,
    });
    const { actions, spies } = createFakeActions(board);
    const rejected = Promise.withResolvers<BoardMutationResponse>();
    spies.changeVote.mockReturnValueOnce(rejected.promise);
    const { getByRole, getByText, getByTitle, queryByRole } = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();

    expect(getByText('3 / 3 votes left')).toHaveClass('tabular-nums');
    expect(queryByRole('button', { name: 'Board Settings' })).not.toBeInTheDocument();
    fireEvent.click(getByRole('button', { name: 'Cast Vote' }));
    flush();
    expect(getByText('2 / 3 votes left')).toBeInTheDocument();
    expect(getByTitle('3 total Votes · 1 yours')).toBeInTheDocument();

    rejected.resolve({ ok: false, code: 'LIMIT_EXCEEDED', message: 'Vote cap changed.' });
    await flushPromises();
    expect(getByRole('alert')).toHaveTextContent('Vote cap changed.');
    expect(getByText('3 / 3 votes left')).toBeInTheDocument();
    expect(getByTitle('2 total Votes · 0 yours')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Remove Vote' })).toBeDisabled();
  });
  it('stacks and removes Votes without showing a balance on an unlimited Board', async () => {
    const card = makeCard({ votes: 6, myVotes: 3 });
    const board = makeBoardView({ cards: [card], voteLimit: null, remainingVotes: null });
    const { actions, spies } = createFakeActions(board);
    spies.changeVote
      .mockResolvedValueOnce({
        ok: true,
        version: 2,
        events: [{
          type: 'vote:updated',
          version: 2,
          targetType: 'card',
          targetId: card.id,
          totalVotes: 7,
          myVotes: 4,
          remainingVotes: null,
        }],
      })
      .mockResolvedValueOnce({
        ok: true,
        version: 3,
        events: [{
          type: 'vote:updated',
          version: 3,
          targetType: 'card',
          targetId: card.id,
          totalVotes: 6,
          myVotes: 3,
          remainingVotes: null,
        }],
      });

    const { getByRole, getByTitle, queryByText } = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();
    expect(queryByText(/votes left/)).not.toBeInTheDocument();
    expect(getByRole('button', { name: 'Cast Vote' })).toBeEnabled();
    fireEvent.click(getByRole('button', { name: 'Cast Vote' }));
    await flushPromises();
    expect(getByTitle('7 total Votes · 4 yours')).toBeInTheDocument();

    fireEvent.click(getByRole('button', { name: 'Remove Vote' }));
    flush();
    expect(getByTitle('6 total Votes · 3 yours')).toBeInTheDocument();
    await flushPromises();
    expect(getByTitle('6 total Votes · 3 yours')).toBeInTheDocument();
    expect(spies.changeVote).toHaveBeenLastCalledWith({
      boardId: board.id, targetType: 'card', targetId: card.id, delta: -1,
    });
  });

  it('applies voting settings immediately and resets all Votes only after confirmation', async () => {
    const card = makeCard({ votes: 3, myVotes: 1 });
    const board = makeBoardView({ cards: [card], remainingVotes: 4 });
    const { actions, spies } = createFakeActions(board);
    const blindBoard = makeBoardView({
      version: 3,
      cards: [{ ...card, votes: null }],
      blindVoting: true,
      voteLimit: 7,
      maxVotesPerCard: 1,
      remainingVotes: 6,
    });
    const resetBoard = {
      ...blindBoard,
      version: 4,
      remainingVotes: 7,
      cards: [{ ...card, votes: null, myVotes: 0 }],
    };
    spies.updateVotingSettings.mockResolvedValue({
      ok: true,
      version: 3,
      events: [{ type: 'board:snapshot', version: 3, serverNow: Date.now(), board: blindBoard }],
    });
    spies.resetVotes.mockResolvedValue({
      ok: true,
      version: 4,
      events: [{ type: 'board:snapshot', version: 4, serverNow: Date.now(), board: resetBoard }],
    });

    const { getByRole, getByText, queryByTitle } = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();
    const dialog = getByText('Board Settings', { selector: 'h2' }).closest('dialog')!;
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    fireEvent.click(getByRole('button', { name: 'Board Settings' }));
    flush();
    const settings = within(getByRole('dialog', { name: 'Board Settings' }));
    const voteLimit = settings.getByRole('combobox', { name: 'Vote limit' });
    fireEvent.change(voteLimit, { target: { value: 'custom' } });
    flush();
    fireEvent.input(settings.getByRole('spinbutton', { name: 'Custom Vote limit' }), { target: { value: '7' } });
    fireEvent.change(settings.getByRole('combobox', { name: 'Per-Card cap' }), { target: { value: '1' } });
    fireEvent.click(settings.getByRole('checkbox', { name: 'Blind Voting' }));
    flush();
    fireEvent.click(settings.getByRole('button', { name: 'Save Settings' }));
    await flushPromises();

    expect(spies.updateVotingSettings).toHaveBeenCalledWith({
      boardId: board.id, voteLimit: 7, maxVotesPerCard: 1, blindVoting: true,
    });
    expect(getByText('6 / 7 votes left')).toBeInTheDocument();
    expect(getByText('1 yours')).toBeInTheDocument();
    expect(queryByTitle('3 total Votes · 1 yours')).not.toBeInTheDocument();
    expect(getByRole('button', { name: 'Cast Vote' })).toBeDisabled();

    fireEvent.click(getByRole('button', { name: 'Board Settings' }));
    flush();
    fireEvent.click(settings.getByRole('button', { name: 'Reset All Votes' }));
    flush();
    expect(spies.resetVotes).not.toHaveBeenCalled();
    fireEvent.click(settings.getByRole('button', { name: 'Confirm Reset' }));
    await flushPromises();

    expect(spies.resetVotes).toHaveBeenCalledWith({ boardId: board.id });
    fireEvent.click(settings.getByRole('button', { name: 'Close Board Settings' }));
    expect(getByText('7 / 7 votes left')).toBeInTheDocument();
    expect(getByText('0 yours')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Cast Vote' })).toBeEnabled();
    expect(getByRole('button', { name: 'Remove Vote' })).toBeDisabled();
  });

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

  it('flags Action Items from the Card menu, syncs the open badge live, and opens the Action Items Drawer via A', async () => {
    const streams: EventTarget[] = [];
    vi.stubGlobal(
      'EventSource',
      class extends EventTarget {
        constructor() {
          super();
          streams.push(this);
        }
        close() {}
      },
    );
    const regular = makeCard({
      id: 'regular',
      content: 'Pair on flaky tests',
      isMine: false,
    });
    const action = makeCard({
      id: 'action',
      columnId: 'col_3',
      content: 'Ship canary',
      isMine: false,
      isActionItem: true,
    });
    const board = makeBoardView({
      isFacilitator: false,
      cards: [regular, action],
    });
    const { actions, spies } = createFakeActions(board);
    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    function receive(message: BoardLiveMessage) {
      streams[0].dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify(message) }),
      );
      flush();
    }
    try {
      flush();
      receive({ type: 'board:snapshot', version: 1, serverNow: 100, board });
      expect(
        view.getByRole('button', { name: 'Action Items, 1 open' }),
      ).toBeInTheDocument();

      const cardArticle = view
        .getByText('Pair on flaky tests')
        .closest('article')!;
      fireEvent.click(
        within(cardArticle).getByRole('button', {
          name: 'Flag as Action Item',
        }),
      );
      await flushPromises();
      expect(spies.updateActionItem).toHaveBeenCalledWith({
        boardId: board.id,
        cardId: 'regular',
        isActionItem: true,
      });
      expect(
        view.getByRole('button', { name: 'Action Items, 2 open' }),
      ).toBeInTheDocument();

      const refreshedArticle = view
        .getByText('Pair on flaky tests')
        .closest('article')!;
      const doneCheckbox = within(refreshedArticle).getByLabelText(
        'Mark Pair on flaky tests as Done',
      );
      fireEvent.click(doneCheckbox);
      await flushPromises();
      expect(spies.updateActionItem).toHaveBeenLastCalledWith({
        boardId: board.id,
        cardId: 'regular',
        actionDone: true,
      });
      expect(
        view.getByRole('button', { name: 'Action Items, 1 open' }),
      ).toBeInTheDocument();

      receive({
        type: 'board:mutation',
        version: 4,
        events: [
          {
            type: 'card:upserted',
            version: 4,
            card: { ...action, actionDone: true },
          },
        ],
      });
      expect(
        view.getByRole('button', { name: 'Action Items, 0 open' }),
      ).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'a' });
      flush();
      const drawer = within(
        view.getByRole('dialog', { name: 'Action Items' }),
      );
      expect(drawer.getByText('Pair on flaky tests')).toBeInTheDocument();
      expect(drawer.getByText('Ship canary')).toBeInTheDocument();
      expect(drawer.getByRole('button', { name: 'Done (2)' })).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      flush();
      expect(
        view.queryByRole('dialog', { name: 'Action Items' }),
      ).not.toBeInTheDocument();

      const composer = view.getByRole('textbox', {
        name: 'Add card to Went Well',
      });
      fireEvent.keyDown(composer, { key: 'a' });
      flush();
      expect(
        view.queryByRole('dialog', { name: 'Action Items' }),
      ).not.toBeInTheDocument();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('flags, completes, and tags an Action Item from the Card detail drawer', async () => {
    const card = makeCard({ id: 'detail_card', content: 'Write the runbook' });
    const board = makeBoardView({ cards: [card] });
    const { actions, spies } = createFakeActions(board);
    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();

    fireEvent.click(view.getByRole('button', { name: 'Open Card details' }));
    flush();
    const drawer = within(view.getByRole('dialog', { name: 'Card details' }));

    fireEvent.click(drawer.getByLabelText('Flag as Action Item'));
    await flushPromises();
    expect(spies.updateActionItem).toHaveBeenCalledWith({
      boardId: board.id,
      cardId: 'detail_card',
      isActionItem: true,
    });

    fireEvent.click(drawer.getByLabelText('Done'));
    await flushPromises();
    expect(spies.updateActionItem).toHaveBeenLastCalledWith({
      boardId: board.id,
      cardId: 'detail_card',
      actionDone: true,
    });

    const owner = drawer.getByLabelText('Action owner');
    expect(owner).toHaveAttribute('maxlength', '40');
    fireEvent.input(owner, { target: { value: 'Platform' } });
    flush();
    fireEvent.keyDown(owner, { key: 'Enter' });
    await flushPromises();
    expect(spies.updateActionItem).toHaveBeenLastCalledWith({
      boardId: board.id,
      cardId: 'detail_card',
      actionOwner: 'Platform',
    });
    expect(drawer.getByLabelText('Action owner')).toHaveValue('Platform');

    fireEvent.click(drawer.getByLabelText('Action Item'));
    await flushPromises();
    expect(spies.updateActionItem).toHaveBeenLastCalledWith({
      boardId: board.id,
      cardId: 'detail_card',
      isActionItem: false,
    });
    expect(drawer.queryByLabelText('Done')).not.toBeInTheDocument();
    expect(drawer.queryByLabelText('Action owner')).not.toBeInTheDocument();
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

  it('groups Cards from the "Group with..." menu and votes only on the Card Group header', async () => {
    const first = makeCard({
      id: 'card_1',
      content: 'CI flakiness',
      votes: 2,
      myVotes: 1,
    });
    const second = makeCard({
      id: 'card_2',
      content: 'Flaky CI checks',
      isMine: false,
      votes: 1,
    });
    const board = makeBoardView({ cards: [first, second], isFacilitator: true });
    const { actions, spies } = createFakeActions(board);
    const { getByRole, queryByLabelText } = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();

    const wentWell = getByRole('region', { name: 'Went Well' });
    fireEvent.click(
      within(wentWell).getAllByRole('button', { name: 'Group with...' })[0],
    );
    flush();
    fireEvent.click(
      within(wentWell).getByRole('menuitem', { name: /Flaky CI checks/ }),
    );
    await flushPromises();

    expect(spies.groupCards).toHaveBeenCalledWith({
      boardId: board.id,
      cardId: 'card_1',
      targetType: 'card',
      targetId: 'card_2',
    });
    expect(within(wentWell).getByLabelText('2 cards')).toBeInTheDocument();
    expect(
      within(wentWell).getByTitle('3 total Votes · 1 yours'),
    ).toBeInTheDocument();
    expect(
      within(wentWell).getAllByRole('button', { name: 'Cast Vote' }),
    ).toHaveLength(1);

    fireEvent.click(
      within(wentWell).getByRole('button', { name: 'Cast Vote' }),
    );
    await flushPromises();
    expect(spies.changeVote).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: board.id,
        targetType: 'group',
        delta: 1,
      }),
    );

    fireEvent.click(
      within(wentWell).getByRole('button', {
        name: 'Collapse Card Group',
      }),
    );
    flush();
    expect(
      within(wentWell).queryByText('CI flakiness'),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(wentWell).getByRole('button', {
        name: 'Expand Card Group',
      }),
    );
    flush();
    expect(within(wentWell).getByText('CI flakiness')).toBeInTheDocument();

    fireEvent.click(
      within(wentWell).getAllByRole('button', { name: 'Ungroup card' })[0],
    );
    await flushPromises();

    expect(spies.ungroupCard).toHaveBeenCalledWith({
      boardId: board.id,
      cardId: 'card_1',
    });
    expect(queryByLabelText('2 cards')).not.toBeInTheDocument();
    expect(
      within(wentWell).getAllByRole('button', { name: 'Cast Vote' }),
    ).toHaveLength(2);
  });

  it('shows group management only when Participants may group, then renames, moves, and dissolves', async () => {
    const group: CardGroupDTO = {
      id: 'group_1',
      columnId: 'col_1',
      title: 'CI stability',
      cardIds: ['card_1', 'card_2'],
      votes: 3,
      myVotes: 1,
      createdAt: 1_760_000_002_000,
    };
    const cards = [
      makeCard({
        id: 'card_1',
        columnId: 'col_1',
        content: 'CI flakiness',
        groupId: 'group_1',
        votes: 1,
        myVotes: 1,
      }),
      makeCard({
        id: 'card_2',
        columnId: 'col_1',
        content: 'Flaky CI checks',
        groupId: 'group_1',
        votes: 2,
      }),
    ];
    const participantBoard = makeBoardView({
      cards,
      groups: [group],
      isFacilitator: false,
      allowParticipantGroup: false,
    });
    const participant = createFakeActions(participantBoard);
    const firstRender = render(() => (
      <BoardWorkspace
        board={participantBoard}
        boardId={participantBoard.id}
        actions={participant.actions}
      />
    ));
    flush();
    const participantColumn = firstRender.getByRole('region', {
      name: 'Went Well',
    });
    expect(
      within(participantColumn).queryByRole('button', {
        name: 'Rename Card Group',
      }),
    ).not.toBeInTheDocument();
    expect(
      within(participantColumn).queryByRole('button', { name: 'Ungroup card' }),
    ).not.toBeInTheDocument();
    cleanup();

    const board = makeBoardView({
      cards,
      groups: [group],
      isFacilitator: false,
      allowParticipantGroup: true,
    });
    const { actions, spies } = createFakeActions(board);
    const { getByRole, getByLabelText, queryByText } = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();
    const wentWell = getByRole('region', { name: 'Went Well' });

    fireEvent.click(
      within(wentWell).getByRole('button', { name: 'Rename Card Group' }),
    );
    flush();
    const titleInput = getByLabelText('Card Group title');
    fireEvent.input(titleInput, { target: { value: 'CI reliability' } });
    flush();
    fireEvent.click(
      getByRole('button', { name: 'Save Card Group title' }),
    );
    await flushPromises();
    expect(spies.renameCardGroup).toHaveBeenCalledWith({
      boardId: board.id,
      groupId: 'group_1',
      title: 'CI reliability',
    });
    expect(within(wentWell).getByText('CI reliability')).toBeInTheDocument();

    fireEvent.click(
      within(wentWell).getByRole('button', {
        name: 'Move Card Group to...',
      }),
    );
    flush();
    fireEvent.click(
      within(wentWell).getByRole('menuitem', { name: /To Improve/i }),
    );
    await flushPromises();
    expect(spies.moveCardGroup).toHaveBeenCalledWith({
      boardId: board.id,
      groupId: 'group_1',
      targetColumnId: 'col_2',
    });
    const toImprove = getByRole('region', { name: 'To Improve' });
    expect(within(toImprove).getByText('CI reliability')).toBeInTheDocument();

    fireEvent.click(
      within(toImprove).getByRole('button', {
        name: 'Dissolve Card Group',
      }),
    );
    await flushPromises();
    expect(spies.dissolveCardGroup).toHaveBeenCalledWith({
      boardId: board.id,
      groupId: 'group_1',
    });
    expect(queryByText('CI reliability')).not.toBeInTheDocument();
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
