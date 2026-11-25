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
} from '@ui-sdk/core';
import type { PrimitiveHandle } from '@ui-sdk/solid/primitive';

import {
  canInteractWithCard,
  canManageCard,
  canManageGroup,
  canManageGrouping,
  canMergeCard,
} from './board-permissions';
import type { BoardViewDTO, CardGroupDTO, CardViewDTO } from './board-types';
import type { BoardViewProjection } from './board-view';

/** Prefix marking a Card / Card Group article as a drop target list. */
const BOARD_TARGET_PREFIX = 'on:';

export type TransferTarget =
  | { kind: 'card'; card: CardViewDTO }
  | { kind: 'group'; group: CardGroupDTO };

export type BoardTransferMove =
  | { kind: 'move-card'; cardId: string; targetColumnId: string }
  | { kind: 'move-group'; groupId: string; targetColumnId: string }
  | { kind: 'group-with-card'; cardId: string; targetCardId: string }
  | { kind: 'group-with-group'; cardId: string; targetGroupId: string };

export function parseTransferKey(key: string): { kind: 'card' | 'group'; id: string } | undefined {
  if (key.startsWith('card:')) {
    return { kind: 'card', id: key.slice(5) };
  }
  if (key.startsWith('group:')) {
    return { kind: 'group', id: key.slice(6) };
  }
  return undefined;
}

function parseBoardTargetKey(listKey: string): { kind: 'card' | 'group'; id: string } | undefined {
  return listKey.startsWith(BOARD_TARGET_PREFIX)
    ? parseTransferKey(listKey.slice(BOARD_TARGET_PREFIX.length))
    : undefined;
}

function findTransferTarget(board: BoardViewDTO | null, key: string): TransferTarget | undefined {
  const parsed = parseTransferKey(key);
  if (!board || !parsed) return undefined;
  if (parsed.kind === 'card') {
    const card = board.cards.find((item) => item.id === parsed.id);
    // Client-only optimistic rows have no server id yet: not grabbable, not a drop target.
    return card && !card.pending ? { kind: 'card', card } : undefined;
  }
  const group = board.groups.find((item) => item.id === parsed.id);
  return group ? { kind: 'group', group } : undefined;
}

/** Whether a Card or Card Group can be picked up at all: move or grouping rights. */
export function canGrabTransferItem(
  board: BoardViewDTO | null,
  itemKey: string,
): boolean {
  if (!board) return false;
  const item = findTransferTarget(board, itemKey);
  if (!item) return false;
  if (item.kind === 'card') {
    return (
      canManageCard(board, item.card) ||
      (canManageGrouping(board) && canInteractWithCard(board, item.card))
    );
  }
  return canManageGroup(board, item.group, board.cards);
}

// A home-Column drop is an allowed no-op. An invalid destination is rejected.
function planBoardDrop(
  board: BoardViewDTO | null,
  itemKey: string,
  targetKey: string,
): BoardTransferMove | null | false {
  if (!board || board.isLocked) return false;
  const item = findTransferTarget(board, itemKey);
  if (!item) return false;

  const isCardTarget = targetKey.startsWith(BOARD_TARGET_PREFIX);
  const landing = isCardTarget
    ? findTransferTarget(board, targetKey.slice(BOARD_TARGET_PREFIX.length))
    : undefined;
  if (isCardTarget && (!landing || item.kind !== 'card')) return false;
  const columnId = landing
    ? (landing.kind === 'card' ? landing.card : landing.group).columnId
    : targetKey;
  if (!board.columns.some((column) => column.id === columnId)) return false;

  if (item.kind === 'group') {
    if (!canManageGroup(board, item.group, board.cards)) return false;
    if (columnId === item.group.columnId) return null;
    return { kind: 'move-group', groupId: item.group.id, targetColumnId: columnId };
  }
  if (!landing || columnId !== item.card.columnId) {
    if (!canManageCard(board, item.card)) return false;
    if (columnId === item.card.columnId) return null;
    return { kind: 'move-card', cardId: item.card.id, targetColumnId: columnId };
  }
  if (landing.kind === 'group') {
    if (!canMergeCard(board, item.card.id, 'group', landing.group.id)) return false;
    return { kind: 'group-with-group', cardId: item.card.id, targetGroupId: landing.group.id };
  }
  const target = landing.card;
  if (!canMergeCard(board, item.card.id, 'card', target.id)) return false;
  return { kind: 'group-with-card', cardId: item.card.id, targetCardId: target.id };
}

function dropTargetColumn(
  board: BoardViewDTO | null,
  targetKey: string,
): string | undefined {
  if (!targetKey.startsWith(BOARD_TARGET_PREFIX)) {
    return board?.columns.some((column) => column.id === targetKey) ? targetKey : undefined;
  }
  const landing = findTransferTarget(board, targetKey.slice(BOARD_TARGET_PREFIX.length));
  if (!landing) return undefined;
  return landing.kind === 'card' ? landing.card.columnId : landing.group.columnId;
}

// A Card or Card Group dropped back on its own Group is a no-op, not a
// rejected destination. The plan reports it as false to keep the old
// drop-target eligibility; release handling must not surface an error for it.
function isNoOpDrop(
  board: BoardViewDTO | null,
  itemKey: string,
  targetKey: string,
): boolean {
  if (!targetKey.startsWith(BOARD_TARGET_PREFIX)) return false;
  const item = findTransferTarget(board, itemKey);
  const landing = findTransferTarget(board, targetKey.slice(BOARD_TARGET_PREFIX.length));
  if (!item || !landing) return false;
  if (item.kind === 'group') {
    return landing.kind === 'group'
      ? landing.group.id === item.group.id
      : landing.card.groupId === item.group.id;
  }
  if (landing.kind === 'group') return landing.group.cardIds.includes(item.card.id);
  return landing.card.id === item.card.id
    || (landing.card.groupId !== null && landing.card.groupId === item.card.groupId);
}

function isQuietDrop(
  board: BoardViewDTO | null,
  itemKey: string,
  targetKey: string,
): boolean {
  if (isNoOpDrop(board, itemKey, targetKey)) return true;
  const item = findTransferTarget(board, itemKey);
  if (!item) return false;
  const sourceColumn = item.kind === 'card' ? item.card.columnId : item.group.columnId;
  return dropTargetColumn(board, targetKey) === sourceColumn;
}

export function acceptsBoardDrop(
  board: BoardViewDTO | null,
  itemKey: string,
  targetKey: string,
): boolean {
  return planBoardDrop(board, itemKey, targetKey) !== false;
}

/**
 * The commit seam: which mutation a finished transfer stands for, or null.
 * `to` is a Column id, or an `on:`-prefixed Card / Card Group target.
 */
export function resolveBoardTransferMove(
  board: BoardViewDTO | null,
  move: { key: string; to: string },
): BoardTransferMove | null {
  return planBoardDrop(board, move.key, move.to) || null;
}

/**
 * The transfer lists value: each Column's rendered stream order, an empty
 * target list per visible loose Card, and — per visible Card Group — the
 * member list under its drop-zone key, so grouped Cards stay grabbable and a
 * held draft rebases against the value while hovering (#52).
 */
export function buildBoardTransferLists(
  view: BoardViewProjection | null,
): TransferLists {
  const lists: TransferLists = {};
  for (const bucket of view?.columnViews ?? []) {
    const keys: string[] = [];
    for (const item of bucket.items) {
      keys.push(item.key);
      lists[BOARD_TARGET_PREFIX + item.key] =
        item.kind === 'group'
          ? item.cards.map((card) => `card:${card.id}`)
          : [];
    }
    lists[bucket.id] = keys;
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
  onRejectedDrop: () => void;
}

interface BoardTransferState {
  lists: TransferLists;
  moving: TransferDraft | null;
}

function transferTargetLabel(
  board: BoardViewDTO | null,
  itemKey: string,
): string | undefined {
  const item = findTransferTarget(board, itemKey);
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
  const label = transferTargetLabel(board, `${target.kind}:${target.id}`);
  return label && `${label} (${target.kind === 'card' ? 'Card' : 'Card Group'})`;
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

export const boardTransfer = definePrimitive({
  name: 'board-transfer',
  options: { lists: 'value', board: 'callback', commit: 'callback', onRejectedDrop: 'callback' },
  state: (options: BoardTransferOptions) => ({
    lists: options.lists,
    moving: null as TransferDraft | null,
  }),
  sync: (options: BoardTransferOptions) => ({ lists: options.lists }),
  api: (context) => {
    const read = () => context.options();
    let announcedSave = false;
    let release: { key: string; list: string } | undefined;
    let stopTrackingRelease: (() => void) | undefined;
    context.onDestroy(() => stopTrackingRelease?.());
    const transfer = createTransfer(context, {
      key: 'lists',
      draft: 'moving',
      set: (_lists, details) => {
        const options = read();
        const list = release?.key === details.key ? release.list : details.to;
        const move = planBoardDrop(options.board(), details.key, list);
        if (move === false && !isQuietDrop(options.board(), details.key, list)) options.onRejectedDrop();
        if (!move) return false;
        announcedSave = true;
        options.commit(move);
        return true;
      },
      accepts: (key, target) => acceptsBoardDrop(read().board(), key, target),
      disabled: (key) => !canGrabTransferItem(read().board(), key),
      label: (key) => transferTargetLabel(read().board(), key),
      listLabel: (list) => boardListLabel(read().board(), list),
      message: (message) => {
        if (message.type !== 'drop' || !announcedSave) return transferMessage(message);
        announcedSave = false;
        return `Saving move of ${message.label} to ${message.list}.`;
      },
      order: () => (read().board()?.columns ?? []).map((column) => column.id),
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
        zone.unbind();
      };
    }

    function trackPointerRelease(event: PointerEvent, key: string): void {
      if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return;
      const document = event.target.ownerDocument;
      stopTrackingRelease?.();
      function cleanup() {
        document.removeEventListener('pointerup', finish, true);
        document.removeEventListener('pointercancel', finish, true);
        stopTrackingRelease = undefined;
      }
      function finish(end: PointerEvent) {
        if (event.pointerId !== end.pointerId) return;
        cleanup();
        const state = context.store.get();
        if (end.type !== 'pointerup' || !state.moving?.pointer || state.moving.key !== key) return;

        // The SDK can retain the last accepted hover. Check the actual release
        // point, deepest zone first, so a Card inside a Column can fall back to
        // its enclosing Column for a move that Card cannot itself receive.
        const candidates: { key: string; el: HTMLElement }[] = [];
        for (const [list, { el }] of zones) {
          if (list === BOARD_TARGET_PREFIX + key || !el.isConnected) continue;
          const { left, right, top, bottom } = el.getBoundingClientRect();
          if (end.clientX < left || end.clientX >= right || end.clientY < top || end.clientY >= bottom) continue;
          candidates.push({ key: list, el });
        }
        const depth = (el: HTMLElement): number => {
          let value = 0;
          for (let node: HTMLElement | null = el; node; node = node.parentElement) value += 1;
          return value;
        };
        candidates.sort((a, b) => depth(b.el) - depth(a.el));

        const board = read().board();
        let landing: { key: string; el: HTMLElement } | undefined;
        for (const candidate of candidates) {
          const move = planBoardDrop(board, key, candidate.key);
          if (move) {
            landing = candidate;
            break;
          }
          if (move === null) {
            transfer.cancel();
            return;
          }
        }
        if (!landing) {
          transfer.cancel();
          if (candidates.length > 0 && !candidates.some((candidate) => isQuietDrop(board, key, candidate.key))) {
            read().onRejectedDrop();
          }
          return;
        }
        release = { key, list: landing.key };
        queueMicrotask(() => { release = undefined; });
        if (listWith(transfer.lists(state), key) !== landing.key) transfer.moveTo(landing.key, 0);
      }
      stopTrackingRelease = cleanup;
      document.addEventListener('pointerup', finish, true);
      document.addEventListener('pointercancel', finish, true);
      transfer.pointerdown(event, key);
    }

    function handleTransferKey(event: KeyboardEvent, key: string): boolean {
      const draft = context.store.get().moving;
      if (draft?.key === key && !draft.pointer && (event.key === ' ' || event.key === 'Enter')) {
        const list = listWith(draft.lists, key);
        if (list && list !== draft.from && planBoardDrop(read().board(), key, list) === false) {
          event.preventDefault();
          event.stopPropagation();
          transfer.cancel();
          if (!isQuietDrop(read().board(), key, list)) read().onRejectedDrop();
          return true;
        }
      }
      return transfer.keydown(event, key);
    }

    function overList(state: BoardTransferState, listKey: string): boolean {
      const moving = state.moving;
      return !!moving && listWith(transfer.lists(state), moving.key) === listKey;
    }

    // The dragged item's home Column, so its own Column never poses as a target.
    function homeColumnOf(itemKey: string): string | undefined {
      const item = findTransferTarget(read().board(), itemKey);
      if (!item) return undefined;
      return item.kind === 'card' ? item.card.columnId : item.group.columnId;
    }

    return {
      transfer: {
        ...transfer,
        keydown: handleTransferKey,
        pointerdown: trackPointerRelease,
        bindColumn: (el: HTMLElement, columnId: string) => bindZone(el, columnId),
        bindTarget: (el: HTMLElement, itemKey: string) =>
          bindZone(el, BOARD_TARGET_PREFIX + itemKey),
        armedColumn: (state: BoardTransferState, columnId: string) =>
          state.moving !== null && homeColumnOf(state.moving.key) !== columnId,
        overColumn: (state: BoardTransferState, columnId: string) =>
          state.moving !== null &&
          homeColumnOf(state.moving.key) !== columnId &&
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
    'group-members': slot<{ value: string }>({
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

