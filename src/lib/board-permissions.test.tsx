import { describe, expect, it } from 'vitest';

import type { BoardViewDTO, CardGroupDTO, CardViewDTO, CommentViewDTO } from './board-types';
import {
  canAddColumn,
  canCastVote,
  canChangeVote,
  canContribute,
  canControlFacilitation,
  canDeleteColumn,
  canDeleteComment,
  canEditActionItem,
  canEditActionItemFollowUp,
  canEditActionItems,
  canFacilitate,
  canInteractWithCard,
  canInteractWithGroup,
  canManageCard,
  canManageGroup,
  canManageGrouping,
  canMergeCard,
  canRemoveVote,
  canUngroupCard,
  decideColumnDeletion,
  getCardMergeTargets,
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
    it('canFacilitate tracks the Facilitator role regardless of lock state', () => {
      expect(canFacilitate(makeBoard({ isFacilitator: true, isLocked: true }))).toBe(true);
      expect(canFacilitate(makeBoard({ isFacilitator: true, isLocked: false }))).toBe(true);
      expect(canFacilitate(makeBoard({ isFacilitator: false }))).toBe(false);
    });

    it('canControlFacilitation requires an unlocked Facilitator', () => {
      expect(canControlFacilitation(makeBoard({ isFacilitator: true }))).toBe(true);
      expect(canControlFacilitation(makeBoard({ isFacilitator: true, isLocked: true }))).toBe(false);
      expect(canControlFacilitation(makeBoard({ isFacilitator: false }))).toBe(false);
    });

    it('canContribute is exactly the inverse of the Locked gate', () => {
      expect(canContribute(makeBoard({ isLocked: false }))).toBe(true);
      expect(canContribute(makeBoard({ isLocked: true }))).toBe(false);
    });

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
    it('canInteractWithCard needs an unlocked Board and a revealed, confirmed Card', () => {
      expect(canInteractWithCard(makeBoard(), makeCard())).toBe(true);
      expect(canInteractWithCard(makeBoard({ isLocked: true }), makeCard())).toBe(false);
      expect(canInteractWithCard(makeBoard({ isBlurred: true }), makeCard({ redacted: true }))).toBe(false);
      expect(canInteractWithCard(makeBoard({ isBlurred: true }), makeCard({ isMine: false }))).toBe(false);
      expect(canInteractWithCard(makeBoard({ isBlurred: true }), makeCard({ isMine: true }))).toBe(true);
      expect(canInteractWithCard(makeBoard(), makeCard({ pending: true }))).toBe(false);
    });

    it('canInteractWithCard by id resolves the Card and rejects missing or pending rows', () => {
      const board = makeBoard({
        cards: [
          makeCard({ id: 'real-1', isMine: true }),
          makeCard({ id: 'pending-1', isMine: true, pending: true }),
        ],
      });
      expect(canInteractWithCard(board, 'real-1')).toBe(true);
      expect(canInteractWithCard(board, 'missing-1')).toBe(false);
      expect(canInteractWithCard(board, 'pending-1')).toBe(false);
    });

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

    it('canManageCard by id resolves the Card and rejects client-only pending rows', () => {
      const board = makeBoard({
        cards: [
          makeCard({ id: 'real-1', isMine: true }),
          makeCard({ id: 'pending-1', isMine: true, pending: true }),
        ],
      });
      expect(canManageCard(board, 'real-1')).toBe(true);
      expect(canManageCard(board, 'missing-1')).toBe(false);
      expect(canManageCard(board, 'pending-1')).toBe(false);
    });
  });

  describe('grouping gates', () => {
    it('canManageGrouping mirrors the facilitator-or-allowParticipantGroup rule', () => {
      expect(canManageGrouping(makeBoard())).toBe(false);
      expect(canManageGrouping(makeBoard({ allowParticipantGroup: true }))).toBe(true);
      expect(canManageGrouping(makeBoard({ isFacilitator: true }))).toBe(true);
      expect(
        canManageGrouping(makeBoard({ isFacilitator: true, allowParticipantGroup: true, isLocked: true })),
      ).toBe(false);
    });

    it('canManageGroup combines the role gate with whole-Group Private Mode visibility', () => {
      const mine = makeCard({ id: 'mine', isMine: true });
      const foreign = makeCard({ id: 'foreign', isMine: false });
      const mixed = makeGroup({ cardIds: ['mine', 'foreign'], redacted: true });
      const unredactedMixed = makeGroup({ cardIds: ['mine', 'foreign'] });

      expect(canManageGroup(makeBoard({ isFacilitator: true }), makeGroup({ cardIds: ['mine'] }), [mine])).toBe(true);
      expect(canManageGroup(makeBoard({ isFacilitator: true, isBlurred: true }), mixed, [mine, foreign])).toBe(false);
      expect(canManageGroup(makeBoard({ isFacilitator: true, isBlurred: true }), unredactedMixed, [mine, foreign])).toBe(false);
      expect(
        canManageGroup(makeBoard({ isFacilitator: true, isBlurred: true }), makeGroup({ cardIds: ['mine'] }), [mine]),
      ).toBe(true);
      expect(canManageGroup(makeBoard({ allowParticipantGroup: true }), makeGroup({ cardIds: ['mine'] }), [mine])).toBe(true);
      expect(canManageGroup(makeBoard({ isLocked: true, isFacilitator: true }), makeGroup({ cardIds: ['mine'] }), [mine])).toBe(false);
      expect(canManageGroup(makeBoard({ isFacilitator: true }), makeGroup({ redacted: true }), [mine])).toBe(false);
    });

    it('canInteractWithGroup allows Participants to vote on revealed Groups but blocks redacted or mixed Groups in Private Mode', () => {
      const mine = makeCard({ id: 'mine', isMine: true });
      const foreign = makeCard({ id: 'foreign', isMine: false });
      const group = makeGroup({ cardIds: ['mine', 'foreign'] });

      expect(canInteractWithGroup(makeBoard({ isFacilitator: false, allowParticipantGroup: false }), group, [mine, foreign])).toBe(true);
      expect(canInteractWithGroup(makeBoard({ isLocked: true }), group, [mine, foreign])).toBe(false);
      expect(canInteractWithGroup(makeBoard({ isBlurred: true }), group, [mine, foreign])).toBe(false);
      expect(canInteractWithGroup(makeBoard({ isBlurred: true }), makeGroup({ cardIds: ['mine'] }), [mine])).toBe(true);
      expect(canInteractWithGroup(makeBoard(), makeGroup({ cardIds: ['mine'], redacted: true }), [mine])).toBe(false);
    });

    it('canUngroupCard enforces whole-Card-Group Private Mode for both Participants and Facilitators', () => {
      const mine = makeCard({ id: 'mine', groupId: 'group-mixed', isMine: true });
      const foreign = makeCard({ id: 'foreign', groupId: 'group-mixed', isMine: false });
      const mixedGroup = makeGroup({ id: 'group-mixed', cardIds: ['mine', 'foreign'] });

      const ownA = makeCard({ id: 'own-a', groupId: 'group-own', isMine: true });
      const ownB = makeCard({ id: 'own-b', groupId: 'group-own', isMine: true });
      const ownGroup = makeGroup({ id: 'group-own', cardIds: ['own-a', 'own-b'] });

      const standalone = makeCard({ id: 'standalone', groupId: null, isMine: true });
      const pending = makeCard({ id: 'pending', groupId: 'group-own', isMine: true, pending: true });

      const blurredFacilitator = makeBoard({
        isFacilitator: true,
        isBlurred: true,
        groups: [mixedGroup, ownGroup],
        cards: [mine, foreign, ownA, ownB, standalone, pending],
      });

      expect(canUngroupCard(blurredFacilitator, 'mine')).toBe(false);
      expect(canUngroupCard(blurredFacilitator, 'own-a')).toBe(true);
      expect(canUngroupCard(blurredFacilitator, 'standalone')).toBe(false);
      expect(canUngroupCard(blurredFacilitator, 'pending')).toBe(false);

      const blurredParticipant = makeBoard({
        isFacilitator: false,
        allowParticipantGroup: true,
        isBlurred: true,
        groups: [mixedGroup, ownGroup],
        cards: [mine, foreign, ownA, ownB],
      });
      expect(canUngroupCard(blurredParticipant, 'mine')).toBe(false);
      expect(canUngroupCard(blurredParticipant, 'own-a')).toBe(true);

      // Outside Private Mode, ungrouping from a mixed Group is allowed for Facilitators and permitted Participants.
      const revealedBoard = makeBoard({
        isFacilitator: false,
        allowParticipantGroup: true,
        isBlurred: false,
        groups: [mixedGroup],
        cards: [mine, foreign],
      });
      expect(canUngroupCard(revealedBoard, 'mine')).toBe(true);
    });

    it('getCardMergeTargets and canMergeCard exclude redacted and mixed Card Groups during Private Mode', () => {
      const myLoose = makeCard({ id: 'my-loose', columnId: 'col-1', isMine: true });
      const myOther = makeCard({ id: 'my-other', columnId: 'col-1', isMine: true });
      const pendingOther = makeCard({ id: 'pending-other', columnId: 'col-1', isMine: true, pending: true });
      const foreignHidden = makeCard({ id: 'foreign-hidden', columnId: 'col-1', isMine: false, redacted: true });

      const ownGroupCard = makeCard({ id: 'own-g-1', columnId: 'col-1', groupId: 'g-own', isMine: true });
      const ownGroup = makeGroup({ id: 'g-own', columnId: 'col-1', cardIds: ['own-g-1'] });

      const redactedGroupCard = makeCard({ id: 'red-g-1', columnId: 'col-1', groupId: 'g-red', isMine: false, redacted: true });
      const redactedGroup = makeGroup({ id: 'g-red', columnId: 'col-1', cardIds: ['red-g-1'], redacted: true });

      const mixedGroupForeign = makeCard({ id: 'mix-g-2', columnId: 'col-1', groupId: 'g-mix', isMine: false });
      const mixedGroupMine = makeCard({ id: 'mix-g-1', columnId: 'col-1', groupId: 'g-mix', isMine: true });
      const mixedGroup = makeGroup({ id: 'g-mix', columnId: 'col-1', cardIds: ['mix-g-1', 'mix-g-2'] });

      const cards = [
        myLoose,
        myOther,
        pendingOther,
        foreignHidden,
        ownGroupCard,
        redactedGroupCard,
        mixedGroupMine,
        mixedGroupForeign,
      ];
      const groups = [ownGroup, redactedGroup, mixedGroup];
      const blurredBoard = makeBoard({
        isFacilitator: true,
        isBlurred: true,
        cards,
        groups,
      });

      const targets = getCardMergeTargets(blurredBoard, myLoose, cards, groups);
      expect(targets.cards.map((c) => c.id)).toEqual(['my-other']);
      expect(targets.groups.map((g) => g.id)).toEqual(['g-own']);

      expect(canMergeCard(blurredBoard, 'my-loose', 'group', 'g-own')).toBe(true);
      expect(canMergeCard(blurredBoard, 'my-loose', 'group', 'g-red')).toBe(false);
      expect(canMergeCard(blurredBoard, 'my-loose', 'group', 'g-mix')).toBe(false);
      expect(canMergeCard(blurredBoard, 'my-loose', 'card', 'pending-other')).toBe(false);
    });
  });

  describe('action item gates', () => {
    it('canEditActionItems follows the Locked carve-out for Facilitators', () => {
      expect(canEditActionItems(makeBoard())).toBe(true);
      expect(canEditActionItems(makeBoard({ isLocked: true }))).toBe(false);
      expect(canEditActionItems(makeBoard({ isLocked: true, isFacilitator: true }))).toBe(true);
    });

    it('canEditActionItemFollowUp applies to existing revealed Action Items and respects Private Mode', () => {
      const actionItem = makeCard({ isActionItem: true, isMine: true });
      const foreignActionItem = makeCard({ isActionItem: true, isMine: false });
      expect(canEditActionItemFollowUp(makeBoard(), actionItem)).toBe(true);
      expect(canEditActionItemFollowUp(makeBoard(), makeCard())).toBe(false);
      expect(canEditActionItemFollowUp(makeBoard(), makeCard({ isActionItem: true, pending: true }))).toBe(false);
      expect(canEditActionItemFollowUp(makeBoard({ isLocked: true }), actionItem)).toBe(false);
      expect(
        canEditActionItemFollowUp(makeBoard({ isLocked: true, isFacilitator: true }), actionItem),
      ).toBe(true);
      expect(
        canEditActionItemFollowUp(
          makeBoard({ isLocked: true, isFacilitator: true, isBlurred: true }),
          foreignActionItem,
        ),
      ).toBe(false);
      expect(
        canEditActionItemFollowUp(
          makeBoard({ isLocked: true, isFacilitator: true, isBlurred: true }),
          actionItem,
        ),
      ).toBe(true);
    });

    it('canEditActionItem enforces the Locked Action Item carve-out and Private Mode', () => {
      const actionItem = makeCard({ isActionItem: true, isMine: true });
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
      expect(
        canEditActionItem(
          makeBoard({ isLocked: true, isFacilitator: true, isBlurred: true }),
          makeCard({ isActionItem: true, isMine: false }),
          { actionDone: true },
        ),
      ).toBe(false);
    });

    it('canEditActionItem never touches redacted or pending Cards', () => {
      expect(
        canEditActionItem(makeBoard(), makeCard({ redacted: true, isActionItem: true }), { actionDone: true }),
      ).toBe(false);
      expect(
        canEditActionItem(makeBoard(), makeCard({ pending: true, isActionItem: true }), { actionDone: true }),
      ).toBe(false);
    });
  });

  describe('comment gates', () => {
    it('canDeleteComment preserves intentional Private Mode moderation conservatism and parent Card checks', () => {
      const myCard = makeCard({ id: 'card-1', isMine: true });
      const pendingCard = makeCard({ id: 'card-pending', isMine: true, pending: true });

      expect(canDeleteComment(makeBoard(), makeComment({ isMine: true }))).toBe(true);
      expect(canDeleteComment(makeBoard(), makeComment({ isMine: false }))).toBe(false);
      expect(
        canDeleteComment(makeBoard({ isFacilitator: true }), makeComment({ isMine: false })),
      ).toBe(true);
      expect(
        canDeleteComment(makeBoard({ isFacilitator: true, isBlurred: true }), makeComment({ isMine: false }), myCard),
      ).toBe(false);
      expect(
        canDeleteComment(makeBoard({ isFacilitator: true, isBlurred: true }), makeComment({ isMine: true }), myCard),
      ).toBe(true);
      expect(
        canDeleteComment(makeBoard({ isLocked: true }), makeComment({ isMine: true }), myCard),
      ).toBe(false);
      expect(
        canDeleteComment(makeBoard(), makeComment({ isMine: true }), pendingCard),
      ).toBe(false);
    });
  });

  describe('vote gates', () => {
    it('canCastVote and canRemoveVote mirror Vote caps, balance, and zero-Vote floor', () => {
      const unlimited = { remainingVotes: null, maxVotesPerCard: null };
      expect(canCastVote(unlimited, 0)).toBe(true);
      expect(canCastVote({ remainingVotes: 1, maxVotesPerCard: null }, 0)).toBe(true);
      expect(canCastVote({ remainingVotes: 0, maxVotesPerCard: null }, 0)).toBe(false);
      expect(canCastVote({ remainingVotes: 3, maxVotesPerCard: 1 }, 0)).toBe(true);
      expect(canCastVote({ remainingVotes: 3, maxVotesPerCard: 1 }, 1)).toBe(false);

      expect(canRemoveVote(0)).toBe(false);
      expect(canRemoveVote(1)).toBe(true);
    });

    it('canCastVote ignores Blind Voting totals hiding', () => {
      const blindBoardVoting = { remainingVotes: 2, maxVotesPerCard: null };
      expect(canCastVote(blindBoardVoting, 0)).toBe(true);
    });

    it('canChangeVote enforces lock, pending, grouped-Card routing, Private Mode, caps, and balance', () => {
      const standalone = makeCard({ id: 'c1', myVotes: 1 });
      const grouped = makeCard({ id: 'c2', groupId: 'g1', myVotes: 0 });
      const pending = makeCard({ id: 'c3', pending: true, myVotes: 0 });
      const group = makeGroup({ id: 'g1', cardIds: ['c2'], myVotes: 1 });

      const board = makeBoard({
        remainingVotes: 1,
        maxVotesPerCard: 1,
        cards: [standalone, grouped, pending],
        groups: [group],
      });

      expect(canChangeVote(board, 'card', 'c1', 1)).toBe(false); // per-card cap reached
      expect(canChangeVote(board, 'card', 'c1', -1)).toBe(true);
      expect(canChangeVote(board, 'card', 'c2', 1)).toBe(false); // card is in a group
      expect(canChangeVote(board, 'card', 'c3', 1)).toBe(false); // card is pending
      expect(canChangeVote(board, 'group', 'g1', -1)).toBe(true);
      expect(canChangeVote({ ...board, maxVotesPerCard: null, remainingVotes: 0 }, 'group', 'g1', 1)).toBe(false);
      expect(canChangeVote({ ...board, isBlurred: true, cards: [makeCard({ id: 'c2', groupId: 'g1', isMine: false })] }, 'group', 'g1', -1)).toBe(false);
    });
  });

  describe('column gates', () => {
    it('canDeleteColumn and decideColumnDeletion report last-column and hidden-cards denials', () => {
      const revealed = [makeCard()];
      const hidden = [makeCard({ redacted: true })];
      const foreign = [makeCard({ isMine: false })];

      expect(canDeleteColumn(makeBoard({ isFacilitator: true }), 2, revealed)).toBe(true);
      expect(canDeleteColumn(makeBoard({ isFacilitator: true }), 1, revealed)).toBe(false);
      expect(canDeleteColumn(makeBoard({ isFacilitator: true, isLocked: true }), 2, revealed)).toBe(false);
      expect(canDeleteColumn(makeBoard({ isFacilitator: true }), 2, hidden)).toBe(false);
      expect(canDeleteColumn(makeBoard({ isFacilitator: true, isBlurred: true }), 2, foreign)).toBe(false);
      expect(canDeleteColumn(makeBoard(), 2, revealed)).toBe(false);

      expect(decideColumnDeletion(makeBoard({ isFacilitator: true }), 1, hidden)).toEqual({
        allowed: false,
        reason: 'last-column',
      });
      expect(decideColumnDeletion(makeBoard({ isFacilitator: true }), 2, hidden)).toEqual({
        allowed: false,
        reason: 'column-has-hidden-cards',
      });
    });
  });
});
