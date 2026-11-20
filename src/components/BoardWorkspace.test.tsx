import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, waitFor, within } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { Show, createSignal, flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardWorkspaceActions } from '../lib/board-actions';
import type { BoardLiveMessage } from '../lib/board-live-protocol';
import type { BoardEvent, BoardMutationResponse, BoardViewDTO, CardGroupDTO, CardViewDTO, ColumnDTO } from '../lib/board-types';
import { logPrivacyColophon } from '../lib/easter-eggs';
import { readRecentBoards, recordRecentBoard } from '../lib/recent-boards';
import BoardConfirmDialog from './BoardConfirmDialog';
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

    const { getByRole, getByText, queryByRole, queryByTitle } = render(() => (
      <>
        <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        <BoardConfirmDialog />
      </>
    ));
    flush();
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
    const reopened = within(getByRole('dialog', { name: 'Board Settings' }));
    const destructiveActions = within(reopened.getByRole('region', { name: 'Destructive actions' }));
    expect(destructiveActions.getByRole('button', { name: 'Delete Board' })).toBeVisible();
    fireEvent.click(destructiveActions.getByRole('button', { name: 'Reset All Votes' }));
    await flushPromises();
    expect(spies.resetVotes).not.toHaveBeenCalled();

    // The shared confirm asks before the destructive reset.
    const resetConfirm = within(
      getByRole('alertdialog', { name: 'Remove every Vote from this Board?' }),
    );
    fireEvent.click(resetConfirm.getByRole('button', { name: 'Reset All Votes' }));
    await waitFor(() =>
      expect(spies.resetVotes).toHaveBeenCalledWith({ boardId: board.id }),
    );
    expect(queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(reopened.getByRole('button', { name: 'Close Board Settings' }));
    await waitFor(() => expect(getByText('7 / 7 votes left')).toBeInTheDocument());
    expect(getByText('0 yours')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Cast Vote' })).toBeEnabled();
    expect(getByRole('button', { name: 'Remove Vote' })).toBeDisabled();
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
    const view = render(() => (
      <>
        <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        <BoardConfirmDialog />
      </>
    ));
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
      await flushPromises();
      expect(deleteComment).not.toHaveBeenCalled();
      fireEvent.click(
        within(view.getByRole('alertdialog', { name: 'Delete this comment?' }))
          .getByRole('button', { name: 'Delete comment' }),
      );
      await waitFor(() => {
        expect(deleteComment).toHaveBeenCalledWith({ boardId: board.id, cardId: card.id, commentId: 'mine' });
        expect(drawer.queryByText('My reply')).not.toBeInTheDocument();
      });

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
      expect(view.queryByText(card.content)).not.toBeInTheDocument();
      await Promise.resolve();
      expect(view.getByRole('main')).toHaveFocus();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('retains a failed comment in Card details and clears it after a successful retry', async () => {
    const card = makeCard();
    const board = makeBoardView({ cards: [card] });
    const { actions, spies } = createFakeActions(board);
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} actions={actions} />);
    flush();
    fireEvent.click(view.getByRole('button', { name: 'Open Card details' }));
    flush();
    const drawer = within(view.getByRole('dialog', { name: 'Card details' }));
    const comment = drawer.getByRole('textbox', { name: 'Comment' });
    fireEvent.input(comment, { target: { value: 'Keep my reply' } });
    flush();

    let rejectComment!: (response: BoardMutationResponse) => void;
    spies.createComment.mockImplementationOnce(() => new Promise((resolve) => { rejectComment = resolve; }));
    fireEvent.click(drawer.getByRole('button', { name: 'Post comment' }));
    flush();
    expect(drawer.getByRole('button', { name: /Posting/ })).toBeDisabled();
    rejectComment({ ok: false, code: 'RATE_LIMITED', message: 'Try posting again shortly.' });
    await flushPromises();
    expect(drawer.getByRole('alert')).toHaveTextContent('Try posting again shortly.');
    expect(comment).toHaveValue('Keep my reply');

    spies.createComment.mockResolvedValueOnce({
      ok: true,
      version: 2,
      events: [{
        type: 'comment:created',
        version: 2,
        cardId: card.id,
        comment: { id: 'comment_1', cardId: card.id, content: 'Keep my reply', isMine: true, createdAt: 300 },
      }],
    });
    fireEvent.click(drawer.getByRole('button', { name: 'Post comment' }));
    await flushPromises();
    expect(drawer.getByText('Keep my reply')).toBeInTheDocument();
    expect(comment).toHaveValue('');
    expect(drawer.queryByRole('alert')).toBeNull();
  });

  it('handles Escape within Card details before dismissing the drawer', async () => {
    const card = makeCard({ isActionItem: true, actionOwner: 'Platform' });
    const board = makeBoardView({ cards: [card] });
    const { actions, spies } = createFakeActions(board);
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} actions={actions} />);
    flush();

    const trigger = view.getByRole('button', { name: 'Open Card details' });
    fireEvent.click(trigger);
    flush();
    const drawer = within(view.getByRole('dialog', { name: 'Card details' }));
    const picker = drawer.getByRole('button', { name: 'Add reaction' });
    fireEvent.click(picker);
    flush();
    const choice = within(drawer.getByRole('group', { name: 'Choose a reaction' }))
      .getByRole('button', { name: '🎉' });
    choice.focus();
    fireEvent.keyDown(choice, { key: 'Escape' });
    flush();
    expect(drawer.queryByRole('group', { name: 'Choose a reaction' })).toBeNull();
    expect(picker).toHaveFocus();

    const owner = drawer.getByRole('textbox', { name: 'Action owner' });
    owner.focus();
    fireEvent.input(owner, { target: { value: 'Draft owner' } });
    flush();
    fireEvent.keyDown(owner, { key: 'Escape' });
    // A subsequent blur in the same frame cannot save the discarded draft.
    picker.focus();
    await flushPromises();
    expect(owner).toHaveValue('Platform');
    expect(spies.updateActionItem).not.toHaveBeenCalled();

    fireEvent.keyDown(picker, { key: 'Escape' });
    flush();
    expect(view.queryByRole('dialog', { name: 'Card details' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('dismisses Card details when a press begins and ends on the backdrop', async () => {
    const board = makeBoardView({ cards: [makeCard()] });
    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
    ));
    flush();

    const trigger = view.getByRole('button', { name: 'Open Card details' });
    fireEvent.click(trigger);
    await flushPromises();

    const drawer = view.getByRole('dialog', { name: 'Card details' });
    const backdrop = document.querySelector('[data-slot="drawer-backdrop"]')!;
    const close = within(drawer).getByRole('button', { name: 'Close Card details' });
    // A press that begins inside the sheet never counts as a backdrop press.
    fireEvent.pointerDown(close, { button: 0 });
    fireEvent.pointerUp(close, { button: 0 });
    flush();
    expect(view.getByRole('dialog', { name: 'Card details' })).toBeInTheDocument();

    fireEvent.pointerDown(backdrop, { button: 0 });
    fireEvent.pointerUp(backdrop, { button: 0 });
    await flushPromises();
    expect(view.queryByRole('dialog', { name: 'Card details' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('contains focus in Card details and restores it after Escape or explicit close', async () => {
    const card = makeCard({ comments: [], commentCount: 1 });
    const board = makeBoardView({ cards: [card] });
    const { actions } = createFakeActions(board);
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} actions={actions} />);
    flush();

    const comments = view.getByRole('button', { name: '1 comment' });
    fireEvent.click(comments);
    await flushPromises();
    const drawer = within(view.getByRole('dialog', { name: 'Card details' }));
    const close = drawer.getByRole('button', { name: 'Close Card details' });
    const comment = drawer.getByRole('textbox', { name: 'Comment' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    await flushPromises();
    expect(comment).toHaveFocus();
    fireEvent.keyDown(comment, { key: 'Tab' });
    await flushPromises();
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Escape' });
    await flushPromises();
    expect(view.queryByRole('dialog', { name: 'Card details' })).toBeNull();
    expect(comments).toHaveFocus();

    const open = view.getByRole('button', { name: 'Open Card details' });
    fireEvent.click(open);
    await flushPromises();
    fireEvent.click(view.getByRole('button', { name: 'Close Card details' }));
    await flushPromises();
    expect(view.queryByRole('dialog', { name: 'Card details' })).toBeNull();
    expect(open).toHaveFocus();
  });

  it('lets Facilitators delete any revealed comment through the shared confirm and closes Card details on Escape without Solid diagnostics', async () => {
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
        <>
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
          <BoardConfirmDialog />
        </>
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
        await flushPromises();
        expect(deleteComment).not.toHaveBeenCalled();
        fireEvent.click(
          within(view.getByRole('alertdialog', { name: 'Delete this comment?' }))
            .getByRole('button', { name: 'Delete comment' }),
        );
        await waitFor(() => {
          expect(deleteComment).toHaveBeenCalledWith({
            boardId: board.id,
            cardId: card.id,
            commentId: 'other_comment',
          });
          expect(drawer.queryByText('Needs follow-up')).not.toBeInTheDocument();
        });

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
      fireEvent.click(within(cardArticle).getByRole('button', { name: 'Card actions' }));
      flush();
      fireEvent.click(within(cardArticle).getByRole('menuitem', { name: 'Flag as Action Item' }));
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

    expect(within(getByRole('banner').querySelector('.board-masthead-island')!)
      .getByRole('link', { name: 'Retrocks home' })).toHaveAttribute('href', '/');
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

  it('lets Participants recover from a failed copy and return to Share after dismissal', async () => {
    const board = makeBoardView({ isFacilitator: false });
    const { actions } = createFakeActions(board);
    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();

    const share = view.getByRole('button', { name: 'Share' });
    share.focus();
    fireEvent.click(share);
    flush();
    const dialog = within(view.getByRole('dialog', { name: 'Share Board' }));
    // A press-open moves focus on the next animation frame.
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: 'Close Share' })).toHaveFocus(),
    );
    expect(dialog.getByRole('img', { name: 'Participant Link QR code' })).toBeInTheDocument();
    expect(dialog.queryByRole('region', { name: 'Co-Facilitator Link' })).toBeNull();

    const link = dialog.getByRole('textbox', { name: 'Participant Link' }) as HTMLInputElement;
    const participantUrl = new URL(`/b/${board.id}`, window.location.origin).href;
    expect(link).toHaveValue(participantUrl);
    const copy = dialog.getByRole('button', { name: 'Copy Participant Link' });
    const writeText = vi.fn().mockRejectedValueOnce(new Error('Clipboard unavailable'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      copy.focus();
      fireEvent.click(copy);
      await flushPromises();
      expect(dialog.getByRole('status')).toHaveTextContent('Copy the selected link manually.');
      expect(link).toHaveFocus();
      expect(link.selectionStart).toBe(0);
      expect(link.selectionEnd).toBe(participantUrl.length);

      copy.focus();
      fireEvent.click(copy);
      await flushPromises();
      expect(dialog.getByRole('status')).toHaveTextContent('Participant Link copied.');
      expect(writeText).toHaveBeenLastCalledWith(participantUrl);

      fireEvent.keyDown(copy, { key: 'Escape' });
      flush();
      expect(view.queryByRole('dialog', { name: 'Share Board' })).toBeNull();
      expect(share).toHaveFocus();
    } finally {
      vi.unstubAllGlobals();
    }
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
    const untouchedComposer = getByLabelText('Add card to To Improve');
    const column = within(getByRole('region', { name: 'Went Well' }));
    expect(composer).toHaveAttribute('rows', '1');
    expect(column.getByRole('button', { name: 'Add' })).toBeDisabled();
    composer.focus();
    flush();
    // Zero-shift composer stays single-row on focus without latching open
    expect(composer).toHaveAttribute('rows', '1');
    expect(untouchedComposer).toHaveAttribute('rows', '1');
    fireEvent.input(composer, {
      target: {
        value: 'Shipped `v2` cleanly\nDocs: https://retrocks.app/docs',
      },
    });
    flush();
    expect(column.getByRole('button', { name: 'Add' })).toBeEnabled();

    // Shift+Enter does NOT submit
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    await flushPromises();
    expect(spies.createCard).not.toHaveBeenCalled();

    // Enter submits the Card and clears draft with zero residual newline
    fireEvent.keyDown(composer, { key: 'Enter' });
    await flushPromises();

    expect(spies.createCard).toHaveBeenCalledWith({
      boardId: board.id,
      columnId: 'col_1',
      content: 'Shipped `v2` cleanly\nDocs: https://retrocks.app/docs',
    });
    expect(composer).toHaveValue('');
    expect(composer).toHaveFocus();
    expect(composer).toHaveAttribute('rows', '1');

    const cardActions = column.getByRole('button', { name: 'Card actions' });
    cardActions.focus();
    flush();
    expect(composer).toHaveAttribute('rows', '1');
    expect(column.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(untouchedComposer).toHaveAttribute('rows', '1');

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
    expect(mobileComposer).toHaveAttribute('placeholder', 'Add to To Improve…');
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

  it('shows failed Card mutations beside their controls and leaves them available to retry', async () => {
    const card = makeCard({ content: 'My card', isMine: true });
    const target = makeCard({ id: 'target', content: 'Group target' });
    const board = makeBoardView({ cards: [card, target], allowParticipantGroup: true });
    const { actions, spies } = createFakeActions(board);
    spies.moveCard.mockRejectedValueOnce(new Error('Disconnected'));
    spies.groupCards.mockResolvedValueOnce({
      ok: false, code: 'VALIDATION_ERROR', message: 'Grouping failed.',
    });
    spies.deleteCard.mockRejectedValueOnce(new Error('Disconnected'));
    const view = render(() => (
      <>
        <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        <BoardConfirmDialog />
      </>
    ));
    flush();
    const mine = within(view.getByText(card.content).closest('article')!);
    const trigger = mine.getByRole('button', { name: 'Card actions' });
    function select(name: string) {
      fireEvent.click(mine.getByRole('menuitem', { name }));
      flush();
    }

    fireEvent.click(trigger);
    flush();
    select('Move to…');
    select('To Improve');
    await flushPromises();
    expect(mine.getByRole('alert')).toHaveTextContent('Could not move the Card.');
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    flush();
    select('Group with…');
    select('Group target');
    await flushPromises();
    expect(mine.getByRole('alert')).toHaveTextContent('Could not group the Card.');

    // A failed delete stays confirmable for a retry through the shared dialog.
    fireEvent.click(trigger);
    flush();
    select('Delete Card');
    await flushPromises();
    expect(spies.deleteCard).not.toHaveBeenCalled();
    fireEvent.click(
      within(view.getByRole('alertdialog', { name: 'Delete this Card?' }))
        .getByRole('button', { name: 'Delete Card' }),
    );
    await waitFor(() =>
      expect(mine.getByRole('alert')).toHaveTextContent('Could not delete the Card.'),
    );
    fireEvent.click(trigger);
    flush();
    select('Delete Card');
    await flushPromises();
    fireEvent.click(
      within(view.getByRole('alertdialog', { name: 'Delete this Card?' }))
        .getByRole('button', { name: 'Delete Card' }),
    );
    await waitFor(() => expect(view.queryByText(card.content)).toBeNull());
  });

  it('supports inline Card edit, cross-Column move via "Move to..." and drag-and-drop, and Card delete through the shared confirm', async () => {
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
      <>
        <BoardWorkspace
          board={board}
          boardId={board.id}
          homeHref="/"
          actions={actions}
        />
        <BoardConfirmDialog />
      </>
    ));
    flush();

    const wentWell = getByRole('region', { name: 'Went Well' });
    const mine = within(within(wentWell).getByText(myCard.content).closest('article')!);
    const teammate = within(within(wentWell).getByText(otherCard.content).closest('article')!);
    const menuTrigger = mine.getByRole('button', { name: 'Card actions' });
    expect(within(wentWell).getAllByText('You')).toHaveLength(1);

    fireEvent.click(teammate.getByRole('button', { name: 'Card actions' }));
    flush();
    const teammateMenu = within(teammate.getByRole('menu', { name: 'Card actions' }));
    expect(teammateMenu.getAllByRole('menuitem').map((item) => item.textContent?.trim()))
      .toEqual(['Flag as Action Item']);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    flush();
    expect(teammate.queryByRole('menu')).toBeNull();
    expect(teammate.getByRole('button', { name: 'Card actions' })).toHaveFocus();

    fireEvent.keyDown(menuTrigger, { key: 'ArrowDown' });
    flush();
    const edit = mine.getByRole('menuitem', { name: 'Edit Card' });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: 'ArrowDown' });
    expect(mine.getByRole('menuitem', { name: 'Move to…' })).toHaveFocus();
    fireEvent.click(edit);
    flush();
    const editBox = mine.getByRole('textbox', { name: 'Edit card text' });
    expect(editBox).toHaveFocus();
    fireEvent.input(editBox, { target: { value: 'Refined retro note' } });
    flush();

    let rejectEdit!: (response: BoardMutationResponse) => void;
    spies.updateCard.mockImplementationOnce(() => new Promise((resolve) => { rejectEdit = resolve; }));
    fireEvent.click(mine.getByRole('button', { name: 'Save' }));
    flush();
    expect(mine.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    rejectEdit({ ok: false, code: 'VALIDATION_ERROR', message: 'Could not save this edit.' });
    await flushPromises();
    expect(mine.getByRole('alert')).toHaveTextContent('Could not save this edit.');
    expect(editBox).toHaveValue('Refined retro note');
    fireEvent.click(mine.getByRole('button', { name: 'Save' }));
    await flushPromises();

    expect(spies.updateCard).toHaveBeenCalledWith({
      boardId: board.id,
      cardId: 'card_mine',
      content: 'Refined retro note',
    });
    expect(within(wentWell).getByText('Refined retro note')).toBeInTheDocument();

    // Move myCard across Columns using "Move to..." menu
    expect(mine.getByRole('button', { name: 'Card actions' })).toHaveFocus();
    fireEvent.click(mine.getByRole('button', { name: 'Card actions' }));
    flush();
    fireEvent.click(mine.getByRole('menuitem', { name: 'Move to…' }));
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

    // Delete Card asks through the shared confirm
    const movedBack = within(within(wentWell).getByText('Refined retro note').closest('article')!);
    fireEvent.click(movedBack.getByRole('button', { name: 'Card actions' }));
    flush();
    fireEvent.click(movedBack.getByRole('menuitem', { name: 'Delete Card' }));
    await flushPromises();
    expect(spies.deleteCard).not.toHaveBeenCalled();

    fireEvent.click(
      within(getByRole('alertdialog', { name: 'Delete this Card?' }))
        .getByRole('button', { name: 'Delete Card' }),
    );
    await waitFor(() => {
      expect(spies.deleteCard).toHaveBeenCalledWith({
        boardId: board.id,
        cardId: 'card_mine',
      });
      expect(queryByText('Refined retro note')).not.toBeInTheDocument();
    });
  });

  it('allows Facilitators to inline-rename Board and add, rename, reorder, change accent, and delete Columns (with shared confirmation)', async () => {
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
      <>
        <BoardWorkspace
          board={board}
          boardId={board.id}
          homeHref="/"
          actions={actions}
        />
        <BoardConfirmDialog />
      </>
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
      within(col2Region).getByRole('menuitemradio', { name: 'Accent Amber' }),
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
      within(col2Region).getByRole('menuitem', { name: 'Move left' }),
    );
    await flushPromises();
    expect(spies.reorderColumns).toHaveBeenCalledWith({
      boardId: board.id,
      columnIds: ['col_2', 'col_1', 'col_new_2'],
    });

    // Delete non-empty Column -> shared confirm shows the Card count
    fireEvent.click(
      within(col2Region).getByRole('button', {
        name: 'Column options for To Improve',
      }),
    );
    flush();
    fireEvent.click(
      within(col2Region).getByRole('menuitem', { name: 'Delete column' }),
    );
    await flushPromises();
    expect(spies.deleteColumn).not.toHaveBeenCalled();

    fireEvent.click(
      within(getByRole('alertdialog', { name: 'Delete this Column and its 1 card?' }))
        .getByRole('button', { name: 'Delete column' }),
    );
    await waitFor(() => {
      expect(spies.deleteColumn).toHaveBeenCalledWith({
        boardId: board.id,
        columnId: 'col_2',
      });
      expect(
        queryByRole('heading', { level: 2, name: 'To Improve' }),
      ).not.toBeInTheDocument();
    });
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
    fireEvent.click(within(ownCard).getByRole('button', { name: 'Card actions' }));
    flush();
    fireEvent.click(within(ownCard).getByRole('menuitem', { name: 'Edit Card' }));
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

    getByRole('button', { name: 'Reveal All' }).focus();
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

  it('announces concurrent Board states and keeps Vote totals hidden after Cards are revealed', () => {
    const streams: EventTarget[] = [];
    vi.stubGlobal('EventSource', class extends EventTarget {
      constructor() {
        super();
        streams.push(this);
      }
      close() {}
    });
    const peer = makeCard({
      id: 'peer', isMine: false, content: 'Review handoff notes', votes: null, myVotes: 2,
    });
    const own = makeCard({ id: 'own', content: 'Prepare the handoff', votes: null });
    const board = makeBoardView({ isFacilitator: false, cards: [own, peer], remainingVotes: 3 });
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} />);
    try {
      flush();
      const send = (nextBoard: BoardViewDTO) => {
        const message: BoardLiveMessage = {
          type: 'board:snapshot', version: nextBoard.version, serverNow: Date.now(), board: nextBoard,
        };
        streams[0].dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
        flush();
      };

      send({
        ...board, version: 2, isBlurred: true, blindVoting: true,
        cards: [own, { ...peer, content: '', redacted: true, placeholderLines: 2, myVotes: 0 }],
      });
      const status = within(view.getByRole('group', { name: 'Board status' }));
      expect(status.getByText('Private Mode')).toBeVisible();
      expect(status.getByText('Blind Voting')).toBeVisible();
      expect(view.getByText(/Private Mode is on.*Blind Voting is on/)).toHaveAttribute('aria-live', 'polite');
      expect(view.queryByText(peer.content)).not.toBeInTheDocument();
      expect(view.getByText(own.content)).toBeVisible();
      fireEvent.click(within(view.getByText(own.content).closest('article')!).getByRole('button', { name: 'Card actions' }));
      flush();
      expect(view.getByRole('menuitem', { name: 'Edit Card' })).toBeEnabled();

      send({
        ...board, version: 3, isBlurred: true, blindVoting: true, isLocked: true,
        cards: [own, { ...peer, content: '', redacted: true, placeholderLines: 2, myVotes: 0 }],
      });
      expect(status.getByText('Private Mode')).toBeVisible();
      expect(status.getByText('Blind Voting')).toBeVisible();
      expect(status.getByText('Locked')).toBeVisible();

      send({ ...board, version: 4, blindVoting: true });
      expect(view.getByText(peer.content)).toBeVisible();
      expect(status.queryByText('Private Mode')).not.toBeInTheDocument();
      expect(status.getByText('Blind Voting')).toBeVisible();
      expect(status.queryByText('Locked')).not.toBeInTheDocument();
      expect(view.getByText(/All Cards revealed.*Board unlocked/)).toHaveAttribute('aria-live', 'polite');
      const peerVote = within(view.getByText(peer.content).closest('article')!).getByRole('group', { name: 'Voting' });
      expect(peerVote).toHaveTextContent('2 yours');
      expect(view.getByText('3 / 5 votes left')).toBeVisible();
      expect(view.getByRole('option', { name: /Most Voted/ })).toBeDisabled();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
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
      within(col1).queryByRole('button', { name: 'Card actions' }),
    ).toBeNull();
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
    expect(queryByRole('button', { name: 'Card actions' })).toBeNull();
    expect(queryByRole('button', { name: 'Add reaction' })).toBeNull();
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
    const reopened = within(getByRole('dialog', { name: 'Board Settings' }));
    fireEvent.click(reopened.getByRole('button', { name: 'Unlock Board' }));
    await flushPromises();
    fireEvent.click(reopened.getByRole('button', { name: 'Close Board Settings' }));
    flush();

    expect(spies.setBoardLock).toHaveBeenLastCalledWith({
      boardId: board.id,
      isLocked: false,
    });
    expect(queryByText('Locked')).toBeNull();
    expect(getByRole('button', { name: 'Private Mode' })).toBeEnabled();
  });

  it('returns focus to More when the Action Items header entry is hidden while the drawer is open', async () => {
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
    await waitFor(() => expect(close).toHaveFocus());
    // In the browser the header entry becomes hidden at the compact layout width;
    // jsdom still focuses hidden elements, so simulate it being unavailable.
    entry.remove();
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

    const { getByRole, queryByRole } = render(() => (
      <>
        <BoardWorkspace
          board={board}
          boardId={board.id}
          homeHref="/"
          actions={actions}
        />
        <BoardConfirmDialog />
      </>
    ));
    flush();

    openBoardSettings({ getByRole });
    flush();
    const settings = within(getByRole('dialog', { name: 'Board Settings' }));

    // Clicking Delete Board opens the shared confirm without deleting yet
    fireEvent.click(settings.getByRole('button', { name: 'Delete Board' }));
    await flushPromises();
    expect(spies.deleteBoard).not.toHaveBeenCalled();

    const confirmDialog = within(
      getByRole('alertdialog', { name: 'Permanently delete this Board?' }),
    );

    // Escape restores the Board Settings without deleting
    fireEvent.keyDown(confirmDialog.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    await flushPromises();
    expect(queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(spies.deleteBoard).not.toHaveBeenCalled();
    expect(getByRole('dialog', { name: 'Board Settings' })).toBeInTheDocument();

    // Cancel aborts deletion
    fireEvent.click(settings.getByRole('button', { name: 'Delete Board' }));
    await flushPromises();
    fireEvent.click(within(getByRole('alertdialog', { name: 'Permanently delete this Board?' }))
      .getByRole('button', { name: 'Cancel' }));
    await flushPromises();
    expect(spies.deleteBoard).not.toHaveBeenCalled();

    // Confirming deletes the Board, shows 404 empty state, and removes from Recent Boards
    fireEvent.click(settings.getByRole('button', { name: 'Delete Board' }));
    await flushPromises();
    fireEvent.click(within(getByRole('alertdialog', { name: 'Permanently delete this Board?' }))
      .getByRole('button', { name: 'Delete Board' }));
    await waitFor(() => {
      expect(spies.deleteBoard).toHaveBeenCalledWith({ boardId: board.id });
      expect(
        getByRole('heading', { level: 1, name: 'Board not found or expired' }),
      ).toBeInTheDocument();
    });
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

      const { getByRole, queryByRole } = render(() => (
        <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
      ));
      flush();

      expect(streams).toHaveLength(1);
      expect(readRecentBoards().some((item) => item.id === board.id)).toBe(true);

      fireEvent.click(getByRole('button', { name: 'Share' }));
      flush();
      expect(getByRole('dialog', { name: 'Share Board' })).toBeInTheDocument();

      streams[0].emit({ type: 'board:deleted', version: 2 });
      flush();

      expect(
        getByRole('heading', { level: 1, name: 'Board not found or expired' }),
      ).toHaveFocus();
      expect(queryByRole('dialog', { name: 'Share Board' })).toBeNull();
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
          <>
            <BoardWorkspace
              board={board}
              boardId={board.id}
              homeHref="/"
              actions={actions}
            />
            <BoardConfirmDialog />
          </>
        ));
        flush();
        openBoardSettings(view);
        flush();
        fireEvent.click(view.getByRole('button', { name: 'Delete Board' }));
        await flushPromises();
        fireEvent.click(
          within(view.getByRole('alertdialog', { name: 'Permanently delete this Board?' }))
            .getByRole('button', { name: 'Delete Board' }),
        );
        await flushPromises();
      },
      { scenario: 'board-workspace-locked-delete' },
    );
    expectNoDiagnostics(artifact);
  });

  it('shows completed Action Items with one status and announces updates off-layout', async () => {
    const actionCard = makeCard({
      id: 'card_action',
      content: 'Document the rollout',
      isActionItem: true,
      actionDone: true,
      actionOwner: 'Platform',
    });
    const board = makeBoardView({ cards: [actionCard] });
    const { actions, spies } = createFakeActions(board);
    const update = Promise.withResolvers<BoardMutationResponse>();
    spies.updateActionItem.mockReturnValueOnce(update.promise);

    const { artifact } = await captureArtifact(async () => {
      const view = render(() => <BoardWorkspace board={board} boardId={board.id} actions={actions} />);
      flush();
      const card = within(view.getByText(actionCard.content).closest('article')!);
      expect(card.getByText(actionCard.content).closest('.line-through')).toBeInTheDocument();
      expect(card.queryByText('Action Item')).not.toBeInTheDocument();
      expect(card.getByText('Done')).toBeVisible();
      expect(card.getByText('Platform')).toBeVisible();
      const status = card.getByRole('checkbox');
      expect(status).toBeChecked();
      fireEvent.click(status);
      flush();
      const pending = card.getByText('Updating Action Item…');
      expect(pending).toHaveAttribute('aria-live', 'polite');
      expect(pending).toHaveClass('sr-only');
      update.resolve({ ok: false, code: 'VALIDATION_ERROR', message: 'Try again.' });
      await waitFor(() => expect(status).toBeChecked());
    }, { scenario: 'card-action-status' });

    expectNoDiagnostics(artifact);
  });

  it('opens Card actions off-layout and returns keyboard focus to the trigger', async () => {
    const ownCard = makeCard({ id: 'card_menu', content: 'Review the release checklist' });
    const board = makeBoardView({ cards: [ownCard], isFacilitator: true });
    const { actions } = createFakeActions(board);

    const { artifact } = await captureArtifact(() => {
      const view = render(() => <BoardWorkspace board={board} boardId={board.id} actions={actions} />);
      flush();
      const card = within(view.getByText(ownCard.content).closest('article')!);
      const trigger = card.getByRole('button', { name: 'Card actions' });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      flush();

      const popup = card.getByRole('menu', { name: 'Card actions' });
      expect(popup).toHaveAttribute('popover');
      expect(popup).toHaveAttribute('data-board-overlay', 'true');
      const edit = within(popup).getByRole('menuitem', { name: 'Edit Card' });
      expect(edit).toHaveFocus();
      fireEvent.keyDown(edit, { key: 'Escape' });
      flush();
      expect(card.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();

      fireEvent.click(trigger);
      flush();
      fireEvent.pointerDown(view.getByRole('region', { name: 'Went Well' }));
      flush();
      expect(card.queryByRole('menu')).not.toBeInTheDocument();
    }, { scenario: 'card-actions-popup' });

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
    const firstCard = within(within(wentWell).getByText(first.content).closest('article')!);
    fireEvent.click(firstCard.getByRole('button', { name: 'Card actions' }));
    flush();
    fireEvent.click(firstCard.getByRole('menuitem', { name: 'Group with…' }));
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

    const groupedFirstCard = within(within(wentWell).getByText(first.content).closest('article')!);
    fireEvent.click(groupedFirstCard.getByRole('button', { name: 'Card actions' }));
    flush();
    fireEvent.click(groupedFirstCard.getByRole('menuitem', { name: 'Ungroup Card' }));
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
    const memberCard = within(within(participantColumn).getByText(cards[0].content).closest('article')!);
    fireEvent.click(memberCard.getByRole('button', { name: 'Card actions' }));
    flush();
    expect(memberCard.queryByRole('menuitem', { name: 'Ungroup Card' })).not.toBeInTheDocument();
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

    const moveGroup = within(wentWell).getByRole('button', { name: 'Move Card Group to...' });
    let rejectMove!: (response: BoardMutationResponse) => void;
    spies.moveCardGroup.mockImplementationOnce(() => new Promise((resolve) => { rejectMove = resolve; }));
    fireEvent.click(moveGroup);
    flush();
    fireEvent.click(within(wentWell).getByRole('menuitem', { name: /To Improve/i }));
    flush();
    expect(moveGroup).toBeDisabled();
    const pendingMove = within(wentWell).getByRole('status');
    expect(pendingMove).toHaveTextContent('Moving Card Group…');
    expect(pendingMove).toHaveClass('sr-only');
    rejectMove({ ok: false, code: 'VALIDATION_ERROR', message: 'Move was rejected.' });
    await flushPromises();
    expect(within(wentWell).getByRole('alert')).toHaveTextContent('Could not move the Card Group.');
    expect(moveGroup).toBeEnabled();
    expect(moveGroup).toHaveFocus();

    fireEvent.click(moveGroup);
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

  it('navigates the floating Card Group move menu with the keyboard and restores focus on Escape', async () => {
    const board = makeBoardView({
      cards: [
        makeCard({ id: 'card_1', groupId: 'group_1' }),
        makeCard({ id: 'card_2', groupId: 'group_1' }),
      ],
      groups: [{
        id: 'group_1',
        columnId: 'col_1',
        title: 'CI stability',
        cardIds: ['card_1', 'card_2'],
        votes: 0,
        myVotes: 0,
        createdAt: Date.now(),
      }],
    });
    const { actions, spies } = createFakeActions(board);

    const { artifact } = await captureArtifact(async () => {
      const view = render(() => <BoardWorkspace board={board} boardId={board.id} actions={actions} />);
      try {
        flush();
        const trigger = view.getByRole('button', { name: 'Move Card Group to...' });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        flush();

        const menu = view.getByRole('menu', { name: 'Move Card Group to Column' });
        expect(menu).toHaveAttribute('popover');
        expect(menu).toHaveAttribute('data-board-overlay', 'true');
        const first = within(menu).getByRole('menuitem', { name: 'To Improve' });
        const last = within(menu).getByRole('menuitem', { name: 'Action Items' });
        await waitFor(() => expect(first).toHaveFocus());

        fireEvent.keyDown(first, { key: 'ArrowDown' });
        expect(last).toHaveFocus();
        fireEvent.keyDown(last, { key: 'ArrowUp' });
        expect(first).toHaveFocus();
        fireEvent.keyDown(first, { key: 'Escape' });
        flush();

        expect(trigger).toHaveFocus();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(view.queryByRole('menu', { name: 'Move Card Group to Column' })).not.toBeInTheDocument();
        expect(spies.moveCardGroup).not.toHaveBeenCalled();
      } finally {
        view.unmount();
      }
    }, { scenario: 'card-group-move-menu-keyboard' });

    expectNoDiagnostics(artifact);
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
          const { getByRole, queryByRole, getByText } = render(() => (
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

          expect(getByText('Markdown copied.')).toBeVisible();
          expect(queryByRole('menu', { name: 'More board actions' })).not.toBeInTheDocument();

          // Reopen and close on Escape
          fireEvent.click(exportButton);
          flush();
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

  it('reports an unsuccessful Board download beside More and allows a retry', async () => {
    const request = vi.spyOn(window, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }));
    try {
      const board = makeBoardView({ isFacilitator: false, isLocked: true });
      const { getByRole, queryByRole, getByText } = render(() => (
        <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
      ));
      flush();

      const more = getByRole('button', { name: 'More board actions' });
      fireEvent.click(more);
      flush();
      fireEvent.click(getByRole('menuitem', { name: 'Download CSV' }));
      flush();

      expect(queryByRole('menu', { name: 'More board actions' })).not.toBeInTheDocument();
      expect(more).toHaveFocus();
      expect(getByText('Preparing CSV download…')).toBeVisible();
      await flushPromises();
      expect(getByText('Could not download CSV. Try again.')).toBeVisible();
      expect(request).toHaveBeenCalledWith(expect.stringMatching(`/api/boards/${board.id}/export\\?format=csv$`));

      fireEvent.click(more);
      flush();
      request.mockRejectedValueOnce(new TypeError('Offline'));
      fireEvent.click(getByRole('menuitem', { name: 'Download CSV' }));
      await flushPromises();
      expect(request).toHaveBeenCalledTimes(2);
      expect(getByText('Could not download CSV. Try again.')).toBeVisible();
    } finally {
      request.mockRestore();
    }
  });

  it.each([false, true])('prints the viewer’s Board with Private Mode and Blind Voting (Facilitator: %s)', (isFacilitator) => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    try {
      const board = makeBoardView({
        isFacilitator,
        isBlurred: true,
        blindVoting: true,
        isLocked: true,
        groups: [{
          id: 'group_mixed',
          columnId: 'col_2',
          title: 'Hidden group title',
          redacted: true,
          cardIds: ['mine', 'theirs'],
          votes: 7,
          myVotes: 0,
          createdAt: 1,
        }],
        cards: [
          makeCard({
            id: 'mine', columnId: 'col_2', groupId: 'group_mixed',
            content: 'Visible group member', isActionItem: true, actionOwner: 'Platform',
            votes: null,
          }),
          makeCard({
            id: 'theirs', columnId: 'col_2', groupId: 'group_mixed',
            content: 'Hidden Card content', redacted: true, isMine: false, votes: null,
          }),
          makeCard({ id: 'standalone', content: 'Visible standalone Card', myVotes: 1, votes: 7 }),
        ],
      });
      const { getByRole, getByLabelText, queryByLabelText } = render(() => (
        <BoardWorkspace board={board} boardId={board.id} homeHref="/" />
      ));
      flush();
      const search = getByRole('searchbox', { name: 'Search Cards, Card Groups, and comments' });
      fireEvent.input(search, { target: { value: 'Visible standalone Card' } });
      flush();

      fireEvent.click(getByRole('button', { name: 'More board actions' }));
      flush();
      fireEvent.click(getByRole('menuitem', { name: 'Print / Save as PDF' }));
      flush();

      const output = getByLabelText('Printable Board');
      expect(output).toHaveTextContent('Sprint 42 Retro');
      expect(output).toHaveTextContent('To Improve');
      expect(output).toHaveTextContent('Visible group member');
      expect(output).toHaveTextContent('Platform');
      expect(output).toHaveTextContent('Visible standalone Card');
      expect(output).toHaveTextContent('1 of your Votes');
      expect(output).toHaveTextContent('[Hidden in Private Mode]');
      expect(output).not.toHaveTextContent('Hidden group title');
      expect(output).not.toHaveTextContent('Hidden Card content');
      expect(output).not.toHaveTextContent('7 Votes');

      window.dispatchEvent(new Event('afterprint'));
      flush();
      expect(queryByLabelText('Printable Board')).not.toBeInTheDocument();
      expect(search).toHaveValue('Visible standalone Card');
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

  it.each([false, true])('shows a secret search on a Board with cards: %s', async (hasCards) => {
    const board = makeBoardView({
      cards: hasCards ? [makeCard({ content: 'Fast deploy pipeline', isMine: false })] : [],
    });
    const { actions } = createFakeActions(board);
    const { artifact } = await captureArtifact(() => {
      const view = render(() => (
        <BoardWorkspace board={board} boardId={board.id} homeHref="/" actions={actions} />
      ));
      flush();

      const search = view.getByRole('searchbox');
      const searchFor = (query: string) => {
        fireEvent.input(search, { target: { value: query } });
        flush();
      };

      searchFor('  MeEtInGs  ');
      expect(view.getByText('No Cards matched — this search could have been an email.')).toBeInTheDocument();

      searchFor('blame');
      expect(view.getByText('No blame found here.')).toBeInTheDocument();
      expect(view.getByText(/^“Regardless of what we discover/)).toBeInTheDocument();
      expect(view.getByRole('link', { name: /Norm Kerth/ })).toBeInTheDocument();

      searchFor('42');
      expect(view.getByText('The answer to life, the sprint, and everything.')).toBeInTheDocument();
      expect(view.queryByRole('link', { name: /Norm Kerth/ })).not.toBeInTheDocument();

      searchFor('scope creep');
      expect(view.getByText("Careful, don't let it grow.")).toBeInTheDocument();
      const searchField = search.closest('.secret-search-field');
      expect(searchField).toHaveClass('secret-search-wide');

      for (const query of ['retrocks', 'rock']) {
        searchFor(query);
        expect(view.getByText('Retrospectives that rock.')).toBeInTheDocument();
        expect(view.container.querySelector('svg.secret-search-pebble')).toBeInTheDocument();
        expect(searchField).not.toHaveClass('secret-search-wide');
      }

      searchFor('pivot');
      expect(view.getByText('Pivot!')).toBeInTheDocument();
      const columns = view.container.querySelector('[data-board-columns]');
      expect(columns).toHaveClass('secret-search-pivot');
      expect(view.container.querySelector('svg.secret-search-pebble')).not.toBeInTheDocument();

      for (const query of ['kudos', 'party']) {
        searchFor(query);
        expect(view.getByText('Kudos all around!')).toBeInTheDocument();
        expect(view.container.querySelectorAll('.secret-search-dot')).toHaveLength(10);
        expect(columns).not.toHaveClass('secret-search-pivot');
      }

      fireEvent.click(view.getByRole('button', { name: 'Clear search' }));
      flush();
      expect(search).toHaveValue('');
      expect(view.queryByText('Kudos all around!')).not.toBeInTheDocument();
      expect(view.container.querySelectorAll('.secret-search-dot')).toHaveLength(0);

      searchFor('meetings');
      fireEvent.click(view.getByRole('button', { name: 'Mine' }));
      flush();
      if (hasCards) {
        expect(view.queryByText('No Cards matched — this search could have been an email.')).not.toBeInTheDocument();
      } else {
        expect(view.getByText('No Cards matched — this search could have been an email.')).toBeInTheDocument();
      }

      fireEvent.click(view.getByRole('button', { name: 'All' }));
      flush();
      searchFor('more meetings');
      expect(view.queryByText('No Cards matched — this search could have been an email.')).not.toBeInTheDocument();
    }, { scenario: 'board-workspace-secret-search' });
    expectNoDiagnostics(artifact);
  });

  it('keeps matching Cards visible before applying any secret search', async () => {
    const board = makeBoardView({
      cards: [makeCard({ content: 'Kudos for the fast deployment', isMine: false })],
    });
    const { actions } = createFakeActions(board);
    const { artifact } = await captureArtifact(() => {
      const view = render(() => (
        <BoardWorkspace board={board} boardId={board.id} homeHref="/" actions={actions} />
      ));
      flush();
      fireEvent.input(view.getByRole('searchbox'), { target: { value: 'kudos' } });
      flush();

      expect(view.getByText('Kudos for the fast deployment')).toBeInTheDocument();
      expect(view.queryByText('Kudos all around!')).not.toBeInTheDocument();

      fireEvent.click(view.getByRole('button', { name: 'Mine' }));
      flush();
      expect(view.queryByText('Kudos for the fast deployment')).not.toBeInTheDocument();
      expect(within(view.getByRole('region', { name: 'Search, filter, and sort Board' }))
        .getByText('No Cards match your current search or filter.')).toBeInTheDocument();
      expect(view.queryByText('Kudos all around!')).not.toBeInTheDocument();
    }, { scenario: 'board-workspace-secret-search-card-match' });
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

  it('keeps Search and the active filter available outside Filter & sort on a Locked Board', () => {
    const board = makeBoardView({
      isFacilitator: false,
      isLocked: true,
      cards: [
        makeCard({ id: 'own', content: 'My deployment checklist' }),
        makeCard({ id: 'peer', content: 'Teammate deployment checklist', isMine: false }),
      ],
    });
    const { actions, spies } = createFakeActions(board);
    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={actions} />
    ));
    flush();

    const search = view.getByRole('searchbox', { name: 'Search Cards, Card Groups, and comments' });
    const disclosure = view.getByRole('button', { name: 'Filter & sort' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(disclosure);
    flush();
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(within(view.getByRole('group', { name: 'Filter cards' })).getByRole('button', { name: 'Mine' }));
    fireEvent.change(view.getByRole('combobox', { name: 'Sort cards' }), { target: { value: 'oldest' } });
    fireEvent.click(disclosure);
    fireEvent.input(search, { target: { value: 'deployment' } });
    flush();

    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(view.getByText('Filter: Mine')).toBeVisible();
    expect(view.getByText('1 match (1 of 2 cards)')).toBeVisible();
    expect(view.queryByText('Teammate deployment checklist')).not.toBeInTheDocument();

    fireEvent.click(view.getByRole('button', { name: 'Clear filters' }));
    flush();
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(view.queryByText('Filter: Mine')).not.toBeInTheDocument();
    expect(view.getByText('Teammate deployment checklist')).toBeInTheDocument();

    fireEvent.click(disclosure);
    flush();
    expect(view.getByRole('combobox', { name: 'Sort cards' })).toHaveValue('oldest');
    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
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

          // "Esc" closes the Share Board dialog and the Column options popover
          fireEvent.click(view.getByRole('button', { name: 'Share' }));
          flush();
          expect(view.getByRole('dialog', { name: 'Share Board' })).toBeInTheDocument();
          fireEvent.keyDown(document, { key: 'Escape' });
          flush();
          expect(view.queryByRole('dialog', { name: 'Share Board' })).not.toBeInTheDocument();

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

  it('lets Tab leave More in either direction without adding actions to the tab order', () => {
    const board = makeBoardView({ isFacilitator: true });
    const { actions } = createFakeActions(board);
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} actions={actions} />);
    flush();
    const trigger = view.getByRole('button', { name: 'More board actions' });
    const next = view.getByRole('searchbox');

    for (const shiftKey of [false, true]) {
      fireEvent.click(trigger);
      flush();
      const menu = within(view.getByRole('menu', { name: 'More board actions' }));
      const items = menu.getAllByRole('menuitem');
      expect(items.every((item) => item.tabIndex === -1)).toBe(true);
      expect(items[0]).toHaveFocus();
      fireEvent.keyDown(items[0], { key: 'End' });
      expect(items.at(-1)).toHaveFocus();
      expect(fireEvent.keyDown(items.at(-1)!, { key: 'Tab', shiftKey })).toBe(true);

      const destination = shiftKey ? trigger : next;
      destination.focus();
      flush();
      expect(destination).toHaveFocus();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('keeps the primary Board controls together while the Board title and status can scroll away', async () => {
    const board = makeBoardView({ isFacilitator: true, voteLimit: 5, remainingVotes: 2 });
    const { artifact } = await captureArtifact(() => {
      const view = render(() => (
        <BoardWorkspace board={board} boardId={board.id} actions={createFakeActions(board).actions} />
      ));
      try {
        flush();
        const controls = within(view.getByRole('group', { name: 'Board controls' }));
        expect(controls.getByRole('link', { name: 'Retrocks home' })).toBeInTheDocument();
        expect(controls.getByRole('button', { name: 'Countdown Timer' })).toBeInTheDocument();
        expect(controls.getByRole('button', { name: 'Private Mode' })).toBeInTheDocument();
        expect(controls.getByRole('button', { name: 'Share' })).toBeInTheDocument();
        expect(controls.getByRole('button', { name: 'More board actions' })).toBeInTheDocument();
        expect(controls.queryByRole('heading', { level: 1 })).toBeNull();
        expect(controls.queryByRole('group', { name: 'Board status' })).toBeNull();
        expect(within(view.getByRole('group', { name: 'Board status' })).getByText('2 / 5 votes left')).toBeInTheDocument();
      } finally {
        view.unmount();
      }
    }, { scenario: 'compact-mobile-board-controls' });
    expectNoDiagnostics(artifact);
  });

  it('lets an agent find the Column choices and select a mounted Column', async () => {
    const board = makeBoardView();
    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={createFakeActions(board).actions} />
    ));
    flush();

    const agent = createAgent();
    const tabs = agent.snapshot().find((entry) => entry.component === 'tabs');
    expect(tabs?.label).toBe('Select Column');
    const choice = tabs?.items?.find((item) => item.label.startsWith('To Improve'));
    expect(choice?.label).toBeTruthy();

    const result = await agent.act({
      steps: [{ ref: 'Select Column', action: 'select', args: [choice?.label] }],
    });
    flush();

    expect(result.ok, result.error?.message).toBe(true);
    const selected = view.getByRole('tab', { name: /To Improve/, selected: true });
    const controlledPanel = document.getElementById(selected.getAttribute('aria-controls') ?? '');
    expect(controlledPanel).toHaveAttribute('data-column-id', 'col_2');
  });

  it('fades the Column rail only on edges with more tabs to scroll to', () => {
    const board = makeBoardView();
    const view = render(() => (
      <BoardWorkspace board={board} boardId={board.id} actions={createFakeActions(board).actions} />
    ));
    flush();
    const tabs = view.getByRole('tablist', { name: 'Select Column' });
    Object.defineProperties(tabs, {
      clientWidth: { value: 300 },
      scrollWidth: { value: 500 },
    });

    fireEvent.scroll(tabs);
    expect(tabs).not.toHaveAttribute('data-fade-start');
    expect(tabs).toHaveAttribute('data-fade-end');

    tabs.scrollLeft = 100;
    fireEvent.scroll(tabs);
    expect(tabs).toHaveAttribute('data-fade-start');
    expect(tabs).toHaveAttribute('data-fade-end');

    tabs.scrollLeft = 200;
    fireEvent.scroll(tabs);
    expect(tabs).toHaveAttribute('data-fade-start');
    expect(tabs).not.toHaveAttribute('data-fade-end');
  });

  it('offers the mobile-only Board actions in More and labels the active Column panel', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(width < 40rem)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    try {
      const board = makeBoardView();
      const view = render(() => (
        <BoardWorkspace board={board} boardId={board.id} actions={createFakeActions(board).actions} />
      ));
      flush();
      const firstTab = view.getByRole('tab', { name: /Went Well/ });
      const secondTab = view.getByRole('tab', { name: /To Improve/ });
      firstTab.focus();
      fireEvent.keyDown(firstTab, { key: 'ArrowRight' });
      flush();
      expect(secondTab).toHaveFocus();
      expect(secondTab).toHaveAttribute('aria-selected', 'true');
      expect(view.getByRole('tabpanel', { name: /To Improve/ })).toHaveAttribute(
        'id', secondTab.getAttribute('aria-controls'),
      );

      fireEvent.click(view.getByRole('button', { name: 'More board actions' }));
      flush();
      const menu = within(view.getByRole('menu', { name: 'More board actions' }));
      expect(menu.getByRole('menuitem', { name: 'Rename Board' })).toBeInTheDocument();
      expect(menu.getByRole('menuitem', { name: 'Add column' })).toBeInTheDocument();
      expect(menu.getByRole('menuitem', { name: /Action Items/ })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
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
          expect(withinMenu.queryByRole('menuitem', { name: /Add column/i })).toBeNull();
          expect(withinMenu.queryByRole('menuitem', { name: /Action Items/i })).toBeNull();
          const settings = withinMenu.getByRole('menuitem', { name: 'Board Settings' });
          settings.focus();
          fireEvent.keyDown(settings, { key: 'ArrowDown' });
          flush();
          expect(withinMenu.getByRole('menuitem', { name: 'Copy Markdown' })).toHaveFocus();
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

  it('exposes a data-private-mode hint on redacted Cards only and keeps DevTools colophon silent in test runs', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const own = makeCard({ id: 'card_own', content: 'My visible Card', isMine: true });
    const hidden = makeCard({
      id: 'card_hidden',
      content: '',
      redacted: true,
      placeholderLines: 2,
      isMine: false,
    });
    const board = makeBoardView({ isBlurred: true, cards: [own, hidden] });
    const { actions, spies } = createFakeActions(board);
    spies.setPrivateMode.mockResolvedValue({
      ok: true,
      version: 2,
      events: [{
        type: 'board:snapshot',
        version: 2,
        serverNow: Date.now(),
        board: {
          ...board,
          version: 2,
          isBlurred: false,
          cards: [own, { ...hidden, content: 'Revealed Card', redacted: false }],
        },
      }],
    });

    try {
      const { artifact } = await captureArtifact(async () => {
        const view = render(() => (
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        ));
        try {
          flush();

          expect(infoSpy).not.toHaveBeenCalled();

          // Explicit invocation emits the styled colophon at most once per session
          expect(logPrivacyColophon({ force: true })).toBe(true);
          expect(logPrivacyColophon({ force: true })).toBe(false);
          expect(infoSpy).toHaveBeenCalledTimes(1);
          expect(infoSpy.mock.calls[0]?.[0]).toMatch(/%cRetrocks%c.*Private Mode.*server/i);

          const hiddenArticle = view.container.querySelector('[data-card-id="card_hidden"]');
          const ownArticle = view.container.querySelector('[data-card-id="card_own"]');
          expect(hiddenArticle).toHaveAttribute('data-private-mode', 'server-redacted-nice-try');
          expect(ownArticle).not.toHaveAttribute('data-private-mode');

          fireEvent.click(view.getByRole('button', { name: 'Reveal All' }));
          await flushPromises();

          expect(hiddenArticle).not.toHaveAttribute('data-private-mode');
        } finally {
          view.unmount();
        }
      }, { scenario: 'private-mode-dom-hint' });
      expectNoDiagnostics(artifact);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('cycles redacted Card footer whispers on click, restores after 2200ms, and cancels timers on reveal or unmount', async () => {
    vi.stubGlobal('EventSource', class extends EventTarget { close() {} });
    vi.stubGlobal('WebSocket', class extends EventTarget { close() {} send() {} readyState = 1; });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hidden = makeCard({
      id: 'card_hidden',
      content: '',
      redacted: true,
      placeholderLines: 2,
      isMine: false,
    });
    const board = makeBoardView({ isBlurred: true, cards: [hidden] });
    const { actions, spies } = createFakeActions(board);
    spies.setPrivateMode.mockResolvedValue({
      ok: true,
      version: 2,
      events: [{
        type: 'board:snapshot',
        version: 2,
        serverNow: Date.now(),
        board: {
          ...board,
          version: 2,
          isBlurred: false,
          cards: [{ ...hidden, content: 'Now visible', redacted: false }],
        },
      }],
    });

    try {
      const { artifact } = await captureArtifact(async () => {
        const view = render(() => (
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        ));
        try {
          flush();
          const redactedCard = view.getByLabelText('Hidden Card in Private Mode');
          expect(within(redactedCard).getByText('Hidden until Reveal All')).toBeInTheDocument();

          const seenWhispers: string[] = [];
          for (let i = 0; i < 4; i += 1) {
            fireEvent.click(redactedCard);
            flush();
            expect(within(redactedCard).queryByText('Hidden until Reveal All')).not.toBeInTheDocument();
            const label = redactedCard.querySelector('[data-redacted-footer]')?.textContent?.trim() ?? '';
            expect(label.length).toBeGreaterThan(0);
            seenWhispers.push(label);
          }
          expect(new Set(seenWhispers).size).toBe(4);

          // 5th click wraps around to the first whisper
          fireEvent.click(redactedCard);
          flush();
          expect(redactedCard.querySelector('[data-redacted-footer]')?.textContent?.trim()).toBe(seenWhispers[0]);

          // Still showing at 2199ms, restores at 2200ms
          vi.advanceTimersByTime(2_199);
          flush();
          expect(within(redactedCard).queryByText('Hidden until Reveal All')).not.toBeInTheDocument();

          vi.advanceTimersByTime(1);
          flush();
          expect(within(redactedCard).getByText('Hidden until Reveal All')).toBeInTheDocument();

          // Clicking again and revealing immediately cancels the pending restore timer
          const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
          const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
          try {
            fireEvent.click(redactedCard);
            flush();
            const revealPeekCallIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 2_200);
            expect(revealPeekCallIndex).not.toBe(-1);
            const revealPeekTimerId = setTimeoutSpy.mock.results[revealPeekCallIndex]?.value;

            fireEvent.click(view.getByRole('button', { name: 'Reveal All' }));
            await flushPromises();
            expect(view.getByText('Now visible')).toBeInTheDocument();
            expect(clearTimeoutSpy).toHaveBeenCalledWith(revealPeekTimerId);
          } finally {
            setTimeoutSpy.mockRestore();
            clearTimeoutSpy.mockRestore();
          }
        } finally {
          view.unmount();
        }

        // Unmounting while a whisper timer is active cancels it cleanly
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const secondView = render(() => (
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        ));
        try {
          flush();
          fireEvent.click(secondView.getByLabelText('Hidden Card in Private Mode'));
          flush();
          const unmountPeekCallIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 2_200);
          expect(unmountPeekCallIndex).not.toBe(-1);
          const unmountPeekTimerId = setTimeoutSpy.mock.results[unmountPeekCallIndex]?.value;

          secondView.unmount();
          expect(clearTimeoutSpy).toHaveBeenCalledWith(unmountPeekTimerId);
        } finally {
          setTimeoutSpy.mockRestore();
          clearTimeoutSpy.mockRestore();
        }
      }, { scenario: 'private-mode-redacted-whispers' });
      expectNoDiagnostics(artifact);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('applies a capped pure-CSS stagger delay only to Cards revealed by Reveal All', async () => {
    const baseTime = Date.now();
    const own = makeCard({
      id: 'card_0',
      content: 'My own Card',
      isMine: true,
      redacted: false,
      createdAt: baseTime,
      updatedAt: baseTime,
    });
    const hiddenCards = Array.from({ length: 15 }, (_, idx) =>
      makeCard({
        id: `card_${idx + 1}`,
        content: '',
        redacted: true,
        placeholderLines: 2,
        isMine: false,
        createdAt: baseTime - (idx + 1) * 1_000,
        updatedAt: baseTime - (idx + 1) * 1_000,
      }),
    );
    const board = makeBoardView({
      isBlurred: true,
      cards: [own, ...hiddenCards],
    });
    const { actions, spies } = createFakeActions(board);
    spies.setPrivateMode.mockResolvedValue({
      ok: true,
      version: 2,
      events: [{
        type: 'board:snapshot',
        version: 2,
        serverNow: Date.now(),
        board: {
          ...board,
          version: 2,
          isBlurred: false,
          cards: [
            own,
            ...hiddenCards.map((card, idx) => ({
              ...card,
              content: `Revealed ${idx + 1}`,
              redacted: false,
            })),
          ],
        },
      }],
    });

    const { artifact } = await captureArtifact(async () => {
      const view = render(() => (
        <BoardWorkspace board={board} boardId={board.id} actions={actions} />
      ));
      try {
        flush();

        // Before Reveal All, no Card has a reveal delay custom property
        for (const card of [own, ...hiddenCards]) {
          const article = view.container.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`)!;
          expect(article.style.getPropertyValue('--card-reveal-delay')).toBe('');
          expect(article).not.toHaveClass('card-revealed');
        }

        fireEvent.click(view.getByRole('button', { name: 'Reveal All' }));
        await flushPromises();

        // Viewer's own Card was already visible, so it does not get reveal stagger
        const ownArticle = view.container.querySelector<HTMLElement>('[data-card-id="card_0"]')!;
        expect(ownArticle.style.getPropertyValue('--card-reveal-delay')).toBe('');
        expect(ownArticle).not.toHaveClass('card-revealed');

        // Revealed Cards get min(index * 18ms, 250ms)
        const card1 = view.container.querySelector<HTMLElement>('[data-card-id="card_1"]')!;
        const card2 = view.container.querySelector<HTMLElement>('[data-card-id="card_2"]')!;
        const card14 = view.container.querySelector<HTMLElement>('[data-card-id="card_14"]')!;
        const card15 = view.container.querySelector<HTMLElement>('[data-card-id="card_15"]')!;
        expect(card1).toHaveClass('card-revealed');
        expect(card1.style.getPropertyValue('--card-reveal-delay')).toBe('18ms');
        expect(card2).toHaveClass('card-revealed');
        expect(card2.style.getPropertyValue('--card-reveal-delay')).toBe('36ms');
        expect(card14).toHaveClass('card-revealed');
        expect(card14.style.getPropertyValue('--card-reveal-delay')).toBe('250ms');
        expect(card15).toHaveClass('card-revealed');
        expect(card15.style.getPropertyValue('--card-reveal-delay')).toBe('250ms');
      } finally {
        view.unmount();
      }
    }, { scenario: 'private-mode-staggered-reveal' });
    expectNoDiagnostics(artifact);
  });

  it('triggers transient dramatic reveal and mute-respecting Web Audio shimmer on Facilitator Shift+Click Reveal All', async () => {
    const startNote = vi.fn();
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      close = async () => {};
      resume = async () => {};
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 0 },
          connect() {},
          disconnect() {},
          start: startNote,
          stop() {},
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          disconnect() {},
        };
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('EventSource', class extends EventTarget { close() {} });
    vi.stubGlobal('WebSocket', class extends EventTarget { close() {} send() {} readyState = 1; });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();

    const hidden = makeCard({
      id: 'card_secret',
      content: 'Big reveal',
      isMine: false,
      redacted: false,
    });
    const initialBoard = makeBoardView({
      isBlurred: true,
      isFacilitator: true,
      cards: [{ ...hidden, content: '', redacted: true, placeholderLines: 2 }],
    });
    const { actions, spies } = createFakeActions(initialBoard);
    let version = initialBoard.version;
    spies.setPrivateMode.mockImplementation(async (input) => {
      version += 1;
      const cards = input.isBlurred
        ? [{ ...hidden, content: '', redacted: true, placeholderLines: 2 }]
        : [hidden];
      return {
        ok: true,
        version,
        events: [{
          type: 'board:snapshot',
          version,
          serverNow: Date.now(),
          board: { ...initialBoard, version, isBlurred: input.isBlurred, cards },
        }],
      };
    });

    try {
      const { artifact } = await captureArtifact(async () => {
        const view = render(() => (
          <BoardWorkspace board={initialBoard} boardId={initialBoard.id} actions={actions} />
        ));
        try {
          flush();
          const workspaceEl = view.container.querySelector('.board-workspace')!;

          // 1. Plain click on Reveal All does not trigger dramatic reveal or Web Audio
          fireEvent.click(view.getByRole('button', { name: 'Reveal All' }));
          await flushPromises();
          expect(workspaceEl).not.toHaveAttribute('data-dramatic-reveal');
          expect(startNote).not.toHaveBeenCalled();

          // Re-enable Private Mode
          fireEvent.click(view.getByRole('button', { name: 'Private Mode' }));
          await flushPromises();

          // 2. Shift + Click Reveal All enables dramatic reveal for 950ms and plays Web Audio shimmer
          fireEvent.click(view.getByRole('button', { name: 'Reveal All' }), { shiftKey: true });
          await flushPromises();
          expect(workspaceEl).toHaveAttribute('data-dramatic-reveal', 'true');
          expect(startNote).toHaveBeenCalled();

          vi.advanceTimersByTime(949);
          flush();
          expect(workspaceEl).toHaveAttribute('data-dramatic-reveal', 'true');

          vi.advanceTimersByTime(1);
          flush();
          expect(workspaceEl).not.toHaveAttribute('data-dramatic-reveal');

          // 3. Muted timer preference suppresses Web Audio shimmer on Shift + Click
          startNote.mockClear();
          localStorage.setItem('retrocks-timer-muted', 'true');
          fireEvent.click(view.getByRole('button', { name: 'Private Mode' }));
          await flushPromises();
          fireEvent.click(view.getByRole('button', { name: 'Reveal All' }), { shiftKey: true });
          await flushPromises();
          expect(workspaceEl).toHaveAttribute('data-dramatic-reveal', 'true');
          expect(startNote).not.toHaveBeenCalled();

          vi.advanceTimersByTime(950);
          flush();
          expect(workspaceEl).not.toHaveAttribute('data-dramatic-reveal');

          // 4. prefers-reduced-motion suppresses dramatic reveal visual state and Web Audio shimmer
          startNote.mockClear();
          localStorage.removeItem('retrocks-timer-muted');
          vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
            matches: query === '(prefers-reduced-motion: reduce)',
            media: query,
            addEventListener() {},
            removeEventListener() {},
          })));
          fireEvent.click(view.getByRole('button', { name: 'Private Mode' }));
          await flushPromises();
          fireEvent.click(view.getByRole('button', { name: 'Reveal All' }), { shiftKey: true });
          await flushPromises();
          expect(workspaceEl).not.toHaveAttribute('data-dramatic-reveal');
          expect(startNote).not.toHaveBeenCalled();
        } finally {
          view.unmount();
        }
      }, { scenario: 'private-mode-dramatic-reveal' });
      expectNoDiagnostics(artifact);
    } finally {
      localStorage.clear();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('edits an individual Card on double-click of its text area (standalone or grouped) while ignoring links, non-text areas, and non-editable Cards', async () => {
    const myCard = makeCard({
      id: 'card_mine',
      columnId: 'col_1',
      content: 'Check https://example.com/docs for details',
      isMine: true,
    });
    const groupedCard = makeCard({
      id: 'card_grouped',
      columnId: 'col_1',
      groupId: 'group_1',
      content: 'Grouped retro note',
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
      groups: [
        {
          id: 'group_1',
          columnId: 'col_1',
          title: 'Release',
          cardIds: ['card_grouped'],
          votes: 0,
          myVotes: 0,
          createdAt: Date.now() - 60_000,
        },
      ],
      cards: [myCard, groupedCard, otherCard],
    });
    const { actions, spies } = createFakeActions(board);

    const view = render(() => (
      <BoardWorkspace
        board={board}
        boardId={board.id}
        homeHref="/"
        actions={actions}
      />
    ));
    flush();

    const wentWell = view.getByRole('region', { name: 'Went Well' });
    const mineArticle = within(wentWell).getByText(/for details/).closest('article')!;
    const mine = within(mineArticle);

    // Double-clicking a link inside card text does not enter edit mode
    fireEvent.dblClick(mine.getByRole('link', { name: 'https://example.com/docs' }));
    flush();
    expect(mine.queryByRole('textbox', { name: 'Edit card text' })).toBeNull();

    // Double-clicking outside the text area (e.g., the "You" badge in the card footer) does not enter edit mode
    fireEvent.dblClick(mine.getByText('You'));
    flush();
    expect(mine.queryByRole('textbox', { name: 'Edit card text' })).toBeNull();

    // Double-clicking a teammate's card as a participant does not enter edit mode
    const otherArticle = within(wentWell).getByText('Teammate note').closest('article')!;
    fireEvent.dblClick(within(otherArticle).getByText('Teammate note'));
    flush();
    expect(within(otherArticle).queryByRole('textbox', { name: 'Edit card text' })).toBeNull();

    // Double-clicking the card text area enters edit mode and saves cleanly
    fireEvent.dblClick(mine.getByText(/for details/));
    flush();
    const editBox = mine.getByRole('textbox', { name: 'Edit card text' });
    expect(editBox).toHaveFocus();
    fireEvent.input(editBox, { target: { value: 'Updated via double-click' } });
    flush();
    fireEvent.keyDown(editBox, { key: 'Enter' });
    await flushPromises();
    expect(spies.updateCard).toHaveBeenCalledWith({
      boardId: board.id,
      cardId: 'card_mine',
      content: 'Updated via double-click',
    });
    expect(within(wentWell).getByText('Updated via double-click')).toBeInTheDocument();

    // Double-clicking an individual card inside a Card Group enters edit mode
    const groupedArticle = within(wentWell).getByText('Grouped retro note').closest('article')!;
    fireEvent.dblClick(within(groupedArticle).getByText('Grouped retro note'));
    flush();
    const groupedEditBox = within(groupedArticle).getByRole('textbox', { name: 'Edit card text' });
    expect(groupedEditBox).toHaveFocus();
    expect(groupedEditBox).toHaveValue('Grouped retro note');
    fireEvent.keyDown(groupedEditBox, { key: 'Escape' });
    flush();
    expect(within(groupedArticle).queryByRole('textbox', { name: 'Edit card text' })).toBeNull();
  });

  it('edits a Card on touch double-tap of its text area and ignores slow taps, drags, or locked boards', () => {
    vi.useFakeTimers();
    try {
      const myCard = makeCard({
        id: 'card_touch',
        columnId: 'col_1',
        content: 'Tap me twice',
        isMine: true,
      });
      const board = makeBoardView({ cards: [myCard] });
      const { actions } = createFakeActions(board);

      const view = render(() => (
        <BoardWorkspace
          board={board}
          boardId={board.id}
          homeHref="/"
          actions={actions}
        />
      ));
      flush();

      const wentWell = view.getByRole('region', { name: 'Went Well' });
      const cardText = within(wentWell).getByText('Tap me twice');
      const cardArticle = cardText.closest('article')!;
      const card = within(cardArticle);

      const tapAt = (target: Element, x: number, y: number, pointerId = 1) => {
        fireEvent.pointerDown(target, { pointerType: 'touch', isPrimary: true, pointerId, clientX: x, clientY: y });
        vi.advanceTimersByTime(40);
        fireEvent.pointerUp(target, { pointerType: 'touch', isPrimary: true, pointerId, clientX: x, clientY: y });
        flush();
      };

      // Two taps too far apart in time do not enter edit mode
      tapAt(cardText, 100, 100, 1);
      vi.advanceTimersByTime(500);
      tapAt(cardText, 100, 100, 2);
      expect(card.queryByRole('textbox', { name: 'Edit card text' })).toBeNull();

      // A drag/scroll gesture does not count as a second tap
      vi.advanceTimersByTime(100);
      fireEvent.pointerDown(cardText, { pointerType: 'touch', isPrimary: true, pointerId: 3, clientX: 100, clientY: 100 });
      vi.advanceTimersByTime(40);
      fireEvent.pointerUp(cardText, { pointerType: 'touch', isPrimary: true, pointerId: 3, clientX: 100, clientY: 140 });
      flush();
      expect(card.queryByRole('textbox', { name: 'Edit card text' })).toBeNull();

      // Two quick taps within threshold enter edit mode
      tapAt(cardText, 100, 100, 4);
      vi.advanceTimersByTime(120);
      tapAt(cardText, 104, 102, 5);
      const editBox = card.getByRole('textbox', { name: 'Edit card text' });
      expect(editBox).toHaveFocus();
      expect(editBox).toHaveValue('Tap me twice');
    } finally {
      vi.useRealTimers();
    }
  });

  it('frames Columns as architectural rails with 3px accent bars, 5% header tints, Flag cue, and stable stream container', async () => {
    const board = makeBoardView({
      cards: [makeCard({ id: 'card_1', columnId: 'col_1', content: 'Clean rail card' })],
    });
    const { actions } = createFakeActions(board);

    const { artifact } = await captureArtifact(
      async () => {
        const view = render(() => (
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        ));
        try {
          flush();

          const wentWell = view.getByRole('region', { name: 'Went Well' });
          const accentBar = wentWell.querySelector('[data-column-accent-bar="true"]') as HTMLElement;
          expect(accentBar).toBeInTheDocument();
          expect(accentBar.className).toContain('h-[3px]');
          expect(accentBar.className).toContain('bg-col-sage');
          expect(wentWell.querySelector('.bg-col-sage-tint')).toBeInTheDocument();

          // Stream container stays :scope > div:last-child for top-level Cards/Groups
          const stream = wentWell.querySelector(':scope > div:last-child')!;
          expect(stream.querySelector('[data-card-id="card_1"]')).toBeInTheDocument();

          // Action Column uses a clean Flag cue instead of the boxy "Actions" text pill
          const actionCol = view.getByRole('region', { name: 'Action Items' });
          expect(actionCol.querySelector('.bg-col-sky-tint')).toBeInTheDocument();
          expect(within(actionCol).queryByText('Actions')).not.toBeInTheDocument();
          expect(within(actionCol).getByTitle('Action Column')).toBeInTheDocument();
        } finally {
          view.unmount();
        }
      },
      { scenario: 'column-architectural-rails' },
    );
    expectNoDiagnostics(artifact);
  });

  it('keeps 3 Columns balanced at 1024px and opens Add Column in a non-shifting overlay dialog with zero diagnostics', async () => {
    const board = makeBoardView({ isFacilitator: true });
    const { actions, spies } = createFakeActions(board);

    const { artifact } = await captureArtifact(
      async () => {
        const view = render(() => (
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        ));
        try {
          flush();

          const columnsGrid = view.container.querySelector('[data-board-columns="true"]') as HTMLElement;
          expect(columnsGrid).toBeInTheDocument();
          // 3-Column Board does not squeeze columns with a 4th auto track at lg (1024px)
          expect(columnsGrid.className).toContain('lg:grid-cols-3');
          expect(columnsGrid.className).not.toContain('lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]');

          // Inline "+ Add a Column" trigger sits inside the Column grid
          const addColumnBtn = within(columnsGrid).getByRole('button', { name: 'Add a Column' });
          expect(addColumnBtn).toBeInTheDocument();

          // Opening Add Column does not mount a form above <main>
          const main = view.getByRole('main');
          const childrenBeforeMain = Array.from(main.parentElement!.children);
          const mainIndexBefore = childrenBeforeMain.indexOf(main);

          fireEvent.click(addColumnBtn);
          flush();

          const mainIndexAfter = Array.from(main.parentElement!.children).indexOf(main);
          expect(mainIndexAfter).toBe(mainIndexBefore);

          const dialog = view.getByRole('dialog', { name: 'Add a Column' });
          expect(dialog).toHaveAttribute('data-board-overlay', 'true');
          const titleInput = within(dialog).getByLabelText('New column title') as HTMLInputElement;
          expect(titleInput).toHaveFocus();

          // Pressing Escape closes the overlay cleanly
          fireEvent.keyDown(document, { key: 'Escape' });
          flush();
          expect(view.queryByRole('dialog', { name: 'Add a Column' })).not.toBeInTheDocument();

          // Reopen, pick accent + Action Column, submit -> creates & selects Column
          fireEvent.click(addColumnBtn);
          flush();
          const dialog2 = view.getByRole('dialog', { name: 'Add a Column' });
          const titleInput2 = within(dialog2).getByLabelText('New column title') as HTMLInputElement;
          fireEvent.input(titleInput2, { target: { value: 'Risks' } });
          fireEvent.click(within(dialog2).getByRole('button', { name: 'New column accent Coral' }));
          fireEvent.click(within(dialog2).getByLabelText('Action Items column'));
          flush();
          fireEvent.click(within(dialog2).getByRole('button', { name: 'Add column' }));
          await flushPromises();

          expect(spies.addColumn).toHaveBeenCalledWith({
            boardId: board.id,
            title: 'Risks',
            accent: 'coral',
            isActionColumn: true,
          });
          expect(view.queryByRole('dialog', { name: 'Add a Column' })).not.toBeInTheDocument();
          expect(view.getByRole('tab', { name: /Risks/i })).toHaveAttribute('aria-selected', 'true');
        } finally {
          view.unmount();
        }
      },
      { scenario: 'add-column-overlay-and-1024-grid' },
    );
    expectNoDiagnostics(artifact);
  });

  it('clears desktop composer cleanly on Enter, handles Column options overlay with zero diagnostics', async () => {
    const board = makeBoardView({ isFacilitator: true, cards: [] });
    const { actions, spies } = createFakeActions(board);

    const { artifact } = await captureArtifact(
      async () => {
        const view = render(() => (
          <BoardWorkspace board={board} boardId={board.id} actions={actions} />
        ));
        try {
          flush();

          const wentWell = view.getByRole('region', { name: 'Went Well' });
          const composer = within(wentWell).getByRole('textbox', {
            name: 'Add card to Went Well',
          }) as HTMLTextAreaElement;

          // Enter on empty/whitespace does not submit or leave a stray newline
          fireEvent.keyDown(composer, { key: 'Enter' });
          await flushPromises();
          expect(spies.createCard).not.toHaveBeenCalled();
          expect(composer.value).toBe('');

          // Typing and pressing Enter submits and clears DOM value cleanly
          composer.value = 'Direct DOM sync card';
          fireEvent.input(composer, { target: { value: 'Direct DOM sync card' } });
          flush();
          fireEvent.keyDown(composer, { key: 'Enter' });
          await flushPromises();
          expect(spies.createCard).toHaveBeenCalledWith({
            boardId: board.id,
            columnId: 'col_1',
            content: 'Direct DOM sync card',
          });
          expect(composer.value).toBe('');

          // Column options menu renders with data-board-overlay and closes on Escape
          const optionsBtn = within(wentWell).getByRole('button', {
            name: 'Column options for Went Well',
          });
          fireEvent.click(optionsBtn);
          flush();
          const menu = within(wentWell).getByRole('menu', { name: 'Options for Went Well' });
          expect(menu).toHaveAttribute('data-board-overlay', 'true');
          expect(menu.className).toContain('board-popover');
          const renameItem = within(menu).getByRole('menuitem', { name: 'Rename column' });
          renameItem.focus();
          fireEvent.keyDown(renameItem, { key: 'ArrowDown' });
          flush();
          const moveLeft = within(menu).getByRole('menuitem', { name: 'Move left' });
          expect(moveLeft).toHaveFocus();
          expect(moveLeft).toHaveAttribute('aria-disabled', 'true');
          fireEvent.keyDown(moveLeft, { key: 'ArrowDown' });
          flush();
          const moveRight = within(menu).getByRole('menuitem', { name: 'Move right' });
          expect(moveRight).toHaveFocus();
          fireEvent.keyDown(moveRight, { key: 'ArrowDown' });
          flush();
          expect(within(menu).getByRole('menuitemradio', { name: 'Accent Slate' })).toHaveFocus();

          fireEvent.keyDown(document, { key: 'Escape' });
          flush();
          expect(within(wentWell).queryByRole('menu', { name: 'Options for Went Well' })).not.toBeInTheDocument();

          // Reopen and choose Rename column -> focuses inline Column title input & saves on Enter
          fireEvent.click(optionsBtn);
          flush();
          fireEvent.click(
            within(wentWell).getByRole('menuitem', { name: 'Rename column' }),
          );
          flush();
          const renameInput = within(wentWell).getByRole('textbox', { name: 'Column title' }) as HTMLInputElement;
          expect(renameInput).toHaveFocus();
          expect(renameInput).toHaveValue('Went Well');
          fireEvent.input(renameInput, { target: { value: 'Highlights' } });
          flush();
          fireEvent.keyDown(renameInput, { key: 'Enter' });
          await flushPromises();
          expect(spies.updateColumn).toHaveBeenCalledWith({
            boardId: board.id,
            columnId: 'col_1',
            title: 'Highlights',
          });
        } finally {
          view.unmount();
        }
      },
      { scenario: 'column-composer-and-options-menu' },
    );
    expectNoDiagnostics(artifact);
  });

  it('renders a Home-style floating Dynamic Island header with synced theme toggle and supports double-click / double-tap Board title rename for Facilitators', async () => {
    const board = makeBoardView({
      title: 'Sprint 42 Retro',
      isFacilitator: true,
      isLocked: false,
    });
    const { actions, spies } = createFakeActions(board);

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
        try {
          flush();

          // The island holds the brand link, centered title, and theme toggle.
          const banner = view.getByRole('banner');
          const island = banner.querySelector('.board-island');
          expect(island).not.toBeNull();
          const withinIsland = within(island as HTMLElement);
          expect(withinIsland.getByRole('link', { name: /Retrocks/i })).toHaveAttribute('href', '/');
          const heading = withinIsland.getByRole('heading', { level: 1, name: 'Sprint 42 Retro' });
          expect(heading).toBeVisible();
          const islandThemeToggle = withinIsland.getByRole('button', { name: /Switch to (light|dark) theme/ });
          expect(islandThemeToggle).toHaveAttribute('aria-pressed');

          // Island ThemeToggle and More menu theme item stay synced and toggle cleanly once
          fireEvent.click(view.getByRole('button', { name: 'More board actions' }));
          flush();
          const moreMenu = view.getByRole('menu', { name: 'More board actions' });
          expect(moreMenu).toHaveAttribute('data-slot', 'menu-content');
          expect(moreMenu).toHaveAttribute('data-board-overlay', 'true');
          expect(moreMenu).toHaveClass('board-popover');
          const menuThemeItem = within(moreMenu).getByRole('menuitem', { name: /Switch to (light|dark) theme/ });
          const initialTheme = document.documentElement.dataset.theme ?? 'light';
          fireEvent.click(menuThemeItem);
          flush();
          const toggledTheme = initialTheme === 'dark' ? 'light' : 'dark';
          expect(document.documentElement.dataset.theme).toBe(toggledTheme);
          expect(islandThemeToggle).toHaveAttribute('aria-pressed', toggledTheme === 'dark' ? 'true' : 'false');
          fireEvent.keyDown(document, { key: 'Escape' });
          flush();

          // Double-clicking the Board title enters inline rename, focuses input, and saves on Enter
          fireEvent.dblClick(heading);
          flush();
          const titleInput = withinIsland.getByRole('textbox', { name: 'Board title' });
          expect(titleInput).toHaveFocus();
          expect(titleInput).toHaveValue('Sprint 42 Retro');
          fireEvent.input(titleInput, { target: { value: 'Q4 Platform Retro' } });
          flush();
          fireEvent.keyDown(titleInput, { key: 'Enter' });
          await flushPromises();

          expect(spies.renameBoard).toHaveBeenCalledWith({
            boardId: board.id,
            title: 'Q4 Platform Retro',
          });
          expect(withinIsland.getByRole('heading', { level: 1, name: 'Q4 Platform Retro' })).toBeVisible();

          // Escape cancels rename and keeps the current title
          fireEvent.dblClick(withinIsland.getByRole('heading', { level: 1, name: 'Q4 Platform Retro' }));
          flush();
          const cancelInput = withinIsland.getByRole('textbox', { name: 'Board title' });
          expect(cancelInput).toHaveFocus();
          fireEvent.input(cancelInput, { target: { value: 'Unsaved Draft' } });
          flush();
          fireEvent.keyDown(cancelInput, { key: 'Escape' });
          flush();
          expect(withinIsland.queryByRole('textbox', { name: 'Board title' })).toBeNull();
          expect(withinIsland.getByRole('heading', { level: 1, name: 'Q4 Platform Retro' })).toBeVisible();
        } finally {
          view.unmount();
        }
      },
      { scenario: 'board-island-header-and-title-rename' },
    );
    expectNoDiagnostics(artifact);
  });

  it('guards Board title double-tap/double-click against slow taps, drags, Participants, and Locked Boards', () => {
    vi.useFakeTimers();
    try {
      // 1. Participant cannot double-click or double-tap to rename
      const participantBoard = makeBoardView({
        title: 'Participant View',
        isFacilitator: false,
      });
      const participantView = render(() => (
        <BoardWorkspace
          board={participantBoard}
          boardId={participantBoard.id}
          homeHref="/"
          actions={createFakeActions(participantBoard).actions}
        />
      ));
      flush();
      fireEvent.dblClick(participantView.getByRole('heading', { level: 1, name: 'Participant View' }));
      flush();
      expect(participantView.queryByRole('textbox', { name: 'Board title' })).toBeNull();
      participantView.unmount();

      // 2. Facilitator on a Locked Board cannot double-click to rename
      const lockedBoard = makeBoardView({
        title: 'Locked Retro',
        isFacilitator: true,
        isLocked: true,
      });
      const lockedView = render(() => (
        <BoardWorkspace
          board={lockedBoard}
          boardId={lockedBoard.id}
          homeHref="/"
          actions={createFakeActions(lockedBoard).actions}
        />
      ));
      flush();
      fireEvent.dblClick(lockedView.getByRole('heading', { level: 1, name: 'Locked Retro' }));
      flush();
      expect(lockedView.queryByRole('textbox', { name: 'Board title' })).toBeNull();
      lockedView.unmount();

      // 3. Facilitator on unlocked Board: touch double-tap gesture guards
      const facilitatorBoard = makeBoardView({
        title: 'Touch Rename Retro',
        isFacilitator: true,
        isLocked: false,
      });
      const view = render(() => (
        <BoardWorkspace
          board={facilitatorBoard}
          boardId={facilitatorBoard.id}
          homeHref="/"
          actions={createFakeActions(facilitatorBoard).actions}
        />
      ));
      try {
        flush();
        const heading = view.getByRole('heading', { level: 1, name: 'Touch Rename Retro' });
        const tapAt = (target: Element, x: number, y: number, pointerId: number) => {
          fireEvent.pointerDown(target, { pointerType: 'touch', isPrimary: true, pointerId, clientX: x, clientY: y });
          vi.advanceTimersByTime(40);
          fireEvent.pointerUp(target, { pointerType: 'touch', isPrimary: true, pointerId, clientX: x, clientY: y });
          flush();
        };

        // Slow taps (500ms apart) do not open rename
        tapAt(heading, 120, 30, 1);
        vi.advanceTimersByTime(500);
        tapAt(heading, 120, 30, 2);
        expect(view.queryByRole('textbox', { name: 'Board title' })).toBeNull();

        // Touch drag (> 16px) does not count as a tap
        vi.advanceTimersByTime(100);
        fireEvent.pointerDown(heading, { pointerType: 'touch', isPrimary: true, pointerId: 3, clientX: 120, clientY: 30 });
        vi.advanceTimersByTime(40);
        fireEvent.pointerUp(heading, { pointerType: 'touch', isPrimary: true, pointerId: 3, clientX: 120, clientY: 70 });
        flush();
        expect(view.queryByRole('textbox', { name: 'Board title' })).toBeNull();

        // Two quick taps within threshold enter inline rename
        tapAt(heading, 120, 30, 4);
        vi.advanceTimersByTime(120);
        tapAt(heading, 124, 32, 5);
        const titleInput = view.getByRole('textbox', { name: 'Board title' });
        expect(titleInput).toHaveFocus();
        expect(titleInput).toHaveValue('Touch Rename Retro');
      } finally {
        view.unmount();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('rations primary accent between Share and Reveal All and keeps Private Mode inline without bloating the header bar', async () => {
    const board = makeBoardView({
      isFacilitator: true,
      isBlurred: false,
      isLocked: false,
      cards: [makeCard({ isActionItem: true, actionDone: false })],
    });
    const { actions, spies } = createFakeActions(board);
    spies.setPrivateMode.mockImplementation(async (input) => ({
      ok: true,
      version: input.isBlurred ? 2 : 3,
      events: [{
        type: 'board:snapshot',
        version: input.isBlurred ? 2 : 3,
        serverNow: Date.now(),
        board: { ...board, version: input.isBlurred ? 2 : 3, isBlurred: input.isBlurred },
      }],
    }));

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
        try {
          flush();
          const share = view.getByRole('button', { name: 'Share' });
          const privateToggle = view.getByRole('button', { name: 'Private Mode' });
          const actionItems = view.getByRole('button', { name: 'Action Items 1 open' });
          const more = view.getByRole('button', { name: 'More board actions' });

          // Unified pill geometry, tactile spring-press, and primary accent rationed strictly to Share
          for (const control of [share, privateToggle, actionItems, more]) {
            expect(control).toHaveClass('rounded-full', 'spring-press', 'min-h-11', 'sm:min-h-9');
          }
          expect(share).toHaveAttribute('data-cta-emphasis', 'primary');
          expect(share).toHaveClass('bg-accent');
          expect(privateToggle).not.toHaveClass('bg-accent');

          // Toggling Private Mode ON shifts primary accent strictly to Reveal All and yields Share
          fireEvent.click(privateToggle);
          await flushPromises();

          const revealAll = view.getByRole('button', { name: 'Reveal All' });
          expect(revealAll).toHaveAttribute('data-cta-emphasis', 'primary');
          expect(revealAll).toHaveClass('bg-accent');
          expect(share).toHaveAttribute('data-cta-emphasis', 'secondary');
          expect(share).not.toHaveClass('bg-accent');

          // Private Mode status stays inline without appending a wrapping basis-full paragraph
          const statusGroup = view.getByRole('group', { name: 'Board status' });
          expect(within(statusGroup).getByText('Private Mode')).toBeVisible();
          expect(statusGroup.querySelector('p.basis-full')).toBeNull();
          expect(
            within(statusGroup).getByText('Private Mode').closest('[title]'),
          ).toHaveAttribute('title', 'Only you can read your Cards until they’re revealed.');
        } finally {
          view.unmount();
        }
      },
      { scenario: 'header-accent-rationing-and-zero-cls-private-mode' },
    );
    expectNoDiagnostics(artifact);
  });
});
