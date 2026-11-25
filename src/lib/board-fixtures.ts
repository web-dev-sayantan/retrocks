import { vi } from 'vitest';

import type { BoardCommandDispatcher } from './board-controller';
import type {
  BoardEvent,
  BoardMutationResponse,
  BoardViewDTO,
  CardGroupDTO,
  CardViewDTO,
  ColumnDTO,
} from './board-types';
import type { BoardCommand } from './schemas';

/**
 * In-memory Board fixtures shared by the workspace component tests and the
 * Board session controller tests: DTO factories plus `createFakeBoardDispatcher`,
 * an in-memory `BoardCommandDispatcher` double that bumps `version`, mirrors the
 * cards/columns/groups maps, and emits `BoardEvent[]` responses (including
 * group vote rollup via `groupView`).
 */

/** Fixture lookups receive ids the fixture itself created; fail loudly otherwise. */
function must<T>(value: T | undefined, id: string): T {
  if (value === undefined) throw new Error(`Fixture entity not found: ${id}`);
  return value;
}

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

function createFakeBoardDispatcher(initialBoard: BoardViewDTO): {
  dispatchCommand: ReturnType<typeof vi.fn<BoardCommandDispatcher>>;
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

  const dispatchCommand = vi.fn<BoardCommandDispatcher>(
    async (_boardId: string, command: BoardCommand): Promise<BoardMutationResponse> => {
      switch (command.type) {
        case 'board:rename': {
          version += 1;
          return {
            ok: true,
            version,
            events: [
              {
                type: 'board:updated',
                version,
                patch: { title: command.title.trim() },
              },
            ],
          };
        }
        case 'board:set-lock': {
          version += 1;
          return {
            ok: true,
            version,
            events: [
              {
                type: 'board:updated',
                version,
                patch: { isLocked: command.isLocked },
              },
            ],
          };
        }
        case 'board:delete': {
          version += 1;
          return {
            ok: true,
            version,
            events: [{ type: 'board:deleted', version }],
          };
        }
        case 'card:create': {
          version += 1;
          seq += 1;
          const col = columns.get(command.columnId);
          const card = makeCard({
            id: `card_new_${seq}`,
            columnId: command.columnId,
            content: command.content.trim(),
            isMine: true,
            isActionItem: Boolean(col?.isActionColumn),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          cards.set(card.id, card);
          return {
            ok: true,
            version,
            events: [{ type: 'card:upserted', version, card }],
          };
        }
        case 'card:update': {
          version += 1;
          const existing = must(cards.get(command.cardId), command.cardId);
          const updated: CardViewDTO = {
            ...existing,
            content: command.content.trim(),
            updatedAt: Date.now(),
          };
          cards.set(updated.id, updated);
          return {
            ok: true,
            version,
            events: [{ type: 'card:upserted', version, card: updated }],
          };
        }
        case 'card:set-action': {
          version += 1;
          const existing = must(cards.get(command.cardId), command.cardId);
          const updated: CardViewDTO = {
            ...existing,
            ...(command.isActionItem !== undefined
              ? {
                  isActionItem: command.isActionItem,
                  ...(command.isActionItem
                    ? {}
                    : { actionDone: false, actionOwner: '' }),
                }
              : {}),
            ...(command.actionDone !== undefined
              ? { actionDone: command.actionDone }
              : {}),
            ...(command.actionOwner !== undefined
              ? { actionOwner: command.actionOwner }
              : {}),
            updatedAt: Date.now(),
          };
          cards.set(updated.id, updated);
          return {
            ok: true,
            version,
            events: [{ type: 'card:upserted', version, card: updated }],
          };
        }
        case 'card:move': {
          version += 1;
          const existing = must(cards.get(command.cardId), command.cardId);
          const moved: CardViewDTO = {
            ...existing,
            columnId: command.targetColumnId,
            updatedAt: Date.now(),
          };
          cards.set(moved.id, moved);
          return {
            ok: true,
            version,
            events: [{ type: 'card:upserted', version, card: moved }],
          };
        }
        case 'card:delete': {
          version += 1;
          cards.delete(command.cardId);
          return {
            ok: true,
            version,
            events: [{ type: 'card:deleted', version, cardId: command.cardId }],
          };
        }
        case 'group:merge': {
          version += 1;
          const targetCard =
            command.targetType === 'card' ? cards.get(command.targetId) : undefined;
          let group =
            command.targetType === 'group'
              ? groups.get(command.targetId)
              : [...groups.values()].find((item) =>
                  item.cardIds.includes(command.cardId),
                );
          const moved = must(cards.get(command.cardId), command.cardId);
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
            ok: true,
            version,
            events: [
              { type: 'group:upserted', version, group: groupView(group) },
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
                type: 'card:upserted',
                version,
                card: { ...moved },
              },
            ],
          };
        }
        case 'group:rename': {
          version += 1;
          const group = must(groups.get(command.groupId), command.groupId);
          group.title = command.title.trim();
          return {
            ok: true,
            version,
            events: [{ type: 'group:upserted', version, group: groupView(group) }],
          };
        }
        case 'group:ungroup': {
          version += 1;
          const card = must(cards.get(command.cardId), command.cardId);
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
          return { ok: true, version, events };
        }
        case 'group:dissolve': {
          version += 1;
          const group = must(groups.get(command.groupId), command.groupId);
          for (const id of group.cardIds) {
            const member = cards.get(id);
            if (member) member.groupId = null;
          }
          groups.delete(command.groupId);
          return {
            ok: true,
            version,
            events: [{ type: 'group:dissolved', version, groupId: command.groupId }],
          };
        }
        case 'group:move': {
          version += 1;
          const group = must(groups.get(command.groupId), command.groupId);
          group.columnId = command.targetColumnId;
          const events: BoardEvent[] = [
            { type: 'group:upserted', version, group: groupView(group) },
          ];
          for (const id of group.cardIds) {
            const card = must(cards.get(id), id);
            card.columnId = command.targetColumnId;
            events.push({ type: 'card:upserted', version, card: { ...card } });
          }
          return { ok: true, version, events };
        }
        case 'column:add': {
          version += 1;
          seq += 1;
          const column: ColumnDTO = {
            id: `col_new_${seq}`,
            title: command.title.trim(),
            accent: command.accent ?? 'slate',
            position: columns.size,
            isActionColumn: Boolean(command.isActionColumn),
            cardCount: 0,
          };
          columns.set(column.id, column);
          return {
            ok: true,
            version,
            events: [{ type: 'column:upserted', version, column }],
          };
        }
        case 'column:update': {
          version += 1;
          const existing = must(columns.get(command.columnId), command.columnId);
          const updated: ColumnDTO = {
            ...existing,
            ...(command.title !== undefined ? { title: command.title.trim() } : {}),
            ...(command.accent !== undefined ? { accent: command.accent } : {}),
            ...(command.isActionColumn !== undefined
              ? { isActionColumn: command.isActionColumn }
              : {}),
          };
          columns.set(updated.id, updated);
          return {
            ok: true,
            version,
            events: [{ type: 'column:upserted', version, column: updated }],
          };
        }
        case 'column:reorder': {
          version += 1;
          return {
            ok: true,
            version,
            events: [
              {
                type: 'columns:reordered',
                version,
                columnIds: command.columnIds,
              },
            ],
          };
        }
        case 'column:delete': {
          version += 1;
          columns.delete(command.columnId);
          return {
            ok: true,
            version,
            events: [
              {
                type: 'column:deleted',
                version,
                columnId: command.columnId,
              },
            ],
          };
        }
        case 'timer:update':
        case 'board:set-private-mode':
        case 'reaction:toggle':
        case 'comment:create':
        case 'comment:delete':
        case 'vote:change':
        case 'voting:configure':
        case 'voting:reset':
          throw new Error(`Unhandled fake command: ${command.type}`);
      }
    },
  );

  return { dispatchCommand };
}

export { createFakeBoardDispatcher, makeBoardView, makeCard };
