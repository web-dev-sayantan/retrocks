import { announce } from '@ui-sdk/core';
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@ui-sdk/solid/dialog';
import {
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@ui-sdk/solid/menu';
import { Radio, RadioGroup } from '@ui-sdk/solid/radio';
import { ScrollArea, ScrollAreaContent, ScrollAreaViewport } from '@ui-sdk/solid/scroll-area';
import { Tabs, TabsList, TabsTab } from '@ui-sdk/solid/tabs';
import { usePrimitive } from '@ui-sdk/solid/primitive';
import { Textarea } from '@ui-sdk/solid/textarea';
import { useShortcut } from '@ui-sdk/solid/shortcuts';
import {
  Check,
  Columns3,
  Ellipsis,
  Eye,
  EyeOff,
  Flag,
  Lock,
  Pencil,
  Plus,
  Vote,
  X,
} from 'lucide';
import {
  For,
  Repeat,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createStore,
  flush,
  onSettled,
  untrack,
} from 'solid-js';

import { dispatchBoardCommand } from '../lib/board-actions';
import { createInlineEditSession, type InlineEditOutcome } from '../lib/inline-edit';
import {
  canAddColumn as canAddBoardColumn,
  canControlFacilitation,
  canFacilitate,
  canManageGrouping,
} from '../lib/board-permissions';
import {
  createBoardController,
  type BoardCommandDispatcher,
} from '../lib/board-controller';
import type { LiveTransport } from '../lib/live-stream';
import {
  buildBoardTransferLists,
  boardTransfer,
  type BoardTransferMove,
} from '../lib/board-transfer';
import {
  COLUMN_ACCENTS,
  MAX_BOARD_TITLE_LENGTH,
  MAX_CARD_CONTENT_LENGTH,
  MAX_COLUMN_TITLE_LENGTH,
  type BoardViewDTO,
  type ColumnAccent,
} from '../lib/board-types';
import {
  createBoardProjection,
  type BoardQuickFilter,
  type BoardSortMode,
} from '../lib/board-view';
import {
  RETROSPECTIVE_PRIME_DIRECTIVE,
  logPrivacyColophon,
  matchSecretSearch,
} from '../lib/easter-eggs';
import { recordRecentBoard, removeRecentBoard } from '../lib/recent-boards';
import { retroSetupPath } from '../lib/routes';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import { toggleTheme } from '../lib/theme';
import { createTimerChime, isTimerAudioMuted } from '../lib/timer-chime';
import ActionItemsDrawer from './ActionItemsDrawer';
import BoardFilterBar from './BoardFilterBar';
import BoardMenuContent from './BoardMenuContent';
import BoardVotingSettings from './BoardVotingSettings';
import {
  BoardWorkspaceContext,
  type BoardWorkspaceContextValue,
} from './BoardWorkspaceContext';
import CardDetailDrawer from './CardDetailDrawer';
import ColumnPanel from './ColumnPanel';
import CountdownTimer from './CountdownTimer';
import ExportBoardMenu from './ExportBoardMenu';
import { CloseIcon } from './Icons';
import LucideIcon from './LucideIcon';
import PageMessage from './PageMessage';
import PrintBoard from './PrintBoard';
import ShareBoard from './ShareBoard';
import ThemeToggle from './ThemeToggle';

export interface BoardWorkspaceProps {
  board: BoardViewDTO | null;
  boardId: string;
  homeHref?: string;
  dispatchCommand?: BoardCommandDispatcher;
  liveTransport?: LiveTransport;
  liveReconnectKey?: number;
}

function BoardHomeLink(props: { href: string; class: string }) {
  return (
    <a
      href={props.href}
      aria-label="Retrocks home"
      class={[
        'spring-press min-h-11 min-w-11 w-fit items-center justify-center gap-2 rounded-full px-2 text-sm font-semibold tracking-tight text-text sm:min-h-10 sm:min-w-10 sm:pr-3',
        'hover:bg-surface-subtle/80 active:bg-surface-subtle',
        'board-focus-ring',
        props.class,
      ]}
    >
      <span aria-hidden="true" class="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast">
        <LucideIcon icon={Columns3} class="size-3.5" strokeWidth={2.1} />
      </span>
      <span class="hidden sm:inline">Retrocks</span>
    </a>
  );
}

function getResponsiveGridClass(columnCount: number, showAddColumn: boolean): string {
  if (columnCount <= 1) return showAddColumn
    ? 'sm:grid sm:grid-cols-[minmax(0,1fr)_auto] lg:max-w-3xl'
    : 'sm:grid sm:grid-cols-1 lg:max-w-2xl';
  if (columnCount === 2) return showAddColumn
    ? 'sm:grid sm:grid-cols-2 lg:grid-cols-[repeat(2,minmax(0,1fr))_auto]'
    : 'sm:grid sm:grid-cols-2';
  if (columnCount === 3) return showAddColumn
    ? 'sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto]'
    : 'sm:grid sm:grid-cols-2 lg:grid-cols-3';
  if (columnCount === 4) return showAddColumn
    ? 'sm:grid sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]'
    : 'sm:grid sm:grid-cols-2 lg:grid-cols-4';
  return 'sm:flex sm:overflow-x-auto sm:snap-x sm:snap-mandatory sm:pb-4';
}

function getAddColumnSlotClass(columnCount: number): string {
  if (columnCount === 3) {
    return 'lg:col-span-3 lg:justify-self-end xl:col-span-1 xl:justify-self-start';
  }
  if (columnCount === 4) {
    return 'lg:col-span-4 lg:justify-self-end 2xl:col-span-1 2xl:justify-self-start';
  }
  return '';
}

export default function BoardWorkspace(props: BoardWorkspaceProps) {
  // The route ID scopes viewer-local state across live snapshots.
  return (
    <For each={[props.boardId]}>
      {(boardId) => <BoardWorkspaceSession {...props} boardId={boardId} />}
    </For>
  );
}

function BoardWorkspaceSession(props: BoardWorkspaceProps) {
  // The Board controller owns the store, live stream, server clock,
  // mutation handlers, and pending state; this component keeps layout and UI state.
  const controller = createBoardController({
    board: () => props.board,
    dispatchCommand: (boardId, command) =>
      (props.dispatchCommand ?? dispatchBoardCommand)(boardId, command),
    liveTransport: untrack(() => props.liveTransport),
    liveReconnectKey: () => props.liveReconnectKey ?? 0,
    onDramaticReveal: runDramaticReveal,
  });

  const [isDramaticReveal, setIsDramaticReveal] = createSignal(false);
  const revealChime = createTimerChime();
  let dramaticRevealTimer: ReturnType<typeof setTimeout> | undefined;

  function clearDramaticReveal(): void {
    if (dramaticRevealTimer !== undefined) {
      clearTimeout(dramaticRevealTimer);
      dramaticRevealTimer = undefined;
    }
    setIsDramaticReveal(false);
  }

  function runDramaticReveal(): void {
    clearDramaticReveal();
    setIsDramaticReveal(true);
    dramaticRevealTimer = setTimeout(() => {
      dramaticRevealTimer = undefined;
      setIsDramaticReveal(false);
    }, 950);
    if (!isTimerAudioMuted()) {
      revealChime.playRevealShimmer();
    }
  }

  onSettled(() => () => {
    clearDramaticReveal();
    revealChime.dispose();
  });

  // More disclosure and Board Settings
  const [boardMenuOpen, setBoardMenuOpen] = createSignal(false);
  const [isPrinting, setIsPrinting] = createSignal(false);
  onSettled(() => {
    function preparePrint(): void {
      setIsPrinting(true);
      flush();
    }
    function finishPrint(): void {
      setIsPrinting(false);
    }
    window.addEventListener('beforeprint', preparePrint);
    window.addEventListener('afterprint', finishPrint);
    return () => {
      window.removeEventListener('beforeprint', preparePrint);
      window.removeEventListener('afterprint', finishPrint);
    };
  });
  const [isBoardSettingsOpen, setIsBoardSettingsOpen] = createSignal(false);
  let boardMenuTriggerEl: HTMLButtonElement | undefined;

  function closeBoardMenu(restoreFocus: boolean): void {
    setBoardMenuOpen(false);
    if (restoreFocus) {
      boardMenuTriggerEl?.focus();
    }
  }

  // Board title inline editing: unified session owns edit, input, IME, focus-out, and fallback focus.
  let renameBoardButtonEl: HTMLButtonElement | undefined;
  const boardTitleEdit = createInlineEditSession({
    value: () => controller.board()?.title ?? '',
    target: () => controller.board()?.id,
    disabled: () => {
      const board = controller.board();
      return !board || !canControlFacilitation(board);
    },
    save: saveBoardTitleText,
    fallbackFocus: () => {
      renameBoardButtonEl?.focus();
      if (document.activeElement === document.body) boardMenuTriggerEl?.focus();
    },
    acceptsTarget: (target) => !(target instanceof Element && target.closest('button')),
  });
  const isRenamingBoard = boardTitleEdit.isEditing;

  // Add Column inline composer state
  const [isAddingColumn, setIsAddingColumn] = createSignal(false);
  const [newColumnTitle, setNewColumnTitle] = createSignal('');
  const [newColumnAccent, setNewColumnAccent] =
    createSignal<ColumnAccent>('slate');
  const [newColumnIsAction, setNewColumnIsAction] = createSignal(false);
  const canAddColumn = createMemo(() => {
    const board = controller.board();
    return !!board && canAddBoardColumn(board);
  });
  let newColumnTitleEl: HTMLInputElement | undefined;

  function openAddColumn(): void {
    closeBoardMenu(false);
    setIsAddingColumn(true);
  }

  // The controller-opened dialog needs focus after its input has mounted.
  createEffect(isAddingColumn, (open) => {
    if (open) newColumnTitleEl?.focus();
  });

  // Mobile active Column + swipe + bottom quick-add state
  const [isMobileBoard, setIsMobileBoard] = createSignal(false);
  onSettled(() => {
    const media = window.matchMedia?.('(width < 40rem)');
    if (!media) return;
    const update = () => setIsMobileBoard(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
  const [activeColumnId, setActiveColumnId] = createSignal<string | null>(null);
  const [mobileDrafts, setMobileDrafts] = createStore<Record<string, { content: string; error: string | null }>>({});
  const [isSubmittingMobileCard, setIsSubmittingMobileCard] =
    createSignal(false);
  let swipeStart: { x: number; y: number; touchId: number } | undefined;
  let columnTabListEl: HTMLDivElement | undefined;
  let columnTabViewportEl: HTMLDivElement | undefined;
  let mobileComposerBarEl: HTMLDivElement | undefined;

  // Card Detail Drawer state
  const [openCardDetailId, setOpenCardDetailId] = createSignal<string | null>(
    null,
  );

  const [isCardDetailOpen, setIsCardDetailOpen] = createSignal(false);
  let cardDetailTrigger: HTMLButtonElement | undefined;
  let boardMain: HTMLElement | undefined;

  // Action Items Drawer state
  const [isActionItemsOpen, setIsActionItemsOpen] = createSignal(false);
  let actionItemsHeaderEntry: HTMLButtonElement | undefined;
  let actionItemsOpener: HTMLElement | null = null;

  function openActionItems(): void {
    actionItemsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIsActionItemsOpen(true);
  }

  function isAvailableFocusTarget(target: HTMLElement | null | undefined): target is HTMLElement {
    if (!target?.isConnected || target === document.body || target.closest('[hidden], :disabled')) {
      return false;
    }
    if (getComputedStyle(target).visibility !== 'visible') return false;
    for (let element: HTMLElement | null = target; element; element = element.parentElement) {
      if (getComputedStyle(element).display === 'none') return false;
    }
    return true;
  }

  function actionItemsFocusTarget(): HTMLElement | undefined {
    return [actionItemsOpener, actionItemsHeaderEntry, boardMenuTriggerEl].find(isAvailableFocusTarget);
  }

  const openActionItemCount = createMemo(
    () =>
      controller.board()?.cards.filter(
        (card) => card.isActionItem && !card.actionDone,
      ).length ?? 0,
  );

  // Viewer-local Search, Quick Filter & Sort state (never persisted/broadcast)
  const [searchQuery, setSearchQuery] = createSignal('');
  const [quickFilter, setQuickFilter] = createSignal<BoardQuickFilter>('all');
  const [sortMode, setSortMode] = createSignal<BoardSortMode>('newest');
  let searchInputEl: HTMLInputElement | undefined;
  let mobileComposerEl: HTMLTextAreaElement | undefined;
  const columnComposers = new Map<string, HTMLTextAreaElement>();

  function resetFilters(): void {
    setSearchQuery('');
    setQuickFilter('all');
  }

  function registerColumnComposer(
    columnId: string,
    el: HTMLTextAreaElement | null,
  ): void {
    if (el) {
      columnComposers.set(columnId, el);
    } else {
      columnComposers.delete(columnId);
    }
  }

  // Mirror the controller's Board lifecycle into workspace UI state: when the
  // controller board is removed, close every overlay and hand focus to the
  // not-found heading.
  createEffect(
    () => controller.board()?.id ?? null,
    (boardId, previousBoardId) => {
      if (boardId) return;
      if (previousBoardId) unavailableHeading?.focus();
      setIsAddingColumn(false);
      setOpenCardDetailId(null);
      setIsCardDetailOpen(false);
      setIsActionItemsOpen(false);
      setBoardMenuOpen(false);
      setIsBoardSettingsOpen(false);
    },
  );

  createEffect(
    () => controller.board()?.isLocked ?? false,
    (locked) => {
      if (locked) {
        setIsAddingColumn(false);
      }
    },
  );

  const boardModes = createMemo(() => {
    const board = controller.board();
    return board && {
      id: board.id,
      isBlurred: board.isBlurred,
      blindVoting: board.blindVoting,
      isLocked: board.isLocked,
    };
  });
  const boardModeStatus = createMemo<{
    modes: ReturnType<typeof boardModes>;
    announcement: string;
  }>((previous) => {
    const modes = boardModes();
    const before = previous?.modes;
    if (!modes || before?.id !== modes.id) return { modes, announcement: '' };

    const changes: string[] = [];
    if (modes.isBlurred !== before.isBlurred) {
      changes.push(modes.isBlurred ? 'Private Mode is on.' : 'All Cards revealed.');
    }
    if (modes.blindVoting !== before.blindVoting) {
      changes.push(modes.blindVoting ? 'Blind Voting is on.' : 'Blind Voting is off.');
    }
    if (modes.isLocked !== before.isLocked) {
      changes.push(modes.isLocked ? 'Board locked.' : 'Board unlocked.');
    }
    return { modes, announcement: changes.join(' ') };
  });

  let unavailableHeading: HTMLHeadingElement | undefined;

  onSettled(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateComposerInset = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      mobileComposerBarEl?.style.setProperty('--keyboard-inset', `${inset}px`);
    };
    viewport.addEventListener('resize', updateComposerInset);
    viewport.addEventListener('scroll', updateComposerInset);
    return () => {
      viewport.removeEventListener('resize', updateComposerInset);
      viewport.removeEventListener('scroll', updateComposerInset);
    };
  });

  // Record / scrub localStorage Recent Boards cleanly (including after Board rename)
  createEffect(
    () => {
      const board = controller.board();
      return {
        boardId: props.boardId,
        board: board
          ? {
              id: board.id,
              title: board.title,
              isFacilitator: board.isFacilitator,
            }
          : null,
      };
    },
    ({ boardId, board }) => {
      if (board) {
        recordRecentBoard(board);
      } else if (boardId) {
        removeRecentBoard(boardId);
      }
    },
  );

  const resolvedActiveColumnIndex = createMemo(() => {
    const cols = controller.board()?.columns ?? [];
    if (cols.length === 0) return 0;
    const currentId = activeColumnId();
    if (currentId) {
      const found = cols.findIndex((c) => c.id === currentId);
      if (found !== -1) return found;
    }
    return 0;
  });

  const activeMobileColumn = createMemo(() => {
    const cols = controller.board()?.columns ?? [];
    return cols[resolvedActiveColumnIndex()] ?? null;
  });

  // The one keyed projection (#51): identity, ordering, totals, and the
  // per-Column Card/Group lists all come from here — no regrouping memos.
  const view = createBoardProjection(() => controller.board(), {
    query: searchQuery,
    filter: quickFilter,
    sortMode,
  });

  let latestTransfer = 0;
  const pendingTransfers = new Map<string, number>();
  onSettled(() => () => {
    latestTransfer += 1;
    pendingTransfers.clear();
  });

  function sendTransferMove(
    move: BoardTransferMove,
    onFailure: (message: string) => void,
  ): Promise<boolean> {
    switch (move.kind) {
      case 'move-card': return controller.moveCard(move.cardId, move.targetColumnId, onFailure);
      case 'move-group': return controller.moveCardGroup(move.groupId, move.targetColumnId, onFailure);
      case 'group-with-card': return controller.groupCard(move.cardId, 'card', move.targetCardId, onFailure);
      case 'group-with-group': return controller.groupCard(move.cardId, 'group', move.targetGroupId, onFailure);
    }
  }

  async function commitTransferMove(move: BoardTransferMove): Promise<void> {
    const transferId = ++latestTransfer;
    const item = move.kind === 'move-group' ? `group:${move.groupId}` : `card:${move.cardId}`;
    pendingTransfers.set(item, transferId);
    controller.clearError();
    const moved = await sendTransferMove(move, (message) => {
      if (pendingTransfers.get(item) === transferId) controller.reportError(message);
    });
    if (pendingTransfers.get(item) === transferId) pendingTransfers.delete(item);
    if (moved && transferId === latestTransfer) announce('Move saved.');
  }

  const transfer = usePrimitive(boardTransfer, () => ({
    lists: buildBoardTransferLists(view),
    board: () => controller.board(),
    commit: (move) => { void commitTransferMove(move); },
    onRejectedDrop: () => {
      controller.reportError('This move is no longer available. Choose another destination.');
    },
  }));

  const secretSearch = createMemo(() => {
    if (!view.hasSearchQuery || view.matchedCardCount !== 0) return;
    if (view.totalCardCount !== 0 && quickFilter() !== 'all') return;
    return matchSecretSearch(searchQuery());
  });

  const isHorizontalSnap = createMemo(
    () => (controller.board()?.columns.length ?? 0) >= 5,
  );

  const openDetailCard = createMemo(() => {
    const id = openCardDetailId();
    if (!id) return null;
    const card = view.cards.find((item) => item.id === id) ?? null;
    if (!card || card.redacted) return null;
    return card;
  });

  createEffect(
    () => ({ id: openCardDetailId(), card: openDetailCard() }),
    ({ id, card }) => {
      if (id !== null && card === null) {
        setOpenCardDetailId(null);
        setIsCardDetailOpen(false);
      }
    },
  );

  // Global Board shortcuts. useShortcut pauses them while someone types and
  // while a modal layer is open; shortcuts.list() feeds the help surface.
  useShortcut(
    () => (controller.board() ? '/' : null),
    () => {
      if (searchInputEl?.isConnected) {
        searchInputEl.focus();
        searchInputEl.select();
      }
    },
    { description: 'Search cards' },
  );

  useShortcut(
    () => {
      const board = controller.board();
      return board && !board.isLocked ? 'n' : null;
    },
    () => {
      const targetCol = activeMobileColumn();
      const composer = targetCol ? columnComposers.get(targetCol.id) : undefined;
      if (composer?.isConnected) {
        composer.focus();
        if (document.activeElement === composer) {
          composer.scrollIntoView?.({ block: 'nearest' });
          return;
        }
      }
      if (mobileComposerEl?.isConnected) {
        mobileComposerEl.focus();
      }
    },
    { description: 'Add a card' },
  );

  useShortcut(
    () => (controller.board() ? 'a' : null),
    openActionItems,
    { description: 'Toggle Action Items' },
  );

  useShortcut(
    () => {
      const board = controller.board();
      return board && canControlFacilitation(board) ? 'b' : null;
    },
    () => {
      void togglePrivateMode();
    },
    { description: 'Toggle Private Mode' },
  );

  async function togglePrivateMode(options?: { dramatic?: boolean }): Promise<void> {
    const board = controller.board();
    if (!board || !canControlFacilitation(board) || controller.isChangingPrivateMode()) return;
    const { isBlurred } = board;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dramatic = isBlurred && Boolean(options?.dramatic) && !prefersReducedMotion;
    if (dramatic && !isTimerAudioMuted()) {
      revealChime.prepare();
    } else if (!isBlurred) {
      clearDramaticReveal();
    }
    // The controller runs the mutation and invokes onDramaticReveal before applying.
    await controller.togglePrivateMode(dramatic);
  }

  async function saveBoardTitleText(text: string): Promise<InlineEditOutcome> {
    const board = controller.board();
    const trimmed = text.trim();
    if (!board || trimmed.length === 0) return false;
    return (await controller.renameBoard(trimmed)) ? true : false;
  }

  function handleOpenCardDetail(cardId: string, trigger: HTMLButtonElement): void {
    const board = controller.board();
    if (!board) return;
    const card = board.cards.find((item) => item.id === cardId);
    if (!card || card.redacted || card.pending) return;
    cardDetailTrigger = trigger;
    setOpenCardDetailId(cardId);
    setIsCardDetailOpen(true);
  }

  function cardDetailFocusTarget(): HTMLElement | undefined {
    return isAvailableFocusTarget(cardDetailTrigger) ? cardDetailTrigger : boardMain;
  }

  async function handleAddColumn(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const board = controller.board();
    const trimmed = newColumnTitle().trim();
    if (!board || trimmed.length === 0 || controller.isSavingColumn()) return;
    const column = await controller.addColumn({
      title: trimmed,
      accent: newColumnAccent(),
      isActionColumn: newColumnIsAction(),
    });
    if (column) {
      setActiveColumnId(column.id);
      setNewColumnTitle('');
      setNewColumnAccent('slate');
      setNewColumnIsAction(false);
      setIsAddingColumn(false);
    }
  }

  function updateMobileDraft(columnId: string, content: string): void {
    setMobileDrafts((drafts) => {
      drafts[columnId] = { content, error: null };
    });
  }

  async function handleMobileQuickAdd(): Promise<void> {
    const targetCol = activeMobileColumn();
    if (!targetCol || isSubmittingMobileCard()) return;
    const { id } = targetCol;
    const draft = mobileDrafts[id]?.content ?? '';
    if (draft.trim().length === 0) return;
    setIsSubmittingMobileCard(true);
    updateMobileDraft(id, draft);
    try {
      const error = await controller.createCard(id, draft.trim());
      setMobileDrafts((drafts) => {
        const current = drafts[id];
        if (current?.content === draft) {
          drafts[id] = error === null ? { content: '', error: null } : { content: draft, error };
        }
      });
    } finally {
      setIsSubmittingMobileCard(false);
    }
  }

  function handleMobileComposerKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void handleMobileQuickAdd();
    }
  }

  createEffect(resolvedActiveColumnIndex, (index) => {
    const viewport = columnTabViewportEl;
    const tab = columnTabListEl?.querySelectorAll<HTMLElement>('[role=tab]')[index];
    if (!viewport || !tab) return;
    const rail = viewport.getBoundingClientRect();
    const item = tab.getBoundingClientRect();
    const offset = item.left < rail.left ? item.left - rail.left - 12
      : item.right > rail.right ? item.right - rail.right + 12 : 0;
    if (offset !== 0) viewport.scrollLeft += offset;
  });

  function handleTouchStart(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    if (!touch || (event.touches && event.touches.length > 1) ||
        (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, [data-board-overlay], [role=tablist]'))) {
      swipeStart = undefined;
      return;
    }
    swipeStart = { x: touch.clientX, y: touch.clientY, touchId: touch.identifier };
  }

  function handleTouchEnd(event: TouchEvent): void {
    const start = swipeStart;
    swipeStart = undefined;
    const touch = event.changedTouches[0];
    if (!start || !touch || touch.identifier !== start.touchId) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

    const cols = controller.board()?.columns ?? [];
    const current = resolvedActiveColumnIndex();
    const next = cols[current + (dx < 0 ? 1 : -1)];
    if (next) setActiveColumnId(next.id);
  }

  return (
    <Show
      when={controller.board()}
      fallback={
        <div class="flex min-h-dvh flex-col">
          <header class="pointer-events-none sticky top-0 z-30 px-4 pt-3 pb-1 sm:px-6 sm:pt-4">
            <div class="mx-auto flex max-w-6xl justify-center">
              <div class="board-island pointer-events-auto inline-flex w-full max-w-md items-center justify-between gap-2 rounded-full px-2 py-1.5 sm:w-auto sm:min-w-80 sm:gap-3">
                <a
                  href={props.homeHref ?? '/'}
                  class={[
                    'spring-press inline-flex min-h-10 items-center gap-2 rounded-full pl-2 pr-3 text-sm font-semibold tracking-tight text-text',
                    'hover:bg-surface-subtle/80 active:bg-surface-subtle',
                    'board-focus-ring',
                  ]}
                >
                  <span
                    aria-hidden="true"
                    class="inline-flex size-6 items-center justify-center rounded-full bg-accent text-accent-contrast"
                  >
                    <LucideIcon icon={Columns3} class="size-3.5" strokeWidth={2.1} />
                  </span>
                  <span>Retrocks</span>
                </a>
                <ThemeToggle variant="island" />
              </div>
            </div>
          </header>

          <PageMessage
            title="Board not found or expired"
            message="This Board may have been deleted by a Facilitator or expired after inactivity."
            headingRef={(element) => { unavailableHeading = element; }}
          >
            <a href={retroSetupPath} class="page-message-action">
              Create a new board
            </a>
          </PageMessage>
        </div>
      }
    >
      {(board) => {
        const workspaceContext: BoardWorkspaceContextValue = {
          get columns() { return view.columns; },
          get voting() { return controller.voting(); },
          get isFacilitator() { return board().isFacilitator; },
          get isLocked() { return board().isLocked; },
          get isBlurred() { return board().isBlurred; },
          get blindVoting() { return board().blindVoting; },
          get canGroupCards() { return canManageGrouping(board()); },
          get nowMs() { return controller.nowMs(); },
          transfer,
          actions: controller,
          openCardDetail: handleOpenCardDetail,
        };
        return (
          <BoardWorkspaceContext value={workspaceContext}>
            <div
              ref={() => logPrivacyColophon()}
              class="board-workspace flex min-h-dvh flex-col bg-canvas"
              data-board-print-ready={isPrinting() ? "" : undefined}
              data-dramatic-reveal={isDramaticReveal() ? 'true' : undefined}
            >
          <Show when={isPrinting()}>
            <PrintBoard board={board()} />
          </Show>
          <div aria-live="polite" aria-atomic="true" class="sr-only">
            {boardModeStatus().announcement}
          </div>
          <header role="banner" class="board-masthead">
            <div class="board-island board-masthead-island">
              <BoardHomeLink href={props.homeHref ?? '/'} class="hidden justify-self-start sm:inline-flex" />
              <div data-renaming={isRenamingBoard() ? "" : undefined}
                class="board-masthead-title flex h-7 min-w-0 max-w-full items-center px-3 sm:h-10 sm:justify-center sm:px-0">
                <Show
                  when={!isRenamingBoard()}
                  fallback={
                    <div ref={boardTitleEdit.containerRef} class="flex h-7 w-full max-w-md items-center gap-1.5 sm:h-10">
                      <input
                        ref={boardTitleEdit.inputRef}
                        type="text"
                        aria-label="Board title"
                        maxlength={MAX_BOARD_TITLE_LENGTH}
                        readonly={boardTitleEdit.isSaving()}
                        {...boardTitleEdit.inputProps}
                        class={[
                          'h-11 min-w-0 flex-1 rounded-md border border-control/80 bg-surface px-3.5 text-xl leading-snug font-semibold tracking-[-0.02em] text-text sm:h-9 sm:text-center sm:text-lg',
                          'board-focus-ring',
                        ]}
                      />
                      <button
                        type="button"
                        aria-label="Save Board title"
                        disabled={boardTitleEdit.isSaving() || !boardTitleEdit.hasText()}
                        onClick={boardTitleEdit.submit}
                        class="spring-press inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md bg-accent text-accent-contrast hover:opacity-90 disabled:opacity-50 sm:size-9"
                      >
                        <LucideIcon icon={Check} class="size-4" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel Board rename"
                        onClick={boardTitleEdit.cancel}
                        class="spring-press inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border/80 bg-surface text-text-muted hover:bg-surface-subtle hover:text-text sm:size-9"
                      >
                        <LucideIcon icon={X} class="size-4" strokeWidth={1.9} />
                      </button>
                    </div>
                  }
                >
                  <div
                    {...boardTitleEdit.triggerProps}
                    class="flex h-full max-w-full min-w-0 items-center gap-1 sm:justify-center"
                  >
                    <h1
                      title={
                        canControlFacilitation(board())
                          ? `${board().title} — Double-click to rename`
                          : board().title
                      }
                      class={[
                        'min-w-0 truncate text-xl leading-snug font-semibold tracking-[-0.02em] text-text sm:text-lg',
                        canControlFacilitation(board()) && 'cursor-text touch-manipulation',
                      ]}
                    >
                      {board().title}
                    </h1>
                    <Show when={canControlFacilitation(board())}>
                      <button
                        ref={renameBoardButtonEl}
                        type="button"
                        aria-label="Rename Board"
                        title="Rename Board"
                        data-print-hide="true"
                        onClick={boardTitleEdit.start}
                        class={[
                          'spring-press hidden size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-muted sm:inline-flex',
                          'transition-colors hover:bg-surface-subtle/90 hover:text-text',
                          'board-focus-ring',
                        ]}
                      >
                        <LucideIcon icon={Pencil} class="size-3.5" strokeWidth={1.85} />
                      </button>
                    </Show>
                  </div>
                </Show>
              </div>

              <div data-print-hide="true" class="hidden justify-self-end sm:block">
                <ThemeToggle variant="island" />
              </div>
            </div>
            <div class="board-masthead-toolbar">
              <div role="group" aria-label="Board controls" class="board-masthead-controls">
                <BoardHomeLink href={props.homeHref ?? '/'} class="inline-flex sm:hidden" />
                <div class="min-w-0 flex-1 truncate text-base leading-snug font-semibold tracking-[-0.02em] text-text sm:hidden" title={board().title}>
                  {board().title}
                </div>
                <div class="flex min-w-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
                  <div data-print-hide="true">
                    <Show when={board().id} keyed>
                      {(boardId) => (
                        <CountdownTimer
                          timer={board().timer}
                          clock={controller.timerClock()}
                          canControl={canControlFacilitation(board())}
                          onChange={(change) => controller.changeCountdown(boardId, change)}
                        />
                      )}
                    </Show>
                  </div>

                  <Show when={canControlFacilitation(board())}>
                    <button
                      type="button"
                      data-print-hide="true"
                      data-cta-emphasis={board().isBlurred ? 'primary' : 'secondary'}
                      aria-keyshortcuts="B"
                      title={board().isBlurred ? 'Reveal All (B)' : 'Enable Private Mode (B)'}
                      disabled={controller.isChangingPrivateMode()}
                      onClick={(event) => void togglePrivateMode({ dramatic: event.shiftKey })}
                      class={[
                        'spring-press hidden board-touch-target min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-2 text-[13px] sm:px-3 leading-none font-medium active:opacity-85 sm:inline-flex sm:h-9',
                        'board-focus-ring disabled:cursor-not-allowed disabled:opacity-50',
                        board().isBlurred
                          ? 'border-transparent bg-accent sm:px-3.5 text-accent-contrast shadow-xs hover:opacity-92'
                          : 'border-border/80 bg-surface text-text hover:bg-surface-subtle',
                      ]}
                    >
                      <Show
                        when={board().isBlurred}
                        fallback={<LucideIcon icon={EyeOff} class="size-3.5 shrink-0 text-text-muted" strokeWidth={1.9} />}
                      >
                        <LucideIcon icon={Eye} class="size-3.5 shrink-0" strokeWidth={1.9} />
                      </Show>
                      <span class="sr-only sm:not-sr-only">{board().isBlurred ? 'Reveal All' : 'Private Mode'}</span>
                    </button>
                  </Show>

                  <div data-print-hide="true" class="flex shrink-0 items-center gap-1 sm:gap-2">
                    <button
                      ref={actionItemsHeaderEntry}
                      type="button"
                      aria-keyshortcuts="A"
                      aria-haspopup="dialog"
                      aria-expanded={isActionItemsOpen() ? 'true' : 'false'}
                      title="Action Items (A)"
                      onClick={(event) => {
                        event.currentTarget.focus();
                        openActionItems();
                      }}
                      class={[
                        'spring-press hidden board-touch-target min-w-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-border/80 bg-surface px-3 text-[13px] leading-none font-medium text-text sm:inline-flex sm:h-9',
                        'hover:bg-surface-subtle active:bg-surface-subtle',
                        'board-focus-ring',
                      ]}
                    >
                      <LucideIcon icon={Flag} class="size-3.5 shrink-0 text-text-muted" strokeWidth={1.9} />
                      <span>Action Items</span>{' '}
                      <span class="inline-flex min-w-5 items-center justify-center rounded-full bg-surface-subtle px-1.5 py-0.5 text-xs font-semibold text-text tabular-nums">
                        {openActionItemCount()}
                      </span>{' '}
                      <span class="sr-only">open</span>
                    </button>

                    <Show when={board().id} keyed>
                      {(boardId) => (
                        <ShareBoard
                          boardId={boardId}
                          isFacilitator={board().isFacilitator}
                          emphasis={board().isBlurred ? 'secondary' : 'primary'}
                        />
                      )}
                    </Show>

                    <Menu open={boardMenuOpen()} onOpenChange={setBoardMenuOpen} modal={false}>
                      <MenuTrigger
                        ref={boardMenuTriggerEl}
                        aria-label="More board actions"
                        class="spring-press board-focus-ring inline-flex board-touch-target min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-border/80 bg-surface px-3 text-[13px] leading-none font-medium text-text hover:bg-surface-subtle active:bg-surface-subtle sm:h-9"
                      >
                        <LucideIcon icon={Ellipsis} class="size-4 shrink-0" strokeWidth={1.9} />
                        <span class="hidden sm:inline">More</span>
                      </MenuTrigger>

                      <BoardMenuContent
                        sideOffset={8}
                        finalFocus={isRenamingBoard() ? 'none' : undefined}
                        aria-label="More board actions"
                        class="board-popover max-h-[min(60dvh,28rem)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-md p-1"
                      >
                        <MenuItem
                          value="toggle-theme"
                          closeOnSelect={false}
                          onSelect={toggleTheme}
                          render={(itemProps) => <ThemeToggle menuItem menuItemProps={itemProps} />}
                        />
                        <Show when={canFacilitate(board())}>
                          <MenuItem
                            value="board-settings"
                            aria-haspopup="dialog"
                            class="board-menu-item"
                            onSelect={() => {
                              closeBoardMenu(true);
                              setIsBoardSettingsOpen(true);
                            }}
                          >
                            Board Settings
                          </MenuItem>
                        </Show>
                        <Show when={isMobileBoard()}>
                          <Show when={canControlFacilitation(board())}>
                            <MenuItem
                              value="toggle-private-mode"
                              aria-keyshortcuts="B"
                              class="board-menu-item"
                              onSelect={() => {
                                closeBoardMenu(true);
                                void togglePrivateMode();
                              }}
                            >
                              {board().isBlurred ? 'Reveal All' : 'Private Mode'}
                            </MenuItem>
                            <MenuItem
                              value="rename-board"
                              class="board-menu-item"
                              closeOnSelect={false}
                              onSelect={() => {
                                closeBoardMenu(false);
                                boardTitleEdit.start();
                              }}
                            >
                              Rename Board
                            </MenuItem>
                          </Show>
                          <Show when={canAddColumn()}>
                            <MenuItem
                              value="add-column"
                              class="board-menu-item"
                              onSelect={openAddColumn}
                            >
                              <span class="inline-flex items-center gap-2"><LucideIcon icon={Plus} class="size-3.5" strokeWidth={2} /> Add column</span>
                            </MenuItem>
                          </Show>
                          <MenuItem
                            value="action-items"
                            aria-haspopup="dialog"
                            class="board-menu-item"
                            onSelect={() => {
                              closeBoardMenu(true);
                              openActionItems();
                            }}
                          >
                            <span class="inline-flex items-center gap-2"><LucideIcon icon={Flag} class="size-3.5" strokeWidth={1.9} /> Action Items</span>{' '}
                            <span class="text-text-muted tabular-nums">{openActionItemCount()} open</span>
                          </MenuItem>
                        </Show>
                        <MenuSeparator class="my-1 border-t border-border/75" />
                        <ExportBoardMenu
                          board={board()}
                          onClose={() => closeBoardMenu(true)}
                        />
                      </BoardMenuContent>
                    </Menu>
                  </div>
                </div>
              </div>
              <div role="group" aria-label="Board status" class="board-masthead-status flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 text-xs leading-4 sm:gap-x-2.5 sm:px-0">
                <div data-print-hide="true" class="inline-flex items-center gap-2 text-text-muted sm:min-h-9 sm:text-[13px]">
                  <span role="status" class="inline-flex items-center gap-1.5 font-medium text-text">
                    <span
                      aria-hidden="true"
                      class={['size-1.5 shrink-0 rounded-full', controller.isLive() ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-text-muted']}
                    />
                    {controller.isLive() ? 'Live' : 'Reconnecting…'}
                  </span>
                  <Show when={controller.isLive() && controller.onlineCount() !== null}>
                    <span class="border-l border-border/80 pl-2 tabular-nums">{controller.onlineCount()} online</span>
                  </Show>
                </div>
                <span aria-hidden="true" data-print-hide="true" class="hidden h-4 w-px bg-border/75 sm:block" />

                <Show when={board().blindVoting}>
                  <span class="inline-flex items-center gap-1 text-text-muted sm:min-h-9 sm:gap-1.5 sm:rounded-full sm:bg-surface-subtle/90 sm:px-3 sm:text-[13px] sm:font-medium sm:text-text">
                    <LucideIcon icon={EyeOff} class="hidden size-3.5 shrink-0 text-text-muted sm:block" strokeWidth={1.9} />
                    <span>Blind Voting</span>
                  </span>
                </Show>
                <Show when={board().isLocked}>
                  <span class="inline-flex items-center gap-1 text-text-muted sm:min-h-9 sm:gap-1.5 sm:rounded-full sm:bg-surface-subtle/90 sm:px-3 sm:text-[13px] sm:font-medium sm:text-text">
                    <LucideIcon icon={Lock} class="hidden size-3.5 shrink-0 text-text-muted sm:block" strokeWidth={1.9} />
                    <span>Locked</span>
                  </span>
                </Show>
                <Show when={board().voteLimit !== null}>
                  <span
                    aria-live="polite"
                    aria-atomic="true"
                    class="inline-flex max-sm:border-l max-sm:border-border/80 max-sm:pl-2 items-center gap-1 text-text-muted tabular-nums sm:min-h-9 sm:gap-1.5 sm:rounded-full sm:bg-surface-subtle/75 sm:px-3 sm:text-[13px] sm:font-medium sm:text-text"
                  >
                    <LucideIcon icon={Vote} class="hidden size-3.5 shrink-0 text-text-muted sm:block" strokeWidth={1.85} />
                    <span class="tabular-nums">{controller.voting().remainingVotes} / {board().voteLimit} votes left</span>
                  </span>
                </Show>
                <Show when={board().isBlurred}>
                  <span title="Only you can read your Cards until they’re revealed." class="font-medium text-text">Private Mode</span>
                  <span class="sr-only">Only you can read your Cards until they’re revealed.</span>
                </Show>
              </div>
            </div>
            <Show when={board().subtitle.length > 0}>
              <p class="board-masthead-subtitle mx-3 max-w-[65ch] sm:mx-0 wrap-anywhere text-sm leading-snug text-text-muted">{board().subtitle}</p>
            </Show>
          </header>

          <Show when={canFacilitate(board())}>
            <BoardVotingSettings
              board={board()}
              open={isBoardSettingsOpen()}
              onClose={() => {
                setIsBoardSettingsOpen(false);
                boardMenuTriggerEl?.focus();
              }}
              onUpdate={controller.saveVotingSettings}
              onReset={controller.resetAllVotes}
              onToggleLock={controller.toggleBoardLock}
              onDeleteBoard={controller.deleteCurrentBoard}
            />
          </Show>

          {/* Viewer-local Search, Quick Filter & Sort toolbar */}
          <BoardFilterBar
            query={searchQuery()}
            filter={quickFilter()}
            requestedSortMode={sortMode()}
            effectiveSortMode={view.effectiveSortMode}
            blindVoting={board().blindVoting}
            hasActiveFilter={view.hasActiveFilter}
            hasSearchQuery={view.hasSearchQuery}
            widenSearch={secretSearch()?.id === 'scope-creep'}
            matchedCardCount={view.matchedCardCount}
            totalCardCount={view.totalCardCount}
            onQueryChange={setSearchQuery}
            onFilterChange={setQuickFilter}
            onSortChange={setSortMode}
            onResetFilters={resetFilters}
            onSearchInputRef={(el) => {
              searchInputEl = el;
            }}
          />

          {/* Inline dismissible error feedback */}
          <Show when={controller.errorMessage()}>
            {(message) => (
              <div
                role="alert"
                class="mx-auto mt-3 flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6"
              >
                <div class="flex flex-1 items-center justify-between gap-3 rounded-md border border-col-rose/40 bg-col-rose-tint px-3.5 py-2 text-xs font-medium text-text">
                  <span>{message()}</span>
                  <button
                    type="button"
                    aria-label="Dismiss error"
                    onClick={() => controller.clearError()}
                    class="inline-flex min-h-11 min-w-11 cursor-pointer sm:min-h-8 sm:min-w-8 items-center justify-center rounded-sm text-text-muted hover:text-text"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
            )}
          </Show>

          {/* Responsive Columns workspace (single-column + swipe on mobile, grid/snap on tablet & desktop) */}
          <main
            ref={boardMain}
            tabindex={-1}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={() => { swipeStart = undefined; }}
            class="mx-auto w-full max-w-[1600px] flex-1 px-3 pb-5 sm:px-6 sm:py-6"
          >
            <Show when={secretSearch()}>
              <div class="relative mb-4 rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-sm text-text-muted">
                <p class="flex items-center gap-2">
                  {secretSearch()?.message}
                  <Show when={secretSearch()?.id === 'rock'}>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 12"
                      class="secret-search-pebble size-4 shrink-0 text-col-slate"
                    >
                      <path fill="currentColor" d="M1 8c0-2 2-5 5-6 3-1 7 1 9 5 1 2-2 4-6 4-5 0-8-1-8-3Z" />
                    </svg>
                  </Show>
                </p>
                <Show when={secretSearch()?.id === 'blame'}>
                  <figure class="mt-2 max-w-prose">
                    <blockquote cite={RETROSPECTIVE_PRIME_DIRECTIVE.source}>
                      “{RETROSPECTIVE_PRIME_DIRECTIVE.excerpt} …”
                    </blockquote>
                    <figcaption class="mt-1">
                      <a
                        href={RETROSPECTIVE_PRIME_DIRECTIVE.source}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="underline underline-offset-2"
                      >
                        Norm Kerth’s Retrospective Prime Directive
                      </a>
                    </figcaption>
                  </figure>
                </Show>
                <Show when={secretSearch()?.id === 'kudos'}>
                  <span aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden">
                    <Repeat count={10}>
                      {() => <span class="secret-search-dot" />}
                    </Repeat>
                  </span>
                </Show>
              </div>
            </Show>

            <Tabs
              value={activeMobileColumn()?.id ?? null}
              onValueChange={setActiveColumnId}
              class="board-column-deck relative"
              data-can-manage={canControlFacilitation(board()) ? "" : undefined}
            >
              <nav
                aria-label="Board Columns"
                data-print-hide="true"
                class="board-column-tabs min-w-0 sm:hidden"
              >
                <ScrollArea class="scroll-edge-fade w-full rounded-full bg-surface-subtle">
                  <ScrollAreaViewport ref={columnTabViewportEl}>
                    <ScrollAreaContent>
                      <TabsList ref={columnTabListEl} aria-label="Select Column">
                        <div class="flex w-max min-w-full items-center gap-0.5 py-0.5 pl-0.5 pr-2">
                          <For each={view.columnViews}>
                            {(bucket) => (
                              <TabsTab
                                value={bucket.column.id}
                                title={bucket.column.title}
                                render={(tabProps) => (
                                  <button
                                    {...tabProps}
                                    id={`column-tab-${bucket.column.id}`}
                                    aria-controls={`column-${bucket.column.id}`}
                                  />
                                )}
                                class="inline-flex min-h-11 min-w-11 max-w-[min(17rem,72vw)] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-3 text-[13px] font-medium text-text-muted transition-colors hover:text-text active:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus data-selected:bg-surface data-selected:text-text data-selected:shadow-xs"
                              >
                                <span
                                  aria-hidden="true"
                                  class={[
                                    'h-2 w-2 shrink-0 rounded-full',
                                    COLUMN_ACCENT_STYLES[bucket.column.accent].swatch,
                                  ]}
                                />
                                <span class="min-w-0 truncate text-left">{bucket.column.title}</span>
                                <span class="text-xs text-text-muted tabular-nums">
                                  {view.hasActiveFilter
                                    ? `${bucket.visibleCardCount}/${bucket.column.cardCount}`
                                    : bucket.column.cardCount}
                                </span>
                              </TabsTab>
                            )}
                          </For>
                        </div>
                      </TabsList>
                    </ScrollAreaContent>
                  </ScrollAreaViewport>
                </ScrollArea>
              </nav>
              <div
                data-board-columns="true"
                class={[
                  'gap-4 touch-pan-y touch-pinch-zoom sm:touch-auto',
                  getResponsiveGridClass(board().columns.length, canAddColumn()),
                  { 'secret-search-pivot': secretSearch()?.id === 'pivot' },
                ]}
              >
                <For each={view.columnViews}>
                  {(bucket, index) => (
                    <ColumnPanel
                      view={bucket}
                      columnIndex={index()}
                      hasActiveFilter={view.hasActiveFilter}
                      isMobile={isMobileBoard()}
                      isMobileActive={resolvedActiveColumnIndex() === index()}
                      isHorizontalSnap={isHorizontalSnap()}
                      onResetFilters={resetFilters}
                      onRegisterComposer={registerColumnComposer}
                      onActivateColumn={(colId) => setActiveColumnId(colId)}
                    />
                  )}
                </For>
                <Show when={canAddColumn()}>
                  <button
                    type="button"
                    data-print-hide="true"
                    onClick={openAddColumn}
                    class={[
                      'spring-press hidden w-fit shrink-0 cursor-pointer items-center gap-1.5 self-start rounded-lg border border-dashed border-border/85 bg-surface-subtle/25 px-3.5 py-2.5 text-[13px] font-medium text-text-muted',
                      'transition-colors hover:border-control/80 hover:bg-surface hover:text-text active:bg-surface-subtle sm:inline-flex sm:min-h-11',
                      'board-focus-ring',
                      getAddColumnSlotClass(board().columns.length),
                    ]}
                  >
                    <LucideIcon icon={Plus} class="size-4" strokeWidth={2} />
                    <span>Add a Column</span>
                  </button>
                </Show>
              </div>
            </Tabs>
          </main>

          <Dialog
            open={isAddingColumn() && canControlFacilitation(board())}
            onOpenChange={(next) => setIsAddingColumn(next)}
          >
            <DialogBackdrop
              data-print-hide="true"
              class="board-dialog-backdrop z-40"
            />
            <DialogContent
              data-board-overlay="true"
              data-print-hide="true"
              initialFocus={() => newColumnTitleEl ?? null}
              class="board-dialog-surface z-50 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface text-text shadow-2xl"
            >
              <div
                aria-hidden="true"
                class={['h-0.75 w-full transition-colors duration-200', COLUMN_ACCENT_STYLES[newColumnAccent()].bar]}
              />
              <div
                class={[
                  'flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3.5 transition-colors duration-200',
                  COLUMN_ACCENT_STYLES[newColumnAccent()].tint,
                ]}
              >
                <div class="flex min-w-0 items-center gap-2">
                  <DialogTitle class="truncate text-base font-semibold tracking-[-0.015em] text-text">
                    Add a Column
                  </DialogTitle>
                  <Show when={newColumnIsAction()}>
                    <span class="inline-flex shrink-0 items-center text-col-sky">
                      <LucideIcon icon={Flag} class="size-3.5" strokeWidth={2} />
                    </span>
                  </Show>
                </div>
                <DialogClose
                  aria-label="Close Add Column"
                  class="spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface/80 hover:text-text board-focus-ring sm:min-h-8 sm:min-w-8"
                >
                  <LucideIcon icon={X} class="size-4" strokeWidth={2} />
                </DialogClose>
              </div>

              <form onSubmit={(e) => void handleAddColumn(e)} class="space-y-4 p-5">
                <div>
                  <label
                    for="new-column-title"
                    class="block text-xs font-medium text-text-muted"
                  >
                    New column title
                  </label>
                  <input
                    ref={newColumnTitleEl}
                    id="new-column-title"
                    type="text"
                    aria-label="New column title"
                    placeholder="e.g. Kudos, Questions, Risks"
                    value={newColumnTitle()}
                    maxlength={MAX_COLUMN_TITLE_LENGTH}
                    onInput={(e) => setNewColumnTitle(e.currentTarget.value)}
                    class="mt-1.5 min-h-11 w-full rounded-md border border-border/85 bg-canvas px-3 py-2 text-sm text-text placeholder:text-text-muted board-focus-ring sm:min-h-10"
                  />
                </div>

                <div>
                  <span class="block text-xs font-medium text-text-muted">
                    Accent color
                  </span>
                  <RadioGroup<ColumnAccent>
                    class="mt-1.5 grid grid-cols-4 gap-1 sm:grid-cols-8"
                    value={newColumnAccent()}
                    onValueChange={(accent) => {
                      if (accent) setNewColumnAccent(accent);
                    }}
                  >
                    <For each={COLUMN_ACCENTS}>
                      {(accent) => (
                        <Radio
                          value={accent}
                          aria-label={`New column accent ${COLUMN_ACCENT_STYLES[accent].label}`}
                          class="spring-press inline-flex board-touch-target cursor-pointer items-center justify-center rounded-sm border border-transparent transition-colors hover:bg-surface-subtle data-checked:border-border data-checked:bg-surface-subtle board-focus-ring"
                        >
                          <span
                            aria-hidden="true"
                            class={[
                              'size-4 rounded-full',
                              COLUMN_ACCENT_STYLES[accent].swatch,
                              'data-checked:ring-2 data-checked:ring-text data-checked:ring-offset-2 data-checked:ring-offset-surface',
                            ]}
                          />
                        </Radio>
                      )}
                    </For>
                  </RadioGroup>
                </div>

                <label class="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-text-muted sm:min-h-9">
                  <input
                    type="checkbox"
                    checked={newColumnIsAction()}
                    onChange={(e) =>
                      setNewColumnIsAction(e.currentTarget.checked)
                    }
                    class="size-4 rounded-sm border-border accent-accent"
                  />
                  <span>Action Items column</span>
                </label>

                <div class="flex items-center justify-end gap-2 border-t border-border/70 pt-3.5">
                  <button
                    type="button"
                    onClick={() => setIsAddingColumn(false)}
                    class="spring-press board-touch-target cursor-pointer rounded-md border border-border bg-surface px-3.5 py-2 text-xs font-medium text-text-muted hover:bg-surface-subtle hover:text-text"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      controller.isSavingColumn() || newColumnTitle().trim().length === 0
                    }
                    class="spring-press board-touch-target cursor-pointer rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {controller.isSavingColumn() ? 'Adding…' : 'Add column'}
                  </button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {/* Card Detail Drawer / Bottom Sheet */}
          <Show when={openDetailCard()} keyed>
            {(card) => (
              <CardDetailDrawer
                card={card}
                isOpen={isCardDetailOpen()}
                side={isMobileBoard() ? 'bottom' : 'right'}
                onClose={() => setIsCardDetailOpen(false)}
                onExit={() => setOpenCardDetailId(null)}
                restoreFocusTarget={cardDetailFocusTarget}
              />
            )}
          </Show>

          {/* Action Items Drawer / Bottom Sheet */}
          <ActionItemsDrawer
            board={board()}
            cards={view.cards}
            open={isActionItemsOpen()}
            side={isMobileBoard() ? 'bottom' : 'right'}
            isLocked={board().isLocked}
            onClose={() => setIsActionItemsOpen(false)}
            restoreFocusTarget={actionItemsFocusTarget}
            onUpdateActionItem={controller.updateActionItem}
            isActionItemPending={controller.isActionItemPending}
          />

          {/* Mobile (< 640px) bottom-anchored quick-add Card bar */}
          <Show
            when={!board().isLocked && activeMobileColumn()}
            fallback={
              <Show when={board().isLocked}>
                <p data-print-hide="true" class="sticky bottom-0 z-20 border-t border-border bg-surface px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-sm text-text-muted sm:hidden">
                  This Board is Locked. You can still read and search Cards.
                </p>
              </Show>
            }
          >
            {(targetCol) => (
              <div
                data-print-hide="true"
                ref={mobileComposerBarEl}
                class="board-mobile-composer sticky bottom-(--keyboard-inset,0px) z-20 border-t border-border px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:hidden"
              >
                <Show when={mobileDrafts[targetCol().id]?.error}>
                  {(error) => <p role="alert" class="mb-2 text-sm text-rose-700 dark:text-rose-300">{error()}</p>}
                </Show>
                <div class="flex items-end gap-2">
                  <Textarea
                    ref={(el) => {
                      mobileComposerEl = el;
                    }}
                    autoResize
                    aria-label={`Quick add card to ${targetCol().title}`}
                    placeholder={`Add to ${targetCol().title}…`}
                    value={mobileDrafts[targetCol().id]?.content ?? ''}
                    maxlength={MAX_CARD_CONTENT_LENGTH}
                    rows={1}
                    onValueChange={(value) => updateMobileDraft(targetCol().id, value)}
                    onKeyDown={handleMobileComposerKeyDown}
                    class={[
                      'min-h-11 max-h-32 min-w-0 flex-1 resize-none rounded-md border border-control bg-canvas px-3 py-2.25 text-base leading-6 text-text',
                      'placeholder:text-text-muted board-focus-ring',
                    ]}
                  />
                  <button
                    type="button"
                    disabled={
                      isSubmittingMobileCard() ||
                      (mobileDrafts[targetCol().id]?.content.trim().length ?? 0) === 0
                    }
                    onClick={() => void handleMobileQuickAdd()}
                    class={[
                      'inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md bg-accent px-4 text-xs font-medium text-accent-contrast',
                      'transition-opacity hover:opacity-90 active:opacity-75 disabled:cursor-not-allowed disabled:opacity-50',
                      'board-focus-ring',
                    ]}
                  >
                    {isSubmittingMobileCard() ? '...' : 'Add'}
                  </button>
                </div>
              </div>
            )}
          </Show>
            </div>
          </BoardWorkspaceContext>
        );
      }}
    </Show>
  );
}
