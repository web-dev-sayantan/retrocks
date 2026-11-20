import { vi } from 'vitest';

import type { BoardWorkspaceActions } from './board-actions';
import type {
  BoardEvent,
  BoardViewDTO,
  CardGroupDTO,
  CardViewDTO,
  ColumnDTO,
} from './board-types';

/**
 * In-memory Board fixtures shared by the workspace component tests and the
 * Board session controller tests: DTO factories plus `createFakeActions`, an
 * in-memory `BoardWorkspaceActions` double that bumps `version`, mirrors the
 * cards/columns/groups maps, and emits `BoardEvent[]` responses (including
 * group vote rollup via `groupView`).
 */

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
            item.cardIds.includes(input.cardId),
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

export { createFakeActions, makeBoardView, makeCard };
