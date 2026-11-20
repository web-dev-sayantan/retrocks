import { describe, expect, it } from 'vitest';
import type * as v from 'valibot';

import type { BoardLiveMessage } from './board-live-protocol';
import type {
  BoardEvent,
  BoardViewDTO,
  CardGroupDTO,
  CardViewDTO,
  ColumnDTO,
  CommentViewDTO,
  TimerStateDTO,
} from './board-types';
import {
  parseBoardLiveMessage,
  parseBoardView,
  type BoardEventSchema,
  type BoardLiveMessageSchema,
  type BoardViewDTOSchema,
  type CardGroupDTOSchema,
  type CardViewDTOSchema,
  type ColumnDTOSchema,
  type CommentViewDTOSchema,
  type TimerStateDTOSchema,
} from './wire-schemas';

function makeCard(overrides?: Partial<CardViewDTO>): CardViewDTO {
  const now = 1_760_000_000_000;
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
    reactions: { '👍': 2 },
    myReactions: ['👍'],
    commentCount: 1,
    comments: [
      { id: 'c_1', cardId: 'card_1', content: 'Nice', isMine: false, createdAt: now },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBoard(): BoardViewDTO {
  const now = 1_760_000_000_000;
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
        cardCount: 1,
      },
    ],
    groups: [],
    cards: [makeCard()],
  };
}

describe('parseBoardLiveMessage', () => {
  it('parses a snapshot frame with its nested Board', () => {
    const frame = JSON.stringify({
      type: 'board:snapshot',
      version: 3,
      serverNow: 100,
      board: makeBoard(),
      connectionId: 'conn_1',
    });
    const message = parseBoardLiveMessage(frame);
    expect(message.type).toBe('board:snapshot');
    if (message.type !== 'board:snapshot') return;
    expect(message.connectionId).toBe('conn_1');
    expect(message.board.title).toBe('Sprint 42 Retro');
    expect(message.board.cards[0]?.reactions).toEqual({ '👍': 2 });
  });

  it('parses a mutation batch, presence, heartbeat, and deleted frames', () => {
    const mutation = parseBoardLiveMessage(
      JSON.stringify({
        type: 'board:mutation',
        version: 4,
        events: [
          {
            type: 'reaction:updated',
            version: 4,
            cardId: 'card_1',
            counts: { '🎉': 1 },
            myReactions: ['🎉'],
          },
        ],
      }),
    );
    expect(mutation).toMatchObject({
      type: 'board:mutation',
      events: [{ type: 'reaction:updated', counts: { '🎉': 1 } }],
    });

    expect(parseBoardLiveMessage('{"type":"presence:count","count":2}')).toEqual({
      type: 'presence:count',
      count: 2,
    });
    expect(parseBoardLiveMessage('{"type":"heartbeat"}')).toEqual({ type: 'heartbeat' });
    expect(parseBoardLiveMessage('{"type":"board:deleted","version":9}')).toEqual({
      type: 'board:deleted',
      version: 9,
    });
  });

  it('rejects frames that are not valid JSON', () => {
    expect(() => parseBoardLiveMessage('not json')).toThrow();
  });

  it('rejects unknown message types', () => {
    expect(() => parseBoardLiveMessage('{"type":"board:exploded"}')).toThrow();
  });

  it('rejects snapshot frames whose Board has drifted', () => {
    const board: Record<string, unknown> = JSON.parse(JSON.stringify(makeBoard()));
    delete board.title;
    expect(() =>
      parseBoardLiveMessage(
        JSON.stringify({ type: 'board:snapshot', version: 1, serverNow: 1, board }),
      ),
    ).toThrow();
  });

  it('rejects cards with reaction keys outside the emoji palette', () => {
    const board: unknown = { ...makeBoard(), cards: [{ ...makeCard(), reactions: { '🙃': 1 } }] };
    expect(() =>
      parseBoardLiveMessage(
        JSON.stringify({ type: 'board:snapshot', version: 1, serverNow: 1, board }),
      ),
    ).toThrow();
  });

  it('rejects mutation events missing required fields', () => {
    expect(() =>
      parseBoardLiveMessage(
        JSON.stringify({
          type: 'board:mutation',
          version: 2,
          events: [{ type: 'card:deleted' }],
        }),
      ),
    ).toThrow();
  });
});

describe('parseBoardView', () => {
  it('accepts a viewer-projected Board snapshot', () => {
    const board = parseBoardView(makeBoard());
    expect(board.id).toBe('board_0123456789abcdef');
    expect(board.cards[0]?.comments[0]?.content).toBe('Nice');
  });

  it('rejects Boards with wrong-typed fields', () => {
    const drifted: unknown = { ...makeBoard(), title: 42 };
    expect(() => parseBoardView(drifted)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Compile-time contracts (fail `pnpm typecheck` when the hand-written DTO
// interfaces in board-types.ts drift from the wire schemas).
// ---------------------------------------------------------------------------

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
  ? true
  : false;
type Expect<T extends true> = T;

type _ColumnDTOMatches = Expect<Equal<v.InferOutput<typeof ColumnDTOSchema>, ColumnDTO>>;
type _CommentViewDTOMatches = Expect<
  Equal<v.InferOutput<typeof CommentViewDTOSchema>, CommentViewDTO>
>;
type _CardViewDTOMatches = Expect<Equal<v.InferOutput<typeof CardViewDTOSchema>, CardViewDTO>>;
type _CardGroupDTOMatches = Expect<Equal<v.InferOutput<typeof CardGroupDTOSchema>, CardGroupDTO>>;
type _TimerStateDTOMatches = Expect<
  Equal<v.InferOutput<typeof TimerStateDTOSchema>, TimerStateDTO>
>;
type _BoardViewDTOMatches = Expect<Equal<v.InferOutput<typeof BoardViewDTOSchema>, BoardViewDTO>>;
type _BoardEventMatches = Expect<Equal<v.InferOutput<typeof BoardEventSchema>, BoardEvent>>;
type _BoardLiveMessageMatches = Expect<
  Equal<v.InferOutput<typeof BoardLiveMessageSchema>, BoardLiveMessage>
>;

export type CompileTimeContracts = [
  _ColumnDTOMatches,
  _CommentViewDTOMatches,
  _CardViewDTOMatches,
  _CardGroupDTOMatches,
  _TimerStateDTOMatches,
  _BoardViewDTOMatches,
  _BoardEventMatches,
  _BoardLiveMessageMatches,
];
