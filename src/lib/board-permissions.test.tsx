import { describe, expect, it } from 'vitest';

import type { BoardViewDTO, CardGroupDTO, CardViewDTO, CommentViewDTO } from './board-types';
import {
  areAllGroupCardsMine,
  canAddColumn,
  canCastVote,
  canContribute,
  canControlFacilitation,
  canDeleteColumn,
  canDeleteComment,
  canEditActionItem,
  canEditActionItemFollowUp,
  canEditActionItems,
  canFacilitate,
  canInteractWithCard,
  canManageCard,
  canManageGroup,
  canManageGrouping,
  isGroupRedacted,
  passesPrivateMode,
} from './board-permissions';

function makeCard(overrides: Partial<CardViewDTO> = {}): CardViewDTO {
  return {
    id: 'card-1',
    columnId: 'col-1',
    groupId: null,
    content: 'Card',
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
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<CardGroupDTO> = {}): CardGroupDTO {
  return {
    id: 'group-1',
    columnId: 'col-1',
    title: 'Group',
    cardIds: ['card-1'],
    votes: 0,
    myVotes: 0,
    createdAt: 0,
    ...overrides,
  };
}

function makeComment(overrides: Partial<CommentViewDTO> = {}): CommentViewDTO {
  return {
    id: 'comment-1',
    cardId: 'card-1',
    content: 'Comment',
    isMine: true,
    createdAt: 0,
    ...overrides,
  };
}

function makeBoard(overrides: Partial<BoardViewDTO> = {}): BoardViewDTO {
  return {
    id: 'board-1',
    title: 'Board',
    subtitle: '',
    templateId: 'standard',
    isBlurred: false,
    blindVoting: false,
    isLocked: false,
    allowParticipantGroup: false,
    voteLimit: null,
    maxVotesPerCard: null,
    remainingVotes: null,
    isFacilitator: false,
    timer: { endsAt: null, remainingMs: null, durationMs: null },
    version: 1,
    retentionDays: 30,
    createdAt: 0,
    lastActiveAt: 0,
    columns: [],
    groups: [],
    cards: [],
    ...overrides,
  };
}

describe('board-permissions', () => {
  describe('facilitation gates', () => {
    // board:set-lock (sql-board-operations.ts:798) and deleteBoardForRequest
    // (board-service.ts:308–357) stay Facilitator-only even while Locked.
    it('canFacilitate tracks the Facilitator role regardless of lock state', () => {
      expect(canFacilitate(makeBoard({ isFacilitator: true, isLocked: true }))).toBe(true);
      expect(canFacilitate(makeBoard({ isFacilitator: true, isLocked: false }))).toBe(true);
      expect(canFacilitate(makeBoard({ isFacilitator: false }))).toBe(false);
    });

    // timer:update (712), board:rename (737), board:set-private-mode (773) and
    // voting:configure/voting:reset (656) are Facilitator-only and blocked while Locked.
    it('canControlFacilitation requires an unlocked Facilitator', () => {
      expect(canControlFacilitation(makeBoard({ isFacilitator: true }))).toBe(true);
      expect(canControlFacilitation(makeBoard({ isFacilitator: true, isLocked: true }))).toBe(false);
      expect(canControlFacilitation(makeBoard({ isFacilitator: false }))).toBe(false);
    });

    // Global Locked gate (sql-board-operations.ts:603–617): while Locked every write except
    // facilitator:rotate, board:set-lock and facilitator follow-up on existing Action Items
    // fails with BOARD_LOCKED — so Cards, comments, reactions and Votes are all frozen.
    it('canContribute is exactly the inverse of the Locked gate', () => {
      expect(canContribute(makeBoard({ isLocked: false }))).toBe(true);
      expect(canContribute(makeBoard({ isLocked: true }))).toBe(false);
    });

    // column:add (sql-board-operations.ts:1562) is Facilitator-only, blocked while
    // Locked, and capped by MAX_COLUMNS_PER_BOARD (1575).
    it('canAddColumn caps Facilitators at MAX_COLUMNS_PER_BOARD unlocked Columns', () => {
      const columns = Array.from({ length: 10 }, (_, i) => ({
        id: `col-${i}`,
        title: `Column ${i}`,
        accent: 'slate' as const,
        position: i,
        isActionColumn: false,
        cardCount: 0,
      }));
      expect(
        canAddColumn(makeBoard({ isFacilitator: true, columns: columns.slice(0, 9) })),
      ).toBe(true);
      expect(canAddColumn(makeBoard({ isFacilitator: true, columns }))).toBe(false);
      expect(
        canAddColumn(makeBoard({ isFacilitator: true, isLocked: true, columns: columns.slice(0, 9) })),
      ).toBe(false);
      expect(canAddColumn(makeBoard({ columns: columns.slice(0, 9) }))).toBe(false);
    });
  });

  describe('card gates', () => {
    // checkPrivateCardPermission (card-permissions.ts:5–18) plus the Locked gate:
    // reactions, comments and Votes need only a revealed Card on an unlocked Board.
    it('canInteractWithCard needs an unlocked Board and a revealed Card', () => {
      expect(canInteractWithCard(makeBoard(), makeCard())).toBe(true);
      expect(canInteractWithCard(makeBoard({ isLocked: true }), makeCard())).toBe(false);
      expect(canInteractWithCard(makeBoard({ isBlurred: true }), makeCard({ redacted: true }))).toBe(false);
    });

    // checkCardManagePermission (sql-board-operations.ts:547–563) on projected state:
    // own Card, or any revealed Card as Facilitator — Private Mode blinds Facilitators
    // because checkPrivateCardPermission applies even to them.
    it('canManageCard allows own Cards, or any revealed Card for an unlocked Facilitator', () => {
      const participant = makeBoard();
      expect(canManageCard(participant, makeCard({ isMine: true }))).toBe(true);
      expect(canManageCard(participant, makeCard({ isMine: false }))).toBe(false);
      expect(canManageCard(participant, makeCard({ isMine: true, redacted: true }))).toBe(false);
      expect(canManageCard(makeBoard({ isLocked: true }), makeCard({ isMine: true }))).toBe(false);

      const facilitator = makeBoard({ isFacilitator: true });
      expect(canManageCard(facilitator, makeCard({ isMine: false }))).toBe(true);
      expect(canManageCard(makeBoard({ isFacilitator: true, isBlurred: true }), makeCard({ isMine: false }))).toBe(false);
    });

    it('canManageCard by id resolves the Card and rejects optimistic placeholders', () => {
      const board = makeBoard({ cards: [makeCard({ id: 'real-1', isMine: true })] });
      expect(canManageCard(board, 'real-1')).toBe(true);
      expect(canManageCard(board, 'missing-1')).toBe(false);
      expect(canManageCard(board, 'optimistic:card:1')).toBe(false);
    });
  });

  describe('grouping gates', () => {
    // checkGroupManagePermission (sql-board-operations.ts:512–524): Facilitators always,
    // Participants only with allow_participant_group (default false) — behind the Locked gate.
    it('canManageGrouping mirrors the facilitator-or-allow_participant_group rule', () => {
      expect(canManageGrouping(makeBoard())).toBe(false);
      expect(canManageGrouping(makeBoard({ allowParticipantGroup: true }))).toBe(true);
      expect(canManageGrouping(makeBoard({ isFacilitator: true }))).toBe(true);
      expect(
        canManageGrouping(makeBoard({ isFacilitator: true, allowParticipantGroup: true, isLocked: true })),
      ).toBe(false);
    });

    // checkGroupPrivacy (sql-board-operations.ts:526–545): while Private Mode is active
    // every member Card's author must pass checkPrivateCardPermission — Facilitators included.
    it('areAllGroupCardsMine demands every member Card while Private Mode is active', () => {
      const mine = makeCard({ id: 'mine', isMine: true });
      const foreign = makeCard({ id: 'foreign', isMine: false });
      const group = makeGroup({ cardIds: ['mine', 'foreign'] });
      const blurred = { isBlurred: true } as const;

      expect(areAllGroupCardsMine({ isBlurred: false }, group, [mine, foreign])).toBe(true);
      expect(areAllGroupCardsMine(blurred, group, [mine])).toBe(false);
      expect(areAllGroupCardsMine(blurred, makeGroup({ cardIds: ['mine'] }), [mine])).toBe(true);
      expect(areAllGroupCardsMine(blurred, makeGroup({ cardIds: ['mine'] }), [])).toBe(false);
    });

    it('canManageGroup combines the role gate with group visibility', () => {
      const mine = makeCard({ id: 'mine', isMine: true });
      const foreign = makeCard({ id: 'foreign', isMine: false });
      const mixed = makeGroup({ cardIds: ['mine', 'foreign'], redacted: true });

      expect(canManageGroup(makeBoard({ isFacilitator: true }), makeGroup({ cardIds: ['mine'] }), [mine])).toBe(true);
      expect(canManageGroup(makeBoard({ isFacilitator: true, isBlurred: true }), mixed, [mine, foreign])).toBe(false);
      expect(
        canManageGroup(makeBoard({ isFacilitator: true, isBlurred: true }), makeGroup({ cardIds: ['mine'] }), [mine]),
      ).toBe(true);
      expect(canManageGroup(makeBoard({ allowParticipantGroup: true }), makeGroup({ cardIds: ['mine'] }), [mine])).toBe(true);
      expect(canManageGroup(makeBoard({ isLocked: true, isFacilitator: true }), makeGroup({ cardIds: ['mine'] }), [mine])).toBe(false);
      expect(canManageGroup(makeBoard({ isFacilitator: true }), makeGroup({ redacted: true }), [mine])).toBe(false);
    });

    it('isGroupRedacted treats an unset redacted flag as revealed', () => {
      expect(isGroupRedacted(makeGroup())).toBe(false);
      expect(isGroupRedacted(makeGroup({ redacted: true }))).toBe(true);
    });

    // The strict Private Mode rule used for ungrouping: checkPrivateCardPermission
    // blocks Facilitators from touching another Participant's Card while blurred.
    it('passesPrivateMode keeps only the actor own Cards touchable while blurred', () => {
      expect(passesPrivateMode({ isBlurred: false }, makeCard({ isMine: false }))).toBe(true);
      expect(passesPrivateMode({ isBlurred: true }, makeCard({ isMine: true }))).toBe(true);
      expect(passesPrivateMode({ isBlurred: true }, makeCard({ isMine: false }))).toBe(false);
    });
  });

  describe('action item gates', () => {
    // SPEC permission matrix: while Locked, only a Facilitator may still toggle
    // actionDone and edit actionOwner on EXISTING Action Items.
    it('canEditActionItems follows the Locked carve-out for Facilitators', () => {
      expect(canEditActionItems(makeBoard())).toBe(true);
      expect(canEditActionItems(makeBoard({ isLocked: true }))).toBe(false);
      expect(canEditActionItems(makeBoard({ isLocked: true, isFacilitator: true }))).toBe(true);
    });

    it('canEditActionItemFollowUp only applies to existing Action Items', () => {
      const actionItem = makeCard({ isActionItem: true });
      expect(canEditActionItemFollowUp(makeBoard(), actionItem)).toBe(true);
      expect(canEditActionItemFollowUp(makeBoard(), makeCard())).toBe(false);
      expect(canEditActionItemFollowUp(makeBoard({ isLocked: true }), actionItem)).toBe(false);
      expect(
        canEditActionItemFollowUp(makeBoard({ isLocked: true, isFacilitator: true }), actionItem),
      ).toBe(true);
    });

    // card:set-action (sql-board-operations.ts:1387–1457) behind the global Locked gate
    // (603–617): while Locked a Facilitator may only update EXISTING Action Items
    // (done/owner) and only without re-flagging — isActionItem must stay undefined.
    it('canEditActionItem enforces the Locked Action Item carve-out', () => {
      const actionItem = makeCard({ isActionItem: true });
      expect(canEditActionItem(makeBoard(), actionItem, { actionDone: true })).toBe(true);
      expect(canEditActionItem(makeBoard(), actionItem, { isActionItem: false })).toBe(true);

      const locked = makeBoard({ isLocked: true });
      expect(canEditActionItem(locked, actionItem, { actionDone: true })).toBe(false);
      expect(canEditActionItem(locked, actionItem, { actionOwner: 'Ron' })).toBe(false);
      expect(canEditActionItem(locked, makeCard(), { actionDone: true })).toBe(false);
      expect(
        canEditActionItem(makeBoard({ isLocked: true, isFacilitator: true }), actionItem, { actionDone: true }),
      ).toBe(true);
      expect(
        canEditActionItem(makeBoard({ isLocked: true, isFacilitator: true }), actionItem, { actionOwner: 'Ron' }),
      ).toBe(true);
      expect(
        canEditActionItem(makeBoard({ isLocked: true, isFacilitator: true }), actionItem, { isActionItem: false }),
      ).toBe(false);
      expect(
        canEditActionItem(makeBoard({ isLocked: true, isFacilitator: true }), makeCard(), { actionDone: true }),
      ).toBe(false);
    });

    it('canEditActionItem never touches redacted Cards', () => {
      expect(
        canEditActionItem(makeBoard(), makeCard({ redacted: true, isActionItem: true }), { actionDone: true }),
      ).toBe(false);
    });
  });

  describe('comment gates', () => {
    // comment:delete (sql-board-operations.ts:1541–1543): own comment, or any comment as
    // Facilitator. The client additionally requires the Facilitator to wait for Reveal All
    // (!isBlurred) because it cannot compare comment author hashes itself.
    it('canDeleteComment allows own comments, or any revealed comment for Facilitators', () => {
      expect(canDeleteComment(makeBoard(), makeComment({ isMine: true }))).toBe(true);
      expect(canDeleteComment(makeBoard(), makeComment({ isMine: false }))).toBe(false);
      expect(
        canDeleteComment(makeBoard({ isFacilitator: true }), makeComment({ isMine: false })),
      ).toBe(true);
      expect(
        canDeleteComment(makeBoard({ isFacilitator: true, isBlurred: true }), makeComment({ isMine: false })),
      ).toBe(false);
      expect(canDeleteComment(makeBoard({ isLocked: true }), makeComment({ isMine: true }))).toBe(false);
    });
  });

  describe('vote gates', () => {
    // sql-voting-operations.ts changeVote (16–84): a +1 cast must clear the remaining
    // Board Vote balance and the per-Card cap. Blind Voting never restricts casting —
    // it only hides totals in the projection — so canCastVote takes no blindVoting input.
    it('canCastVote mirrors the per-Card cap and remaining Vote balance', () => {
      const unlimited = { remainingVotes: null, maxVotesPerCard: null };
      expect(canCastVote(unlimited, 0)).toBe(true);
      expect(canCastVote({ remainingVotes: 1, maxVotesPerCard: null }, 0)).toBe(true);
      expect(canCastVote({ remainingVotes: 0, maxVotesPerCard: null }, 0)).toBe(false);
      expect(canCastVote({ remainingVotes: 3, maxVotesPerCard: 1 }, 0)).toBe(true);
      expect(canCastVote({ remainingVotes: 3, maxVotesPerCard: 1 }, 1)).toBe(false);
    });

    it('canCastVote ignores Blind Voting totals hiding', () => {
      const blindBoardVoting = { remainingVotes: 2, maxVotesPerCard: null };
      expect(canCastVote(blindBoardVoting, 0)).toBe(true);
    });
  });

  describe('column gates', () => {
    // column:delete (sql-board-operations.ts:1695–1734): Facilitator only, more than one
    // Column, and no hidden Cards while Private Mode is active.
    it('canDeleteColumn requires an unlocked Facilitator, spare Column, and no hidden Cards', () => {
      const revealed = [makeCard()];
      const hidden = [makeCard({ redacted: true })];

      expect(canDeleteColumn(makeBoard({ isFacilitator: true }), 2, revealed)).toBe(true);
      expect(canDeleteColumn(makeBoard({ isFacilitator: true }), 1, revealed)).toBe(false);
      expect(canDeleteColumn(makeBoard({ isFacilitator: true, isLocked: true }), 2, revealed)).toBe(false);
      expect(canDeleteColumn(makeBoard({ isFacilitator: true }), 2, hidden)).toBe(false);
      expect(canDeleteColumn(makeBoard(), 2, revealed)).toBe(false);
    });
  });
});
