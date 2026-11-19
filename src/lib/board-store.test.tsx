import { createStore, flush, snapshot } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { applyBoardEvents } from './board-store';
import type { BoardViewDTO, CardViewDTO } from './board-types';

function makeInitialBoard(): BoardViewDTO {
  const now = 1_760_000_000_000;
  return {
    id: 'board_0123456789abcdef',
    title: 'Sprint 42 Retro',
    subtitle: 'Platform',
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
    groups: [],
    cards: [],
  };
}

function makeCard(overrides?: Partial<CardViewDTO>): CardViewDTO {
  return {
    id: 'card_1',
    columnId: 'col_1',
    groupId: null,
    content: 'Fast builds',
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
    createdAt: 1_760_000_001_000,
    updatedAt: 1_760_000_001_000,
    ...overrides,
  };
}

describe('applyBoardEvents (reactive store patcher)', () => {
  it('patches Card create, edit, cross-Column move, and delete idempotently while keeping Column cardCounts accurate', () => {
    const [board, setBoard] = createStore<BoardViewDTO>(makeInitialBoard());
    const card = makeCard();

    // Create Card (applied twice to prove idempotency for future live WS/SSE fan-out)
    setBoard((draft) => {
      applyBoardEvents(draft, [
        { type: 'card:upserted', version: 2, card },
        { type: 'card:upserted', version: 2, card },
      ]);
    });
    flush();

    const afterCreate = snapshot(board);
    expect(afterCreate.version).toBe(2);
    expect(afterCreate.cards).toHaveLength(1);
    expect(afterCreate.columns[0].cardCount).toBe(1);
    expect(afterCreate.columns[1].cardCount).toBe(0);

    // Move Card from col_1 to col_2
    setBoard((draft) => {
      applyBoardEvents(draft, [
        {
          type: 'card:upserted',
          version: 3,
          card: { ...card, columnId: 'col_2', content: 'Moved card' },
        },
      ]);
    });
    flush();

    const afterMove = snapshot(board);
    expect(afterMove.cards[0].columnId).toBe('col_2');
    expect(afterMove.cards[0].content).toBe('Moved card');
    expect(afterMove.columns[0].cardCount).toBe(0);
    expect(afterMove.columns[1].cardCount).toBe(1);

    // Delete Card (applied twice for idempotency)
    setBoard((draft) => {
      applyBoardEvents(draft, [
        { type: 'card:deleted', version: 4, cardId: card.id },
        { type: 'card:deleted', version: 4, cardId: card.id },
      ]);
    });
    flush();

    const afterDelete = snapshot(board);
    expect(afterDelete.cards).toHaveLength(0);
    expect(afterDelete.columns[1].cardCount).toBe(0);
  });

  it('patches viewer reactions and keeps the anonymous comment thread chronological and idempotent', () => {
    const [board, setBoard] = createStore<BoardViewDTO>({
      ...makeInitialBoard(),
      cards: [makeCard({
        comments: [{ id: 'late', cardId: 'card_1', content: 'Later', isMine: false, createdAt: 300 }],
        commentCount: 1,
      })],
    });
    const early = { id: 'early', cardId: 'card_1', content: 'Earlier', isMine: true, createdAt: 100 };

    setBoard((draft) => {
      applyBoardEvents(draft, [
        { type: 'reaction:updated', version: 2, cardId: 'card_1', counts: { '👍': 2 }, myReactions: ['👍'] },
        { type: 'comment:created', version: 3, cardId: 'card_1', comment: early },
        { type: 'comment:created', version: 3, cardId: 'card_1', comment: early },
      ]);
    });
    flush();

    let card = snapshot(board).cards[0];
    expect(card.reactions).toEqual({ '👍': 2 });
    expect(card.myReactions).toEqual(['👍']);
    expect(card.comments.map((comment) => comment.id)).toEqual(['early', 'late']);
    expect(card.commentCount).toBe(2);

    setBoard((draft) => {
      applyBoardEvents(draft, [
        { type: 'reaction:updated', version: 4, cardId: 'card_1', counts: {}, myReactions: [] },
        { type: 'comment:deleted', version: 4, cardId: 'card_1', commentId: 'late' },
        { type: 'comment:deleted', version: 4, cardId: 'card_1', commentId: 'late' },
      ]);
    });
    flush();

    card = snapshot(board).cards[0];
    expect(card.reactions).toEqual({});
    expect(card.myReactions).toEqual([]);
    expect(card.comments.map((comment) => comment.id)).toEqual(['early']);
    expect(card.commentCount).toBe(1);
  });

  it('patches Card Group create, rename, Column move, and dissolve across member Cards', () => {
    const first = makeCard({ id: 'card_1' });
    const second = makeCard({ id: 'card_2' });
    const [board, setBoard] = createStore<BoardViewDTO>({
      ...makeInitialBoard(),
      columns: makeInitialBoard().columns.map((column) => ({
        ...column,
        cardCount: column.id === 'col_1' ? 2 : 0,
      })),
      cards: [first, second],
    });

    setBoard((draft) => {
      applyBoardEvents(draft, [
        {
          type: 'group:upserted',
          version: 2,
          group: {
            id: 'group_1',
            columnId: 'col_1',
            title: 'CI stability',
            cardIds: ['card_1', 'card_2'],
            votes: 3,
            myVotes: 1,
            createdAt: 1_760_000_002_000,
          },
        },
        {
          type: 'card:upserted',
          version: 2,
          card: { ...first, groupId: 'group_1' },
        },
        {
          type: 'card:upserted',
          version: 2,
          card: { ...second, groupId: 'group_1' },
        },
      ]);
    });
    flush();

    let next = snapshot(board);
    expect(next.groups).toEqual([
      expect.objectContaining({
        id: 'group_1',
        title: 'CI stability',
        votes: 3,
        myVotes: 1,
      }),
    ]);
    expect(next.cards.map((card) => card.groupId)).toEqual([
      'group_1',
      'group_1',
    ]);

    setBoard((draft) => {
      applyBoardEvents(draft, [
        {
          type: 'group:upserted',
          version: 3,
          group: {
            ...next.groups[0],
            columnId: 'col_2',
            title: 'CI reliability',
          },
        },
        {
          type: 'card:upserted',
          version: 3,
          card: { ...next.cards[0], columnId: 'col_2' },
        },
        {
          type: 'card:upserted',
          version: 3,
          card: { ...next.cards[1], columnId: 'col_2' },
        },
      ]);
    });
    flush();

    next = snapshot(board);
    expect(next.groups[0]).toMatchObject({
      columnId: 'col_2',
      title: 'CI reliability',
    });
    expect(next.cards.map((card) => card.columnId)).toEqual(['col_2', 'col_2']);
    expect(next.columns.map((column) => column.cardCount)).toEqual([0, 2]);

    setBoard((draft) => {
      applyBoardEvents(draft, [
        { type: 'group:dissolved', version: 4, groupId: 'group_1' },
      ]);
    });
    flush();

    next = snapshot(board);
    expect(next.groups).toEqual([]);
    expect(next.cards.map((card) => card.groupId)).toEqual([null, null]);
  });

  it('patches Board rename and Column add, update, reorder, and delete', () => {
    const [board, setBoard] = createStore<BoardViewDTO>(makeInitialBoard());

    setBoard((draft) => {
      applyBoardEvents(draft, [
        {
          type: 'board:updated',
          version: 2,
          patch: { title: 'Sprint 43 Retro' },
        },
        {
          type: 'column:upserted',
          version: 3,
          column: {
            id: 'col_3',
            title: 'Kudos',
            accent: 'violet',
            position: 2,
            isActionColumn: false,
            cardCount: 0,
          },
        },
        {
          type: 'column:upserted',
          version: 4,
          column: {
            id: 'col_3',
            title: 'Shoutouts',
            accent: 'coral',
            position: 2,
            isActionColumn: false,
            cardCount: 0,
          },
        },
        {
          type: 'columns:reordered',
          version: 5,
          columnIds: ['col_3', 'col_1', 'col_2'],
        },
        {
          type: 'card:upserted',
          version: 6,
          card: makeCard({ id: 'card_in_col3', columnId: 'col_3' }),
        },
      ]);
    });
    flush();

    const afterReorder = snapshot(board);
    expect(afterReorder.title).toBe('Sprint 43 Retro');
    expect(afterReorder.columns.map((c) => c.id)).toEqual([
      'col_3',
      'col_1',
      'col_2',
    ]);
    expect(afterReorder.columns[0]).toMatchObject({
      title: 'Shoutouts',
      accent: 'coral',
      position: 0,
      cardCount: 1,
    });

    setBoard((draft) => {
      applyBoardEvents(draft, [
        { type: 'column:deleted', version: 7, columnId: 'col_3' },
      ]);
    });
    flush();

    const afterColDelete = snapshot(board);
    expect(afterColDelete.columns.map((c) => c.id)).toEqual(['col_1', 'col_2']);
    expect(afterColDelete.columns.map((c) => c.position)).toEqual([0, 1]);
    expect(afterColDelete.cards).toHaveLength(0);
  });
});
