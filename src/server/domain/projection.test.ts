import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import { CreateBoardInputSchema } from '../../lib/schemas';
import {
  BOARD_TEMPLATES,
  formatDefaultBoardTitle,
  getBoardTemplate,
} from '../../lib/templates';
import type { RawBoardSnapshot } from '../db/raw-types';
import {
  projectBoardForViewer,
  projectMutationEventsForViewer,
} from './projection';

function makeRawSnapshot(overrides?: Partial<RawBoardSnapshot>): RawBoardSnapshot {
  const now = 1_760_000_000_000;
  return {
    board: {
      id: 'board_0123456789abcdef',
      title: 'Sprint 42 Retro',
      subtitle: 'Checkout Team',
      templateId: 'standard',
      facilitatorTokenHash: 'secret_facilitator_hash_do_not_leak',
      facilitatorTokenEncrypted: 'v1.encrypted_secret_do_not_leak.tag',
      tokenSalt: 'secret_salt_do_not_leak',
      isBlurred: false,
      blindVoting: false,
      isLocked: false,
      allowParticipantGroup: false,
      voteLimit: 5,
      maxVotesPerCard: null,
      timerEndsAt: null,
      timerRemainingMs: null,
      timerDurationMs: null,
      version: 1,
      retentionDays: 90,
      createdAt: now,
      lastActiveAt: now,
    },
    columns: [
      {
        id: 'col_1',
        boardId: 'board_0123456789abcdef',
        title: 'Went Well',
        accent: 'sage',
        position: 0,
        isActionColumn: false,
      },
      {
        id: 'col_2',
        boardId: 'board_0123456789abcdef',
        title: 'Action Items',
        accent: 'sky',
        position: 1,
        isActionColumn: true,
      },
    ],
    groups: [],
    cards: [
      {
        id: 'card_mine',
        boardId: 'board_0123456789abcdef',
        columnId: 'col_1',
        groupId: null,
        content: 'My own card text',
        authorTokenHash: 'hash_viewer_a',
        isActionItem: false,
        actionDone: false,
        actionOwner: '',
        createdAt: now + 1,
        updatedAt: now + 1,
      },
      {
        id: 'card_other',
        boardId: 'board_0123456789abcdef',
        columnId: 'col_1',
        groupId: null,
        content: 'Confidential other participant note that must not leak in Private Mode',
        authorTokenHash: 'hash_viewer_b',
        isActionItem: false,
        actionDone: false,
        actionOwner: '',
        createdAt: now + 2,
        updatedAt: now + 2,
      },
    ],
    votes: [
      {
        boardId: 'board_0123456789abcdef',
        targetType: 'card',
        targetId: 'card_mine',
        voterTokenHash: 'hash_viewer_a',
        count: 2,
        updatedAt: now + 5,
      },
      {
        boardId: 'board_0123456789abcdef',
        targetType: 'card',
        targetId: 'card_mine',
        voterTokenHash: 'hash_viewer_b',
        count: 1,
        updatedAt: now + 6,
      },
    ],
    reactions: [
      {
        boardId: 'board_0123456789abcdef',
        cardId: 'card_mine',
        emoji: '👍',
        reactorTokenHash: 'hash_viewer_a',
        createdAt: now + 7,
      },
    ],
    comments: [
      {
        id: 'comment_1',
        boardId: 'board_0123456789abcdef',
        cardId: 'card_other',
        content: 'Secret discussion comment on other card',
        authorTokenHash: 'hash_viewer_b',
        createdAt: now + 8,
      },
    ],
    ...overrides,
  };
}

describe('curated templates & Board creation schema', () => {
  it('defines all 9 curated templates with Standard Retro marking Action Items as isActionColumn', () => {
    expect(BOARD_TEMPLATES.map((t) => t.id)).toEqual([
      'standard',
      'start-stop-continue',
      'mad-sad-glad',
      '4ls',
      'starfish',
      'sailboat',
      'six-thinking-hats',
      'pros-cons',
      'custom',
    ]);

    const standard = getBoardTemplate('standard');
    expect(standard.columns).toHaveLength(3);
    expect(standard.columns[2]).toMatchObject({
      title: 'Action Items',
      isActionColumn: true,
    });

    const sixHats = getBoardTemplate('six-thinking-hats');
    expect(sixHats.columns).toHaveLength(6);
  });

  it('formats the default Board title as "Sprint Retrospective — <MMM D>"', () => {
    const title = formatDefaultBoardTitle(new Date('2026-11-08T12:00:00Z'));
    expect(title).toBe('Sprint Retrospective — Nov 8');
  });

  it('validates Board creation input bounds and defaults', () => {
    const parsed = v.parse(CreateBoardInputSchema, {});
    expect(parsed.templateId).toBe('standard');
    expect(parsed.voteLimit).toBe(5);
    expect(parsed.maxVotesPerCard).toBeNull();
    expect(parsed.isBlurred).toBe(false);
    expect(parsed.retentionDays).toBe(90);

    expect(() =>
      v.parse(CreateBoardInputSchema, { title: 'a'.repeat(121) }),
    ).toThrow();
    expect(() =>
      v.parse(CreateBoardInputSchema, { subtitle: 'b'.repeat(241) }),
    ).toThrow();
    expect(() =>
      v.parse(CreateBoardInputSchema, { columns: [] }),
    ).toThrow();
    expect(() =>
      v.parse(CreateBoardInputSchema, {
        columns: Array.from({ length: 11 }, (_, i) => ({
          title: `Col ${i}`,
          accent: 'slate',
        })),
      }),
    ).toThrow();
  });
});

describe('projectBoardForViewer()', () => {
  it('strips all hashes, salts, and encrypted secrets and computes viewer-scoped fields', () => {
    const raw = makeRawSnapshot();
    const dto = projectBoardForViewer(raw, 'hash_viewer_a', true);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain('secret_facilitator_hash_do_not_leak');
    expect(serialized).not.toContain('encrypted_secret_do_not_leak');
    expect(serialized).not.toContain('secret_salt_do_not_leak');
    expect(serialized).not.toContain('hash_viewer_a');
    expect(serialized).not.toContain('hash_viewer_b');
    expect(serialized).not.toContain('facilitatorTokenHash');
    expect(serialized).not.toContain('facilitatorTokenEncrypted');
    expect(serialized).not.toContain('tokenSalt');
    expect(serialized).not.toContain('authorTokenHash');
    expect(serialized).not.toContain('voterTokenHash');
    expect(serialized).not.toContain('reactorTokenHash');

    expect(dto.isFacilitator).toBe(true);
    expect(dto.remainingVotes).toBe(3); // 5 limit - 2 cast by viewer A
    expect(dto.columns[0].cardCount).toBe(2);
    expect(dto.columns[1].cardCount).toBe(0);

    const mine = dto.cards.find((c) => c.id === 'card_mine')!;
    const other = dto.cards.find((c) => c.id === 'card_other')!;
    expect(mine.isMine).toBe(true);
    expect(mine.votes).toBe(3);
    expect(mine.myVotes).toBe(2);
    expect(mine.reactions).toEqual({ '👍': 1 });
    expect(mine.myReactions).toEqual(['👍']);

    expect(other.isMine).toBe(false);
    expect(other.redacted).toBe(false);
    expect(other.content).toContain('Confidential');
  });

  it('redacts other Participants cards and comments during Private Mode even for Facilitators', () => {
    const raw = makeRawSnapshot();
    raw.board.isBlurred = true;

    const dto = projectBoardForViewer(raw, 'hash_viewer_a', true);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain('Confidential other participant note');
    expect(serialized).not.toContain('Secret discussion comment');

    const mine = dto.cards.find((c) => c.id === 'card_mine')!;
    const other = dto.cards.find((c) => c.id === 'card_other')!;

    expect(mine.redacted).toBe(false);
    expect(mine.content).toBe('My own card text');
    expect(other.redacted).toBe(true);
    expect(other.content).toBe('');
    expect([1, 2, 3]).toContain(other.placeholderLines);
    expect(other.comments).toEqual([]);
    expect(other.commentCount).toBe(0);
  });

  it('hides aggregate Vote totals during Blind Voting while preserving myVotes', () => {
    const raw = makeRawSnapshot();
    raw.board.blindVoting = true;

    const dto = projectBoardForViewer(raw, 'hash_viewer_a', false);
    const mine = dto.cards.find((c) => c.id === 'card_mine')!;
    expect(mine.votes).toBeNull();
    expect(mine.myVotes).toBe(2);
    expect(dto.remainingVotes).toBe(3);
  });

  it('redacts Private Mode Card Groups in SSR snapshots and live group:upserted events for non-authors including Facilitators', () => {
    const now = 1_760_000_000_000;
    const raw = makeRawSnapshot({
      groups: [
        {
          id: 'group_secret',
          boardId: 'board_0123456789abcdef',
          columnId: 'col_1',
          title: 'Secret merged incident theme',
          createdAt: now + 10,
        },
      ],
      cards: [
        {
          id: 'card_b1',
          boardId: 'board_0123456789abcdef',
          columnId: 'col_1',
          groupId: 'group_secret',
          content: 'Secret merged incident theme',
          authorTokenHash: 'hash_viewer_b',
          isActionItem: false,
          actionDone: false,
          actionOwner: '',
          createdAt: now + 1,
          updatedAt: now + 1,
        },
        {
          id: 'card_b2',
          boardId: 'board_0123456789abcdef',
          columnId: 'col_1',
          groupId: 'group_secret',
          content: 'Second private card from B',
          authorTokenHash: 'hash_viewer_b',
          isActionItem: false,
          actionDone: false,
          actionOwner: '',
          createdAt: now + 2,
          updatedAt: now + 2,
        },
      ],
      votes: [
        {
          boardId: 'board_0123456789abcdef',
          targetType: 'group',
          targetId: 'group_secret',
          voterTokenHash: 'hash_viewer_b',
          count: 2,
          updatedAt: now + 12,
        },
      ],
    });
    raw.board.isBlurred = true;

    // Author (viewer B) sees their own Card Group title and votes normally
    const authorDto = projectBoardForViewer(raw, 'hash_viewer_b', false);
    expect(authorDto.groups).toEqual([
      expect.objectContaining({
        id: 'group_secret',
        title: 'Secret merged incident theme',
        redacted: false,
        votes: 2,
        myVotes: 2,
      }),
    ]);

    // Facilitator (viewer A) and another Participant (viewer C) MUST NOT see title or votes
    for (const [viewerHash, isFac] of [
      ['hash_viewer_a', true] as const,
      ['hash_viewer_c', false] as const,
    ]) {
      const viewerDto = projectBoardForViewer(raw, viewerHash, isFac);
      expect(JSON.stringify(viewerDto)).not.toContain('Secret merged incident theme');
      expect(viewerDto.groups).toEqual([
        expect.objectContaining({
          id: 'group_secret',
          title: '',
          redacted: true,
          votes: null,
          myVotes: 0,
        }),
      ]);

      const liveEvents = projectMutationEventsForViewer(
        raw,
        [{ type: 'group:upserted', version: 2, groupId: 'group_secret' }],
        viewerHash,
        isFac,
      );
      expect(JSON.stringify(liveEvents)).not.toContain('Secret merged incident theme');
      expect(liveEvents).toEqual([
        {
          type: 'group:upserted',
          version: 2,
          group: expect.objectContaining({
            id: 'group_secret',
            title: '',
            redacted: true,
            votes: null,
            myVotes: 0,
          }),
        },
      ]);
    }
  });
});
