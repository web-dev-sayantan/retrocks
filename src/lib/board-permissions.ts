// Client-side mirror of the server authorization truth table. Enforcement lives in
// src/server/db/sql-board-operations.ts (mutateBoard), src/server/domain/card-permissions.ts
// and src/server/db/sql-voting-operations.ts; the client cannot see author/voter token
// hashes, so these predicates approximate them with the projected redacted/isMine/
// isFacilitator/isBlurred flags — the established convention. Pure functions only:
// no reactivity lives in this module, callers pass plain (possibly props-shaped) state.

import {
  MAX_COLUMNS_PER_BOARD,
  type ActionItemPatch,
  type BoardViewDTO,
  type CardGroupDTO,
  type CardViewDTO,
  type CommentViewDTO,
} from './board-types';

// ── Facilitation gates ──────────────────────────────────────────────────────────

// board:set-lock (sql-board-operations.ts:798) and deleteBoardForRequest
// (board-service.ts:308–357) stay Facilitator-only even while Locked.
export function canFacilitate(board: Pick<BoardViewDTO, 'isFacilitator'>): boolean {
  return board.isFacilitator;
}

// timer:update (712), board:rename (737), board:set-private-mode (773),
// voting:configure/voting:reset (656) and Column CRUD (1562–1734) are
// Facilitator-only and blocked by the global Locked gate (603–617).
export function canControlFacilitation(
  board: Pick<BoardViewDTO, 'isFacilitator' | 'isLocked'>,
): boolean {
  return board.isFacilitator && !board.isLocked;
}

// Global Locked gate (603–617): while Locked every write except facilitator:rotate,
// board:set-lock and facilitator follow-up on existing Action Items fails with
// BOARD_LOCKED — so Cards, comments, reactions and Votes are all frozen.
export function canContribute(board: Pick<BoardViewDTO, 'isLocked'>): boolean {
  return !board.isLocked;
}

// column:add (1562): Facilitator-only, blocked while Locked, capped at
// MAX_COLUMNS_PER_BOARD (1575).
export function canAddColumn(
  board: Pick<BoardViewDTO, 'isFacilitator' | 'isLocked' | 'columns'>,
): boolean {
  return canControlFacilitation(board) && board.columns.length < MAX_COLUMNS_PER_BOARD;
}

// ── Card gates ──────────────────────────────────────────────────────────────────

// checkPrivateCardPermission (card-permissions.ts:5–18) plus the Locked gate:
// reactions, comments and Votes need only a revealed, server-confirmed Card on
// an unlocked Board; client-only optimistic rows stay untouchable.
export function canInteractWithCard(
  board: Pick<BoardViewDTO, 'isLocked'>,
  card: Pick<CardViewDTO, 'redacted' | 'pending'>,
): boolean {
  return !board.isLocked && !card.redacted && !card.pending;
}

type CardManageBoard = Pick<BoardViewDTO, 'isLocked' | 'isFacilitator' | 'isBlurred'>;
type CardManageState = Pick<CardViewDTO, 'redacted' | 'isMine' | 'pending'>;

// checkCardManagePermission (sql-board-operations.ts:547–563) on projected state:
// own Card, or any revealed Card as Facilitator — Private Mode blinds Facilitators
// because checkPrivateCardPermission applies even to them.
export function canManageCard(board: CardManageBoard, card: CardManageState): boolean;
export function canManageCard(
  board: CardManageBoard & { cards: readonly (CardManageState & { id: string })[] },
  cardId: string,
): boolean;
export function canManageCard(
  board: CardManageBoard & { cards?: readonly (CardManageState & { id: string })[] },
  cardOrId: CardManageState | string,
): boolean {
  const card = typeof cardOrId === 'string'
    ? board.cards?.find((item) => item.id === cardOrId)
    : cardOrId;
  return (
    !!card &&
    !card.pending &&
    canInteractWithCard(board, card) &&
    (card.isMine || (board.isFacilitator && !board.isBlurred))
  );
}

// ── Grouping gates ──────────────────────────────────────────────────────────────

// checkGroupManagePermission (sql-board-operations.ts:512–524) behind the Locked
// gate: Facilitators always, Participants only with allow_participant_group.
export function canManageGrouping(
  board: Pick<BoardViewDTO, 'isLocked' | 'isFacilitator' | 'allowParticipantGroup'>,
): boolean {
  return !board.isLocked && (board.isFacilitator || board.allowParticipantGroup);
}

// checkGroupPrivacy (sql-board-operations.ts:526–545): while Private Mode is active
// every member Card's author must pass checkPrivateCardPermission — Facilitators
// are blinded like everyone else, so the client demands all members be the actor's.
export function areAllGroupCardsMine(
  board: Pick<BoardViewDTO, 'isBlurred'>,
  group: Pick<CardGroupDTO, 'cardIds'>,
  cards: readonly Pick<CardViewDTO, 'id' | 'isMine'>[],
): boolean {
  if (!board.isBlurred) return true;
  return group.cardIds.every((id) => cards.find((card) => card.id === id)?.isMine === true);
}

// The grouping role gate plus group visibility: not redacted, and fully the
// actor's under Private Mode.
export function canManageGroup(
  board: Pick<BoardViewDTO, 'isLocked' | 'isFacilitator' | 'allowParticipantGroup' | 'isBlurred'>,
  group: Pick<CardGroupDTO, 'redacted' | 'cardIds'>,
  cards: readonly Pick<CardViewDTO, 'id' | 'isMine'>[],
): boolean {
  return canManageGrouping(board) && !group.redacted && areAllGroupCardsMine(board, group, cards);
}

export function canMergeCard(
  board: BoardViewDTO,
  cardId: string,
  targetType: 'card' | 'group',
  targetId: string,
): boolean {
  if (!canManageGrouping(board)) return false;
  const card = board.cards.find((item) => item.id === cardId);
  if (!card || !canInteractWithCard(board, card) || !passesPrivateMode(board, card)) return false;

  const target = targetType === 'card' ? board.cards.find((item) => item.id === targetId) : undefined;
  if (targetType === 'card' &&
      (!target || target.id === cardId || target.columnId !== card.columnId ||
        !canInteractWithCard(board, target) || !passesPrivateMode(board, target))) return false;

  const groupId = targetType === 'group' ? targetId : target?.groupId;
  if (groupId == null) return true;
  const group = board.groups.find((item) => item.id === groupId);
  return group !== undefined && group.columnId === card.columnId &&
    !group.cardIds.includes(cardId) && canManageGroup(board, group, board.cards);
}

// Projected group privacy: the projection (projection.ts) redacts groups holding
// other participants' Cards while Private Mode is active.
export function isGroupRedacted(group: Pick<CardGroupDTO, 'redacted'>): boolean {
  return Boolean(group.redacted);
}

// Strict checkPrivateCardPermission mirror for a single Card (group membership,
// ungrouping): only the actor's own Cards stay touchable while blurred — even
// for Facilitators.
export function passesPrivateMode(
  board: Pick<BoardViewDTO, 'isBlurred'>,
  card: Pick<CardViewDTO, 'isMine'>,
): boolean {
  return !board.isBlurred || card.isMine;
}

// ── Action Item gates ───────────────────────────────────────────────────────────

// SPEC permission matrix: while Locked, only a Facilitator may still toggle
// actionDone and edit actionOwner on EXISTING Action Items.
export function canEditActionItems(
  board: Pick<BoardViewDTO, 'isLocked' | 'isFacilitator'>,
): boolean {
  return !board.isLocked || board.isFacilitator;
}

export function canEditActionItemFollowUp(
  board: Pick<BoardViewDTO, 'isLocked' | 'isFacilitator'>,
  card: Pick<CardViewDTO, 'isActionItem' | 'pending'>,
): boolean {
  return card.isActionItem && !card.pending && canEditActionItems(board);
}

// card:set-action (sql-board-operations.ts:1387–1457) behind the global Locked
// gate (603–617): while Locked a Facilitator may only update EXISTING Action
// Items (done/owner) and only without re-flagging — isActionItem must stay
// undefined so the is_action_item !== 1 check in 1410 passes.
export function canEditActionItem(
  board: Pick<BoardViewDTO, 'isLocked' | 'isFacilitator'>,
  card: Pick<CardViewDTO, 'redacted' | 'isActionItem' | 'pending'>,
  patch: ActionItemPatch,
): boolean {
  if (card.redacted || card.pending) return false;
  if (!board.isLocked) return true;
  return board.isFacilitator && card.isActionItem && patch.isActionItem === undefined;
}

// ── Comment gates ───────────────────────────────────────────────────────────────

// comment:delete (sql-board-operations.ts:1541–1543): own comment, or any comment
// as Facilitator. The client additionally requires the Facilitator to wait for
// Reveal All (!isBlurred) because it cannot compare comment author hashes —
// stricter than the server, by established convention.
export function canDeleteComment(
  board: Pick<BoardViewDTO, 'isLocked' | 'isFacilitator' | 'isBlurred'>,
  comment: Pick<CommentViewDTO, 'isMine'>,
): boolean {
  return !board.isLocked && (comment.isMine || (board.isFacilitator && !board.isBlurred));
}

// ── Vote gates ──────────────────────────────────────────────────────────────────

// sql-voting-operations.ts changeVote (16–84): a +1 cast must clear the remaining
// Board Vote balance and the per-Card cap. Blind Voting never restricts casting —
// it only hides totals in the projection — so no blindVoting input exists here.
export function canCastVote(
  voting: { remainingVotes: number | null; maxVotesPerCard: number | null },
  myVotes: number,
): boolean {
  return (
    (voting.remainingVotes === null || voting.remainingVotes > 0) &&
    (voting.maxVotesPerCard === null || myVotes < voting.maxVotesPerCard)
  );
}

// ── Column gates ────────────────────────────────────────────────────────────────

// column:delete (sql-board-operations.ts:1695–1734): Facilitator only, more than
// one Column, and no hidden Cards while Private Mode is active — the client reads
// that as "no redacted Cards in the Column".
export function canDeleteColumn(
  board: Pick<BoardViewDTO, 'isFacilitator' | 'isLocked'>,
  totalColumns: number,
  cards: readonly Pick<CardViewDTO, 'redacted'>[],
): boolean {
  return (
    canControlFacilitation(board) &&
    totalColumns > 1 &&
    !cards.some((card) => card.redacted)
  );
}
