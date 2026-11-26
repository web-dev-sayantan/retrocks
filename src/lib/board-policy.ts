/**
 * Pure, runtime-agnostic shared Board authorization policy.
 *
 * Consumed by both authoritative server operations (deriving plain-data facts
 * from SQLite rows and the authenticated actor) and client adapters/controls
 * (deriving facts from the viewer-projected Board snapshot). Contains zero
 * server-only imports and zero Solid reactivity.
 */

import { MAX_COLUMNS_PER_BOARD, type ActionItemPatch } from './board-types';

export type BoardPolicyDenialReason =
  | 'board-locked'
  | 'facilitator-required'
  | 'private-mode-restricted'
  | 'private-mode-comment-moderation'
  | 'not-card-author'
  | 'not-comment-author'
  | 'grouping-restricted'
  | 'same-card'
  | 'different-column'
  | 'already-in-group'
  | 'card-not-in-group'
  | 'not-action-item'
  | 'column-limit-reached'
  | 'last-column'
  | 'column-has-hidden-cards'
  | 'card-in-group'
  | 'target-vote-limit-reached'
  | 'board-vote-limit-reached'
  | 'no-votes-to-remove'
  | 'card-pending';

export type BoardPolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: BoardPolicyDenialReason };

/** Minimal Board + actor role facts needed across authorization decisions. */
export interface BoardPolicyContext {
  readonly isFacilitator: boolean;
  readonly isLocked: boolean;
  readonly isPrivateMode: boolean;
  readonly allowParticipantGroup: boolean;
}

export type BoardPolicyAction =
  | 'board:contribute'
  | 'board:rename'
  | 'timer:update'
  | 'board:set-private-mode'
  | 'voting:configure'
  | 'voting:reset'
  | 'board:set-lock'
  | 'board:delete'
  | 'facilitator:view-link'
  | 'facilitator:rotate'
  | 'action-item:follow-up';

const ALLOWED: BoardPolicyDecision = { allowed: true };

function deny(reason: BoardPolicyDenialReason): BoardPolicyDecision {
  return { allowed: false, reason };
}

/**
 * Evaluates Board-level and Facilitation actions, encoding the exact Locked
 * exceptions and `BOARD_LOCKED` vs `FORBIDDEN` precedence distinctions:
 * - Co-Facilitator Link view/rotate: Facilitator-only; non-Facilitators fail
 *   with `facilitator-required` even when the Board is Locked.
 * - `board:set-lock` / `board:delete`: allowed for Facilitators while Locked;
 *   non-Facilitators fail with `board-locked` while Locked and
 *   `facilitator-required` while unlocked.
 * - `action-item:follow-up`: allowed for anyone while unlocked and for
 *   Facilitators while Locked.
 */
export function decideBoardAction(
  board: Pick<BoardPolicyContext, 'isFacilitator' | 'isLocked'>,
  action: BoardPolicyAction,
): BoardPolicyDecision {
  switch (action) {
    case 'facilitator:view-link':
    case 'facilitator:rotate':
      return board.isFacilitator ? ALLOWED : deny('facilitator-required');

    case 'board:set-lock':
    case 'board:delete':
      if (board.isFacilitator) return ALLOWED;
      return board.isLocked ? deny('board-locked') : deny('facilitator-required');

    case 'action-item:follow-up':
      if (!board.isLocked || board.isFacilitator) return ALLOWED;
      return deny('board-locked');

    case 'board:contribute':
      return board.isLocked ? deny('board-locked') : ALLOWED;

    case 'board:rename':
    case 'timer:update':
    case 'board:set-private-mode':
    case 'voting:configure':
    case 'voting:reset':
      if (board.isLocked) return deny('board-locked');
      return board.isFacilitator ? ALLOWED : deny('facilitator-required');
  }
}

export type ColumnPolicyAction =
  | { readonly type: 'column:add'; readonly columnCount: number }
  | { readonly type: 'column:update' }
  | { readonly type: 'column:reorder' }
  | {
      readonly type: 'column:delete';
      readonly columnCount: number;
      /** True when the Column holds at least one Card authored by another Participant. */
      readonly hasOtherParticipantCards?: boolean;
      /** Client-side projected fallback when only redacted Card flags are available. */
      readonly hasRedactedCards?: boolean;
    };

/**
 * Evaluates Column management actions. Enforces check precedence:
 * Locked -> Facilitator role -> Column cap/floor -> hidden Cards in Private Mode.
 */
export function decideColumnAction(
  board: Pick<BoardPolicyContext, 'isFacilitator' | 'isLocked' | 'isPrivateMode'>,
  action: ColumnPolicyAction,
): BoardPolicyDecision {
  if (board.isLocked) return deny('board-locked');
  if (!board.isFacilitator) return deny('facilitator-required');

  switch (action.type) {
    case 'column:add':
      return action.columnCount >= MAX_COLUMNS_PER_BOARD
        ? deny('column-limit-reached')
        : ALLOWED;

    case 'column:update':
    case 'column:reorder':
      return ALLOWED;

    case 'column:delete':
      if (action.columnCount <= 1) return deny('last-column');
      if (
        (board.isPrivateMode && Boolean(action.hasOtherParticipantCards)) ||
        Boolean(action.hasRedactedCards)
      ) {
        return deny('column-has-hidden-cards');
      }
      return ALLOWED;
  }
}

export interface CardPolicyFacts {
  readonly isMine: boolean;
  /** Client-projected redaction flag; treated as hidden even when isPrivateMode is false. */
  readonly isRedacted?: boolean;
  /** Client-only optimistic Card not yet confirmed by the server. */
  readonly isPending?: boolean;
}

export type CardPolicyAction =
  | 'card:interact'
  | 'card:update'
  | 'card:move'
  | 'card:delete';

function isCardHiddenByPrivateMode(
  board: Pick<BoardPolicyContext, 'isPrivateMode'>,
  card: Pick<CardPolicyFacts, 'isMine' | 'isRedacted'>,
): boolean {
  return (board.isPrivateMode && !card.isMine) || Boolean(card.isRedacted);
}

/**
 * Evaluates Card interaction (reactions, commenting) and management
 * (edit, move, delete). Enforces check precedence:
 * Locked -> client-only pending -> Private Mode (blocks Facilitators too) -> authorship/role.
 */
export function decideCardAction(
  board: Pick<BoardPolicyContext, 'isFacilitator' | 'isLocked' | 'isPrivateMode'>,
  action: CardPolicyAction,
  card: CardPolicyFacts,
): BoardPolicyDecision {
  if (board.isLocked) return deny('board-locked');
  if (card.isPending) return deny('card-pending');
  if (isCardHiddenByPrivateMode(board, card)) {
    return deny('private-mode-restricted');
  }
  if (action === 'card:interact') return ALLOWED;
  return board.isFacilitator || card.isMine ? ALLOWED : deny('not-card-author');
}

export interface ActionItemCardFacts extends CardPolicyFacts {
  readonly isActionItem: boolean;
}

/**
 * Evaluates Action Item flagging and follow-up updates (`card:set-action`).
 *
 * Precedence matches the authoritative server contract:
 * 1. Global Locked gate: while Locked, only a Facilitator updating follow-up
 *    fields (`patch.isActionItem === undefined`) may proceed.
 * 2. Client-only optimistic pending guard.
 * 3. Private Mode check (even Facilitators on Locked Boards cannot touch
 *    another Participant's hidden Action Item).
 * 4. Locked existing-Action-Item requirement (`card.isActionItem` must be true).
 * 5. Follow-up fields (`actionDone`/`actionOwner`) require the resulting Card
 *    to be an Action Item.
 */
export function decideActionItemAction(
  board: Pick<BoardPolicyContext, 'isFacilitator' | 'isLocked' | 'isPrivateMode'>,
  card: ActionItemCardFacts,
  patch: ActionItemPatch,
): BoardPolicyDecision {
  if (board.isLocked && (!board.isFacilitator || patch.isActionItem !== undefined)) {
    return deny('board-locked');
  }
  if (card.isPending) return deny('card-pending');
  if (isCardHiddenByPrivateMode(board, card)) {
    return deny('private-mode-restricted');
  }
  if (board.isLocked && !card.isActionItem) {
    return deny('board-locked');
  }
  const nextIsActionItem = patch.isActionItem ?? card.isActionItem;
  if (
    !nextIsActionItem &&
    (patch.actionDone !== undefined || patch.actionOwner !== undefined)
  ) {
    return deny('not-action-item');
  }
  return ALLOWED;
}

export interface CardGroupPolicyFacts {
  /** True when every member Card in the Card Group is authored by the actor. */
  readonly allCardsAreMine: boolean;
  /** Client-projected redaction flag on the Card Group, if available. */
  readonly isRedacted?: boolean;
}

export interface MergeCardFacts extends CardPolicyFacts {
  readonly id: string;
  readonly columnId: string;
  readonly groupId: string | null;
}

export interface MergeGroupFacts extends CardGroupPolicyFacts {
  readonly id: string;
  readonly columnId: string;
}

export type GroupPolicyAction =
  | { readonly type: 'group:manage-access' }
  | {
      readonly type: 'group:rename' | 'group:move' | 'group:dissolve';
      readonly group: CardGroupPolicyFacts;
    }
  | {
      readonly type: 'group:ungroup';
      readonly card: CardPolicyFacts;
      /**
       * Card Group containing `card`, or `null` when `card` is standalone.
       * During Private Mode, the entire Card Group must pass Private Mode
       * (matching `group:rename`, `group:move`, and `group:dissolve`).
       */
      readonly group: CardGroupPolicyFacts | null;
    }
  | {
      readonly type: 'group:merge';
      readonly sourceCard: MergeCardFacts;
      readonly target:
        | {
            readonly kind: 'card';
            readonly card: MergeCardFacts;
            readonly group: MergeGroupFacts | null;
          }
        | {
            readonly kind: 'group';
            readonly group: MergeGroupFacts;
          };
    };

function isGroupHiddenByPrivateMode(
  board: Pick<BoardPolicyContext, 'isPrivateMode'>,
  group: CardGroupPolicyFacts,
): boolean {
  return (board.isPrivateMode && !group.allCardsAreMine) || Boolean(group.isRedacted);
}

/**
 * Evaluates Card Group access, rename, move, dissolve, ungroup, and merge
 * decisions. Enforces the unified whole-Group Private Mode rule across all
 * Card Group mutations (including `group:ungroup`).
 */
export function decideGroupAction(
  board: BoardPolicyContext,
  action: GroupPolicyAction,
): BoardPolicyDecision {
  if (board.isLocked) return deny('board-locked');
  if (!board.isFacilitator && !board.allowParticipantGroup) {
    return deny('grouping-restricted');
  }

  switch (action.type) {
    case 'group:manage-access':
      return ALLOWED;

    case 'group:rename':
    case 'group:move':
    case 'group:dissolve':
      return isGroupHiddenByPrivateMode(board, action.group)
        ? deny('private-mode-restricted')
        : ALLOWED;

    case 'group:ungroup':
      if (action.card.isPending) return deny('card-pending');
      if (isCardHiddenByPrivateMode(board, action.card)) {
        return deny('private-mode-restricted');
      }
      if (action.group === null) return deny('card-not-in-group');
      if (isGroupHiddenByPrivateMode(board, action.group)) {
        return deny('private-mode-restricted');
      }
      return ALLOWED;

    case 'group:merge': {
      const { sourceCard, target } = action;
      if (sourceCard.isPending) return deny('card-pending');
      if (isCardHiddenByPrivateMode(board, sourceCard)) {
        return deny('private-mode-restricted');
      }

      if (target.kind === 'card') {
        if (target.card.isPending) return deny('card-pending');
        if (target.card.id === sourceCard.id) return deny('same-card');
        if (isCardHiddenByPrivateMode(board, target.card)) {
          return deny('private-mode-restricted');
        }
        const targetColumnId = target.group?.columnId ?? target.card.columnId;
        if (sourceCard.columnId !== targetColumnId) {
          return deny('different-column');
        }
        if (target.group !== null) {
          if (isGroupHiddenByPrivateMode(board, target.group)) {
            return deny('private-mode-restricted');
          }
          if (sourceCard.groupId === target.group.id) {
            return deny('already-in-group');
          }
        }
        return ALLOWED;
      }

      if (sourceCard.columnId !== target.group.columnId) {
        return deny('different-column');
      }
      if (isGroupHiddenByPrivateMode(board, target.group)) {
        return deny('private-mode-restricted');
      }
      if (sourceCard.groupId === target.group.id) {
        return deny('already-in-group');
      }
      return ALLOWED;
    }
  }
}

export interface CommentPolicyFacts {
  readonly isMine: boolean;
}

export type CommentDeleteMode = 'authoritative' | 'client-conservative';

export interface CommentDeleteOptions {
  /**
   * Parent Card facts. Server operations and controller preflight supply the
   * parent Card so Private Mode and pending checks run before comment authorship.
   */
  readonly card?: CardPolicyFacts;
  /**
   * `'authoritative'` (default): server rule — once the parent Card passes
   * Private Mode, a Facilitator can delete any comment on it.
   * `'client-conservative'`: intentional client moderation safety — while
   * Private Mode is active, a Facilitator waits until Reveal All before
   * deleting another Participant's comment.
   */
  readonly mode?: CommentDeleteMode;
}

/**
 * Evaluates comment deletion (`comment:delete`), explicitly modeling both the
 * authoritative server rule and the intentional client-conservative Private
 * Mode moderation rule.
 */
export function decideCommentDelete(
  board: Pick<BoardPolicyContext, 'isFacilitator' | 'isLocked' | 'isPrivateMode'>,
  comment: CommentPolicyFacts,
  options: CommentDeleteOptions = {},
): BoardPolicyDecision {
  if (board.isLocked) return deny('board-locked');

  if (options.card !== undefined) {
    if (options.card.isPending) return deny('card-pending');
    if (isCardHiddenByPrivateMode(board, options.card)) {
      return deny('private-mode-restricted');
    }
  }

  if (comment.isMine) return ALLOWED;
  if (!board.isFacilitator) return deny('not-comment-author');

  const mode = options.mode ?? 'authoritative';
  if (mode === 'client-conservative' && board.isPrivateMode) {
    return deny('private-mode-comment-moderation');
  }
  return ALLOWED;
}

export type VoteDelta = 1 | -1;

export type VoteTargetFacts =
  | ({
      readonly kind: 'card';
      readonly groupId: string | null;
      readonly myVotes: number;
    } & CardPolicyFacts)
  | ({
      readonly kind: 'group';
      /** Combined Votes cast by the actor on the Card Group (direct + member Card Votes). */
      readonly myVotes: number;
    } & CardGroupPolicyFacts);

export interface VoteLimitFacts {
  readonly maxVotesPerCard: number | null;
  /**
   * Actor's remaining Board Vote balance, or `null` when the Board has no
   * Vote limit. Accepts a zero-arg getter so the server can defer querying
   * total cast Votes until a `+1` cast passes lock, privacy, routing, and
   * per-target cap checks.
   */
  readonly remainingVotes: number | null | (() => number | null);
}

/**
 * Evaluates casting (`+1`) or removing (`-1`) a Vote on a standalone Card or
 * Card Group. Blind Voting is intentionally excluded: it affects aggregate
 * Vote projection and sorting only, never Vote authorization.
 */
export function decideVoteChange(
  board: Pick<BoardPolicyContext, 'isLocked' | 'isPrivateMode'>,
  target: VoteTargetFacts,
  limits: VoteLimitFacts,
  delta: VoteDelta,
): BoardPolicyDecision {
  if (board.isLocked) return deny('board-locked');

  if (target.kind === 'card') {
    if (target.isPending) return deny('card-pending');
    if (isCardHiddenByPrivateMode(board, target)) {
      return deny('private-mode-restricted');
    }
    if (target.groupId !== null) return deny('card-in-group');
  } else if (isGroupHiddenByPrivateMode(board, target)) {
    return deny('private-mode-restricted');
  }

  if (delta === -1) {
    return target.myVotes > 0 ? ALLOWED : deny('no-votes-to-remove');
  }

  if (
    limits.maxVotesPerCard !== null &&
    target.myVotes >= limits.maxVotesPerCard
  ) {
    return deny('target-vote-limit-reached');
  }

  const remaining =
    typeof limits.remainingVotes === 'function'
      ? limits.remainingVotes()
      : limits.remainingVotes;
  if (remaining !== null && remaining <= 0) {
    return deny('board-vote-limit-reached');
  }

  return ALLOWED;
}
