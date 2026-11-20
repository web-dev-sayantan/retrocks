// The Board's transfer layer: pure drop-target rules plus the createTransfer
// primitive that replaces the four-module HTML5 drag wiring (#52). Column
// panels register as transfer lists; Cards and Card Groups register as
// transfer items. Every eligibility question funnels through the pure
// predicates below — the board-permissions.ts convention, no reactivity.

import {
  createTransfer,
  definePrimitive,
  transferMessage,
  type TransferDraft,
  type TransferLists,
  type TransferMessage,
} from '@ui-sdk/core';
import type { PrimitiveHandle } from '@ui-sdk/solid/primitive';

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
export function buildBoardTransferLists(
  view: BoardViewProjection | null,
): TransferLists {
  const lists: TransferLists = {};
  for (const [columnId, column] of view?.columns ?? []) {
    lists[columnId] = column.items.map((item) => item.key);
    for (const item of column.items) {
      lists[BOARD_TARGET_PREFIX + item.key] = [];
    }
  }
  return lists;
}

// ── createTransfer wiring ───────────────────────────────────────────────────────

export interface BoardTransferOptions {
  /** The lists value from `buildBoardTransferLists`, kept current per render. */
  lists: TransferLists;
  /** Current Board snapshot; null silences every rule. */
  board: () => BoardViewDTO | null;
  /** Receives the resolved mutation for a committed drop. */
  commit: (move: BoardTransferMove) => void;
}

interface BoardTransferState {
  lists: TransferLists;
  moving: TransferDraft | null;
}

function boardItemLabel(
  board: BoardViewDTO | null,
  itemKey: string,
): string | undefined {
  const item = findBoardItem(board, itemKey);
  if (!item) return undefined;
  return item.kind === 'card'
    ? item.card.content
    : item.group.title || 'Card Group';
}

function boardListLabel(
  board: BoardViewDTO | null,
  listKey: string,
): string | undefined {
  const target = parseBoardTargetKey(listKey);
  if (!target) {
    const column = board?.columns.find((item) => item.id === listKey);
    return column && `Column ${column.title}`;
  }
  const label = boardItemLabel(board, `${target.kind}:${target.id}`);
  return label && `${label} (${target.kind === 'card' ? 'Card' : 'Card Group'})`;
}

function boardTransferMessage(message: TransferMessage): string {
  // Column labels are prefixed “Column ” by boardListLabel; target labels
  // are the landing Card / Card Group’s own name.
  if (message.type === 'move' && !message.list.startsWith('Column ')) {
    return `${message.label} onto ${message.list}.`;
  }
  if (message.type === 'drop' && !message.list.startsWith('Column ')) {
    return `Dropped ${message.label} onto ${message.list}.`;
  }
  return transferMessage(message);
}

/** Drag sources inside cards must stay plain presses: buttons, editors, overlays. */
function isIgnoredDragTarget(event: PointerEvent): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest(
      'button, a, input, textarea, select, [contenteditable="true"], [data-board-overlay]',
    ) !== null
  );
}

function listWith(lists: TransferLists, key: string): string | undefined {
  return Object.keys(lists).find((list) => lists[list]?.includes(key));
}

/**
 * The Board's one transfer instance: Columns are its lists, Cards and Card
 * Groups its items. Pointer drags, keyboard moves, Escape cancels and
 * screen-reader announcements all come from `createTransfer`; drops commit
 * through `resolveBoardTransferMove` and the caller's mutation seam.
 */
export const boardTransfer = definePrimitive({
  name: 'board-transfer',
  options: { lists: 'value', board: 'callback', commit: 'callback' },
  state: (options: BoardTransferOptions) => ({
    lists: options.lists,
    moving: null as TransferDraft | null,
  }),
  sync: (options: BoardTransferOptions) => ({ lists: options.lists }),
  api: (context) => {
    const read = () => context.options();
    const transfer = createTransfer(context, {
      key: 'lists',
      draft: 'moving',
      set: (lists, details) => {
        const move = resolveBoardTransferMove(read().board(), details);
        if (!move) return false;
        read().commit(move);
        return true;
      },
      accepts: (key, target) => acceptsBoardDrop(read().board(), key, target),
      disabled: (key) => !canGrabBoardItem(read().board(), key),
      label: (key) => boardItemLabel(read().board(), key),
      listLabel: (list) => boardListLabel(read().board(), list),
      order: () => (read().board()?.columns ?? []).map((column) => column.id),
      message: boardTransferMessage,
    });

    // Drop-zone registry. createTransfer's listAt resolves distance ties by
    // registration order, and a Column contains its Cards and Card Groups, so
    // every zone that encloses a newly bound zone re-files itself behind it.
    const zones = new Map<string, { el: HTMLElement; unbind: () => void }>();
    function bindZone(el: HTMLElement, listKey: string): () => void {
      const unbind = transfer.bindList(el, listKey);
      const zone = { el, unbind };
      zones.set(listKey, zone);
      for (const [otherKey, other] of zones) {
        if (otherKey !== listKey && other.el.contains(el)) {
          other.unbind();
          other.unbind = transfer.bindList(other.el, otherKey);
        }
      }
      return () => {
        if (zones.get(listKey) === zone) zones.delete(listKey);
        unbind();
      };
    }

    function overList(state: BoardTransferState, listKey: string): boolean {
      const moving = state.moving;
      return !!moving && listWith(transfer.lists(state), moving.key) === listKey;
    }

    return {
      transfer: {
        ...transfer,
        bindColumn: (el: HTMLElement, columnId: string) => bindZone(el, columnId),
        bindTarget: (el: HTMLElement, itemKey: string) =>
          bindZone(el, BOARD_TARGET_PREFIX + itemKey),
        armedColumn: (state: BoardTransferState, columnId: string) =>
          state.moving !== null && state.moving.from !== columnId,
        overColumn: (state: BoardTransferState, columnId: string) =>
          state.moving !== null &&
          state.moving.from !== columnId &&
          overList(state, columnId),
        overTarget: (state: BoardTransferState, itemKey: string) =>
          overList(state, BOARD_TARGET_PREFIX + itemKey),
      },
    };
  },
  slots: (slot) => ({
    column: slot<{ value: string }>({
      props: { value: 'string' },
      bind: (el, part) => part.api.transfer.bindColumn(el, part.key),
      attrs: (state, part) => ({
        'data-drop-armed': part.api.transfer.armedColumn(state, part.key)
          ? ''
          : undefined,
        'data-drop-active': part.api.transfer.overColumn(state, part.key)
          ? ''
          : undefined,
      }),
    }),
    card: slot<{ value: string }>({
      props: { value: 'string' },
      bind: (el, part) => {
        const unbindItem = part.api.transfer.bindItem(el, part.key);
        const unbindTarget = part.api.transfer.bindTarget(el, part.key);
        return () => {
          unbindItem();
          unbindTarget();
        };
      },
      on: {
        keydown: (event, part) => {
          // Only keys on the item itself drive the transfer; presses inside
          // its buttons and inputs keep their own meaning.
          if (event.target === part.el) part.api.transfer.keydown(event, part.key);
        },
        pointerdown: (event, part) => {
          if (!isIgnoredDragTarget(event)) {
            part.api.transfer.pointerdown(event, part.key);
          }
        },
      },
      attrs: (state, part) => ({
        'data-moving': part.api.transfer.moving(state, part.key) ? '' : undefined,
        'data-dragging': part.api.transfer.dragging(state, part.key) ? '' : undefined,
        'data-drop-active': part.api.transfer.overTarget(state, part.key)
          ? ''
          : undefined,
      }),
    }),
    'group-item': slot<{ value: string }>({
      props: { value: 'string' },
      bind: (el, part) => part.api.transfer.bindItem(el, part.key),
      on: {
        keydown: (event, part) => {
          if (event.target === part.el) part.api.transfer.keydown(event, part.key);
        },
        pointerdown: (event, part) => {
          if (!isIgnoredDragTarget(event)) {
            part.api.transfer.pointerdown(event, part.key);
          }
        },
      },
      attrs: (state, part) => ({
        'data-moving': part.api.transfer.moving(state, part.key) ? '' : undefined,
        'data-dragging': part.api.transfer.dragging(state, part.key) ? '' : undefined,
      }),
    }),
    'group-target': slot<{ value: string }>({
      props: { value: 'string' },
      bind: (el, part) => part.api.transfer.bindTarget(el, part.key),
      attrs: (state, part) => ({
        'data-drop-active': part.api.transfer.overTarget(state, part.key)
          ? ''
          : undefined,
      }),
    }),
  }),
});

/** What the workspace hands to every Column panel. */
export type BoardTransferHandle = PrimitiveHandle<typeof boardTransfer>;

