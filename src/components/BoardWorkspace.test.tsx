import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { Show, createSignal, flush } from 'solid-js';
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
  const setBoardLock = vi.fn<BoardWorkspaceActions['setBoardLock']>(
    async (input) => {
      version += 1;
      return {
        ok: true as const,
        version,
        events: [
          {
            type: 'board:updated' as const,
            version,
            patch: { isLocked: input.isLocked },
          },
        ],
      };
    },
  );
  const deleteBoard = vi.fn<BoardWorkspaceActions['deleteBoard']>(async () => {
    version += 1;
    return {
      ok: true as const,
      version,
      events: [{ type: 'board:deleted' as const, version }],
    };
  });
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
    setBoardLock,
    deleteBoard,
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
      setBoardLock,
      deleteBoard,
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

function openBoardSettings(view: Pick<ReturnType<typeof render>, 'getByRole'>) {
  fireEvent.click(view.getByRole('button', { name: 'More board actions' }));
  flush();
  fireEvent.click(view.getByRole('menuitem', { name: 'Board Settings' }));
  flush();
}

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
    openBoardSettings({ getByRole });
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

    openBoardSettings({ getByRole });
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
        view.getByRole('button', { name: 'Action Items 1 open' }),
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
        view.getByRole('button', { name: 'Action Items 2 open' }),
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
        view.getByRole('button', { name: 'Action Items 1 open' }),
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
        view.getByRole('button', { name: 'Action Items 0 open' }),
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
    fireEvent.click(getByRole('button', { name: 'Add a Column' }));
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

  it('lets a Facilitator Lock and Unlock the Board while keeping Action Item follow-up enabled and disabling content edits', async () => {
    const regularCard = makeCard({
      id: 'card_regular',
      columnId: 'col_1',
      content: 'Great collaboration',
      isMine: true,
      votes: 2,
      myVotes: 1,
      reactions: { '👍': 1 },
      myReactions: ['👍'],
    });
    const actionCard = makeCard({
      id: 'card_action',
      columnId: 'col_3',
      content: 'Automate canary rollback',
      isMine: false,
      isActionItem: true,
      actionDone: false,
      actionOwner: '',
    });
    const board = makeBoardView({
      isFacilitator: true,
      isLocked: false,
      cards: [regularCard, actionCard],
    });
    const { actions, spies } = createFakeActions(board);

    const { getByRole, getByText, queryByRole, queryByLabelText, queryByText } =
      render(() => (
        <BoardWorkspace
          board={board}
          boardId={board.id}
          homeHref="/"
          actions={actions}
        />
      ));
    flush();

    const dialog = getByText('Board Settings', { selector: 'h2' }).closest(
      'dialog',
    )!;
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
    };

    // Open Board Settings and Lock the Board
    openBoardSettings({ getByRole });
    flush();
    const settings = within(getByRole('dialog', { name: 'Board Settings' }));
    fireEvent.click(settings.getByRole('button', { name: 'Lock Board' }));
    await flushPromises();

    expect(spies.setBoardLock).toHaveBeenCalledWith({
      boardId: board.id,
      isLocked: true,
    });
    // Voting controls inside Board Settings are disabled while Locked, Unlock is enabled
    expect(settings.getByRole('button', { name: 'Save Settings' })).toBeDisabled();
    expect(settings.getByRole('button', { name: 'Reset All Votes' })).toBeDisabled();
    expect(settings.getByRole('button', { name: 'Unlock Board' })).toBeEnabled();
    fireEvent.click(settings.getByRole('button', { name: 'Close Board Settings' }));
    flush();

    // Locked badge shown; content mutation controls hidden/disabled; Board Settings & Share stay available
    expect(getByText('Locked')).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Rename Board' })).toBeNull();
    expect(queryByRole('button', { name: 'Private Mode' })).toBeNull();
    expect(queryByRole('button', { name: 'Add a Column' })).toBeNull();
    expect(queryByLabelText('Add card to Went Well')).toBeNull();
    expect(queryByRole('button', { name: 'Cast Vote' })).toBeNull();
    expect(queryByRole('button', { name: 'Remove Vote' })).toBeNull();
    expect(queryByRole('button', { name: 'Edit card' })).toBeNull();
    expect(queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(queryByRole('button', { name: 'Add reaction' })).toBeNull();
    expect(queryByRole('button', { name: 'Flag as Action Item' })).toBeNull();
    expect(queryByRole('button', { name: 'Unflag Action Item' })).toBeNull();
    fireEvent.click(getByRole('button', { name: 'More board actions' }));
    flush();
    expect(getByRole('menuitem', { name: 'Board Settings' })).toBeEnabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    flush();
    expect(getByRole('button', { name: 'Share' })).toBeEnabled();

    // Facilitator CAN update actionDone & actionOwner on existing Action Items in Action Items Drawer
    fireEvent.click(getByRole('button', { name: /Action Items \d+ open/i }));
    flush();
    const drawer = within(getByRole('dialog', { name: 'Action Items' }));
    const drawerDone = drawer.getByLabelText(
      'Mark Automate canary rollback as Done',
    );
    const drawerOwner = drawer.getByLabelText(
      'Owner for Automate canary rollback',
    );
    expect(drawerDone).toBeEnabled();
    expect(drawerOwner).toBeEnabled();

    fireEvent.click(drawerDone);
    await flushPromises();
    expect(spies.updateActionItem).toHaveBeenCalledWith({
      boardId: board.id,
      cardId: actionCard.id,
      actionDone: true,
    });

    const refreshedOwner = drawer.getByLabelText(
      'Owner for Automate canary rollback',
    );
    fireEvent.input(refreshedOwner, { target: { value: 'Platform' } });
    flush();
    fireEvent.keyDown(refreshedOwner, { key: 'Enter' });
    await flushPromises();
    expect(spies.updateActionItem).toHaveBeenLastCalledWith({
      boardId: board.id,
      cardId: actionCard.id,
      actionOwner: 'Platform',
    });
    fireEvent.click(drawer.getByRole('button', { name: 'Close Action Items' }));
    flush();

    // Facilitator CAN also update existing Action Item in Card Detail Drawer, but cannot unflag or comment
    const actionArticle = within(getByRole('main')).getByText('Automate canary rollback').closest('article')!;
    fireEvent.click(
      within(actionArticle).getByRole('button', { name: 'Open Card details' }),
    );
    flush();
    const detail = within(getByRole('dialog', { name: 'Card details' }));
    expect(detail.getByLabelText('Action Item')).toBeDisabled();
    expect(detail.getByLabelText('Done')).toBeEnabled();
    expect(detail.getByLabelText('Action owner')).toBeEnabled();
    expect(detail.queryByLabelText('Comment')).toBeNull();
    fireEvent.click(detail.getByLabelText('Done'));
    await flushPromises();
    expect(spies.updateActionItem).toHaveBeenLastCalledWith({
      boardId: board.id,
      cardId: actionCard.id,
      actionDone: false,
    });
    fireEvent.click(detail.getByRole('button', { name: 'Close Card details' }));
    flush();

    // Unlock the Board from Board Settings
    openBoardSettings({ getByRole });
    flush();
    fireEvent.click(settings.getByRole('button', { name: 'Unlock Board' }));
    await flushPromises();
    fireEvent.click(settings.getByRole('button', { name: 'Close Board Settings' }));
    flush();

    expect(spies.setBoardLock).toHaveBeenLastCalledWith({
      boardId: board.id,
      isLocked: false,
    });
    expect(queryByText('Locked')).toBeNull();
    expect(getByRole('button', { name: 'Private Mode' })).toBeEnabled();
  });

  it('returns focus to More when the Action Items header entry is hidden while the drawer is open', () => {
    const board = makeBoardView({ isLocked: true });
    const { actions } = createFakeActions(board);
    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();

    const entry = view.getByRole('button', { name: 'Action Items 0 open' });
    entry.focus();
    fireEvent.click(entry);
    flush();

    const close = view.getByRole('button', { name: 'Close Action Items' });
    expect(close).toHaveFocus();
    // In the browser the header entry becomes hidden at the compact layout width.
    entry.hidden = true;
    fireEvent.click(close);
    flush();

    expect(view.queryByRole('dialog', { name: 'Action Items' })).toBeNull();
    expect(view.getByRole('button', { name: 'More board actions' })).toHaveFocus();
  });

  it('prevents non-Facilitator Participants from editing Action Items or accessing Board Settings when Locked', () => {
    const actionCard = makeCard({
      id: 'card_action',
      columnId: 'col_3',
      content: 'Follow up with QA',
      isMine: true,
      isActionItem: true,
      actionDone: false,
      actionOwner: 'QA',
    });
    const board = makeBoardView({
      isFacilitator: false,
      isLocked: true,
      cards: [actionCard],
    });
    const { actions } = createFakeActions(board);

    const { getByRole, getByText, queryByRole } = render(() => (
      <BoardWorkspace
        board={board}
        boardId={board.id}
        homeHref="/"
        actions={actions}
      />
    ));
    flush();

    expect(getByText('Locked')).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Board Settings' })).toBeNull();
    expect(
      getByRole('checkbox', { name: 'Mark Follow up with QA as Done' }),
    ).toBeDisabled();

    // Action Items Drawer disables controls for Participant while Locked
    fireEvent.click(getByRole('button', { name: /Action Items \d+ open/i }));
    flush();
    const drawer = within(getByRole('dialog', { name: 'Action Items' }));
    expect(
      drawer.getByLabelText('Mark Follow up with QA as Done'),
    ).toBeDisabled();
    expect(drawer.getByLabelText('Owner for Follow up with QA')).toBeDisabled();
    fireEvent.click(drawer.getByRole('button', { name: 'Close Action Items' }));
    flush();

    // Card Detail Drawer disables Action Item controls & hides comments composer
    fireEvent.click(getByRole('button', { name: 'Open Card details' }));
    flush();
    const detail = within(getByRole('dialog', { name: 'Card details' }));
    expect(detail.getByLabelText('Action Item')).toBeDisabled();
    expect(detail.getByLabelText('Done')).toBeDisabled();
    expect(detail.getByLabelText('Action owner')).toBeDisabled();
    expect(detail.queryByLabelText('Comment')).toBeNull();
  });

  it('requires explicit confirmation before permanently deleting a Board and scrubs Recent Boards', async () => {
    const board = makeBoardView({ isFacilitator: true, isLocked: true });
    recordRecentBoard({
      id: board.id,
      title: board.title,
      isFacilitator: true,
    });
    const { actions, spies } = createFakeActions(board);

    const { getByRole, getByText } = render(() => (
      <BoardWorkspace
        board={board}
        boardId={board.id}
        homeHref="/"
        actions={actions}
      />
    ));
    flush();

    const dialog = getByText('Board Settings', { selector: 'h2' }).closest(
      'dialog',
    )!;
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
    };

    openBoardSettings({ getByRole });
    flush();
    const settings = within(getByRole('dialog', { name: 'Board Settings' }));

    // Clicking Delete Board opens confirmation without deleting yet
    fireEvent.click(settings.getByRole('button', { name: 'Delete Board' }));
    flush();
    expect(spies.deleteBoard).not.toHaveBeenCalled();

    // Cancel aborts deletion
    fireEvent.click(settings.getByRole('button', { name: 'Cancel Delete' }));
    flush();
    expect(spies.deleteBoard).not.toHaveBeenCalled();

    // Confirming deletes the Board, shows 404 empty state, and removes from Recent Boards
    fireEvent.click(settings.getByRole('button', { name: 'Delete Board' }));
    flush();
    fireEvent.click(settings.getByRole('button', { name: 'Confirm Delete' }));
    await flushPromises();

    expect(spies.deleteBoard).toHaveBeenCalledWith({ boardId: board.id });
    expect(
      getByRole('heading', { level: 1, name: 'Board not found or expired' }),
    ).toBeInTheDocument();
    expect(
      getByRole('link', { name: 'Create a new board' }),
    ).toBeInTheDocument();
    expect(readRecentBoards().some((item) => item.id === board.id)).toBe(false);
  });

  it('transitions connected clients to "Board not found or expired" and removes Recent Board on live board:deleted', () => {
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
      emit(message: BoardLiveMessage) {
        this.dispatchEvent(
          new MessageEvent('message', { data: JSON.stringify(message) }),
        );
      }
    }

    vi.stubEnv('RETROCKS_LIVE_SSE', '1');
    vi.stubGlobal('EventSource', FakeEventSource);
    try {
      const board = makeBoardView({ isFacilitator: false });
      recordRecentBoard({
        id: board.id,
        title: board.title,
        isFacilitator: false,
      });

      const { getByRole } = render(() => (
        <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
      ));
      flush();

      expect(streams).toHaveLength(1);
      expect(readRecentBoards().some((item) => item.id === board.id)).toBe(true);

      streams[0].emit({ type: 'board:deleted', version: 2 });
      flush();

      expect(
        getByRole('heading', { level: 1, name: 'Board not found or expired' }),
      ).toBeInTheDocument();
      expect(readRecentBoards().some((item) => item.id === board.id)).toBe(
        false,
      );
      expect(streams[0].closed).toBe(true);
      expect(streams).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('renders Locked Board, Board Settings, and board:deleted with zero Solid 2.0 reactivity diagnostics', async () => {
    const board = makeBoardView({
      isFacilitator: true,
      isLocked: true,
      cards: [
        makeCard({ id: 'a1', isActionItem: true, content: 'Track follow-up' }),
      ],
    });
    const { actions } = createFakeActions(board);
    const { artifact } = await captureArtifact(
      async () => {
        const view = render(() => (
          <BoardWorkspace
            board={board}
            boardId={board.id}
            homeHref="/"
            actions={actions}
          />
        ));
        flush();
        const dialog = view
          .getByText('Board Settings', { selector: 'h2' })
          .closest('dialog')!;
        dialog.showModal = () => {
          dialog.open = true;
        };
        dialog.close = () => {
          dialog.open = false;
        };
        openBoardSettings(view);
        flush();
        fireEvent.click(view.getByRole('button', { name: 'Delete Board' }));
        flush();
        fireEvent.click(view.getByRole('button', { name: 'Confirm Delete' }));
        await flushPromises();
      },
      { scenario: 'board-workspace-locked-delete' },
    );
    expectNoDiagnostics(artifact);
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

  it('opens the Export menu, copies Markdown, exposes download links, prints, and closes on Escape/outside click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    try {
      const board = makeBoardView({
        title: 'Sprint 42 Retro',
        subtitle: 'Checkout Team',
        cards: [
          makeCard({
            id: 'card_1',
            columnId: 'col_1',
            content: 'Fast deploy pipeline',
            votes: 2,
            comments: [
              {
                id: 'cm_1',
                cardId: 'card_1',
                content: 'Down from 20m to 6m!',
                isMine: true,
                createdAt: Date.now() - 30_000,
              },
            ],
            commentCount: 1,
          }),
          makeCard({
            id: 'card_action',
            columnId: 'col_3',
            content: 'Automate canary rollback',
            isActionItem: true,
            actionDone: false,
            actionOwner: 'Platform',
          }),
        ],
      });

      const { artifact } = await captureArtifact(
        async () => {
          const { getByRole, queryByRole } = render(() => (
            <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
          ));
          flush();

          const exportButton = getByRole('button', { name: 'More board actions' });
          fireEvent.click(exportButton);
          flush();

          const menu = getByRole('menu', { name: 'More board actions' });
          expect(menu).toHaveAttribute('data-board-overlay', 'true');

          const mdLink = within(menu).getByRole('menuitem', {
            name: /Download Markdown/i,
          });
          expect(mdLink).toHaveAttribute(
            'href',
            `/api/boards/${board.id}/export?format=md`,
          );
          expect(mdLink).toHaveAttribute('download', 'sprint-42-retro.md');

          const csvLink = within(menu).getByRole('menuitem', {
            name: /Download CSV/i,
          });
          expect(csvLink).toHaveAttribute(
            'href',
            `/api/boards/${board.id}/export?format=csv`,
          );
          expect(csvLink).toHaveAttribute('download', 'sprint-42-retro.csv');

          const jsonLink = within(menu).getByRole('menuitem', {
            name: /Download JSON/i,
          });
          expect(jsonLink).toHaveAttribute(
            'href',
            `/api/boards/${board.id}/export?format=json`,
          );
          expect(jsonLink).toHaveAttribute('download', 'sprint-42-retro.json');

          fireEvent.click(
            within(menu).getByRole('menuitem', { name: 'Copy Markdown' }),
          );
          await flushPromises();
          expect(writeText).toHaveBeenCalledTimes(1);
          const copied = writeText.mock.calls[0][0] as string;
          expect(copied).toContain('# Sprint 42 Retro');
          expect(copied).toContain('- Fast deploy pipeline (2 votes)');
          expect(copied).toContain('  - Comment: Down from 20m to 6m!');
          expect(copied).toContain(
            '- [ ] Automate canary rollback (Owner: Platform)',
          );

          // Close on Escape
          fireEvent.keyDown(document, { key: 'Escape' });
          flush();
          expect(
            queryByRole('menu', { name: 'More board actions' }),
          ).not.toBeInTheDocument();

          // Reopen and close on outside pointerdown
          fireEvent.click(exportButton);
          flush();
          expect(
            getByRole('menu', { name: 'More board actions' }),
          ).toBeInTheDocument();
          fireEvent.pointerDown(document.body);
          flush();
          expect(
            queryByRole('menu', { name: 'More board actions' }),
          ).not.toBeInTheDocument();

          // Reopen and trigger Print / Save as PDF
          fireEvent.click(exportButton);
          flush();
          fireEvent.click(
            getByRole('menuitem', { name: /Print \/ Save as PDF/i }),
          );
          flush();
          expect(printSpy).toHaveBeenCalledTimes(1);
          expect(
            queryByRole('menu', { name: 'More board actions' }),
          ).not.toBeInTheDocument();
        },
        { scenario: 'board-workspace-export-menu' },
      );

      expectNoDiagnostics(artifact);
    } finally {
      printSpy.mockRestore();
    }
  });

  it('keeps the Export menu available for Participants when the Board is Locked', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    try {
      const lockedBoard = makeBoardView({
        isFacilitator: false,
        isLocked: true,
        cards: [makeCard({ content: 'Final retro takeaway' })],
      });
      const { getByRole } = render(() => (
        <BoardWorkspace
          board={lockedBoard}
          boardId={lockedBoard.id}
          homeHref="/"
        />
      ));
      flush();

      fireEvent.click(getByRole('button', { name: 'More board actions' }));
      flush();
      const menu = getByRole('menu', { name: 'More board actions' });
      expect(within(menu).queryByRole('menuitem', { name: 'Board Settings' })).not.toBeInTheDocument();
      expect(within(menu).queryByRole('menuitem', { name: 'Add column' })).not.toBeInTheDocument();
      expect(
        within(menu).getByRole('menuitem', { name: 'Copy Markdown' }),
      ).toBeInTheDocument();
      expect(
        within(menu).getByRole('menuitem', { name: /Download CSV/i }),
      ).toHaveAttribute('href', `/api/boards/${lockedBoard.id}/export?format=csv`);

      fireEvent.click(
        within(menu).getByRole('menuitem', { name: /Print \/ Save as PDF/i }),
      );
      flush();
      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      printSpy.mockRestore();
    }
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

  it('filters Cards, Card Group titles, and live comments locally with match counts and never matches redacted Cards', () => {
    const streams: Array<EventTarget & { receive: (msg: BoardLiveMessage) => void }> = [];
    vi.stubGlobal(
      'EventSource',
      class extends EventTarget {
        constructor() {
          super();
          streams.push(this);
        }
        close() {}
        receive(message: BoardLiveMessage) {
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
          flush();
        }
      },
    );

    const group: CardGroupDTO = {
      id: 'group_ci',
      columnId: 'col_1',
      title: 'Pipeline Stability',
      cardIds: ['c_g1', 'c_g2'],
      votes: 3,
      myVotes: 0,
      createdAt: 2_000,
    };
    const board = makeBoardView({
      isBlurred: true,
      groups: [group],
      cards: [
        makeCard({ id: 'c_1', columnId: 'col_1', content: 'Fast checkout deploy', isMine: true, createdAt: 3_000 }),
        makeCard({
          id: 'c_2',
          columnId: 'col_2',
          content: 'Database schema review',
          isMine: true,
          comments: [
            { id: 'cm_1', cardId: 'c_2', content: 'Add rollback plan', isMine: true, createdAt: 1_500 },
          ],
          commentCount: 1,
          createdAt: 1_000,
        }),
        makeCard({ id: 'c_g1', columnId: 'col_1', groupId: 'group_ci', content: 'Flaky e2e test', isMine: true, createdAt: 1_800 }),
        makeCard({ id: 'c_g2', columnId: 'col_1', groupId: 'group_ci', content: 'Retries saved build', isMine: true, createdAt: 1_900 }),
        makeCard({
          id: 'c_hidden',
          columnId: 'col_2',
          content: '',
          redacted: true,
          placeholderLines: 2,
          isMine: false,
          comments: [],
          commentCount: 0,
          createdAt: 2_500,
        }),
      ],
    });
    const { actions, spies } = createFakeActions(board);

    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    try {
      flush();
      streams[0].receive({ type: 'board:snapshot', version: 1, serverNow: 100, board });

      const search = view.getByRole('searchbox', {
        name: /Search Cards, Card Groups, and comments/i,
      }) as HTMLInputElement;

      // Search by comment text
      fireEvent.input(search, { target: { value: 'rollback' } });
      flush();
      expect(view.getByText('1 match (1 of 5 cards)')).toBeInTheDocument();
      expect(view.getByText('Database schema review')).toBeInTheDocument();
      expect(view.queryByText('Fast checkout deploy')).not.toBeInTheDocument();
      expect(view.queryByLabelText('Hidden Card in Private Mode')).not.toBeInTheDocument();

      // Search by Card Group title
      fireEvent.input(search, { target: { value: 'Pipeline Stability' } });
      flush();
      expect(view.getByText('2 matches (2 of 5 cards)')).toBeInTheDocument();
      expect(view.getByText('Flaky e2e test')).toBeInTheDocument();
      expect(view.getByText('Retries saved build')).toBeInTheDocument();

      // Live comment:created updates search matches immediately
      fireEvent.input(search, { target: { value: 'canary' } });
      flush();
      expect(view.getByText('0 matches (0 of 5 cards)')).toBeInTheDocument();
      expect(
        view.getByText(/No Cards match your current search or filter/i),
      ).toBeInTheDocument();

      streams[0].receive({
        type: 'board:mutation',
        version: 2,
        events: [
          {
            type: 'comment:created',
            version: 2,
            cardId: 'c_1',
            comment: {
              id: 'cm_live',
              cardId: 'c_1',
              content: 'Run canary check first',
              isMine: false,
              createdAt: 4_000,
            },
          },
        ],
      });
      expect(view.getByText('1 match (1 of 5 cards)')).toBeInTheDocument();
      expect(view.getByText('Fast checkout deploy')).toBeInTheDocument();

      // Live comment:deleted removes match immediately
      streams[0].receive({
        type: 'board:mutation',
        version: 3,
        events: [
          {
            type: 'comment:deleted',
            version: 3,
            cardId: 'c_1',
            commentId: 'cm_live',
          },
        ],
      });
      expect(view.getByText('0 matches (0 of 5 cards)')).toBeInTheDocument();

      // Clear search button restores all Cards
      fireEvent.click(view.getByRole('button', { name: 'Clear search' }));
      flush();
      expect(search).toHaveValue('');
      expect(view.getByText('Fast checkout deploy')).toBeInTheDocument();
      expect(view.getByLabelText('Hidden Card in Private Mode')).toBeInTheDocument();

      // Escape inside search input clears and blurs cleanly
      search.focus();
      fireEvent.input(search, { target: { value: 'deploy' } });
      flush();
      expect(search).toHaveFocus();
      fireEvent.keyDown(search, { key: 'Escape' });
      flush();
      expect(search).toHaveValue('');
      expect(search).not.toHaveFocus();

      // Purely client-side: zero server mutations called
      for (const spy of Object.values(spies)) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('switches viewer-local Sort modes (Newest, Oldest, Most Voted) across Cards and Card Groups and falls back cleanly during Blind Voting', () => {
    const streams: Array<EventTarget & { receive: (msg: BoardLiveMessage) => void }> = [];
    vi.stubGlobal(
      'EventSource',
      class extends EventTarget {
        constructor() {
          super();
          streams.push(this);
        }
        close() {}
        receive(message: BoardLiveMessage) {
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
          flush();
        }
      },
    );

    const group: CardGroupDTO = {
      id: 'group_mid',
      columnId: 'col_1',
      title: 'Deploy friction',
      cardIds: ['c_g1', 'c_g2'],
      votes: 5,
      myVotes: 0,
      createdAt: 2_000,
    };
    const board = makeBoardView({
      groups: [group],
      cards: [
        makeCard({ id: 'c_old', columnId: 'col_1', content: 'Oldest highest voted', votes: 9, createdAt: 1_000 }),
        makeCard({ id: 'c_new', columnId: 'col_1', content: 'Newest lowest voted', votes: 1, createdAt: 3_000 }),
        makeCard({ id: 'c_g1', columnId: 'col_1', groupId: 'group_mid', content: 'Slow build', createdAt: 1_200 }),
        makeCard({ id: 'c_g2', columnId: 'col_1', groupId: 'group_mid', content: 'Flaky staging', createdAt: 1_400 }),
      ],
    });
    const { actions, spies } = createFakeActions(board);

    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    try {
      flush();
      streams[0].receive({ type: 'board:snapshot', version: 1, serverNow: 100, board });

      const getTopLevelStreamIds = (): string[] => {
        const col = view.getByRole('region', { name: 'Went Well' });
        const stream = col.querySelector(':scope > div:last-child')!;
        return [...stream.children].map((el) => {
          const groupId = el.getAttribute('data-group-id');
          if (groupId) return `group:${groupId}`;
          return `card:${el.getAttribute('data-card-id')}`;
        });
      };

      const sortSelect = view.getByRole('combobox', { name: 'Sort cards' });
      expect(sortSelect).toHaveValue('newest');
      expect(getTopLevelStreamIds()).toEqual(['card:c_new', 'group:group_mid', 'card:c_old']);

      // Switch to Oldest
      fireEvent.change(sortSelect, { target: { value: 'oldest' } });
      flush();
      expect(getTopLevelStreamIds()).toEqual(['card:c_old', 'group:group_mid', 'card:c_new']);

      // Switch to Most Voted -> interleaves Cards and Card Groups by total Votes descending
      fireEvent.change(sortSelect, { target: { value: 'most-voted' } });
      flush();
      expect(getTopLevelStreamIds()).toEqual(['card:c_old', 'group:group_mid', 'card:c_new']);

      // Enable Blind Voting via live snapshot -> Most Voted disabled & falls back cleanly to Newest
      streams[0].receive({
        type: 'board:snapshot',
        version: 2,
        serverNow: 200,
        board: {
          ...board,
          version: 2,
          blindVoting: true,
          groups: [{ ...group, votes: null }],
          cards: board.cards.map((card) => ({ ...card, votes: null })),
        },
      });
      expect(sortSelect).toHaveValue('newest');
      const mostVotedOption = within(sortSelect).getByRole('option', {
        name: /Most Voted/i,
      });
      expect(mostVotedOption).toBeDisabled();
      expect(
        view.getByText('Most Voted paused during Blind Voting'),
      ).toBeInTheDocument();
      expect(getTopLevelStreamIds()).toEqual(['card:c_new', 'group:group_mid', 'card:c_old']);

      // Purely local: zero server writes
      for (const spy of Object.values(spies)) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('composes Quick Filter chips (All, Mine, Voted, Action Items) with Search and Sort and renders distinct empty-filter states', () => {
    const groupVoted: CardGroupDTO = {
      id: 'group_voted',
      columnId: 'col_1',
      title: 'Release cadence',
      cardIds: ['c_gv1', 'c_gv2'],
      votes: 4,
      myVotes: 1,
      createdAt: 2_500,
    };
    const board = makeBoardView({
      columns: [
        { id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 4 },
        { id: 'col_2', title: 'To Improve', accent: 'rose', position: 1, isActionColumn: false, cardCount: 1 },
        { id: 'col_3', title: 'Action Items', accent: 'sky', position: 2, isActionColumn: true, cardCount: 0 },
      ],
      groups: [groupVoted],
      cards: [
        makeCard({ id: 'c_mine', columnId: 'col_1', content: 'My solo card', isMine: true, myVotes: 0, isActionItem: false, createdAt: 1_000 }),
        makeCard({ id: 'c_action', columnId: 'col_1', content: 'Document on-call playbook', isMine: false, myVotes: 2, isActionItem: true, votes: 7, createdAt: 2_000 }),
        makeCard({ id: 'c_gv1', columnId: 'col_1', groupId: 'group_voted', content: 'Weekly train', isMine: false, myVotes: 0, isActionItem: false, createdAt: 1_500 }),
        makeCard({ id: 'c_gv2', columnId: 'col_1', groupId: 'group_voted', content: 'Automated changelog', isMine: true, myVotes: 0, isActionItem: true, createdAt: 1_600 }),
        makeCard({ id: 'c_col2', columnId: 'col_2', content: 'Teammate note', isMine: false, myVotes: 0, isActionItem: false, createdAt: 1_700 }),
      ],
    });
    const { actions, spies } = createFakeActions(board);

    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();

    const filterGroup = within(view.getByRole('group', { name: 'Filter cards' }));
    expect(filterGroup.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');

    // Filter: Mine -> shows my standalone card + group containing my card; col_2 shows distinct empty-filter state while empty col_3 still says "No Cards yet"
    fireEvent.click(filterGroup.getByRole('button', { name: 'Mine' }));
    flush();
    expect(filterGroup.getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true');
    expect(view.getByText('2 of 5 cards')).toBeInTheDocument();
    expect(view.getByText('My solo card')).toBeInTheDocument();
    expect(view.getByText('Automated changelog')).toBeInTheDocument();
    expect(view.queryByText('Weekly train')).not.toBeInTheDocument();
    expect(view.queryByText('Teammate note')).not.toBeInTheDocument();

    const toImprove = view.getByRole('region', { name: 'To Improve' });
    expect(within(toImprove).getByText('No matching Cards in this Column')).toBeInTheDocument();
    const actionItemsCol = view.getByRole('region', { name: 'Action Items' });
    expect(within(actionItemsCol).getByText('No Cards yet')).toBeInTheDocument();

    // Filter: Voted -> shows standalone voted Card and Card Group with group.myVotes > 0
    fireEvent.click(filterGroup.getByRole('button', { name: 'Voted' }));
    flush();
    expect(view.getByText('3 of 5 cards')).toBeInTheDocument();
    expect(view.getByText('Document on-call playbook')).toBeInTheDocument();
    expect(view.getByText('Weekly train')).toBeInTheDocument();
    expect(view.getByText('Automated changelog')).toBeInTheDocument();
    expect(view.queryByText('My solo card')).not.toBeInTheDocument();

    // Filter: Action Items composed with Search
    fireEvent.click(filterGroup.getByRole('button', { name: 'Action Items' }));
    flush();
    expect(view.getByText('2 of 5 cards')).toBeInTheDocument();
    expect(view.getByText('Document on-call playbook')).toBeInTheDocument();
    expect(view.getByText('Automated changelog')).toBeInTheDocument();

    const search = view.getByRole('searchbox', {
      name: /Search Cards, Card Groups, and comments/i,
    });
    fireEvent.input(search, { target: { value: 'playbook' } });
    flush();
    expect(view.getByText('1 match (1 of 5 cards)')).toBeInTheDocument();
    expect(view.getByText('Document on-call playbook')).toBeInTheDocument();
    expect(view.queryByText('Automated changelog')).not.toBeInTheDocument();

    // Reset filters from per-Column empty-filter state restores everything
    fireEvent.click(within(toImprove).getByRole('button', { name: 'Reset filters' }));
    flush();
    expect(filterGroup.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(search).toHaveValue('');
    expect(view.getByText('Teammate note')).toBeInTheDocument();

    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('handles global keyboard shortcuts (/, N, A, B, T, Esc), suppresses them inside editable inputs, and emits zero Solid 2.0 diagnostics', async () => {
    const board = makeBoardView({
      isFacilitator: true,
      cards: [
        makeCard({ id: 'card_1', columnId: 'col_1', content: 'Deploy checks', isActionItem: true }),
      ],
    });
    const { actions, spies } = createFakeActions(board);
    spies.setPrivateMode.mockImplementation(async (input) => ({
      ok: true,
      version: input.isBlurred ? 2 : 3,
      events: [
        {
          type: 'board:snapshot',
          version: input.isBlurred ? 2 : 3,
          serverNow: Date.now(),
          board: { ...board, version: input.isBlurred ? 2 : 3, isBlurred: input.isBlurred },
        },
      ],
    }));

    const { artifact } = await captureArtifact(
      async () => {
        const view = render(() => (
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        ));
        try {
          flush();

          // "/" focuses search bar and prevents default
          const searchInput = view.getByRole('searchbox', {
            name: /Search Cards, Card Groups, and comments/i,
          }) as HTMLInputElement;
          const slashEvent = new KeyboardEvent('keydown', {
            key: '/',
            bubbles: true,
            cancelable: true,
          });
          document.dispatchEvent(slashEvent);
          flush();
          expect(slashEvent.defaultPrevented).toBe(true);
          expect(searchInput).toHaveFocus();

          // Shortcuts suppressed while focused inside <input>
          fireEvent.keyDown(searchInput, { key: 'a' });
          fireEvent.keyDown(searchInput, { key: 'b' });
          fireEvent.keyDown(searchInput, { key: 't' });
          fireEvent.keyDown(searchInput, { key: 'n' });
          flush();
          expect(view.queryByRole('dialog', { name: 'Action Items' })).not.toBeInTheDocument();
          expect(view.queryByRole('dialog', { name: 'Countdown Timer' })).not.toBeInTheDocument();
          expect(spies.setPrivateMode).not.toHaveBeenCalled();
          expect(searchInput).toHaveFocus();

          // Escape blurs search input cleanly
          fireEvent.keyDown(searchInput, { key: 'Escape' });
          flush();
          expect(searchInput).not.toHaveFocus();

          // "N" focuses first/active Column's "+ Add card" composer
          const col1Composer = view.getByRole('textbox', { name: 'Add card to Went Well' });
          fireEvent.keyDown(document.body, { key: 'n' });
          flush();
          expect(col1Composer).toHaveFocus();

          // Shortcuts suppressed while focused inside <textarea>
          fireEvent.keyDown(col1Composer, { key: '/' });
          fireEvent.keyDown(col1Composer, { key: 'a' });
          flush();
          expect(col1Composer).toHaveFocus();
          expect(view.queryByRole('dialog', { name: 'Action Items' })).not.toBeInTheDocument();
          (col1Composer as HTMLElement).blur();

          // Switching active Column tab makes "N" focus that tab's composer
          fireEvent.click(view.getByRole('tab', { name: /To Improve/i }));
          flush();
          fireEvent.keyDown(document.body, { key: 'N' });
          flush();
          const col2Composer = view.getByRole('textbox', { name: 'Add card to To Improve' });
          expect(col2Composer).toHaveFocus();
          (col2Composer as HTMLElement).blur();

          // Shortcuts suppressed inside <select> and contentEditable
          const sortSelect = view.getByRole('combobox', { name: 'Sort cards' });
          sortSelect.focus();
          fireEvent.keyDown(sortSelect, { key: 'a' });
          fireEvent.keyDown(sortSelect, { key: 't' });
          flush();
          expect(view.queryByRole('dialog', { name: 'Action Items' })).not.toBeInTheDocument();
          expect(view.queryByRole('dialog', { name: 'Countdown Timer' })).not.toBeInTheDocument();
          sortSelect.blur();

          const editable = document.createElement('div');
          editable.setAttribute('contenteditable', 'true');
          document.body.appendChild(editable);
          try {
            fireEvent.keyDown(editable, { key: 'a' });
            fireEvent.keyDown(editable, { key: 'n' });
            fireEvent.keyDown(editable, { key: 't' });
            flush();
            expect(view.queryByRole('dialog', { name: 'Action Items' })).not.toBeInTheDocument();
            expect(view.queryByRole('dialog', { name: 'Countdown Timer' })).not.toBeInTheDocument();
          } finally {
            editable.remove();
          }

          // "A" opens and toggles closed the Action Items Drawer
          fireEvent.keyDown(document.body, { key: 'a' });
          flush();
          expect(view.getByRole('dialog', { name: 'Action Items' })).toBeInTheDocument();
          // While overlay is open, "/" and "N" and "B" and "T" are ignored
          fireEvent.keyDown(document.body, { key: '/' });
          fireEvent.keyDown(document.body, { key: 'n' });
          fireEvent.keyDown(document.body, { key: 'b' });
          fireEvent.keyDown(document.body, { key: 't' });
          flush();
          expect(searchInput).not.toHaveFocus();
          expect(spies.setPrivateMode).not.toHaveBeenCalled();
          expect(view.queryByRole('dialog', { name: 'Countdown Timer' })).not.toBeInTheDocument();
          // Pressing "A" again toggles Action Items Drawer closed
          fireEvent.keyDown(document.body, { key: 'a' });
          flush();
          expect(view.queryByRole('dialog', { name: 'Action Items' })).not.toBeInTheDocument();

          // "T" opens and toggles closed the Countdown Timer popover
          fireEvent.keyDown(document.body, { key: 't' });
          flush();
          expect(view.getByRole('dialog', { name: 'Countdown Timer' })).toBeInTheDocument();
          fireEvent.keyDown(document.body, { key: 't' });
          flush();
          expect(view.queryByRole('dialog', { name: 'Countdown Timer' })).not.toBeInTheDocument();

          // "B" toggles Private Mode for Facilitators
          fireEvent.keyDown(document.body, { key: 'b' });
          await flushPromises();
          expect(spies.setPrivateMode).toHaveBeenCalledWith({ boardId: board.id, isBlurred: true });

          // "Esc" closes Share Board <dialog> and Column options popover
          const shareDialog = view.getByText('Share Board', { selector: 'h2' }).closest('dialog')!;
          shareDialog.showModal = () => { shareDialog.open = true; };
          shareDialog.close = () => { shareDialog.open = false; };
          fireEvent.click(view.getByRole('button', { name: 'Share' }));
          flush();
          expect(shareDialog.open).toBe(true);
          fireEvent.keyDown(document, { key: 'Escape' });
          flush();
          expect(shareDialog.open).toBe(false);

          const wentWell = view.getByRole('region', { name: 'Went Well' });
          fireEvent.click(within(wentWell).getByRole('button', { name: 'Column options for Went Well' }));
          flush();
          expect(within(wentWell).getByRole('menu', { name: 'Options for Went Well' })).toBeInTheDocument();
          fireEvent.keyDown(document, { key: 'Escape' });
          flush();
          expect(within(wentWell).queryByRole('menu', { name: 'Options for Went Well' })).not.toBeInTheDocument();
        } finally {
          view.unmount();
        }
      },
      { scenario: 'board-workspace-shortcuts' },
    );
    expectNoDiagnostics(artifact);
  });

  it('ignores N shortcut on a Locked Board while keeping / Search active', () => {
    const board = makeBoardView({
      isLocked: true,
      cards: [makeCard({ id: 'card_1', content: 'Locked retrospective card' })],
    });
    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} />
    ));
    flush();

    const nEvent = new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true });
    document.dispatchEvent(nEvent);
    flush();
    expect(nEvent.defaultPrevented).toBe(false);

    const searchInput = view.getByRole('searchbox', {
      name: /Search Cards, Card Groups, and comments/i,
    });
    fireEvent.keyDown(document.body, { key: '/' });
    flush();
    expect(searchInput).toHaveFocus();
  });

  it('mounts cleanly when Board snapshot resolves via soft navigation and reconciles updates with zero diagnostics', async () => {
    const { artifact } = await captureArtifact(
      () => {
        const [resolvedBoard, setResolvedBoard] = createSignal<BoardViewDTO | null>(null);
        const view = render(() => (
          <Show
            when={resolvedBoard()}
            fallback={<BoardWorkspace board={null} boardId="board_soft_nav" homeHref="/" />}
          >
            {(board) => (
              <BoardWorkspace board={board()} boardId="board_soft_nav" homeHref="/" />
            )}
          </Show>
        ));
        try {
          flush();
          expect(view.getByText(/Board not found or expired/i)).toBeInTheDocument();

          const initial = makeBoardView({
            id: 'board_soft_nav',
            title: 'Soft Navigated Board',
            version: 1,
            cards: [makeCard({ id: 'card_nav_1', content: 'Loaded after navigation' })],
          });
          setResolvedBoard(initial);
          flush();

          expect(view.getByRole('heading', { name: 'Soft Navigated Board' })).toBeInTheDocument();
          expect(view.getByText('Loaded after navigation')).toBeInTheDocument();

          // Reconcile a fresher snapshot prop update without strict-read diagnostics
          setResolvedBoard(
            makeBoardView({
              id: 'board_soft_nav',
              title: 'Soft Navigated Board v2',
              version: 2,
              cards: [
                makeCard({ id: 'card_nav_1', content: 'Loaded after navigation' }),
                makeCard({ id: 'card_nav_2', content: 'Second card after refresh' }),
              ],
            }),
          );
          flush();

          expect(view.getByRole('heading', { name: 'Soft Navigated Board v2' })).toBeInTheDocument();
          expect(view.getByText('Second card after refresh')).toBeInTheDocument();
        } finally {
          view.unmount();
        }
      },
      { scenario: 'board-route-soft-navigation-mount' },
    );
    expectNoDiagnostics(artifact);
  });

  it('renders a redacted Private Mode Card Group with hidden header and no vote/manage controls', async () => {
    const board = makeBoardView({
      isBlurred: true,
      isFacilitator: true,
      groups: [
        {
          id: 'group_redacted',
          columnId: 'col_1',
          title: '',
          redacted: true,
          cardIds: ['card_r1', 'card_r2'],
          votes: null,
          myVotes: 0,
          createdAt: Date.now() - 10_000,
        },
      ],
      cards: [
        makeCard({ id: 'card_r1', groupId: 'group_redacted', content: '', redacted: true, isMine: false, placeholderLines: 1 }),
        makeCard({ id: 'card_r2', groupId: 'group_redacted', content: '', redacted: true, isMine: false, placeholderLines: 2 }),
      ],
    });
    const { artifact } = await captureArtifact(
      () => {
        const view = render(() => (
          <BoardWorkspace board={board} boardId={board.id} />
        ));
        try {
          flush();
          const groupEl = view.container.querySelector('[data-group-id="group_redacted"]') as HTMLElement;
          expect(groupEl).not.toBeNull();
          const groupHeader = groupEl.firstElementChild as HTMLElement;
          expect(within(groupHeader).getByText('Hidden until Reveal All')).toBeInTheDocument();
          const group = within(groupEl);
          expect(group.queryByRole('button', { name: /Rename Card Group/i })).not.toBeInTheDocument();
          expect(group.queryByRole('button', { name: /Move Card Group/i })).not.toBeInTheDocument();
          expect(group.queryByRole('button', { name: /Dissolve Card Group/i })).not.toBeInTheDocument();
          expect(group.queryByRole('button', { name: 'Cast Vote' })).not.toBeInTheDocument();
          expect(groupEl.querySelectorAll('[data-card-id]')).toHaveLength(2);
        } finally {
          view.unmount();
        }
      },
      { scenario: 'redacted-card-group-ui' },
    );
    expectNoDiagnostics(artifact);
  });

  it('opens More for secondary controls and restores focus on Escape with zero diagnostics', async () => {
    const board = makeBoardView({
      isFacilitator: true,
      cards: [makeCard({ isActionItem: true, actionDone: false })],
    });
    const { actions } = createFakeActions(board);
    const { artifact } = await captureArtifact(
      () => {
        const view = render(() => (
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        ));
        try {
          flush();
          const trigger = view.getByRole('button', { name: 'More board actions' });
          expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
          expect(trigger).toHaveAttribute('aria-expanded', 'false');

          fireEvent.click(trigger);
          flush();

          expect(trigger).toHaveAttribute('aria-expanded', 'true');
          const menu = view.getByRole('menu', { name: 'More board actions' });
          expect(menu).toHaveAttribute('data-board-overlay', 'true');
          const withinMenu = within(menu);
          expect(withinMenu.getByRole('menuitem', { name: 'Board Settings' })).toBeInTheDocument();
          expect(withinMenu.getByRole('menuitem', { name: /Switch to (light|dark) theme/ })).toBeInTheDocument();
          expect(withinMenu.getByRole('menuitem', { name: /Add column/i })).toBeInTheDocument();
          expect(withinMenu.getByRole('menuitem', { name: /Action Items/i })).toBeInTheDocument();
          expect(withinMenu.getByRole('menuitem', { name: /Download Markdown/i })).toBeInTheDocument();

          fireEvent.keyDown(document, { key: 'Escape' });
          flush();

          expect(trigger).toHaveAttribute('aria-expanded', 'false');
          expect(view.queryByRole('menu', { name: 'More board actions' })).not.toBeInTheDocument();
          expect(trigger).toHaveFocus();
        } finally {
          view.unmount();
        }
      },
      { scenario: 'mobile-header-overflow-menu' },
    );
    expectNoDiagnostics(artifact);
  });

  it('optimistically renders Card creation, reconciles on success, and rolls back on failure with zero diagnostics', async () => {
    const board = makeBoardView({
      columns: [
        { id: 'col_1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false, cardCount: 0 },
        { id: 'col_2', title: 'To Improve', accent: 'rose', position: 1, isActionColumn: false, cardCount: 0 },
      ],
      cards: [],
    });
    const { actions, spies } = createFakeActions(board);
    const pendingSuccess = Promise.withResolvers<BoardMutationResponse>();
    const pendingFailure = Promise.withResolvers<BoardMutationResponse>();
    spies.createCard
      .mockReturnValueOnce(pendingSuccess.promise)
      .mockReturnValueOnce(pendingFailure.promise);

    const { artifact } = await captureArtifact(
      async () => {
        const view = render(() => (
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        ));
        try {
          flush();
          const composer = view.getByRole('textbox', { name: 'Add card to Went Well' });

          // 1. Optimistic Card creation -> appears immediately before server responds
          fireEvent.input(composer, { target: { value: 'Shipped faster deploys' } });
          flush();
          fireEvent.keyDown(composer, { key: 'Enter' });
          flush();

          expect(view.getByText('Shipped faster deploys')).toBeInTheDocument();
          const col1 = view.container.querySelector('[data-column-id="col_1"]') as HTMLElement;
          expect(within(col1).getByText('1')).toBeInTheDocument();

          // Reconcile with authoritative server response
          const serverCard = makeCard({
            id: 'card_server_1',
            columnId: 'col_1',
            content: 'Shipped faster deploys',
          });
          pendingSuccess.resolve({
            ok: true,
            version: 2,
            events: [{ type: 'card:upserted', version: 2, card: serverCard }],
          });
          await flushPromises();

          expect(view.getAllByText('Shipped faster deploys')).toHaveLength(1);
          expect(view.container.querySelector('[data-card-id="card_server_1"]')).not.toBeNull();
          expect(within(col1).getByText('1')).toBeInTheDocument();

          // 2. Optimistic Card creation failure -> appears immediately, then rolls back on error
          fireEvent.input(composer, { target: { value: 'Will fail on server' } });
          flush();
          fireEvent.keyDown(composer, { key: 'Enter' });
          flush();

          expect(view.getByText('Will fail on server')).toBeInTheDocument();
          expect(within(col1).getByText('2')).toBeInTheDocument();

          pendingFailure.resolve({
            ok: false,
            code: 'LIMIT_EXCEEDED',
            message: 'Board card limit reached.',
          });
          await flushPromises();

          expect(view.queryByText('Will fail on server')).not.toBeInTheDocument();
          expect(within(col1).getByText('1')).toBeInTheDocument();
          expect(composer).toHaveValue('Will fail on server');
          expect(within(col1).getByRole('alert')).toHaveTextContent('Board card limit reached.');
        } finally {
          view.unmount();
        }
      },
      { scenario: 'optimistic-card-creation' },
    );
    expectNoDiagnostics(artifact);
  });

  it('optimistically toggles Emoji Reactions, reconciles on success, and rolls back on failure with zero diagnostics', async () => {
    const card = makeCard({
      id: 'card_react_1',
      reactions: { '👍': 1 },
      myReactions: [],
    });
    const board = makeBoardView({ cards: [card] });
    const { actions, spies } = createFakeActions(board);
    const pendingSuccess = Promise.withResolvers<BoardMutationResponse>();
    const pendingFailure = Promise.withResolvers<BoardMutationResponse>();
    spies.toggleReaction
      .mockReturnValueOnce(pendingSuccess.promise)
      .mockReturnValueOnce(pendingFailure.promise);

    const { artifact } = await captureArtifact(
      async () => {
        const view = render(() => (
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        ));
        try {
          flush();

          // 1. Optimistically increment existing 👍 reaction from 1 -> 2 before server resolves
          fireEvent.click(view.getByRole('button', { name: '👍 1 reaction' }));
          flush();

          const optimisticBtn = view.getByRole('button', { name: '👍 2 reactions' });
          expect(optimisticBtn).toHaveAttribute('aria-pressed', 'true');

          pendingSuccess.resolve({
            ok: true,
            version: 2,
            events: [
              {
                type: 'reaction:updated',
                version: 2,
                cardId: card.id,
                counts: { '👍': 2 },
                myReactions: ['👍'],
              },
            ],
          });
          await flushPromises();

          expect(view.getByRole('button', { name: '👍 2 reactions' })).toHaveAttribute('aria-pressed', 'true');

          // 2. Optimistically decrement 👍 back to 1, then roll back to 2 on server failure
          fireEvent.click(view.getByRole('button', { name: '👍 2 reactions' }));
          flush();

          expect(view.getByRole('button', { name: '👍 1 reaction' })).toHaveAttribute('aria-pressed', 'false');

          pendingFailure.resolve({
            ok: false,
            code: 'RATE_LIMITED',
            message: 'Slow down reactions.',
          });
          await flushPromises();

          expect(view.getByRole('button', { name: '👍 2 reactions' })).toHaveAttribute('aria-pressed', 'true');
          expect(view.getByRole('alert')).toHaveTextContent('Slow down reactions.');
        } finally {
          view.unmount();
        }
      },
      { scenario: 'optimistic-emoji-reactions' },
    );
    expectNoDiagnostics(artifact);
  });
});
