import { describe, expect, it, vi } from 'vitest';

import {
  decideActionItemAction,
  decideBoardAction,
  decideCardAction,
  decideColumnAction,
  decideCommentDelete,
  decideGroupAction,
  decideVoteChange,
  type BoardPolicyAction,
  type BoardPolicyContext,
  type BoardPolicyDecision,
  type CardPolicyAction,
  type CardPolicyFacts,
  type ColumnPolicyAction,
  type CommentDeleteMode,
  type GroupPolicyAction,
  type MergeCardFacts,
  type MergeGroupFacts,
  type VoteDelta,
  type VoteLimitFacts,
  type VoteTargetFacts,
} from './board-policy';
import type { ActionItemPatch } from './board-types';

const ALLOW: BoardPolicyDecision = { allowed: true };
const deny = (reason: Extract<BoardPolicyDecision, { allowed: false }>['reason']): BoardPolicyDecision => ({
  allowed: false,
  reason,
});

describe('board-policy', () => {
  describe('Board and Facilitation decisions', () => {
    const cases: readonly {
      action: BoardPolicyAction;
      isFacilitator: boolean;
      isLocked: boolean;
      expected: BoardPolicyDecision;
    }[] = [
      // Unlocked contribution (e.g., card:create)
      { action: 'board:contribute', isFacilitator: false, isLocked: false, expected: ALLOW },
      { action: 'board:contribute', isFacilitator: true, isLocked: false, expected: ALLOW },
      { action: 'board:contribute', isFacilitator: false, isLocked: true, expected: deny('board-locked') },
      { action: 'board:contribute', isFacilitator: true, isLocked: true, expected: deny('board-locked') },

      // Standard unlocked Facilitator-only controls (Locked precedes role check)
      ...(
        [
          'board:rename',
          'timer:update',
          'board:set-private-mode',
          'voting:configure',
          'voting:reset',
        ] as const
      ).flatMap((action) => [
        { action, isFacilitator: false, isLocked: false, expected: deny('facilitator-required') },
        { action, isFacilitator: true, isLocked: false, expected: ALLOW },
        { action, isFacilitator: false, isLocked: true, expected: deny('board-locked') },
        { action, isFacilitator: true, isLocked: true, expected: deny('board-locked') },
      ]),

      // Locked Facilitator exceptions where non-Facilitator while Locked yields BOARD_LOCKED
      ...(['board:set-lock', 'board:delete'] as const).flatMap((action) => [
        { action, isFacilitator: false, isLocked: false, expected: deny('facilitator-required') },
        { action, isFacilitator: true, isLocked: false, expected: ALLOW },
        { action, isFacilitator: false, isLocked: true, expected: deny('board-locked') },
        { action, isFacilitator: true, isLocked: true, expected: ALLOW },
      ]),

      // Co-Facilitator Link view/rotate: non-Facilitator yields FORBIDDEN even while Locked
      ...(['facilitator:view-link', 'facilitator:rotate'] as const).flatMap((action) => [
        { action, isFacilitator: false, isLocked: false, expected: deny('facilitator-required') },
        { action, isFacilitator: true, isLocked: false, expected: ALLOW },
        { action, isFacilitator: false, isLocked: true, expected: deny('facilitator-required') },
        { action, isFacilitator: true, isLocked: true, expected: ALLOW },
      ]),

      // Board-level Action Item follow-up gate: anyone when unlocked, Facilitator only when Locked
      { action: 'action-item:follow-up', isFacilitator: false, isLocked: false, expected: ALLOW },
      { action: 'action-item:follow-up', isFacilitator: true, isLocked: false, expected: ALLOW },
      { action: 'action-item:follow-up', isFacilitator: false, isLocked: true, expected: deny('board-locked') },
      { action: 'action-item:follow-up', isFacilitator: true, isLocked: true, expected: ALLOW },
    ];

    it.each(cases)(
      '$action (facilitator=$isFacilitator, locked=$isLocked) -> $expected',
      ({ action, isFacilitator, isLocked, expected }) => {
        expect(decideBoardAction({ isFacilitator, isLocked }, action)).toEqual(expected);
      },
    );
  });

  describe('Column decisions', () => {
    const columnAddCases: readonly {
      isFacilitator: boolean;
      isLocked: boolean;
      isPrivateMode: boolean;
      columnCount: number;
      expected: BoardPolicyDecision;
    }[] = [
      // Unlocked Facilitator within cap (MAX_COLUMNS_PER_BOARD = 10)
      { isFacilitator: true, isLocked: false, isPrivateMode: false, columnCount: 1, expected: ALLOW },
      { isFacilitator: true, isLocked: false, isPrivateMode: true, columnCount: 9, expected: ALLOW },
      // At or above cap
      { isFacilitator: true, isLocked: false, isPrivateMode: false, columnCount: 10, expected: deny('column-limit-reached') },
      { isFacilitator: true, isLocked: false, isPrivateMode: false, columnCount: 11, expected: deny('column-limit-reached') },
      // Precedence: board-locked > facilitator-required > column-limit-reached
      { isFacilitator: false, isLocked: false, isPrivateMode: false, columnCount: 10, expected: deny('facilitator-required') },
      { isFacilitator: false, isLocked: true, isPrivateMode: false, columnCount: 10, expected: deny('board-locked') },
      { isFacilitator: true, isLocked: true, isPrivateMode: false, columnCount: 10, expected: deny('board-locked') },
      { isFacilitator: true, isLocked: true, isPrivateMode: false, columnCount: 3, expected: deny('board-locked') },
    ];

    it.each(columnAddCases)(
      'column:add (facilitator=$isFacilitator, locked=$isLocked, private=$isPrivateMode, count=$columnCount) -> $expected',
      ({ isFacilitator, isLocked, isPrivateMode, columnCount, expected }) => {
        expect(
          decideColumnAction({ isFacilitator, isLocked, isPrivateMode }, { type: 'column:add', columnCount }),
        ).toEqual(expected);
      },
    );

    const columnUpdateReorderCases: readonly {
      action: Extract<ColumnPolicyAction, { type: 'column:update' | 'column:reorder' }>;
      isFacilitator: boolean;
      isLocked: boolean;
      isPrivateMode: boolean;
      expected: BoardPolicyDecision;
    }[] = (['column:update', 'column:reorder'] as const).flatMap((type) => [
      { action: { type }, isFacilitator: true, isLocked: false, isPrivateMode: false, expected: ALLOW },
      { action: { type }, isFacilitator: true, isLocked: false, isPrivateMode: true, expected: ALLOW },
      { action: { type }, isFacilitator: false, isLocked: false, isPrivateMode: false, expected: deny('facilitator-required') },
      { action: { type }, isFacilitator: false, isLocked: true, isPrivateMode: false, expected: deny('board-locked') },
      { action: { type }, isFacilitator: true, isLocked: true, isPrivateMode: false, expected: deny('board-locked') },
    ]);

    it.each(columnUpdateReorderCases)(
      '$action.type (facilitator=$isFacilitator, locked=$isLocked, private=$isPrivateMode) -> $expected',
      ({ action, isFacilitator, isLocked, isPrivateMode, expected }) => {
        expect(decideColumnAction({ isFacilitator, isLocked, isPrivateMode }, action)).toEqual(expected);
      },
    );

    const columnDeleteCases: readonly {
      isFacilitator: boolean;
      isLocked: boolean;
      isPrivateMode: boolean;
      columnCount: number;
      hasOtherParticipantCards?: boolean;
      hasRedactedCards?: boolean;
      expected: BoardPolicyDecision;
    }[] = [
      // Unlocked Facilitator with >1 Column
      { isFacilitator: true, isLocked: false, isPrivateMode: false, columnCount: 2, hasOtherParticipantCards: false, expected: ALLOW },
      { isFacilitator: true, isLocked: false, isPrivateMode: false, columnCount: 2, hasOtherParticipantCards: true, expected: ALLOW },
      { isFacilitator: true, isLocked: false, isPrivateMode: true, columnCount: 2, hasOtherParticipantCards: false, expected: ALLOW },
      { isFacilitator: true, isLocked: false, isPrivateMode: true, columnCount: 2, hasOtherParticipantCards: true, expected: deny('column-has-hidden-cards') },
      // Client-projected redacted fallback blocks even if isPrivateMode was omitted/false in a fixture
      { isFacilitator: true, isLocked: false, isPrivateMode: false, columnCount: 2, hasRedactedCards: true, expected: deny('column-has-hidden-cards') },
      // Minimum floor (1 Column) takes precedence over hidden Cards
      { isFacilitator: true, isLocked: false, isPrivateMode: false, columnCount: 1, hasOtherParticipantCards: false, expected: deny('last-column') },
      { isFacilitator: true, isLocked: false, isPrivateMode: true, columnCount: 1, hasOtherParticipantCards: true, expected: deny('last-column') },
      { isFacilitator: true, isLocked: false, isPrivateMode: false, columnCount: 0, hasRedactedCards: true, expected: deny('last-column') },
      // Precedence: board-locked > facilitator-required > last-column > column-has-hidden-cards
      { isFacilitator: false, isLocked: false, isPrivateMode: true, columnCount: 1, hasOtherParticipantCards: true, expected: deny('facilitator-required') },
      { isFacilitator: false, isLocked: true, isPrivateMode: true, columnCount: 1, hasOtherParticipantCards: true, expected: deny('board-locked') },
      { isFacilitator: true, isLocked: true, isPrivateMode: true, columnCount: 1, hasOtherParticipantCards: true, expected: deny('board-locked') },
    ];

    it.each(columnDeleteCases)(
      'column:delete (facilitator=$isFacilitator, locked=$isLocked, private=$isPrivateMode, count=$columnCount, other=$hasOtherParticipantCards, redacted=$hasRedactedCards) -> $expected',
      ({ isFacilitator, isLocked, isPrivateMode, columnCount, hasOtherParticipantCards, hasRedactedCards, expected }) => {
        expect(
          decideColumnAction(
            { isFacilitator, isLocked, isPrivateMode },
            { type: 'column:delete', columnCount, hasOtherParticipantCards, hasRedactedCards },
          ),
        ).toEqual(expected);
      },
    );
  });

  describe('Card decisions', () => {
    const interactCases: readonly {
      isFacilitator: boolean;
      isLocked: boolean;
      isPrivateMode: boolean;
      isMine: boolean;
      isRedacted?: boolean;
      isPending?: boolean;
      expected: BoardPolicyDecision;
    }[] = [
      // Unlocked, not pending
      { isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: true, expected: ALLOW },
      { isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: false, expected: ALLOW },
      { isFacilitator: true, isLocked: false, isPrivateMode: false, isMine: false, expected: ALLOW },
      // Private Mode restricts non-author Cards even for Facilitators
      { isFacilitator: false, isLocked: false, isPrivateMode: true, isMine: true, expected: ALLOW },
      { isFacilitator: true, isLocked: false, isPrivateMode: true, isMine: true, expected: ALLOW },
      { isFacilitator: false, isLocked: false, isPrivateMode: true, isMine: false, expected: deny('private-mode-restricted') },
      { isFacilitator: true, isLocked: false, isPrivateMode: true, isMine: false, expected: deny('private-mode-restricted') },
      // Client-projected redaction blocks even if isPrivateMode is false
      { isFacilitator: true, isLocked: false, isPrivateMode: false, isMine: true, isRedacted: true, expected: deny('private-mode-restricted') },
      // Optimistic pending Card blocks interaction (precedes Private Mode)
      { isFacilitator: true, isLocked: false, isPrivateMode: true, isMine: false, isPending: true, expected: deny('card-pending') },
      { isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: true, isPending: true, expected: deny('card-pending') },
      // Locked Board precedes pending and Private Mode
      { isFacilitator: true, isLocked: true, isPrivateMode: true, isMine: false, isPending: true, expected: deny('board-locked') },
      { isFacilitator: false, isLocked: true, isPrivateMode: false, isMine: true, expected: deny('board-locked') },
    ];

    it.each(interactCases)(
      'card:interact (facilitator=$isFacilitator, locked=$isLocked, private=$isPrivateMode, mine=$isMine, redacted=$isRedacted, pending=$isPending) -> $expected',
      ({ isFacilitator, isLocked, isPrivateMode, isMine, isRedacted, isPending, expected }) => {
        expect(
          decideCardAction(
            { isFacilitator, isLocked, isPrivateMode },
            'card:interact',
            { isMine, isRedacted, isPending },
          ),
        ).toEqual(expected);
      },
    );

    const manageCases: readonly {
      action: Exclude<CardPolicyAction, 'card:interact'>;
      isFacilitator: boolean;
      isLocked: boolean;
      isPrivateMode: boolean;
      isMine: boolean;
      isRedacted?: boolean;
      isPending?: boolean;
      expected: BoardPolicyDecision;
    }[] = (['card:update', 'card:move', 'card:delete'] as const).flatMap((action) => [
      // Own Card unlocked
      { action, isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: true, expected: ALLOW },
      { action, isFacilitator: false, isLocked: false, isPrivateMode: true, isMine: true, expected: ALLOW },
      { action, isFacilitator: true, isLocked: false, isPrivateMode: true, isMine: true, expected: ALLOW },
      // Other Participant's Card outside Private Mode
      { action, isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: false, expected: deny('not-card-author') },
      { action, isFacilitator: true, isLocked: false, isPrivateMode: false, isMine: false, expected: ALLOW },
      // Other Participant's Card during Private Mode: Private Mode precedes authorship and blocks Facilitators
      { action, isFacilitator: false, isLocked: false, isPrivateMode: true, isMine: false, expected: deny('private-mode-restricted') },
      { action, isFacilitator: true, isLocked: false, isPrivateMode: true, isMine: false, expected: deny('private-mode-restricted') },
      // Redacted fallback and pending optimistic Card
      { action, isFacilitator: true, isLocked: false, isPrivateMode: false, isMine: true, isRedacted: true, expected: deny('private-mode-restricted') },
      { action, isFacilitator: true, isLocked: false, isPrivateMode: false, isMine: true, isPending: true, expected: deny('card-pending') },
      // Locked precedes everything
      { action, isFacilitator: true, isLocked: true, isPrivateMode: true, isMine: false, isPending: true, expected: deny('board-locked') },
    ]);

    it.each(manageCases)(
      '$action (facilitator=$isFacilitator, locked=$isLocked, private=$isPrivateMode, mine=$isMine, redacted=$isRedacted, pending=$isPending) -> $expected',
      ({ action, isFacilitator, isLocked, isPrivateMode, isMine, isRedacted, isPending, expected }) => {
        expect(
          decideCardAction(
            { isFacilitator, isLocked, isPrivateMode },
            action,
            { isMine, isRedacted, isPending },
          ),
        ).toEqual(expected);
      },
    );
  });

  describe('Action Item decisions', () => {
    const cases: readonly {
      label: string;
      isFacilitator: boolean;
      isLocked: boolean;
      isPrivateMode: boolean;
      isMine: boolean;
      isActionItem: boolean;
      isRedacted?: boolean;
      isPending?: boolean;
      patch: ActionItemPatch;
      expected: BoardPolicyDecision;
    }[] = [
      // Unlocked: Participant or Facilitator may flag/unflag or update follow-up on revealed Cards
      {
        label: 'unlocked Participant flags another revealed Card',
        isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: false, isActionItem: false,
        patch: { isActionItem: true }, expected: ALLOW,
      },
      {
        label: 'unlocked Participant flags and sets owner in one patch',
        isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: false, isActionItem: false,
        patch: { isActionItem: true, actionOwner: 'Sam' }, expected: ALLOW,
      },
      {
        label: 'unlocked Participant unflags an existing Action Item',
        isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: false, isActionItem: true,
        patch: { isActionItem: false }, expected: ALLOW,
      },
      {
        label: 'unlocked Participant toggles actionDone on existing Action Item',
        isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: false, isActionItem: true,
        patch: { actionDone: true }, expected: ALLOW,
      },
      {
        label: 'unlocked Participant cannot set actionDone on a non-Action Item without flagging',
        isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: true, isActionItem: false,
        patch: { actionDone: true }, expected: deny('not-action-item'),
      },
      {
        label: 'unlocked Participant cannot set actionOwner while unflagging',
        isFacilitator: false, isLocked: false, isPrivateMode: false, isMine: true, isActionItem: true,
        patch: { isActionItem: false, actionOwner: 'Sam' }, expected: deny('not-action-item'),
      },

      // Unlocked + Private Mode: blocks non-author Cards even for Facilitators
      {
        label: 'unlocked Private Mode allows flagging own Card',
        isFacilitator: false, isLocked: false, isPrivateMode: true, isMine: true, isActionItem: false,
        patch: { isActionItem: true }, expected: ALLOW,
      },
      {
        label: 'unlocked Private Mode blocks Participant on hidden Card',
        isFacilitator: false, isLocked: false, isPrivateMode: true, isMine: false, isActionItem: true,
        patch: { actionDone: true }, expected: deny('private-mode-restricted'),
      },
      {
        label: 'unlocked Private Mode blocks Facilitator on hidden Card',
        isFacilitator: true, isLocked: false, isPrivateMode: true, isMine: false, isActionItem: true,
        patch: { actionDone: true }, expected: deny('private-mode-restricted'),
      },
      {
        label: 'redacted fallback blocks Action Item changes',
        isFacilitator: true, isLocked: false, isPrivateMode: false, isMine: true, isActionItem: true, isRedacted: true,
        patch: { actionDone: true }, expected: deny('private-mode-restricted'),
      },
      {
        label: 'pending optimistic Card blocks Action Item changes',
        isFacilitator: true, isLocked: false, isPrivateMode: false, isMine: true, isActionItem: true, isPending: true,
        patch: { actionDone: true }, expected: deny('card-pending'),
      },

      // Locked Board exceptions and precedence
      {
        label: 'Locked Participant blocked from follow-up even on own Action Item',
        isFacilitator: false, isLocked: true, isPrivateMode: false, isMine: true, isActionItem: true,
        patch: { actionDone: true }, expected: deny('board-locked'),
      },
      {
        label: 'Locked Participant on hidden Card still yields board-locked (global Locked gate precedes Private Mode)',
        isFacilitator: false, isLocked: true, isPrivateMode: true, isMine: false, isActionItem: true,
        patch: { actionDone: true }, expected: deny('board-locked'),
      },
      {
        label: 'Locked Facilitator may toggle actionDone on revealed existing Action Item',
        isFacilitator: true, isLocked: true, isPrivateMode: false, isMine: false, isActionItem: true,
        patch: { actionDone: true }, expected: ALLOW,
      },
      {
        label: 'Locked Facilitator may edit actionOwner on revealed existing Action Item',
        isFacilitator: true, isLocked: true, isPrivateMode: false, isMine: false, isActionItem: true,
        patch: { actionOwner: 'Alex' }, expected: ALLOW,
      },
      {
        label: 'Locked Facilitator cannot unflag existing Action Item',
        isFacilitator: true, isLocked: true, isPrivateMode: false, isMine: true, isActionItem: true,
        patch: { isActionItem: false }, expected: deny('board-locked'),
      },
      {
        label: 'Locked Facilitator cannot pass isActionItem=true while Locked even on existing Action Item',
        isFacilitator: true, isLocked: true, isPrivateMode: false, isMine: true, isActionItem: true,
        patch: { isActionItem: true, actionDone: true }, expected: deny('board-locked'),
      },
      {
        label: 'Locked Facilitator passing isActionItem on hidden Card yields board-locked (global Locked gate)',
        isFacilitator: true, isLocked: true, isPrivateMode: true, isMine: false, isActionItem: true,
        patch: { isActionItem: false }, expected: deny('board-locked'),
      },
      {
        label: 'Locked Facilitator follow-up on non-Action Item yields board-locked',
        isFacilitator: true, isLocked: true, isPrivateMode: false, isMine: true, isActionItem: false,
        patch: { actionDone: true }, expected: deny('board-locked'),
      },
      // Locked + Private Mode Facilitator follow-up: Private Mode still protects non-author Cards!
      {
        label: 'Locked + Private Mode Facilitator may follow up on own existing Action Item',
        isFacilitator: true, isLocked: true, isPrivateMode: true, isMine: true, isActionItem: true,
        patch: { actionDone: true, actionOwner: 'Alex' }, expected: ALLOW,
      },
      {
        label: 'Locked + Private Mode Facilitator blocked on another Participant Action Item (private-mode-restricted)',
        isFacilitator: true, isLocked: true, isPrivateMode: true, isMine: false, isActionItem: true,
        patch: { actionDone: true }, expected: deny('private-mode-restricted'),
      },
      {
        label: 'Locked + Private Mode Facilitator follow-up on hidden non-Action Item checks Private Mode before isActionItem',
        isFacilitator: true, isLocked: true, isPrivateMode: true, isMine: false, isActionItem: false,
        patch: { actionDone: true }, expected: deny('private-mode-restricted'),
      },
      {
        label: 'Locked Facilitator follow-up on pending optimistic Action Item blocked with card-pending',
        isFacilitator: true, isLocked: true, isPrivateMode: false, isMine: true, isActionItem: true, isPending: true,
        patch: { actionDone: true }, expected: deny('card-pending'),
      },
    ];

    it.each(cases)('$label -> $expected', ({
      isFacilitator,
      isLocked,
      isPrivateMode,
      isMine,
      isActionItem,
      isRedacted,
      isPending,
      patch,
      expected,
    }) => {
      expect(
        decideActionItemAction(
          { isFacilitator, isLocked, isPrivateMode },
          { isMine, isActionItem, isRedacted, isPending },
          patch,
        ),
      ).toEqual(expected);
    });
  });

  describe('Card Group decisions', () => {
    const makeBoard = (overrides: Partial<BoardPolicyContext> = {}): BoardPolicyContext => ({
      isFacilitator: false,
      isLocked: false,
      isPrivateMode: false,
      allowParticipantGroup: false,
      ...overrides,
    });

    const accessCases: readonly {
      isFacilitator: boolean;
      allowParticipantGroup: boolean;
      isLocked: boolean;
      expected: BoardPolicyDecision;
    }[] = [
      { isFacilitator: false, allowParticipantGroup: false, isLocked: false, expected: deny('grouping-restricted') },
      { isFacilitator: false, allowParticipantGroup: true, isLocked: false, expected: ALLOW },
      { isFacilitator: true, allowParticipantGroup: false, isLocked: false, expected: ALLOW },
      { isFacilitator: true, allowParticipantGroup: true, isLocked: false, expected: ALLOW },
      { isFacilitator: false, allowParticipantGroup: false, isLocked: true, expected: deny('board-locked') },
      { isFacilitator: false, allowParticipantGroup: true, isLocked: true, expected: deny('board-locked') },
      { isFacilitator: true, allowParticipantGroup: true, isLocked: true, expected: deny('board-locked') },
    ];

    it.each(accessCases)(
      'group:manage-access (facilitator=$isFacilitator, allowParticipantGroup=$allowParticipantGroup, locked=$isLocked) -> $expected',
      ({ isFacilitator, allowParticipantGroup, isLocked, expected }) => {
        expect(
          decideGroupAction(
            makeBoard({ isFacilitator, allowParticipantGroup, isLocked }),
            { type: 'group:manage-access' },
          ),
        ).toEqual(expected);
      },
    );

    const groupManageCases: readonly {
      type: 'group:rename' | 'group:move' | 'group:dissolve';
      board: BoardPolicyContext;
      allCardsAreMine: boolean;
      isRedacted?: boolean;
      expected: BoardPolicyDecision;
    }[] = (['group:rename', 'group:move', 'group:dissolve'] as const).flatMap((type) => [
      { type, board: makeBoard({ isFacilitator: true }), allCardsAreMine: false, expected: ALLOW },
      { type, board: makeBoard({ allowParticipantGroup: true }), allCardsAreMine: false, expected: ALLOW },
      { type, board: makeBoard(), allCardsAreMine: true, expected: deny('grouping-restricted') },
      // Private Mode blocks mixed-authorship Card Groups even for Facilitators
      { type, board: makeBoard({ isFacilitator: true, isPrivateMode: true }), allCardsAreMine: true, expected: ALLOW },
      { type, board: makeBoard({ isFacilitator: true, isPrivateMode: true }), allCardsAreMine: false, expected: deny('private-mode-restricted') },
      { type, board: makeBoard({ allowParticipantGroup: true, isPrivateMode: true }), allCardsAreMine: true, expected: ALLOW },
      { type, board: makeBoard({ allowParticipantGroup: true, isPrivateMode: true }), allCardsAreMine: false, expected: deny('private-mode-restricted') },
      // Redacted Card Group fallback
      { type, board: makeBoard({ isFacilitator: true }), allCardsAreMine: true, isRedacted: true, expected: deny('private-mode-restricted') },
      // Precedence: board-locked > grouping-restricted > private-mode-restricted
      { type, board: makeBoard({ isPrivateMode: true }), allCardsAreMine: false, expected: deny('grouping-restricted') },
      { type, board: makeBoard({ isLocked: true, isPrivateMode: true }), allCardsAreMine: false, expected: deny('board-locked') },
    ]);

    it.each(groupManageCases)(
      '$type (facilitator=$board.isFacilitator, allowPart=$board.allowParticipantGroup, locked=$board.isLocked, private=$board.isPrivateMode, allMine=$allCardsAreMine, redacted=$isRedacted) -> $expected',
      ({ type, board, allCardsAreMine, isRedacted, expected }) => {
        expect(
          decideGroupAction(board, { type, group: { allCardsAreMine, isRedacted } }),
        ).toEqual(expected);
      },
    );

    const ungroupCases: readonly {
      label: string;
      board: BoardPolicyContext;
      action: Extract<GroupPolicyAction, { type: 'group:ungroup' }>;
      expected: BoardPolicyDecision;
    }[] = [
      {
        label: 'unlocked Facilitator ungroups any Card outside Private Mode',
        board: makeBoard({ isFacilitator: true }),
        action: { type: 'group:ungroup', card: { isMine: false }, group: { allCardsAreMine: false } },
        expected: ALLOW,
      },
      {
        label: 'unlocked Participant with allowParticipantGroup ungroups outside Private Mode',
        board: makeBoard({ allowParticipantGroup: true }),
        action: { type: 'group:ungroup', card: { isMine: false }, group: { allCardsAreMine: false } },
        expected: ALLOW,
      },
      {
        label: 'unlocked Participant without allowParticipantGroup is denied',
        board: makeBoard({ allowParticipantGroup: false }),
        action: { type: 'group:ungroup', card: { isMine: true }, group: { allCardsAreMine: true } },
        expected: deny('grouping-restricted'),
      },
      {
        label: 'Private Mode: ungrouping own Card from an all-mine Card Group is allowed for Facilitator',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: { type: 'group:ungroup', card: { isMine: true }, group: { allCardsAreMine: true } },
        expected: ALLOW,
      },
      {
        label: 'Private Mode: ungrouping own Card from an all-mine Card Group is allowed for Participant with allowParticipantGroup',
        board: makeBoard({ allowParticipantGroup: true, isPrivateMode: true }),
        action: { type: 'group:ungroup', card: { isMine: true }, group: { allCardsAreMine: true } },
        expected: ALLOW,
      },
      {
        label: 'Private Mode unified whole-Group rule: Participant cannot ungroup own Card from mixed-authorship Card Group',
        board: makeBoard({ allowParticipantGroup: true, isPrivateMode: true }),
        action: { type: 'group:ungroup', card: { isMine: true }, group: { allCardsAreMine: false } },
        expected: deny('private-mode-restricted'),
      },
      {
        label: 'Private Mode unified whole-Group rule: Facilitator cannot ungroup own Card from mixed-authorship Card Group',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: { type: 'group:ungroup', card: { isMine: true }, group: { allCardsAreMine: false } },
        expected: deny('private-mode-restricted'),
      },
      {
        label: 'Private Mode: redacted Card Group blocks ungrouping even when card.isMine is true',
        board: makeBoard({ isFacilitator: true }),
        action: { type: 'group:ungroup', card: { isMine: true }, group: { allCardsAreMine: true, isRedacted: true } },
        expected: deny('private-mode-restricted'),
      },
      {
        label: 'Private Mode: hidden standalone Card fails with private-mode-restricted before card-not-in-group',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: { type: 'group:ungroup', card: { isMine: false }, group: null },
        expected: deny('private-mode-restricted'),
      },
      {
        label: 'revealed standalone Card fails with card-not-in-group',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: { type: 'group:ungroup', card: { isMine: true }, group: null },
        expected: deny('card-not-in-group'),
      },
      {
        label: 'pending optimistic Card cannot be ungrouped',
        board: makeBoard({ isFacilitator: true }),
        action: { type: 'group:ungroup', card: { isMine: true, isPending: true }, group: { allCardsAreMine: true } },
        expected: deny('card-pending'),
      },
      {
        label: 'Locked Board precedes grouping-restricted and card checks',
        board: makeBoard({ isLocked: true }),
        action: { type: 'group:ungroup', card: { isMine: false, isPending: true }, group: null },
        expected: deny('board-locked'),
      },
    ];

    it.each(ungroupCases)('group:ungroup — $label -> $expected', ({ board, action, expected }) => {
      expect(decideGroupAction(board, action)).toEqual(expected);
    });

    const sourceCard = (overrides: Partial<MergeCardFacts> = {}): MergeCardFacts => ({
      id: 'card-a',
      columnId: 'col-1',
      groupId: null,
      isMine: true,
      ...overrides,
    });

    const targetCard = (overrides: Partial<MergeCardFacts> = {}): MergeCardFacts => ({
      id: 'card-b',
      columnId: 'col-1',
      groupId: null,
      isMine: false,
      ...overrides,
    });

    const targetGroup = (overrides: Partial<MergeGroupFacts> = {}): MergeGroupFacts => ({
      id: 'group-1',
      columnId: 'col-1',
      allCardsAreMine: true,
      ...overrides,
    });

    const mergeCases: readonly {
      label: string;
      board: BoardPolicyContext;
      action: Extract<GroupPolicyAction, { type: 'group:merge' }>;
      expected: BoardPolicyDecision;
    }[] = [
      // Target Card merges
      {
        label: 'Facilitator merges two revealed standalone Cards in same Column',
        board: makeBoard({ isFacilitator: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard(),
          target: { kind: 'card', card: targetCard(), group: null },
        },
        expected: ALLOW,
      },
      {
        label: 'Participant with allowParticipantGroup merges two revealed standalone Cards',
        board: makeBoard({ allowParticipantGroup: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard(),
          target: { kind: 'card', card: targetCard(), group: null },
        },
        expected: ALLOW,
      },
      {
        label: 'Participant without allowParticipantGroup cannot merge',
        board: makeBoard(),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard(),
          target: { kind: 'card', card: targetCard({ isMine: true }), group: null },
        },
        expected: deny('grouping-restricted'),
      },
      {
        label: 'Locked Board blocks merge before role check',
        board: makeBoard({ isLocked: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard(),
          target: { kind: 'card', card: targetCard(), group: null },
        },
        expected: deny('board-locked'),
      },
      {
        label: 'cannot merge a Card with itself',
        board: makeBoard({ isFacilitator: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ id: 'card-a' }),
          target: { kind: 'card', card: targetCard({ id: 'card-a', isMine: true }), group: null },
        },
        expected: deny('same-card'),
      },
      {
        label: 'cannot merge Cards from different Columns',
        board: makeBoard({ isFacilitator: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ columnId: 'col-1' }),
          target: { kind: 'card', card: targetCard({ columnId: 'col-2' }), group: null },
        },
        expected: deny('different-column'),
      },
      {
        label: 'cannot merge pending source Card',
        board: makeBoard({ isFacilitator: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ isPending: true }),
          target: { kind: 'card', card: targetCard(), group: null },
        },
        expected: deny('card-pending'),
      },
      {
        label: 'cannot merge into pending target Card',
        board: makeBoard({ isFacilitator: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard(),
          target: { kind: 'card', card: targetCard({ isPending: true }), group: null },
        },
        expected: deny('card-pending'),
      },
      {
        label: 'Private Mode blocks merging hidden source Card even for Facilitator',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ isMine: false }),
          target: { kind: 'card', card: targetCard({ isMine: true }), group: null },
        },
        expected: deny('private-mode-restricted'),
      },
      {
        label: 'Private Mode blocks merging into hidden target Card even for Facilitator',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ isMine: true }),
          target: { kind: 'card', card: targetCard({ isMine: false }), group: null },
        },
        expected: deny('private-mode-restricted'),
      },
      {
        label: 'Private Mode allows merging two of actor own Cards',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ isMine: true }),
          target: { kind: 'card', card: targetCard({ isMine: true }), group: null },
        },
        expected: ALLOW,
      },
      {
        label: 'Private Mode blocks merging into target Card whose Card Group contains another Participant Card',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ isMine: true }),
          target: {
            kind: 'card',
            card: targetCard({ isMine: true, groupId: 'group-1' }),
            group: targetGroup({ id: 'group-1', allCardsAreMine: false }),
          },
        },
        expected: deny('private-mode-restricted'),
      },
      {
        label: 'cannot merge into target Card already in the same Card Group',
        board: makeBoard({ isFacilitator: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ groupId: 'group-1' }),
          target: {
            kind: 'card',
            card: targetCard({ groupId: 'group-1' }),
            group: targetGroup({ id: 'group-1' }),
          },
        },
        expected: deny('already-in-group'),
      },

      // Target Card Group merges (including Card "Group with..." submenu filtering)
      {
        label: 'Facilitator merges own Card into all-mine Card Group in Private Mode',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ isMine: true }),
          target: { kind: 'group', group: targetGroup({ allCardsAreMine: true }) },
        },
        expected: ALLOW,
      },
      {
        label: 'Private Mode blocks merging into mixed-authorship Card Group',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ isMine: true }),
          target: { kind: 'group', group: targetGroup({ allCardsAreMine: false }) },
        },
        expected: deny('private-mode-restricted'),
      },
      {
        label: 'redacted Card Group target is rejected (filters out redacted groups in submenu)',
        board: makeBoard({ isFacilitator: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ isMine: true }),
          target: { kind: 'group', group: targetGroup({ allCardsAreMine: true, isRedacted: true }) },
        },
        expected: deny('private-mode-restricted'),
      },
      {
        label: 'cannot merge Card into Card Group in a different Column (precedes group privacy)',
        board: makeBoard({ isFacilitator: true, isPrivateMode: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ columnId: 'col-1', isMine: true }),
          target: { kind: 'group', group: targetGroup({ columnId: 'col-2', allCardsAreMine: false }) },
        },
        expected: deny('different-column'),
      },
      {
        label: 'cannot merge Card into Card Group it already belongs to',
        board: makeBoard({ isFacilitator: true }),
        action: {
          type: 'group:merge',
          sourceCard: sourceCard({ groupId: 'group-1' }),
          target: { kind: 'group', group: targetGroup({ id: 'group-1' }) },
        },
        expected: deny('already-in-group'),
      },
    ];

    it.each(mergeCases)('group:merge — $label -> $expected', ({ board, action, expected }) => {
      expect(decideGroupAction(board, action)).toEqual(expected);
    });
  });

  describe('Comment deletion decisions', () => {
    const cases: readonly {
      label: string;
      isFacilitator: boolean;
      isLocked: boolean;
      isPrivateMode: boolean;
      commentIsMine: boolean;
      card?: CardPolicyFacts;
      mode?: CommentDeleteMode;
      expected: BoardPolicyDecision;
    }[] = [
      // Own comment on unlocked Board
      {
        label: 'Participant deletes own comment on revealed Card',
        isFacilitator: false, isLocked: false, isPrivateMode: false, commentIsMine: true,
        card: { isMine: false }, expected: ALLOW,
      },
      {
        label: 'Participant deletes own comment on own Card in Private Mode (authoritative)',
        isFacilitator: false, isLocked: false, isPrivateMode: true, commentIsMine: true,
        card: { isMine: true }, mode: 'authoritative', expected: ALLOW,
      },
      {
        label: 'Participant deletes own comment on own Card in Private Mode (client-conservative)',
        isFacilitator: false, isLocked: false, isPrivateMode: true, commentIsMine: true,
        card: { isMine: true }, mode: 'client-conservative', expected: ALLOW,
      },

      // Other Participant's comment — non-Facilitator
      {
        label: 'Participant cannot delete another Participant comment outside Private Mode',
        isFacilitator: false, isLocked: false, isPrivateMode: false, commentIsMine: false,
        card: { isMine: true }, expected: deny('not-comment-author'),
      },
      {
        label: 'Participant cannot delete another Participant comment on own Card in Private Mode',
        isFacilitator: false, isLocked: false, isPrivateMode: true, commentIsMine: false,
        card: { isMine: true }, expected: deny('not-comment-author'),
      },

      // Facilitator moderation outside Private Mode
      {
        label: 'Facilitator deletes another Participant comment outside Private Mode (authoritative)',
        isFacilitator: true, isLocked: false, isPrivateMode: false, commentIsMine: false,
        card: { isMine: false }, mode: 'authoritative', expected: ALLOW,
      },
      {
        label: 'Facilitator deletes another Participant comment outside Private Mode (client-conservative)',
        isFacilitator: true, isLocked: false, isPrivateMode: false, commentIsMine: false,
        card: { isMine: false }, mode: 'client-conservative', expected: ALLOW,
      },

      // Intentional Private Mode moderation divergence on own Card
      {
        label: 'Private Mode authoritative (server): Facilitator may delete another Participant comment on Facilitator own Card',
        isFacilitator: true, isLocked: false, isPrivateMode: true, commentIsMine: false,
        card: { isMine: true }, mode: 'authoritative', expected: ALLOW,
      },
      {
        label: 'Private Mode default mode matches authoritative server rule',
        isFacilitator: true, isLocked: false, isPrivateMode: true, commentIsMine: false,
        card: { isMine: true }, expected: ALLOW,
      },
      {
        label: 'Private Mode client-conservative: Facilitator waits for Private Mode to end before deleting another Participant comment',
        isFacilitator: true, isLocked: false, isPrivateMode: true, commentIsMine: false,
        card: { isMine: true }, mode: 'client-conservative', expected: deny('private-mode-comment-moderation'),
      },
      {
        label: 'Private Mode client-conservative without parent Card facts still blocks Facilitator deleting foreign comment',
        isFacilitator: true, isLocked: false, isPrivateMode: true, commentIsMine: false,
        mode: 'client-conservative', expected: deny('private-mode-comment-moderation'),
      },
      {
        label: 'Private Mode client-conservative without parent Card facts still allows own comment',
        isFacilitator: true, isLocked: false, isPrivateMode: true, commentIsMine: true,
        mode: 'client-conservative', expected: ALLOW,
      },

      // Parent Card Private Mode and pending guards
      {
        label: 'Private Mode blocks Facilitator deleting any comment on another Participant hidden Card (authoritative)',
        isFacilitator: true, isLocked: false, isPrivateMode: true, commentIsMine: true,
        card: { isMine: false }, mode: 'authoritative', expected: deny('private-mode-restricted'),
      },
      {
        label: 'Private Mode blocks Facilitator deleting any comment on another Participant hidden Card (client-conservative)',
        isFacilitator: true, isLocked: false, isPrivateMode: true, commentIsMine: false,
        card: { isMine: false }, mode: 'client-conservative', expected: deny('private-mode-restricted'),
      },
      {
        label: 'redacted parent Card blocks comment deletion',
        isFacilitator: true, isLocked: false, isPrivateMode: false, commentIsMine: true,
        card: { isMine: true, isRedacted: true }, expected: deny('private-mode-restricted'),
      },
      {
        label: 'pending optimistic parent Card blocks comment deletion',
        isFacilitator: true, isLocked: false, isPrivateMode: false, commentIsMine: true,
        card: { isMine: true, isPending: true }, expected: deny('card-pending'),
      },

      // Locked Board precedes everything
      {
        label: 'Locked Board blocks deleting own comment',
        isFacilitator: false, isLocked: true, isPrivateMode: false, commentIsMine: true,
        card: { isMine: true }, expected: deny('board-locked'),
      },
      {
        label: 'Locked Board blocks Facilitator deleting comment even in authoritative mode',
        isFacilitator: true, isLocked: true, isPrivateMode: false, commentIsMine: true,
        card: { isMine: true }, mode: 'authoritative', expected: deny('board-locked'),
      },
    ];

    it.each(cases)('$label -> $expected', ({
      isFacilitator,
      isLocked,
      isPrivateMode,
      commentIsMine,
      card,
      mode,
      expected,
    }) => {
      expect(
        decideCommentDelete(
          { isFacilitator, isLocked, isPrivateMode },
          { isMine: commentIsMine },
          { card, mode },
        ),
      ).toEqual(expected);
    });
  });

  describe('Vote decisions', () => {
    const cardTarget = (
      overrides: Partial<Extract<VoteTargetFacts, { kind: 'card' }>> = {},
    ): Extract<VoteTargetFacts, { kind: 'card' }> => ({
      kind: 'card',
      isMine: false,
      groupId: null,
      myVotes: 0,
      ...overrides,
    });

    const groupTarget = (
      overrides: Partial<Extract<VoteTargetFacts, { kind: 'group' }>> = {},
    ): Extract<VoteTargetFacts, { kind: 'group' }> => ({
      kind: 'group',
      allCardsAreMine: false,
      myVotes: 0,
      ...overrides,
    });

    const limits = (overrides: Partial<VoteLimitFacts> = {}): VoteLimitFacts => ({
      maxVotesPerCard: null,
      remainingVotes: null,
      ...overrides,
    });

    const voteCases: readonly {
      label: string;
      isLocked: boolean;
      isPrivateMode: boolean;
      target: VoteTargetFacts;
      voting: VoteLimitFacts;
      delta: VoteDelta;
      expected: BoardPolicyDecision;
    }[] = [
      // Standalone Card casting (+1)
      {
        label: 'standalone Card +1 with unlimited Votes',
        isLocked: false, isPrivateMode: false, target: cardTarget(), voting: limits(), delta: 1, expected: ALLOW,
      },
      {
        label: 'standalone Card +1 within per-Card cap and Board balance',
        isLocked: false, isPrivateMode: false, target: cardTarget({ myVotes: 0 }),
        voting: limits({ maxVotesPerCard: 1, remainingVotes: 1 }), delta: 1, expected: ALLOW,
      },
      {
        label: 'standalone Card +1 blocked when per-Card cap reached',
        isLocked: false, isPrivateMode: false, target: cardTarget({ myVotes: 1 }),
        voting: limits({ maxVotesPerCard: 1, remainingVotes: 5 }), delta: 1, expected: deny('target-vote-limit-reached'),
      },
      {
        label: 'standalone Card +1 blocked when grandfathered Votes exceed lowered per-Card cap',
        isLocked: false, isPrivateMode: false, target: cardTarget({ myVotes: 2 }),
        voting: limits({ maxVotesPerCard: 1, remainingVotes: 5 }), delta: 1, expected: deny('target-vote-limit-reached'),
      },
      {
        label: 'standalone Card +1 checks per-Card cap before Board Vote balance',
        isLocked: false, isPrivateMode: false, target: cardTarget({ myVotes: 1 }),
        voting: limits({ maxVotesPerCard: 1, remainingVotes: 0 }), delta: 1, expected: deny('target-vote-limit-reached'),
      },
      {
        label: 'standalone Card +1 blocked when Board Vote balance is 0',
        isLocked: false, isPrivateMode: false, target: cardTarget({ myVotes: 0 }),
        voting: limits({ maxVotesPerCard: null, remainingVotes: 0 }), delta: 1, expected: deny('board-vote-limit-reached'),
      },
      {
        label: 'standalone Card +1 blocked when lowered Board voteLimit makes remainingVotes negative',
        isLocked: false, isPrivateMode: false, target: cardTarget({ myVotes: 0 }),
        voting: limits({ maxVotesPerCard: null, remainingVotes: -2 }), delta: 1, expected: deny('board-vote-limit-reached'),
      },

      // Standalone Card removal (-1)
      {
        label: 'standalone Card -1 allowed when actor has cast Votes even if Board balance is 0 and grandfathered over cap',
        isLocked: false, isPrivateMode: false, target: cardTarget({ myVotes: 2 }),
        voting: limits({ maxVotesPerCard: 1, remainingVotes: 0 }), delta: -1, expected: ALLOW,
      },
      {
        label: 'standalone Card -1 denied when actor has 0 Votes on this Card',
        isLocked: false, isPrivateMode: false, target: cardTarget({ myVotes: 0 }),
        voting: limits(), delta: -1, expected: deny('no-votes-to-remove'),
      },

      // Standalone Card privacy, grouped-Card routing, pending, and Locked precedence
      {
        label: 'Private Mode allows voting on own standalone Card',
        isLocked: false, isPrivateMode: true, target: cardTarget({ isMine: true }),
        voting: limits(), delta: 1, expected: ALLOW,
      },
      {
        label: 'Private Mode blocks voting on another Participant Card before grouped-Card routing',
        isLocked: false, isPrivateMode: true, target: cardTarget({ isMine: false, groupId: 'g-1' }),
        voting: limits(), delta: 1, expected: deny('private-mode-restricted'),
      },
      {
        label: 'redacted Card blocks voting',
        isLocked: false, isPrivateMode: false, target: cardTarget({ isMine: true, isRedacted: true }),
        voting: limits(), delta: 1, expected: deny('private-mode-restricted'),
      },
      {
        label: 'revealed grouped Card redirects Votes to its Card Group',
        isLocked: false, isPrivateMode: false, target: cardTarget({ groupId: 'g-1', myVotes: 1 }),
        voting: limits(), delta: -1, expected: deny('card-in-group'),
      },
      {
        label: 'pending optimistic Card blocks voting (+1 and -1)',
        isLocked: false, isPrivateMode: false, target: cardTarget({ isMine: true, isPending: true }),
        voting: limits(), delta: 1, expected: deny('card-pending'),
      },
      {
        label: 'Locked Board blocks Card voting before pending and Private Mode',
        isLocked: true, isPrivateMode: true, target: cardTarget({ isMine: false, isPending: true }),
        voting: limits(), delta: 1, expected: deny('board-locked'),
      },

      // Card Group voting (+1 and -1)
      {
        label: 'Card Group +1 allowed outside Private Mode',
        isLocked: false, isPrivateMode: false, target: groupTarget({ allCardsAreMine: false, myVotes: 0 }),
        voting: limits({ maxVotesPerCard: 1, remainingVotes: 3 }), delta: 1, expected: ALLOW,
      },
      {
        label: 'Card Group +1 blocked when combined Votes reach maxVotesPerCard',
        isLocked: false, isPrivateMode: false, target: groupTarget({ myVotes: 1 }),
        voting: limits({ maxVotesPerCard: 1, remainingVotes: 3 }), delta: 1, expected: deny('target-vote-limit-reached'),
      },
      {
        label: 'Card Group +1 blocked when remaining Board Votes is 0',
        isLocked: false, isPrivateMode: false, target: groupTarget({ myVotes: 0 }),
        voting: limits({ maxVotesPerCard: null, remainingVotes: 0 }), delta: 1, expected: deny('board-vote-limit-reached'),
      },
      {
        label: 'Card Group -1 allowed when actor has combined Votes (direct or member)',
        isLocked: false, isPrivateMode: false, target: groupTarget({ myVotes: 1 }),
        voting: limits({ maxVotesPerCard: 1, remainingVotes: 0 }), delta: -1, expected: ALLOW,
      },
      {
        label: 'Card Group -1 denied when actor has 0 combined Votes',
        isLocked: false, isPrivateMode: false, target: groupTarget({ myVotes: 0 }),
        voting: limits(), delta: -1, expected: deny('no-votes-to-remove'),
      },
      {
        label: 'Private Mode allows voting on all-mine Card Group',
        isLocked: false, isPrivateMode: true, target: groupTarget({ allCardsAreMine: true }),
        voting: limits(), delta: 1, expected: ALLOW,
      },
      {
        label: 'Private Mode blocks voting on mixed-authorship Card Group',
        isLocked: false, isPrivateMode: true, target: groupTarget({ allCardsAreMine: false }),
        voting: limits(), delta: 1, expected: deny('private-mode-restricted'),
      },
      {
        label: 'redacted Card Group blocks voting',
        isLocked: false, isPrivateMode: false, target: groupTarget({ allCardsAreMine: true, isRedacted: true }),
        voting: limits(), delta: 1, expected: deny('private-mode-restricted'),
      },
      {
        label: 'Locked Board blocks Card Group voting before Private Mode',
        isLocked: true, isPrivateMode: true, target: groupTarget({ allCardsAreMine: false }),
        voting: limits(), delta: -1, expected: deny('board-locked'),
      },
    ];

    it.each(voteCases)('$label -> $expected', ({
      isLocked,
      isPrivateMode,
      target,
      voting,
      delta,
      expected,
    }) => {
      expect(
        decideVoteChange({ isLocked, isPrivateMode }, target, voting, delta),
      ).toEqual(expected);
    });

    it('resolves lazy remainingVotes callback only on +1 after lock, privacy, routing, and per-target cap pass', () => {
      const getRemaining = vi.fn(() => 0);

      // Not called on -1
      expect(
        decideVoteChange(
          { isLocked: false, isPrivateMode: false },
          cardTarget({ myVotes: 1 }),
          { maxVotesPerCard: 1, remainingVotes: getRemaining },
          -1,
        ),
      ).toEqual(ALLOW);
      expect(getRemaining).not.toHaveBeenCalled();

      // Not called when Locked
      expect(
        decideVoteChange(
          { isLocked: true, isPrivateMode: false },
          cardTarget(),
          { maxVotesPerCard: null, remainingVotes: getRemaining },
          1,
        ),
      ).toEqual(deny('board-locked'));
      expect(getRemaining).not.toHaveBeenCalled();

      // Not called when Private Mode blocks
      expect(
        decideVoteChange(
          { isLocked: false, isPrivateMode: true },
          cardTarget({ isMine: false }),
          { maxVotesPerCard: null, remainingVotes: getRemaining },
          1,
        ),
      ).toEqual(deny('private-mode-restricted'));
      expect(getRemaining).not.toHaveBeenCalled();

      // Not called when grouped Card redirects to Group
      expect(
        decideVoteChange(
          { isLocked: false, isPrivateMode: false },
          cardTarget({ groupId: 'g-1' }),
          { maxVotesPerCard: null, remainingVotes: getRemaining },
          1,
        ),
      ).toEqual(deny('card-in-group'));
      expect(getRemaining).not.toHaveBeenCalled();

      // Not called when per-target cap already denies
      expect(
        decideVoteChange(
          { isLocked: false, isPrivateMode: false },
          cardTarget({ myVotes: 1 }),
          { maxVotesPerCard: 1, remainingVotes: getRemaining },
          1,
        ),
      ).toEqual(deny('target-vote-limit-reached'));
      expect(getRemaining).not.toHaveBeenCalled();

      // Called once all earlier gates pass on +1
      expect(
        decideVoteChange(
          { isLocked: false, isPrivateMode: false },
          cardTarget({ myVotes: 0 }),
          { maxVotesPerCard: 1, remainingVotes: getRemaining },
          1,
        ),
      ).toEqual(deny('board-vote-limit-reached'));
      expect(getRemaining).toHaveBeenCalledTimes(1);
    });
  });
});
