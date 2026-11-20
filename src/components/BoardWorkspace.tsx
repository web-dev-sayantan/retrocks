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
import { Tabs, TabsList, TabsTab } from '@ui-sdk/solid/tabs';
import { Textarea } from '@ui-sdk/solid/textarea';
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
  reconcile,
  untrack,
} from 'solid-js';

import {
  defaultBoardWorkspaceActions,
  type BoardWorkspaceActions,
} from '../lib/board-actions';
import { createBoardLive, type BoardLive } from '../lib/board-live';
import {
  canAddColumn as canAddBoardColumn,
  canContribute,
  canControlFacilitation,
  canEditActionItem,
  canFacilitate,
  canInteractWithCard,
  canManageCard,
  canManageGroup,
  canManageGrouping,
} from '../lib/board-permissions';
import { applyBoardEvents } from '../lib/board-store';
import {
  COLUMN_ACCENTS,
  MAX_BOARD_TITLE_LENGTH,
  MAX_CARD_CONTENT_LENGTH,
  MAX_COLUMN_TITLE_LENGTH,
  type ActionItemPatch,
  type BoardEvent,
  type BoardMutationResponse,
  type BoardViewDTO,
  type CardGroupDTO,
  type CardViewDTO,
  type ColumnAccent,
  type ReactionEmoji,
} from '../lib/board-types';
import {
  hasOpenBoardOverlay,
  isTypingInEditableElement,
  projectBoardView,
  type BoardQuickFilter,
  type BoardSortMode,
  type ColumnStreamItem,
} from '../lib/board-view';
import {
  RETROSPECTIVE_PRIME_DIRECTIVE,
  logPrivacyColophon,
  matchSecretSearch,
} from '../lib/easter-eggs';
import { recordRecentBoard, removeRecentBoard } from '../lib/recent-boards';
import { isOptimisticId, makeOptimisticCardId } from '../lib/optimistic-ids';
import type { TimerChange } from '../lib/schemas';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import { toggleTheme } from '../lib/theme';
import type { ServerClockSample } from '../lib/timer';
import { createTimerChime, isTimerAudioMuted } from '../lib/timer-chime';
import { createDoubleTap } from '../lib/double-tap';
import type { ChangeVoteInput } from '../lib/voting-schemas';
import ActionItemsDrawer from './ActionItemsDrawer';
import BoardFilterBar from './BoardFilterBar';
import BoardMenuContent from './BoardMenuContent';
import BoardVotingSettings, { type VotingSettingsPatch } from './BoardVotingSettings';
import CardDetailDrawer from './CardDetailDrawer';
import ColumnPanel from './ColumnPanel';
import CountdownTimer from './CountdownTimer';
import ExportBoardMenu, { type ExportFeedback } from './ExportBoardMenu';
import { CloseIcon } from './Icons';
import LucideIcon from './LucideIcon';
import PageMessage from './PageMessage';
import PrintBoard from './PrintBoard';
import ShareBoard from './ShareBoard';
import ThemeToggle from './ThemeToggle';
import type { WorkspaceVoting } from './VoteControls';

export interface BoardWorkspaceProps {
  board: BoardViewDTO | null;
  boardId: string;
  homeHref?: string;
  actions?: BoardWorkspaceActions;
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

function cloneBoardView(board: BoardViewDTO | null): BoardViewDTO | null {
  if (!board) return null;
  return {
    ...board,
    timer: { ...board.timer },
    columns: board.columns.map((c) => ({ ...c })),
    groups: board.groups.map((g) => ({ ...g, cardIds: [...g.cardIds] })),
    cards: board.cards.map((card) => ({
      ...card,
      reactions: { ...card.reactions },
      myReactions: [...card.myReactions],
      comments: card.comments.map((cm) => ({ ...cm })),
    })),
  };
}

const EMPTY_CARDS: readonly CardViewDTO[] = [];
const EMPTY_GROUPS: readonly CardGroupDTO[] = [];
const EMPTY_STREAM_ITEMS: readonly ColumnStreamItem[] = [];

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
  const [workspace, setWorkspace] = createStore<{
    board: BoardViewDTO | null;
  }>({
    board: untrack(() => cloneBoardView(props.board)),
  });

  const [nowMs, setNowMs] = createSignal(Date.now());
  const [liveSession, setLiveSession] = createSignal<{ boardId: string; live: BoardLive } | null>(null);
  const isLive = createMemo(() => liveSession()?.live.status() === 'live');
  const onlineCount = createMemo(() => liveSession()?.live.onlineCount() ?? null);
  const [serverClock, setServerClock] = createSignal<(ServerClockSample & { boardId: string }) | null>(null);
  const timerClock = createMemo(() => {
    const clock = serverClock();
    return clock?.boardId === workspace.board?.id ? clock : null;
  });
  let serverTimeOffsetMs = 0;
  let reconnectLive: (() => void) | undefined;
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  type PendingVote = ChangeVoteInput & { baseVersion: number };
  const [pendingVote, setPendingVote] = createSignal<PendingVote | null>(null);
  let voteInFlight = false;

  const voting = createMemo<WorkspaceVoting>(() => {
    const board = workspace.board;
    const request = pendingVote();
    const optimisticVote = request && board?.id === request.boardId &&
      board.version === request.baseVersion ? request : null;
    let remainingVotes = board?.remainingVotes ?? null;

    if (board && optimisticVote && board.voteLimit !== null) {
      const spentOnCards = board.cards.reduce(
        (sum, card) => sum + (card.groupId === null ? card.myVotes : 0),
        0,
      );
      const spentOnGroups = board.groups.reduce((sum, group) => sum + group.myVotes, 0);
      remainingVotes = Math.max(0, board.voteLimit - spentOnCards - spentOnGroups - optimisticVote.delta);
    }

    return {
      remainingVotes,
      maxVotesPerCard: board?.maxVotesPerCard ?? null,
      pending: request !== null && request.boardId === board?.id,
      optimisticVote,
      onChange: handleChangeVote,
    };
  });

  const [isChangingPrivateMode, setIsChangingPrivateMode] = createSignal(false);
  const [isDramaticReveal, setIsDramaticReveal] = createSignal(false);
  const [modeAnnouncement, setModeAnnouncement] = createSignal('');
  const revealChime = createTimerChime();
  let dramaticRevealTimer: ReturnType<typeof setTimeout> | undefined;
  let optimisticCardSeq = 0;

  function clearDramaticReveal(): void {
    if (dramaticRevealTimer !== undefined) {
      clearTimeout(dramaticRevealTimer);
      dramaticRevealTimer = undefined;
    }
    setIsDramaticReveal(false);
  }

  onSettled(() => () => {
    clearDramaticReveal();
    revealChime.dispose();
  });

  // More disclosure and Board Settings
  const [boardMenuOpen, setBoardMenuOpen] = createSignal(false);
  const [exportFeedback, setExportFeedback] = createSignal<ExportFeedback | null>(null);
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

  // Board inline rename state
  const [isRenamingBoard, setIsRenamingBoard] = createSignal(false);
  const [boardTitleDraft, setBoardTitleDraft] = createSignal('');
  const [isSavingBoardTitle, setIsSavingBoardTitle] = createSignal(false);
  let boardTitleInputEl: HTMLInputElement | undefined;
  let renameBoardButtonEl: HTMLButtonElement | undefined;
  const boardTitleTap = createDoubleTap(isBoardTitleEditTarget, startBoardRename);

  createEffect(isRenamingBoard, (renaming, wasRenaming) => {
    if (renaming) {
      boardTitleInputEl?.focus();
    } else if (wasRenaming && document.activeElement === document.body) {
      renameBoardButtonEl?.focus();
      if (document.activeElement === document.body) boardMenuTriggerEl?.focus();
    }
  });

  // Add Column inline composer state
  const [isAddingColumn, setIsAddingColumn] = createSignal(false);
  const [newColumnTitle, setNewColumnTitle] = createSignal('');
  const [newColumnAccent, setNewColumnAccent] =
    createSignal<ColumnAccent>('slate');
  const [newColumnIsAction, setNewColumnIsAction] = createSignal(false);
  const [isSavingColumn, setIsSavingColumn] = createSignal(false);
  const canAddColumn = createMemo(() => {
    const board = workspace.board;
    return !!board && canAddBoardColumn(board);
  });
  let newColumnTitleEl: HTMLInputElement | undefined;

  function openAddColumn(): void {
    closeBoardMenu(false);
    setIsAddingColumn(true);
  }

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
  let mobileComposerBarEl: HTMLDivElement | undefined;

  // Desktop drag-and-drop Card state
  const [draggingCardId, setDraggingCardId] = createSignal<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = createSignal<string | null>(null);
  const [draggingSourceColumnId, setDraggingSourceColumnId] = createSignal<
    string | null
  >(null);

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

  function restoreActionItemsFocus(previousFocus: HTMLElement | null): void {
    for (const target of [previousFocus, actionItemsHeaderEntry, boardMenuTriggerEl]) {
      if (!target?.isConnected || target.closest('[hidden]')) continue;
      target.focus({ preventScroll: true });
      if (document.activeElement === target) return;
    }
  }

  const openActionItemCount = createMemo(
    () =>
      workspace.board?.cards.filter(
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

  function applySnapshot(nextBoard: BoardViewDTO | null, fromLive = false): void {
    if (nextBoard === null) {
      setErrorMessage(null);
      setIsRenamingBoard(false);
      setIsAddingColumn(false);
      setOpenCardDetailId(null);
      setIsCardDetailOpen(false);
      setIsActionItemsOpen(false);
      setBoardMenuOpen(false);
      setIsBoardSettingsOpen(false);
      }
    untrack(() => {
      setWorkspace((draft) => {
        const current = draft.board;
        if (nextBoard && current?.id === nextBoard.id) {
          if (nextBoard.version < current.version) return;
          if (!fromLive && nextBoard.version === current.version &&
              nextBoard.isFacilitator === current.isFacilitator) return;
        }
        reconcile({ board: cloneBoardView(nextBoard) }, 'id')(draft);
      });
    });
  }

  function syncServerClock(boardId: string, serverNow: number): void {
    setServerClock({ boardId, serverNow, receivedAt: performance.now() });
    serverTimeOffsetMs = serverNow - Date.now();
    setNowMs(serverNow);
  }

  function applyServerSnapshot(nextBoard: BoardViewDTO, serverNow: number): void {
    // Point-in-time guard: judge the snapshot against the board as of this event, not a tracked dependency.
    const stale = untrack(() => {
      const current = workspace.board;
      return !current || current.id !== nextBoard.id || nextBoard.version < current.version;
    });
    if (stale) return;
    syncServerClock(nextBoard.id, serverNow);
    applySnapshot(nextBoard, true);
  }

  function applyVersionedEvents(boardId: string, version: number, events: BoardEvent[]): void {
    if (events.some((event) => event.type === 'board:deleted')) {
      if (untrack(() => workspace.board?.id) === boardId) {
        applySnapshot(null);
      }
      return;
    }
    const snapshot = events.find((event) => event.type === 'board:snapshot');
    if (snapshot) {
      applyServerSnapshot(snapshot.board, snapshot.serverNow);
      return;
    }
    let needsResync = false;
    let serverNow: number | undefined;
    untrack(() => {
      setWorkspace((draft) => {
        const board = draft.board;
        if (!board || board.id !== boardId || version <= board.version) return;
        if (version > board.version + 1) {
          needsResync = true;
          return;
        }
        applyBoardEvents(board, events);
        board.version = version;
        for (const event of events) {
          if (event.type === 'timer:updated') serverNow = event.serverNow;
        }
      });
    });
    if (serverNow !== undefined) syncServerClock(boardId, serverNow);
    if (needsResync) reconnectLive?.();
  }

  createEffect(() => props.board, (nextBoard) => applySnapshot(nextBoard));

  createEffect(
    () => workspace.board?.isLocked ?? false,
    (locked) => {
      if (locked) {
        setIsRenamingBoard(false);
        setIsAddingColumn(false);
      }
    },
  );

  createEffect(
    () => props.boardId,
    (nextId, previousId) => {
      if (previousId !== undefined && nextId !== previousId) {
        setSearchQuery('');
        setQuickFilter('all');
        setSortMode('newest');
        setActiveColumnId(null);
        setMobileDrafts((drafts) => {
          for (const id of Object.keys(drafts)) delete drafts[id];
        });
      }
    },
  );

  createEffect(
    () => {
      const board = workspace.board;
      return board && {
        id: board.id,
        isBlurred: board.isBlurred,
        blindVoting: board.blindVoting,
        isLocked: board.isLocked,
      };
    },
    (board, previous) => {
      if (!board || previous?.id !== board.id) {
        setModeAnnouncement('');
        return;
      }
      const changes: string[] = [];
      if (board.isBlurred !== previous.isBlurred) {
        changes.push(board.isBlurred ? 'Private Mode is on.' : 'All Cards revealed.');
      }
      if (board.blindVoting !== previous.blindVoting) {
        changes.push(board.blindVoting ? 'Blind Voting is on.' : 'Blind Voting is off.');
      }
      if (board.isLocked !== previous.isLocked) {
        changes.push(board.isLocked ? 'Board locked.' : 'Board unlocked.');
      }
      setModeAnnouncement(changes.join(' '));
    },
  );

  let unavailableHeading: HTMLHeadingElement | undefined;
  const liveBoardId = createMemo(() => workspace.board?.id);
  createEffect(liveBoardId, (boardId, previousBoardId) => {
    if (!boardId) {
      if (previousBoardId) unavailableHeading?.focus();
      return;
    }
    if (typeof window === 'undefined') return;
    const live = createBoardLive(boardId);
    setLiveSession({ boardId, live });
    reconnectLive = live.reconnect;
    return () => {
      reconnectLive = undefined;
      setLiveSession(null);
      live.dispose();
    };
  });

  createEffect(
    () => {
      const session = liveSession();
      return session && { boardId: session.boardId, message: session.live.lastEvent() };
    },
    (event, previous) => {
      const message = event?.message;
      if (!event || !message || message === previous?.message) return;
      const { boardId } = event;
      switch (message.type) {
        case 'board:snapshot':
          if (message.board.id !== boardId) break;
          applyServerSnapshot(message.board, message.serverNow);
          break;
        case 'board:mutation':
          applyVersionedEvents(boardId, message.version, message.events);
          break;
        case 'board:deleted':
          applySnapshot(null);
          break;
      }
    },
  );

  // Keep relative timestamps fresh on the client
  onSettled(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now() + serverTimeOffsetMs);
    }, 30_000);
    return () => clearInterval(intervalId);
  });

  createEffect(
    () => workspace.board !== null,
    (hasBoard) => {
      if (hasBoard) logPrivacyColophon();
    },
  );

  onSettled(() => {
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  });

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
    () => ({
      boardId: props.boardId,
      board: workspace.board
        ? {
            id: workspace.board.id,
            title: workspace.board.title,
            isFacilitator: workspace.board.isFacilitator,
          }
        : null,
    }),
    ({ boardId, board }) => {
      if (board) {
        recordRecentBoard(board);
      } else if (boardId) {
        removeRecentBoard(boardId);
      }
    },
  );

  const actions = createMemo(
    () => props.actions ?? defaultBoardWorkspaceActions,
  );

  const resolvedActiveColumnIndex = createMemo(() => {
    const cols = workspace.board?.columns ?? [];
    if (cols.length === 0) return 0;
    const currentId = activeColumnId();
    if (currentId) {
      const found = cols.findIndex((c) => c.id === currentId);
      if (found !== -1) return found;
    }
    return 0;
  });

  const activeMobileColumn = createMemo(() => {
    const cols = workspace.board?.columns ?? [];
    return cols[resolvedActiveColumnIndex()] ?? null;
  });

  const cardsByColumn = createMemo(() => {
    const grouped = new Map<string, CardViewDTO[]>();
    const board = workspace.board;
    if (!board) return grouped;
    for (const card of board.cards) {
      let list = grouped.get(card.columnId);
      if (!list) {
        list = [];
        grouped.set(card.columnId, list);
      }
      list.push(card);
    }
    return grouped;
  });

  const groupsByColumn = createMemo(() => {
    const grouped = new Map<string, CardGroupDTO[]>();
    const board = workspace.board;
    if (!board) return grouped;
    for (const group of board.groups) {
      let list = grouped.get(group.columnId);
      if (!list) {
        list = [];
        grouped.set(group.columnId, list);
      }
      list.push(group);
    }
    return grouped;
  });

  const boardView = createMemo(() => {
    const board = workspace.board;
    if (!board) return null;
    return projectBoardView(board, {
      query: searchQuery(),
      filter: quickFilter(),
      sortMode: sortMode(),
    });
  });

  const secretSearch = createMemo(() => {
    const view = boardView();
    if (!view?.hasSearchQuery || view.matchedCardCount !== 0) return;
    if (view.totalCardCount !== 0 && quickFilter() !== 'all') return;
    return matchSecretSearch(searchQuery());
  });

  const isHorizontalSnap = createMemo(
    () => (workspace.board?.columns.length ?? 0) >= 5,
  );

  const openDetailCard = createMemo(() => {
    const id = openCardDetailId();
    if (!id) return null;
    const card = workspace.board?.cards.find((item) => item.id === id) ?? null;
    if (!card || card.redacted) return null;
    return card;
  });

  const openDetailColumn = createMemo(() => {
    const card = openDetailCard();
    if (!card) return null;
    return (
      workspace.board?.columns.find((col) => col.id === card.columnId) ?? null
    );
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

  function applyMutationResponse(boardId: string, response: BoardMutationResponse): boolean {
    if (workspace.board?.id !== boardId) return false;
    if (!response.ok) {
      setErrorMessage(response.message);
      return false;
    }
    setErrorMessage(null);
    applyVersionedEvents(boardId, response.version, response.events);
    return true;
  }

  async function changeCountdown(boardId: string, change: TimerChange): Promise<BoardMutationResponse> {
    const response = await actions().updateTimer({ boardId, change });
    if (response.ok) applyVersionedEvents(boardId, response.version, response.events);
    return response;
  }

  function handleGlobalKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;

    if (event.key === 'Escape') {
      if (isCardDetailOpen()) {
        // Events inside the drawer are handled there after its nested controls.
        if (event.target instanceof Element && event.target.closest('[data-board-overlay]')) return;
        event.preventDefault();
        setIsCardDetailOpen(false);
        return;
      }
      if (isActionItemsOpen()) {
        event.preventDefault();
        setIsActionItemsOpen(false);
        return;
      }
      if (boardMenuOpen()) {
        event.preventDefault();
        closeBoardMenu(true);
        return;
      }
      if (isAddingColumn()) {
        event.preventDefault();
        setIsAddingColumn(false);
      }
      return;
    }

    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingInEditableElement(event)) return;

    const board = workspace.board;
    if (!board) return;

    if (event.key === '/') {
      if (hasOpenBoardOverlay()) return;
      if (searchInputEl?.isConnected) {
        event.preventDefault();
        searchInputEl.focus();
        searchInputEl.select();
      }
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'n') {
      if (board.isLocked || hasOpenBoardOverlay()) return;
      const targetCol = activeMobileColumn();
      const composer = targetCol ? columnComposers.get(targetCol.id) : undefined;
      if (composer?.isConnected) {
        event.preventDefault();
        composer.focus();
        if (document.activeElement === composer) {
          composer.scrollIntoView?.({ block: 'nearest' });
          return;
        }
      }
      if (mobileComposerEl?.isConnected) {
        event.preventDefault();
        mobileComposerEl.focus();
      }
      return;
    }

    if (key === 'a') {
      if (isActionItemsOpen()) {
        event.preventDefault();
        setIsActionItemsOpen(false);
        return;
      }
      if (hasOpenBoardOverlay()) return;
      event.preventDefault();
      setIsActionItemsOpen(true);
      return;
    }

    if (key === 'b') {
      if (hasOpenBoardOverlay() || !canControlFacilitation(board)) return;
      event.preventDefault();
      void togglePrivateMode();
    }
  }

  async function togglePrivateMode(options?: { dramatic?: boolean }): Promise<void> {
    const board = workspace.board;
    if (!board || !canControlFacilitation(board) || isChangingPrivateMode()) return;
    const { id: boardId, isBlurred } = board;
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
    setIsChangingPrivateMode(true);
    try {
      const response = await actions().setPrivateMode({ boardId, isBlurred: !isBlurred });
      if (dramatic && response.ok && workspace.board?.id === boardId) {
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
      applyMutationResponse(boardId, response);
    } finally {
      setIsChangingPrivateMode(false);
    }
  }

  function isBoardTitleEditTarget(target: EventTarget | null): boolean {
    const board = workspace.board;
    if (!board || !canControlFacilitation(board)) return false;
    return !(target instanceof Element && target.closest('button'));
  }

  function handleBoardTitleDoubleClick(event: MouseEvent): void {
    if (!isBoardTitleEditTarget(event.target)) return;
    boardTitleTap.reset();
    startBoardRename();
  }

  function startBoardRename(): void {
    boardTitleTap.reset();
    const board = workspace.board;
    if (!board || !canControlFacilitation(board)) return;
    setBoardTitleDraft(board.title);
    setIsRenamingBoard(true);
  }

  function cancelBoardRename(): void {
    boardTitleTap.reset();
    setIsRenamingBoard(false);
    setBoardTitleDraft('');
  }

  async function saveBoardRename(): Promise<void> {
    const board = workspace.board;
    const trimmed = boardTitleDraft().trim();
    if (!board || trimmed.length === 0 || isSavingBoardTitle()) return;
    if (trimmed === board.title) {
      setIsRenamingBoard(false);
      return;
    }
    setIsSavingBoardTitle(true);
    try {
      const response = await actions().renameBoard({
        boardId: board.id,
        title: trimmed,
      });
      if (applyMutationResponse(board.id, response)) {
        setIsRenamingBoard(false);
      }
    } finally {
      setIsSavingBoardTitle(false);
    }
  }

  function handleBoardTitleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelBoardRename();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveBoardRename();
    }
  }

  function removeOptimisticCard(boardId: string, tempId: string): void {
    setWorkspace((draft) => {
      const current = draft.board;
      if (!current || current.id !== boardId) return;
      const idx = current.cards.findIndex((item) => item.id === tempId);
      if (idx === -1) return;
      const [removed] = current.cards.splice(idx, 1);
      const col = current.columns.find((c) => c.id === removed.columnId);
      if (col) col.cardCount = Math.max(0, col.cardCount - 1);
    });
  }

  async function handleCreateCard(
    columnId: string,
    content: string,
  ): Promise<string | null> {
    const board = workspace.board;
    const trimmed = content.trim();
    if (!board || board.isLocked) return 'This Board is not accepting new Cards.';
    const column = board.columns.find((col) => col.id === columnId);
    if (!column) return 'This Column is no longer available.';

    const boardId = board.id;
    optimisticCardSeq += 1;
    const tempId = makeOptimisticCardId(optimisticCardSeq);
    const createdAt = Date.now() + serverTimeOffsetMs;
    const optimisticCard: CardViewDTO = {
      id: tempId,
      columnId,
      groupId: null,
      content: trimmed,
      redacted: false,
      isMine: true,
      isActionItem: column.isActionColumn,
      actionDone: false,
      actionOwner: '',
      votes: board.blindVoting ? null : 0,
      myVotes: 0,
      reactions: {},
      myReactions: [],
      commentCount: 0,
      comments: [],
      createdAt,
      updatedAt: createdAt,
    };

    setWorkspace((draft) => {
      const current = draft.board;
      if (!current || current.id !== boardId) return;
      current.cards.push(optimisticCard);
      const col = current.columns.find((c) => c.id === columnId);
      if (col) col.cardCount += 1;
    });
    setNowMs(createdAt);

    try {
      const response = await actions().createCard({
        boardId,
        columnId,
        content,
      });
      if (response.ok) {
        const upserted = response.events.find(
          (ev) => ev.type === 'card:upserted',
        );
        if (upserted && upserted.type === 'card:upserted') {
          setWorkspace((draft) => {
            const current = draft.board;
            if (!current || current.id !== boardId) return;
            if (current.cards.some((item) => item.id === upserted.card.id)) {
              const idx = current.cards.findIndex((item) => item.id === tempId);
              if (idx !== -1) {
                const [removed] = current.cards.splice(idx, 1);
                const col = current.columns.find((c) => c.id === removed.columnId);
                if (col) col.cardCount = Math.max(0, col.cardCount - 1);
              }
              return;
            }
            const placeholder = current.cards.find((item) => item.id === tempId);
            if (placeholder) {
              placeholder.id = upserted.card.id;
            }
          });
        } else {
          removeOptimisticCard(boardId, tempId);
        }
      } else {
        removeOptimisticCard(boardId, tempId);
      }
      if (!response.ok) return response.message;
      if (workspace.board?.id === boardId) {
        applyVersionedEvents(boardId, response.version, response.events);
        setNowMs(Date.now() + serverTimeOffsetMs);
      }
      return null;
    } catch {
      removeOptimisticCard(boardId, tempId);
      return 'Could not create Card. Try again.';
    }
  }

  async function handleUpdateCard(
    cardId: string,
    content: string,
  ): Promise<string | null> {
    const board = workspace.board;
    if (!board || !canManageCard(board, cardId)) return 'This Card can no longer be edited.';
    try {
      const response = await actions().updateCard({ boardId: board.id, cardId, content });
      if (!response.ok) return response.message;
      return applyMutationResponse(board.id, response) ? null : 'This Card can no longer be edited.';
    } catch {
      return 'Could not save the Card. Try again.';
    }
  }

  async function handleUpdateActionItem(
    cardId: string,
    patch: ActionItemPatch,
  ): Promise<boolean> {
    const board = workspace.board;
    if (!board) return false;
    const card = board.cards.find((item) => item.id === cardId);
    if (!card || !canEditActionItem(board, card, patch)) return false;
    const response = await actions().updateActionItem({
      boardId: board.id,
      cardId,
      ...patch,
    });
    return response.ok && applyMutationResponse(board.id, response);
  }

  async function handleMoveCard(
    cardId: string,
    targetColumnId: string,
  ): Promise<boolean> {
    const board = workspace.board;
    if (!board || !canManageCard(board, cardId)) return false;
    const response = await actions().moveCard({
      boardId: board.id,
      cardId,
      targetColumnId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function handleDeleteCard(cardId: string): Promise<boolean> {
    const board = workspace.board;
    if (!board || !canManageCard(board, cardId)) return false;
    const response = await actions().deleteCard({
      boardId: board.id,
      cardId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function handleGroupCard(
    cardId: string,
    targetType: 'card' | 'group',
    targetId: string,
  ): Promise<boolean> {
    const board = workspace.board;
    if (!board || !canManageGrouping(board)) return false;
    const response = await actions().groupCards({
      boardId: board.id,
      cardId,
      targetType,
      targetId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function handleRenameCardGroup(
    groupId: string,
    title: string,
  ): Promise<boolean> {
    const board = workspace.board;
    if (!board || !canManageGrouping(board)) return false;
    const response = await actions().renameCardGroup({
      boardId: board.id,
      groupId,
      title,
    });
    return applyMutationResponse(board.id, response);
  }

  async function handleUngroupCard(cardId: string): Promise<boolean> {
    const board = workspace.board;
    if (!board || !canManageGrouping(board)) return false;
    const response = await actions().ungroupCard({
      boardId: board.id,
      cardId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function handleDissolveCardGroup(groupId: string): Promise<boolean> {
    const board = workspace.board;
    if (!board || !canManageGrouping(board)) return false;
    const response = await actions().dissolveCardGroup({
      boardId: board.id,
      groupId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function handleMoveCardGroup(
    groupId: string,
    targetColumnId: string,
  ): Promise<boolean> {
    const board = workspace.board;
    if (!board || !canManageGrouping(board)) return false;
    const response = await actions().moveCardGroup({
      boardId: board.id,
      groupId,
      targetColumnId,
    });
    return applyMutationResponse(board.id, response);
  }

  function applyOptimisticReactionDelta(
    boardId: string,
    cardId: string,
    emoji: ReactionEmoji,
    adding: boolean,
  ): void {
    setWorkspace((draft) => {
      const current = draft.board;
      if (!current || current.id !== boardId) return;
      const target = current.cards.find((item) => item.id === cardId);
      if (!target) return;
      const existingIdx = target.myReactions.indexOf(emoji);
      const currentCount = target.reactions[emoji] ?? 0;
      if (adding) {
        if (existingIdx === -1) target.myReactions.push(emoji);
        target.reactions[emoji] = currentCount + 1;
      } else {
        if (existingIdx !== -1) target.myReactions.splice(existingIdx, 1);
        if (currentCount <= 1) {
          delete target.reactions[emoji];
        } else {
          target.reactions[emoji] = currentCount - 1;
        }
      }
    });
  }

  async function handleToggleReaction(
    cardId: string,
    emoji: ReactionEmoji,
  ): Promise<string | null> {
    const board = workspace.board;
    if (!board || isOptimisticId(cardId)) {
      return 'This Card can no longer receive reactions.';
    }
    const card = board.cards.find((item) => item.id === cardId);
    if (!card || !canInteractWithCard(board, card)) {
      return 'This Card can no longer receive reactions.';
    }

    const boardId = board.id;
    const hadReaction = card.myReactions.includes(emoji);
    applyOptimisticReactionDelta(boardId, cardId, emoji, !hadReaction);

    try {
      const response = await actions().toggleReaction({
        boardId,
        cardId,
        emoji,
      });
      if (!response.ok) {
        applyOptimisticReactionDelta(boardId, cardId, emoji, hadReaction);
        return response.message;
      }
      applyMutationResponse(boardId, response);
      return null;
    } catch {
      applyOptimisticReactionDelta(boardId, cardId, emoji, hadReaction);
      return 'Could not update reaction. Try again.';
    }
  }

  async function handleCreateComment(
    cardId: string,
    content: string,
  ): Promise<string | null> {
    const board = workspace.board;
    const card = board?.cards.find((item) => item.id === cardId);
    if (!board || !card || !canInteractWithCard(board, card)) {
      return 'This Card can no longer receive comments.';
    }
    try {
      const response = await actions().createComment({ boardId: board.id, cardId, content });
      if (!response.ok) return response.message;
      if (applyMutationResponse(board.id, response)) {
        setNowMs(Date.now() + serverTimeOffsetMs);
      }
      return null;
    } catch {
      return 'Could not post comment. Try again.';
    }
  }

  async function handleDeleteComment(
    cardId: string,
    commentId: string,
  ): Promise<string | null> {
    const board = workspace.board;
    const card = board?.cards.find((item) => item.id === cardId);
    if (!board || !card || !canInteractWithCard(board, card)) {
      return 'This comment can no longer be deleted.';
    }
    try {
      const response = await actions().deleteComment({ boardId: board.id, cardId, commentId });
      if (!response.ok) return response.message;
      applyMutationResponse(board.id, response);
      return null;
    } catch {
      return 'Could not delete comment. Try again.';
    }
  }

  function handleOpenCardDetail(cardId: string, trigger: HTMLButtonElement): void {
    const board = workspace.board;
    if (!board || isOptimisticId(cardId)) return;
    const card = board.cards.find((item) => item.id === cardId);
    if (!card || card.redacted) return;
    cardDetailTrigger = trigger;
    setOpenCardDetailId(cardId);
    setIsCardDetailOpen(true);
  }

  function restoreCardDetailFocus(): void {
    if (cardDetailTrigger?.isConnected) {
      cardDetailTrigger.focus({ preventScroll: true });
      if (document.activeElement === cardDetailTrigger) return;
    }
    boardMain?.focus({ preventScroll: true });
  }

  async function handleAddColumn(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const board = workspace.board;
    const trimmed = newColumnTitle().trim();
    if (!board || trimmed.length === 0 || isSavingColumn()) return;
    setIsSavingColumn(true);
    try {
      const response = await actions().addColumn({
        boardId: board.id,
        title: trimmed,
        accent: newColumnAccent(),
        isActionColumn: newColumnIsAction(),
      });
      if (applyMutationResponse(board.id, response)) {
        const upserted = response.ok
          ? response.events.find((ev) => ev.type === 'column:upserted')
          : undefined;
        if (upserted && upserted.type === 'column:upserted') {
          setActiveColumnId(upserted.column.id);
        }
        setNewColumnTitle('');
        setNewColumnAccent('slate');
        setNewColumnIsAction(false);
        setIsAddingColumn(false);
      }
    } finally {
      setIsSavingColumn(false);
    }
  }

  async function handleUpdateColumn(
    columnId: string,
    patch: { title?: string; accent?: ColumnAccent; isActionColumn?: boolean },
  ): Promise<boolean> {
    const board = workspace.board;
    if (!board) return false;
    const response = await actions().updateColumn({
      boardId: board.id,
      columnId,
      ...patch,
    });
    return applyMutationResponse(board.id, response);
  }

  async function handleMoveColumn(
    columnId: string,
    direction: -1 | 1,
  ): Promise<boolean> {
    const board = workspace.board;
    if (!board) return false;
    const ids = board.columns.map((c) => c.id);
    const currentIndex = ids.indexOf(columnId);
    const nextIndex = currentIndex + direction;
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= ids.length) {
      return false;
    }
    const reordered = [...ids];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    const response = await actions().reorderColumns({
      boardId: board.id,
      columnIds: reordered,
    });
    return applyMutationResponse(board.id, response);
  }

  async function handleDeleteColumn(columnId: string): Promise<boolean> {
    const board = workspace.board;
    if (!board) return false;
    const response = await actions().deleteColumn({
      boardId: board.id,
      columnId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function handleChangeVote(
    targetType: 'card' | 'group',
    targetId: string,
    delta: ChangeVoteInput['delta'],
  ): Promise<void> {
    const board = workspace.board;
    if (!board || !canContribute(board) || voteInFlight || isOptimisticId(targetId)) return;

    const boardId = board.id;
    const input = { boardId, targetType, targetId, delta } as const;
    voteInFlight = true;
    setPendingVote({ ...input, baseVersion: board.version });
    try {
      const response = await actions().changeVote(input);
      applyMutationResponse(boardId, response);
    } catch {
      if (workspace.board?.id === boardId) setErrorMessage('Could not update your Vote. Try again.');
    } finally {
      voteInFlight = false;
      setPendingVote(null);
    }
  }

  async function runVotingSettingsMutation(
    mutate: (boardId: string) => Promise<BoardMutationResponse>,
  ): Promise<string | null> {
    const board = workspace.board;
    if (!board || !canControlFacilitation(board)) return 'Voting settings are unavailable.';
    const boardId = board.id;

    try {
      const response = await mutate(boardId);
      if (!response.ok) return response.message;
      applyMutationResponse(boardId, response);
      return null;
    } catch {
      return 'Could not update Voting. Try again.';
    }
  }

  function saveVotingSettings(patch: VotingSettingsPatch): Promise<string | null> {
    const update = actions().updateVotingSettings;
    return runVotingSettingsMutation((boardId) => update({ boardId, ...patch }));
  }

  function resetAllVotes(): Promise<string | null> {
    const reset = actions().resetVotes;
    return runVotingSettingsMutation((boardId) => reset({ boardId }));
  }

  async function toggleBoardLock(isLocked: boolean): Promise<string | null> {
    const board = workspace.board;
    if (!board || !canFacilitate(board)) return 'Only a Facilitator can Lock or Unlock the Board.';
    const boardId = board.id;
    try {
      const response = await actions().setBoardLock({ boardId, isLocked });
      if (!response.ok) return response.message;
      applyMutationResponse(boardId, response);
      return null;
    } catch {
      return 'Could not update Board lock state. Try again.';
    }
  }

  async function deleteCurrentBoard(): Promise<string | null> {
    const board = workspace.board;
    if (!board || !canFacilitate(board)) return 'Only a Facilitator can delete this Board.';
    const boardId = board.id;
    try {
      const response = await actions().deleteBoard({ boardId });
      if (!response.ok) return response.message;
      applyMutationResponse(boardId, response);
      return null;
    } catch {
      return 'Could not delete this Board. Try again.';
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
      const error = await handleCreateCard(id, draft.trim());
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

  function updateColumnTabEdges(list: HTMLDivElement): void {
    const offset = Math.abs(list.scrollLeft);
    list.toggleAttribute('data-fade-start', offset > 1);
    list.toggleAttribute('data-fade-end', offset < list.scrollWidth - list.clientWidth - 1);
  }

  createEffect(() => workspace.board?.id, () => {
    const list = columnTabListEl;
    const track = list?.firstElementChild;
    if (!list || !track) return;
    updateColumnTabEdges(list);
    const observer = new ResizeObserver(() => updateColumnTabEdges(list));
    observer.observe(list);
    observer.observe(track);
    return () => observer.disconnect();
  });

  createEffect(resolvedActiveColumnIndex, (index) => {
    const list = columnTabListEl;
    const tab = list?.querySelectorAll<HTMLElement>('[role=tab]')[index];
    if (!list || !tab) return;
    const rail = list.getBoundingClientRect();
    const item = tab.getBoundingClientRect();
    const offset = item.left < rail.left ? item.left - rail.left - 12
      : item.right > rail.right ? item.right - rail.right + 12 : 0;
    if (offset !== 0) list.scrollLeft += offset;
    updateColumnTabEdges(list);
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

    const cols = workspace.board?.columns ?? [];
    const current = resolvedActiveColumnIndex();
    const next = cols[current + (dx < 0 ? 1 : -1)];
    if (next) setActiveColumnId(next.id);
  }

  function handleDragStartCard(cardId: string, sourceColumnId: string): void {
    const board = workspace.board;
    if (!board || !canManageCard(board, cardId)) return;
    setDraggingCardId(cardId);
    setDraggingGroupId(null);
    setDraggingSourceColumnId(sourceColumnId);
  }

  function handleDragStartGroup(groupId: string, sourceColumnId: string): void {
    const board = workspace.board;
    if (!board) return;
    const group = board.groups.find((item) => item.id === groupId);
    if (!group || !canManageGroup(board, group, board.cards)) return;
    setDraggingCardId(null);
    setDraggingGroupId(groupId);
    setDraggingSourceColumnId(sourceColumnId);
  }

  function handleDragEndCard(): void {
    setDraggingCardId(null);
    setDraggingGroupId(null);
    setDraggingSourceColumnId(null);
  }

  return (
    <Show
      when={workspace.board}
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
            <a href={props.homeHref ?? '/'} class="page-message-action">
              Create a new board
            </a>
          </PageMessage>
        </div>
      }
    >
      {(board) => (
        <div
          class="board-workspace flex min-h-dvh flex-col bg-canvas"
          data-board-print-ready={isPrinting() ? "" : undefined}
          data-dramatic-reveal={isDramaticReveal() ? 'true' : undefined}
        >
          <Show when={isPrinting()}>
            <PrintBoard board={board()} />
          </Show>
          <div aria-live="polite" aria-atomic="true" class="sr-only">
            {modeAnnouncement()}
          </div>
          <header role="banner" class="board-masthead">
            <div class="board-island board-masthead-island">
              <BoardHomeLink href={props.homeHref ?? '/'} class="hidden justify-self-start sm:inline-flex" />
              <div data-renaming={isRenamingBoard() ? "" : undefined}
                class="board-masthead-title flex h-7 min-w-0 max-w-full items-center px-3 sm:h-10 sm:justify-center sm:px-0">
                <Show
                  when={!isRenamingBoard()}
                  fallback={
                    <div class="flex h-7 w-full max-w-md items-center gap-1.5 sm:h-10">
                      <input
                        ref={boardTitleInputEl}
                        type="text"
                        aria-label="Board title"
                        value={boardTitleDraft()}
                        maxlength={MAX_BOARD_TITLE_LENGTH}
                        onInput={(e) =>
                          setBoardTitleDraft(e.currentTarget.value)
                        }
                        onKeyDown={handleBoardTitleKeyDown}
                        class={[
                          'h-11 min-w-0 flex-1 rounded-full border border-control/80 bg-surface px-3.5 text-xl leading-snug font-semibold tracking-[-0.02em] text-text sm:h-9 sm:text-center sm:text-lg',
                          'focus:border-focus focus:outline-none',
                        ]}
                      />
                      <button
                        type="button"
                        aria-label="Save Board title"
                        disabled={
                          isSavingBoardTitle() ||
                          boardTitleDraft().trim().length === 0
                        }
                        onClick={() => void saveBoardRename()}
                        class="spring-press inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-accent-contrast hover:opacity-90 disabled:opacity-50 sm:size-9"
                      >
                        <LucideIcon icon={Check} class="size-4" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel Board rename"
                        onClick={cancelBoardRename}
                        class="spring-press inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/80 bg-surface text-text-muted hover:bg-surface-subtle hover:text-text sm:size-9"
                      >
                        <LucideIcon icon={X} class="size-4" strokeWidth={1.9} />
                      </button>
                    </div>
                  }
                >
                  <div
                    onDblClick={handleBoardTitleDoubleClick}
                    onPointerDown={boardTitleTap.onPointerDown}
                    onPointerUp={boardTitleTap.onPointerUp}
                    onPointerCancel={boardTitleTap.onPointerCancel}
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
                        onClick={startBoardRename}
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
                          clock={timerClock()}
                          canControl={canControlFacilitation(board())}
                          onChange={(change) => changeCountdown(boardId, change)}
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
                      disabled={isChangingPrivateMode()}
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
                        setIsActionItemsOpen(true);
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
                        class="board-popover max-h-[min(60dvh,28rem)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl p-1.5"
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
                                startBoardRename();
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
                              setIsActionItemsOpen(true);
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
                          onFeedback={setExportFeedback}
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
                      class={['size-1.5 shrink-0 rounded-full', isLive() ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-text-muted']}
                    />
                    {isLive() ? 'Live' : 'Reconnecting…'}
                  </span>
                  <Show when={isLive() && onlineCount() !== null}>
                    <span class="border-l border-border/80 pl-2 tabular-nums">{onlineCount()} online</span>
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
                    <span class="tabular-nums">{voting().remainingVotes} / {board().voteLimit} votes left</span>
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
            <p
              data-print-hide="true"
              aria-live="polite"
              aria-atomic="true"
              class={[
                'board-masthead-feedback mx-3 text-xs empty:sr-only sm:mx-0',
                exportFeedback()?.error ? 'text-rose-700 dark:text-rose-300' : 'text-text-muted',
              ]}
            >
              {exportFeedback()?.message}
            </p>
          </header>

          <Show when={canFacilitate(board())}>
            <BoardVotingSettings
              board={board()}
              open={isBoardSettingsOpen()}
              onClose={() => {
                setIsBoardSettingsOpen(false);
                boardMenuTriggerEl?.focus();
              }}
              onUpdate={saveVotingSettings}
              onReset={resetAllVotes}
              onToggleLock={toggleBoardLock}
              onDeleteBoard={deleteCurrentBoard}
            />
          </Show>

          {/* Viewer-local Search, Quick Filter & Sort toolbar */}
          <Show when={boardView()}>
            {(view) => (
              <BoardFilterBar
                query={searchQuery()}
                filter={quickFilter()}
                requestedSortMode={sortMode()}
                effectiveSortMode={view().effectiveSortMode}
                blindVoting={board().blindVoting}
                hasActiveFilter={view().hasActiveFilter}
                hasSearchQuery={view().hasSearchQuery}
                widenSearch={secretSearch()?.id === 'scope-creep'}
                matchedCardCount={view().matchedCardCount}
                totalCardCount={view().totalCardCount}
                onQueryChange={setSearchQuery}
                onFilterChange={setQuickFilter}
                onSortChange={setSortMode}
                onResetFilters={resetFilters}
                onSearchInputRef={(el) => {
                  searchInputEl = el;
                }}
              />
            )}
          </Show>

          {/* Inline dismissible error feedback */}
          <Show when={errorMessage()}>
            {(message) => (
              <div
                role="alert"
                class="mx-auto mt-3 flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6"
              >
                <div class="flex flex-1 items-center justify-between gap-3 rounded-lg border border-col-rose/40 bg-col-rose-tint px-3.5 py-2 text-xs font-medium text-text">
                  <span>{message()}</span>
                  <button
                    type="button"
                    aria-label="Dismiss error"
                    onClick={() => setErrorMessage(null)}
                    class="inline-flex min-h-11 min-w-11 cursor-pointer sm:min-h-8 sm:min-w-8 items-center justify-center rounded-md text-text-muted hover:text-text"
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
              <div class="relative mb-4 rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-sm text-text-muted">
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
                <TabsList
                  ref={columnTabListEl}
                  onScroll={(event) => updateColumnTabEdges(event.currentTarget)}
                  aria-label="Select Column"
                  class="scroll-edge-fade overflow-x-auto rounded-full bg-surface-subtle"
                >
                  <div class="flex w-max min-w-full items-center gap-0.5 py-0.5 pl-0.5 pr-2">
                    <For each={board().columns}>
                      {(column) => (
                        <TabsTab
                          value={column.id}
                          title={column.title}
                          render={(tabProps) => (
                            <button
                              {...tabProps}
                              id={`column-tab-${column.id}`}
                              aria-controls={`column-${column.id}`}
                            />
                          )}
                          class="inline-flex min-h-11 min-w-11 max-w-[min(17rem,72vw)] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-3 text-[13px] font-medium text-text-muted transition-colors hover:text-text active:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus data-selected:bg-surface data-selected:text-text data-selected:shadow-xs"
                        >
                          <span
                            aria-hidden="true"
                            class={[
                              'h-2 w-2 shrink-0 rounded-full',
                              COLUMN_ACCENT_STYLES[column.accent].swatch,
                            ]}
                          />
                          <span class="min-w-0 truncate text-left">{column.title}</span>
                          <span class="text-xs text-text-muted tabular-nums">
                            {boardView()?.hasActiveFilter
                              ? `${boardView()?.columns.get(column.id)?.visibleCardCount ?? 0}/${column.cardCount}`
                              : column.cardCount}
                          </span>
                        </TabsTab>
                      )}
                    </For>
                  </div>
                </TabsList>
              </nav>
              <div
                data-board-columns="true"
                class={[
                  'gap-4 touch-pan-y touch-pinch-zoom sm:touch-auto',
                  getResponsiveGridClass(board().columns.length, canAddColumn()),
                  { 'secret-search-pivot': secretSearch()?.id === 'pivot' },
                ]}
              >
                <For each={board().columns}>
                  {(column, index) => {
                    const columnCards = createMemo(
                      () => cardsByColumn().get(column.id) ?? EMPTY_CARDS,
                      {
                        equals: (prev, next) =>
                          prev.length === next.length &&
                          prev.every((card, i) => card === next[i]),
                      },
                    );
                    const columnGroups = createMemo(
                      () => groupsByColumn().get(column.id) ?? EMPTY_GROUPS,
                      {
                        equals: (prev, next) =>
                          prev.length === next.length &&
                          prev.every((group, i) => group === next[i]),
                      },
                    );
                    const columnStreamItems = createMemo(
                      () =>
                        boardView()?.columns.get(column.id)?.items ??
                        EMPTY_STREAM_ITEMS,
                      {
                        equals: (prev, next) =>
                          prev.length === next.length &&
                          prev.every((item, i) => {
                            const other = next[i];
                            if (item.kind !== other.kind || item.key !== other.key) {
                              return false;
                            }
                            if (item.kind === 'card' && other.kind === 'card') {
                              return item.card === other.card;
                            }
                            if (item.kind === 'group' && other.kind === 'group') {
                              return (
                                item.group === other.group &&
                                item.cards.length === other.cards.length &&
                                item.cards.every((c, j) => c === other.cards[j])
                              );
                            }
                            return false;
                          }),
                      },
                    );
                    return (
                      <ColumnPanel
                        column={column}
                        columnIndex={index()}
                        totalColumns={board().columns.length}
                        columns={board().columns}
                        cards={columnCards()}
                        groups={columnGroups()}
                        streamItems={columnStreamItems()}
                        visibleCardCount={
                          boardView()?.columns.get(column.id)?.visibleCardCount ?? 0
                        }
                        hasActiveFilter={boardView()?.hasActiveFilter ?? false}
                        voting={voting()}
                        isFacilitator={board().isFacilitator}
                        isLocked={board().isLocked}
                        isBlurred={board().isBlurred}
                        canGroupCards={canManageGrouping(board())}
                        nowMs={nowMs()}
                        isMobile={isMobileBoard()}
                        isMobileActive={resolvedActiveColumnIndex() === index()}
                        isHorizontalSnap={isHorizontalSnap()}
                        draggingCardId={draggingCardId()}
                        draggingGroupId={draggingGroupId()}
                        draggingSourceColumnId={draggingSourceColumnId()}
                        onResetFilters={resetFilters}
                        onRegisterComposer={registerColumnComposer}
                        onActivateColumn={(colId) => setActiveColumnId(colId)}
                        onCreateCard={handleCreateCard}
                        onUpdateCard={handleUpdateCard}
                        onUpdateActionItem={handleUpdateActionItem}
                        onMoveCard={handleMoveCard}
                        onDeleteCard={handleDeleteCard}
                        onToggleReaction={handleToggleReaction}
                        onOpenCardDetail={handleOpenCardDetail}
                        onUpdateColumn={handleUpdateColumn}
                        onMoveColumn={handleMoveColumn}
                        onDeleteColumn={handleDeleteColumn}
                        onGroupCard={handleGroupCard}
                        onUngroupCard={handleUngroupCard}
                        onRenameCardGroup={handleRenameCardGroup}
                        onDissolveCardGroup={handleDissolveCardGroup}
                        onMoveCardGroup={handleMoveCardGroup}
                        onDragStartCard={handleDragStartCard}
                        onDragStartGroup={handleDragStartGroup}
                        onDragEndCard={handleDragEndCard}
                      />
                    );
                  }}
                </For>
                <Show when={canAddColumn()}>
                  <button
                    type="button"
                    data-print-hide="true"
                    onClick={openAddColumn}
                    class={[
                      'spring-press hidden w-fit shrink-0 cursor-pointer items-center gap-1.5 self-start rounded-2xl border border-dashed border-border/85 bg-surface-subtle/25 px-3.5 py-2.5 text-[13px] font-medium text-text-muted',
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
              class="board-dialog-surface z-50 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-2xl"
            >
              <div
                aria-hidden="true"
                class={['h-[3px] w-full transition-colors duration-200', COLUMN_ACCENT_STYLES[newColumnAccent()].bar]}
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
                  class="spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface/80 hover:text-text board-focus-ring sm:min-h-8 sm:min-w-8"
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
                    class="mt-1.5 min-h-11 w-full rounded-xl border border-border/85 bg-canvas px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none sm:min-h-10"
                  />
                </div>

                <div>
                  <span class="block text-xs font-medium text-text-muted">
                    Accent color
                  </span>
                  <div class="mt-1.5 grid grid-cols-4 gap-1 sm:grid-cols-8">
                    <For each={COLUMN_ACCENTS}>
                      {(accent) => (
                        <button
                          type="button"
                          aria-label={`New column accent ${COLUMN_ACCENT_STYLES[accent].label}`}
                          aria-pressed={
                            newColumnAccent() === accent ? 'true' : 'false'
                          }
                          onClick={() => setNewColumnAccent(accent)}
                          class={[
                            'spring-press inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border transition-colors sm:min-h-9',
                            {
                              'border-border bg-surface-subtle':
                                newColumnAccent() === accent,
                              'border-transparent hover:bg-surface-subtle':
                                newColumnAccent() !== accent,
                            },
                          ]}
                        >
                          <span
                            aria-hidden="true"
                            class={[
                              'size-4 rounded-full',
                              COLUMN_ACCENT_STYLES[accent].swatch,
                              {
                                'ring-2 ring-text ring-offset-2 ring-offset-surface':
                                  newColumnAccent() === accent,
                              },
                            ]}
                          />
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                <label class="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-text-muted sm:min-h-9">
                  <input
                    type="checkbox"
                    checked={newColumnIsAction()}
                    onChange={(e) =>
                      setNewColumnIsAction(e.currentTarget.checked)
                    }
                    class="size-4 rounded border-border accent-accent"
                  />
                  <span>Action Items column</span>
                </label>

                <div class="flex items-center justify-end gap-2 border-t border-border/70 pt-3.5">
                  <button
                    type="button"
                    onClick={() => setIsAddingColumn(false)}
                    class="spring-press board-touch-target cursor-pointer rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-medium text-text-muted hover:bg-surface-subtle hover:text-text"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSavingColumn() || newColumnTitle().trim().length === 0
                    }
                    class="spring-press board-touch-target cursor-pointer rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingColumn() ? 'Adding…' : 'Add column'}
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
                column={openDetailColumn()}
                isFacilitator={board().isFacilitator}
                isLocked={board().isLocked}
                isBlurred={board().isBlurred}
                nowMs={nowMs()}
                isOpen={isCardDetailOpen()}
                side={isMobileBoard() ? 'bottom' : 'right'}
                onClose={() => setIsCardDetailOpen(false)}
                onExit={() => setOpenCardDetailId(null)}
                restoreFocus={restoreCardDetailFocus}
                onUpdateActionItem={handleUpdateActionItem}
                onToggleReaction={handleToggleReaction}
                onCreateComment={handleCreateComment}
                onDeleteComment={handleDeleteComment}
              />
            )}
          </Show>

          {/* Action Items Drawer / Bottom Sheet */}
          <ActionItemsDrawer
            board={board()}
            open={isActionItemsOpen()}
            side={isMobileBoard() ? 'bottom' : 'right'}
            isLocked={board().isLocked}
            onClose={() => setIsActionItemsOpen(false)}
            onRestoreFocus={restoreActionItemsFocus}
            onUpdateActionItem={handleUpdateActionItem}
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
                class="board-mobile-composer sticky bottom-[var(--keyboard-inset,0px)] z-20 border-t border-border px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:hidden"
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
                      'min-h-11 max-h-32 min-w-0 flex-1 resize-none rounded-xl border border-control bg-canvas px-3 py-[9px] text-base leading-6 text-text',
                      'placeholder:text-text-muted focus:border-focus focus:outline-none',
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
                      'inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-accent px-4 text-xs font-medium text-accent-contrast',
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
      )}
    </Show>
  );
}
