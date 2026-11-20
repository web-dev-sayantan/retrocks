// The Board's transfer layer: pure drop-target rules plus the createTransfer
// primitive that replaces the four-module HTML5 drag wiring (#52). Column
// panels register as transfer lists; Cards and Card Groups register as
// transfer items. Every eligibility question funnels through the pure
// predicates below — the board-permissions.ts convention, no reactivity.

import type { TransferLists } from '@ui-sdk/core';

import {
  canInteractWithCard,
  canManageCard,
  canManageGroup,
  canManageGrouping,
  isGroupRedacted,
} from './board-permissions';
import type { BoardViewDTO, CardGroupDTO, CardViewDTO } from './board-types';
import { isOptimisticId } from './optimistic-ids';
import type { BoardViewProjection } from './board-view';

/** Prefix marking a Card / Card Group article as a drop target list. */
const BOARD_TARGET_PREFIX = 'on:';

export type BoardItem =
  | { kind: 'card'; card: CardViewDTO }
  | { kind: 'group'; group: CardGroupDTO };

export type BoardTransferMove =
  | { kind: 'move-card'; cardId: string; targetColumnId: string }
  | { kind: 'move-group'; groupId: string; targetColumnId: string }
  | { kind: 'group-with-card'; cardId: string; targetCardId: string }
  | { kind: 'group-with-group'; cardId: string; targetGroupId: string };

export function parseBoardItemKey(key: string): { kind: 'card' | 'group'; id: string } | undefined {
  if (key.startsWith('card:') && !isOptimisticId(key.slice(5))) {
    return { kind: 'card', id: key.slice(5) };
  }
  if (key.startsWith('group:')) {
    return { kind: 'group', id: key.slice(6) };
  }
  return undefined;
}

function parseBoardTargetKey(listKey: string): { kind: 'card' | 'group'; id: string } | undefined {
  return listKey.startsWith(BOARD_TARGET_PREFIX)
    ? parseBoardItemKey(listKey.slice(BOARD_TARGET_PREFIX.length))
    : undefined;
}

function findBoardItem(board: BoardViewDTO | null, key: string): BoardItem | undefined {
  const parsed = parseBoardItemKey(key);
  if (!board || !parsed) return undefined;
  if (parsed.kind === 'card') {
    const card = board.cards.find((item) => item.id === parsed.id);
    return card ? { kind: 'card', card } : undefined;
  }
  const group = board.groups.find((item) => item.id === parsed.id);
  return group ? { kind: 'group', group } : undefined;
}

/** Whether a Card or Card Group can be picked up at all: move or grouping rights. */
export function canGrabBoardItem(
  board: BoardViewDTO | null,
  itemKey: string,
): boolean {
  if (!board) return false;
  const item = findBoardItem(board, itemKey);
  if (!item) return false;
  if (item.kind === 'card') {
    return (
      canManageCard(board, item.card) ||
      (canManageGrouping(board) && canInteractWithCard(board, item.card))
    );
  }
  return canManageGroup(board, item.group, board.cards);
}

/** The one drop-target eligibility rule: can `itemKey` land on `targetKey`? */
export function acceptsBoardDrop(
  board: BoardViewDTO | null,
  itemKey: string,
  targetKey: string,
): boolean {
  if (!board || board.isLocked) return false;
  const item = findBoardItem(board, itemKey);
  if (!item) return false;

  const target = parseBoardTargetKey(targetKey);
  if (!target) {
    // Bare list key: a Column. Source re-entry stays allowed so a drag can
    // come home and commit nothing (resolveBoardTransferMove returns null).
    return item.kind === 'card'
      ? canManageCard(board, item.card)
      : canManageGroup(board, item.group, board.cards);
  }
  if (item.kind !== 'card') return false; // Card Groups only land on Columns.

  const landing = findBoardItem(board, `${target.kind}:${target.id}`);
  if (!landing) return false;
  const landingColumnId =
    landing.kind === 'card' ? landing.card.columnId : landing.group.columnId;
  if (landingColumnId !== item.card.columnId) {
    // Hovering through another Column's Card or Group means "move to that
    // Column", exactly like the Column itself.
    return canManageCard(board, item.card);
  }
  if (!canManageGrouping(board)) return false;
  if (landing.kind === 'card') {
    return (
      canInteractWithCard(board, landing.card) &&
      landing.card.id !== item.card.id &&
      (landing.card.groupId === null || landing.card.groupId !== item.card.groupId)
    );
  }
  return (
    !isGroupRedacted(landing.group) &&
    !landing.group.cardIds.includes(item.card.id)
  );
}

/** The commit seam: which mutation a finished transfer stands for, or null. */
export function resolveBoardTransferMove(
  board: BoardViewDTO | null,
  move: { key: string; from: string; to: string },
): BoardTransferMove | null {
  if (!board || move.to === move.from) return null;
  const item = findBoardItem(board, move.key);
  if (!item) return null;

  const target = parseBoardTargetKey(move.to);
  if (!target) {
    return item.kind === 'card'
      ? { kind: 'move-card', cardId: item.card.id, targetColumnId: move.to }
      : { kind: 'move-group', groupId: item.group.id, targetColumnId: move.to };
  }
  if (item.kind !== 'card') return null;
  const landing = findBoardItem(board, `${target.kind}:${target.id}`);
  if (!landing) return null;
  if (landing.kind === 'card') {
    return landing.card.columnId === item.card.columnId
      ? { kind: 'group-with-card', cardId: item.card.id, targetCardId: landing.card.id }
      : { kind: 'move-card', cardId: item.card.id, targetColumnId: landing.card.columnId };
  }
  return landing.group.columnId === item.card.columnId
    ? { kind: 'group-with-group', cardId: item.card.id, targetGroupId: landing.group.id }
    : { kind: 'move-card', cardId: item.card.id, targetColumnId: landing.group.columnId };
}

/**
 * The transfer lists value: each Column's rendered stream order, plus an
 * empty target list per visible Card / Card Group so a held draft survives
 * board changes while hovering one (createTransfer rebases against the value).
 */
export function buildBoardTransferLists(view: BoardViewProjection): TransferLists {
  const lists: TransferLists = {};
  for (const [columnId, column] of view.columns) {
    lists[columnId] = column.items.map((item) => item.key);
    for (const item of column.items) {
      lists[BOARD_TARGET_PREFIX + item.key] = [];
    }
  }
  return lists;
}
