import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createStore,
  onSettled,
  reconcile,
  untrack,
} from 'solid-js';

import {
  defaultBoardWorkspaceActions,
  type BoardWorkspaceActions,
} from '../lib/board-actions';
import { connectBoardLive } from '../lib/board-live';
import { applyBoardEvents } from '../lib/board-store';
import {
  COLUMN_ACCENTS,
  MAX_BOARD_TITLE_LENGTH,
  MAX_CARD_CONTENT_LENGTH,
  MAX_COLUMNS_PER_BOARD,
  MAX_COLUMN_TITLE_LENGTH,
  type BoardEvent,
  type BoardMutationResponse,
  type BoardViewDTO,
  type CardViewDTO,
  type ColumnAccent,
} from '../lib/board-types';
import { recordRecentBoard, removeRecentBoard } from '../lib/recent-boards';
import type { TimerChange } from '../lib/schemas';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import type { ServerClockSample } from '../lib/timer';
import ColumnPanel from './ColumnPanel';
import CountdownTimer from './CountdownTimer';
import { CheckIcon, CloseIcon, PencilIcon, PlusIcon } from './Icons';
import ShareBoard from './ShareBoard';
import ThemeToggle from './ThemeToggle';

export interface BoardWorkspaceProps {
  board: BoardViewDTO | null;
  boardId: string;
  homeHref?: string;
  actions?: BoardWorkspaceActions;
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

function getResponsiveGridClass(columnCount: number): string {
  if (columnCount <= 1) return 'sm:grid sm:grid-cols-1 lg:max-w-2xl';
  if (columnCount === 2) return 'sm:grid sm:grid-cols-2 lg:grid-cols-2';
  if (columnCount === 3) return 'sm:grid sm:grid-cols-2 lg:grid-cols-3';
  if (columnCount === 4) return 'sm:grid sm:grid-cols-2 lg:grid-cols-4';
  return 'sm:flex sm:overflow-x-auto sm:snap-x sm:snap-mandatory sm:pb-4';
}

export default function BoardWorkspace(props: BoardWorkspaceProps) {
  const [workspace, setWorkspace] = createStore<{
    board: BoardViewDTO | null;
  }>({
    board: untrack(() => cloneBoardView(props.board)),
  });

  const [nowMs, setNowMs] = createSignal(Date.now());
  const [onlineCount, setOnlineCount] = createSignal<number | null>(null);
  const [serverClock, setServerClock] = createSignal<(ServerClockSample & { boardId: string }) | null>(null);
  const timerClock = createMemo(() => {
    const clock = serverClock();
    return clock?.boardId === workspace.board?.id ? clock : null;
  });
  let serverTimeOffsetMs = 0;
  let reconnectLive: (() => void) | undefined;
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  const [isChangingPrivateMode, setIsChangingPrivateMode] = createSignal(false);
  const [revealAnnouncement, setRevealAnnouncement] = createSignal('');

  // Board inline rename state
  const [isRenamingBoard, setIsRenamingBoard] = createSignal(false);
  const [boardTitleDraft, setBoardTitleDraft] = createSignal('');
  const [isSavingBoardTitle, setIsSavingBoardTitle] = createSignal(false);

  // Add Column inline composer state
  const [isAddingColumn, setIsAddingColumn] = createSignal(false);
  const [newColumnTitle, setNewColumnTitle] = createSignal('');
  const [newColumnAccent, setNewColumnAccent] =
    createSignal<ColumnAccent>('slate');
  const [newColumnIsAction, setNewColumnIsAction] = createSignal(false);
  const [isSavingColumn, setIsSavingColumn] = createSignal(false);

  // Mobile active Column + swipe + bottom quick-add state
  const [activeColumnId, setActiveColumnId] = createSignal<string | null>(null);
  const [mobileDraft, setMobileDraft] = createSignal('');
  const [isSubmittingMobileCard, setIsSubmittingMobileCard] =
    createSignal(false);
  let touchStartX: number | null = null;
  let touchStartY: number | null = null;

  // Desktop drag-and-drop Card state
  const [draggingCardId, setDraggingCardId] = createSignal<string | null>(null);
  const [draggingSourceColumnId, setDraggingSourceColumnId] = createSignal<
    string | null
  >(null);

  function applySnapshot(nextBoard: BoardViewDTO | null, fromLive = false): void {
    setWorkspace((draft) => {
      const current = draft.board;
      if (nextBoard && current?.id === nextBoard.id) {
        if (nextBoard.version < current.version) return;
        if (!fromLive && nextBoard.version === current.version &&
            nextBoard.isFacilitator === current.isFacilitator) return;
      }
      reconcile({ board: cloneBoardView(nextBoard) })(draft);
    });
  }

  function syncServerClock(boardId: string, serverNow: number): void {
    setServerClock({ boardId, serverNow, receivedAt: performance.now() });
    serverTimeOffsetMs = serverNow - Date.now();
    setNowMs(serverNow);
  }

  function applyServerSnapshot(nextBoard: BoardViewDTO, serverNow: number): void {
    const current = workspace.board;
    if (current?.id !== nextBoard.id || nextBoard.version < current.version) return;
    syncServerClock(nextBoard.id, serverNow);
    applySnapshot(nextBoard, true);
  }

  function applyVersionedEvents(boardId: string, version: number, events: BoardEvent[]): void {
    const snapshot = events.find((event) => event.type === 'board:snapshot');
    if (snapshot) {
      applyServerSnapshot(snapshot.board, snapshot.serverNow);
      return;
    }
    let needsResync = false;
    let serverNow: number | undefined;
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
    if (serverNow !== undefined) syncServerClock(boardId, serverNow);
    if (needsResync) reconnectLive?.();
  }

  createEffect(() => props.board, (nextBoard) => applySnapshot(nextBoard));

  createEffect(
    () => {
      const board = workspace.board;
      return board && { id: board.id, isBlurred: board.isBlurred };
    },
    (board, previous) => {
      if (!board || board.isBlurred || previous?.id !== board.id) {
        setRevealAnnouncement('');
      } else if (previous.isBlurred) {
        setRevealAnnouncement('All Cards revealed.');
      }
    },
  );

  const liveBoardId = createMemo(() => workspace.board?.id);
  createEffect(liveBoardId, (boardId) => {
    if (!boardId || typeof window === 'undefined') return;
    const live = connectBoardLive(boardId, {
      onReconnect: () => setOnlineCount(null),
      onMessage(message) {
        switch (message.type) {
          case 'board:snapshot':
            applyServerSnapshot(message.board, message.serverNow);
            break;
          case 'board:mutation':
            applyVersionedEvents(boardId, message.version, message.events);
            break;
          case 'presence:count':
            setOnlineCount(message.count);
            break;
          case 'board:deleted':
            applySnapshot(null);
            break;
        }
      },
    });
    reconnectLive = live.reconnect;
    return () => {
      reconnectLive = undefined;
      live.dispose();
    };
  });

  // Keep relative timestamps fresh on the client
  onSettled(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now() + serverTimeOffsetMs);
    }, 30_000);
    return () => clearInterval(intervalId);
  });

  onSettled(() => {
    document.addEventListener('keydown', handlePrivateModeShortcut);
    return () => document.removeEventListener('keydown', handlePrivateModeShortcut);
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

  const isHorizontalSnap = createMemo(
    () => (workspace.board?.columns.length ?? 0) >= 5,
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

  function handlePrivateModeShortcut(event: KeyboardEvent): void {
    if (
      event.defaultPrevented || event.repeat || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'b'
    ) return;
    if (event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;

    const board = workspace.board;
    if (!board?.isFacilitator || board.isLocked) return;
    event.preventDefault();
    void togglePrivateMode();
  }

  async function togglePrivateMode(): Promise<void> {
    const board = workspace.board;
    if (!board?.isFacilitator || board.isLocked || isChangingPrivateMode()) return;
    const { id: boardId, isBlurred } = board;
    setIsChangingPrivateMode(true);
    try {
      const response = await actions().setPrivateMode({ boardId, isBlurred: !isBlurred });
      applyMutationResponse(boardId, response);
    } finally {
      setIsChangingPrivateMode(false);
    }
  }

  function canManageCard(board: BoardViewDTO, cardId: string): boolean {
    const card = board.cards.find((item) => item.id === cardId);
    return !board.isLocked && !!card && !card.redacted &&
      (card.isMine || (board.isFacilitator && !board.isBlurred));
  }

  function startBoardRename(): void {
    const board = workspace.board;
    if (!board || !board.isFacilitator || board.isLocked) return;
    setBoardTitleDraft(board.title);
    setIsRenamingBoard(true);
  }

  function cancelBoardRename(): void {
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

  async function handleCreateCard(
    columnId: string,
    content: string,
  ): Promise<boolean> {
    const board = workspace.board;
    if (!board) return false;
    const response = await actions().createCard({
      boardId: board.id,
      columnId,
      content,
    });
    const ok = applyMutationResponse(board.id, response);
    if (ok) {
      setNowMs(Date.now() + serverTimeOffsetMs);
    }
    return ok;
  }

  async function handleUpdateCard(
    cardId: string,
    content: string,
  ): Promise<boolean> {
    const board = workspace.board;
    if (!board || !canManageCard(board, cardId)) return false;
    const response = await actions().updateCard({
      boardId: board.id,
      cardId,
      content,
    });
    return applyMutationResponse(board.id, response);
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

  async function handleMobileQuickAdd(): Promise<void> {
    const targetCol = activeMobileColumn();
    const trimmed = mobileDraft().trim();
    if (!targetCol || trimmed.length === 0 || isSubmittingMobileCard()) return;
    setIsSubmittingMobileCard(true);
    try {
      const ok = await handleCreateCard(targetCol.id, trimmed);
      if (ok) {
        setMobileDraft('');
      }
    } finally {
      setIsSubmittingMobileCard(false);
    }
  }

  function handleMobileComposerKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleMobileQuickAdd();
    }
  }

  function handleTouchStart(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }

  function handleTouchEnd(event: TouchEvent): void {
    if (touchStartX === null || touchStartY === null) return;
    const touch = event.changedTouches[0];
    const startX = touchStartX;
    const startY = touchStartY;
    touchStartX = null;
    touchStartY = null;
    if (!touch) return;

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) {
      return;
    }

    const cols = workspace.board?.columns ?? [];
    if (cols.length <= 1) return;
    const currentIdx = resolvedActiveColumnIndex();
    const nextIdx =
      dx < 0
        ? Math.min(cols.length - 1, currentIdx + 1)
        : Math.max(0, currentIdx - 1);
    if (nextIdx !== currentIdx) {
      setActiveColumnId(cols[nextIdx].id);
    }
  }

  function handleDragStartCard(cardId: string, sourceColumnId: string): void {
    const board = workspace.board;
    if (!board || !canManageCard(board, cardId)) return;
    setDraggingCardId(cardId);
    setDraggingSourceColumnId(sourceColumnId);
  }

  function handleDragEndCard(): void {
    setDraggingCardId(null);
    setDraggingSourceColumnId(null);
  }

  return (
    <Show
      when={workspace.board}
      fallback={
        <div class="flex min-h-dvh flex-col">
          <header class="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur-sm">
            <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
              <a
                href={props.homeHref ?? '/'}
                class={[
                  'inline-flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight text-text',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                ]}
              >
                <span
                  aria-hidden="true"
                  class="inline-block h-2.5 w-2.5 rounded-sm bg-accent"
                />
                <span>Retrocks</span>
              </a>
              <ThemeToggle />
            </div>
          </header>

          <main class="mx-auto flex flex-1 max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
            <p class="text-xs font-medium tracking-wide text-text-muted uppercase tabular-nums">
              404
            </p>
            <h1 class="mt-2 text-2xl font-semibold tracking-tight text-text">
              Board not found or expired
            </h1>
            <p class="mt-3 text-sm text-text-muted">
              This Board may have been deleted by its Facilitator or expired
              after inactivity.
            </p>
            <a
              href={props.homeHref ?? '/'}
              class={[
                'mt-6 inline-flex items-center rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-contrast',
                'transition-opacity hover:opacity-90',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              ]}
            >
              Create a new board
            </a>
          </main>
        </div>
      }
    >
      {(board) => (
        <div class="flex min-h-dvh flex-col bg-canvas">
          <div aria-live="polite" aria-atomic="true" class="sr-only">
            {revealAnnouncement()}
          </div>
          {/* Minimal sticky Board header */}
          <header class="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur-sm">
            <div class="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
              <div class="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                <a
                  href={props.homeHref ?? '/'}
                  aria-label="Retrocks home"
                  class={[
                    'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md text-sm font-semibold tracking-tight text-text sm:min-h-8',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  ]}
                >
                  <span
                    aria-hidden="true"
                    class="inline-block h-2.5 w-2.5 rounded-sm bg-accent"
                  />
                  <span class="hidden sm:inline">Retrocks</span>
                </a>
                <span aria-hidden="true" class="text-border">
                  /
                </span>

                <div class="min-w-0 flex-1">
                  <Show
                    when={!isRenamingBoard()}
                    fallback={
                      <div class="flex max-w-md items-center gap-1.5">
                        <input
                          type="text"
                          aria-label="Board title"
                          value={boardTitleDraft()}
                          maxlength={MAX_BOARD_TITLE_LENGTH}
                          onInput={(e) =>
                            setBoardTitleDraft(e.currentTarget.value)
                          }
                          onKeyDown={handleBoardTitleKeyDown}
                          class={[
                            'min-w-0 flex-1 rounded-md border border-border bg-canvas px-2.5 py-1 text-sm font-semibold text-text',
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
                          class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md bg-accent text-accent-contrast hover:opacity-90 disabled:opacity-50"
                        >
                          <CheckIcon />
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel Board rename"
                          onClick={cancelBoardRename}
                          class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-text-muted hover:text-text"
                        >
                          <CloseIcon />
                        </button>
                      </div>
                    }
                  >
                    <div class="flex items-center gap-1.5">
                      <h1 class="truncate text-sm font-semibold text-text sm:text-base">
                        {board().title}
                      </h1>
                      <Show when={board().isFacilitator && !board().isLocked}>
                        <button
                          type="button"
                          aria-label="Rename Board"
                          title="Rename Board"
                          onClick={startBoardRename}
                          class={[
                            'inline-flex min-h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted sm:min-h-7 sm:min-w-7',
                            'transition-colors hover:bg-surface-subtle hover:text-text',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                          ]}
                        >
                          <PencilIcon />
                        </button>
                      </Show>
                      <Show when={board().isLocked}>
                        <span class="shrink-0 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text-muted">
                          Locked
                        </span>
                      </Show>
                      <Show when={board().isBlurred}>
                        <span class="shrink-0 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text-muted">
                          Private Mode
                        </span>
                      </Show>
                    </div>
                  </Show>
                  <div class="flex min-w-0 items-center gap-2 text-xs text-text-muted">
                    <span role="status" class="inline-flex shrink-0 items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        class={[
                          'h-1.5 w-1.5 rounded-full',
                          onlineCount() === null ? 'bg-text-muted' : 'bg-emerald-600 dark:bg-emerald-400',
                        ]}
                      />
                      {onlineCount() === null ? 'Reconnecting…' : `${onlineCount()} online`}
                    </span>
                    <Show when={board().subtitle.length > 0}>
                      <p class="truncate">{board().subtitle}</p>
                    </Show>
                  </div>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <Show when={board().id} keyed>
                  {(boardId) => (
                    <CountdownTimer
                      timer={board().timer}
                      clock={timerClock()}
                      canControl={board().isFacilitator && !board().isLocked}
                      onChange={(change) => changeCountdown(boardId, change)}
                    />
                  )}
                </Show>
                <Show when={board().isFacilitator && !board().isLocked}>
                  <button
                    type="button"
                    aria-keyshortcuts="B"
                    title={board().isBlurred ? 'Reveal All (B)' : 'Enable Private Mode (B)'}
                    disabled={isChangingPrivateMode()}
                    onClick={() => void togglePrivateMode()}
                    class={[
                      'inline-flex min-h-11 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium sm:min-h-9 sm:px-3',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
                      board().isBlurred
                        ? 'border-accent bg-accent text-accent-contrast hover:opacity-90'
                        : 'border-border bg-surface text-text hover:bg-surface-subtle',
                    ]}
                  >
                    {board().isBlurred ? 'Reveal All' : 'Private Mode'}
                  </button>
                </Show>
                <Show
                  when={
                    board().isFacilitator &&
                    !board().isLocked &&
                    board().columns.length < MAX_COLUMNS_PER_BOARD
                  }
                >
                  <button
                    type="button"
                    onClick={() => setIsAddingColumn((prev) => !prev)}
                    class={[
                      'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text sm:min-h-9',
                      'transition-colors hover:bg-surface-subtle',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    ]}
                  >
                    <PlusIcon class="h-3.5 w-3.5" />
                    <span class="hidden sm:inline">+ Add column</span>
                    <span class="sm:hidden">Column</span>
                  </button>
                </Show>
                <Show when={board().id} keyed>
                  {(boardId) => (
                    <ShareBoard
                      boardId={boardId}
                      isFacilitator={board().isFacilitator}
                    />
                  )}
                </Show>
                <ThemeToggle />
              </div>
            </div>

            {/* Mobile (< 640px) scrollable Column Tab Bar */}
            <nav
              aria-label="Board Columns"
              class="border-t border-border/70 bg-surface sm:hidden"
            >
              <div
                role="tablist"
                aria-label="Select Column"
                class="flex items-center gap-1.5 overflow-x-auto px-3 py-2"
              >
                <For each={board().columns}>
                  {(column, index) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={
                        resolvedActiveColumnIndex() === index()
                          ? 'true'
                          : 'false'
                      }
                      onClick={() => setActiveColumnId(column.id)}
                      class={[
                        'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        {
                          'border-text bg-surface-subtle text-text':
                            resolvedActiveColumnIndex() === index(),
                          'border-border bg-surface text-text-muted hover:text-text':
                            resolvedActiveColumnIndex() !== index(),
                        },
                      ]}
                    >
                      <span
                        aria-hidden="true"
                        class={[
                          'h-2 w-2 shrink-0 rounded-full',
                          COLUMN_ACCENT_STYLES[column.accent].swatch,
                        ]}
                      />
                      <span class="max-w-32 truncate">{column.title}</span>
                      <span class="rounded-full bg-surface px-1.5 py-0.5 text-[11px] text-text-muted tabular-nums">
                        {column.cardCount}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </nav>
          </header>

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
                    class="inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-md text-text-muted hover:text-text"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
            )}
          </Show>

          {/* Facilitator Add Column inline form */}
          <Show when={isAddingColumn() && board().isFacilitator && !board().isLocked}>
            <div class="mx-auto mt-4 w-full max-w-[1600px] px-4 sm:px-6">
              <form
                onSubmit={(e) => void handleAddColumn(e)}
                class="rounded-xl border border-border bg-surface p-4 shadow-2xs"
              >
                <div class="flex flex-wrap items-end gap-3">
                  <div class="min-w-52 flex-1">
                    <label
                      for="new-column-title"
                      class="block text-xs font-medium text-text-muted"
                    >
                      New column title
                    </label>
                    <input
                      id="new-column-title"
                      type="text"
                      aria-label="New column title"
                      placeholder="e.g. Kudos, Questions, Risks"
                      value={newColumnTitle()}
                      maxlength={MAX_COLUMN_TITLE_LENGTH}
                      onInput={(e) => setNewColumnTitle(e.currentTarget.value)}
                      class="mt-1.5 min-h-11 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-focus focus:outline-none sm:min-h-9"
                    />
                  </div>

                  <div>
                    <span class="block text-xs font-medium text-text-muted">
                      Accent
                    </span>
                    <div class="mt-1.5 flex items-center gap-1.5">
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
                              'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border transition-colors',
                              {
                                'border-focus bg-surface-subtle':
                                  newColumnAccent() === accent,
                                'border-border bg-surface hover:bg-surface-subtle':
                                  newColumnAccent() !== accent,
                              },
                            ]}
                          >
                            <span
                              aria-hidden="true"
                              class={[
                                'h-3.5 w-3.5 rounded-full',
                                COLUMN_ACCENT_STYLES[accent].swatch,
                              ]}
                            />
                          </button>
                        )}
                      </For>
                    </div>
                  </div>

                  <label class="inline-flex min-h-9 cursor-pointer items-center gap-2 text-xs text-text-muted">
                    <input
                      type="checkbox"
                      checked={newColumnIsAction()}
                      onChange={(e) =>
                        setNewColumnIsAction(e.currentTarget.checked)
                      }
                      class="h-4 w-4 rounded border-border accent-accent"
                    />
                    <span>Action Items column</span>
                  </label>

                  <div class="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={
                        isSavingColumn() || newColumnTitle().trim().length === 0
                      }
                      class="min-h-11 cursor-pointer rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
                    >
                      {isSavingColumn() ? 'Adding...' : 'Add column'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingColumn(false)}
                      class="min-h-11 cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text-muted hover:text-text sm:min-h-9"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </Show>

          {/* Responsive Columns workspace (single-column + swipe on mobile, grid/snap on tablet & desktop) */}
          <main
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            class="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-4 pb-28 sm:px-6 sm:py-6"
          >
            <div
              class={[
                'gap-4',
                getResponsiveGridClass(board().columns.length),
              ]}
            >
              <For each={board().columns}>
                {(column, index) => (
                  <ColumnPanel
                    column={column}
                    columnIndex={index()}
                    totalColumns={board().columns.length}
                    columns={board().columns}
                    cards={cardsByColumn().get(column.id) ?? []}
                    isFacilitator={board().isFacilitator}
                    isLocked={board().isLocked}
                    isBlurred={board().isBlurred}
                    nowMs={nowMs()}
                    isMobileActive={resolvedActiveColumnIndex() === index()}
                    isHorizontalSnap={isHorizontalSnap()}
                    draggingCardId={draggingCardId()}
                    draggingSourceColumnId={draggingSourceColumnId()}
                    onCreateCard={handleCreateCard}
                    onUpdateCard={handleUpdateCard}
                    onMoveCard={handleMoveCard}
                    onDeleteCard={handleDeleteCard}
                    onUpdateColumn={handleUpdateColumn}
                    onMoveColumn={handleMoveColumn}
                    onDeleteColumn={handleDeleteColumn}
                    onDragStartCard={handleDragStartCard}
                    onDragEndCard={handleDragEndCard}
                  />
                )}
              </For>
            </div>
          </main>

          {/* Mobile (< 640px) bottom-anchored quick-add Card bar */}
          <Show when={!board().isLocked && activeMobileColumn()}>
            {(targetCol) => (
              <div class="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-3 py-2.5 backdrop-blur-sm sm:hidden">
                <div class="flex items-end gap-2">
                  <textarea
                    aria-label={`Quick add card to ${targetCol().title}`}
                    placeholder={`Add a card to ${targetCol().title}...`}
                    value={mobileDraft()}
                    maxlength={MAX_CARD_CONTENT_LENGTH}
                    rows={1}
                    onInput={(e) => setMobileDraft(e.currentTarget.value)}
                    onKeyDown={handleMobileComposerKeyDown}
                    class={[
                      'min-h-11 flex-1 resize-none rounded-lg border border-border bg-canvas px-3 py-2.5 text-sm text-text',
                      'placeholder:text-text-muted focus:border-focus focus:outline-none',
                    ]}
                  />
                  <button
                    type="button"
                    disabled={
                      isSubmittingMobileCard() ||
                      mobileDraft().trim().length === 0
                    }
                    onClick={() => void handleMobileQuickAdd()}
                    class={[
                      'inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-accent px-4 text-xs font-medium text-accent-contrast',
                      'transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
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
