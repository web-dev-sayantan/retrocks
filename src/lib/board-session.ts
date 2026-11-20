import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  onSettled,
  reconcile,
  untrack,
} from 'solid-js';

import type { BoardWorkspaceActions } from './board-actions';
import { createBoardLive, type BoardLive, type BoardLiveTransport } from './board-live';
import {
  canContribute,
  canControlFacilitation,
  canEditActionItem,
  canFacilitate,
  canInteractWithCard,
  canManageCard,
  canManageGrouping,
} from './board-permissions';
import { applyBoardEvents } from './board-store';
import type {
  ActionItemPatch,
  BoardEvent,
  BoardMutationResponse,
  BoardViewDTO,
  CardViewDTO,
  ColumnAccent,
  ColumnDTO,
  ReactionEmoji,
} from './board-types';
import { isOptimisticId, makeOptimisticCardId } from './optimistic-ids';
import type { ServerClockSample } from './timer';
import type { AddColumnInput, TimerChange } from './schemas';
import type { ChangeVoteInput, UpdateVotingSettingsInput } from './voting-schemas';

type VoteDelta = ChangeVoteInput['delta'];

/**
 * Optimistic voting view state consumed by VoteControls; the session derives
 * it from the store plus the in-flight `changeVote` request.
 */
export interface WorkspaceVoting {
  remainingVotes: number | null;
  maxVotesPerCard: number | null;
  pending: boolean;
  optimisticVote: { targetId: string; delta: VoteDelta } | null;
  onChange: (targetType: 'card' | 'group', targetId: string, delta: VoteDelta) => void;
}

/** Card, Card Group, and Column mutations the workspace panels call. */
export interface BoardMutations {
  createCard(columnId: string, content: string): Promise<string | null>;
  updateCard(cardId: string, content: string): Promise<string | null>;
  updateActionItem(cardId: string, patch: ActionItemPatch): Promise<boolean>;
  moveCard(cardId: string, targetColumnId: string): Promise<boolean>;
  deleteCard(cardId: string): Promise<boolean>;
  toggleReaction(cardId: string, emoji: ReactionEmoji): Promise<string | null>;
  createComment(cardId: string, content: string): Promise<string | null>;
  deleteComment(cardId: string, commentId: string): Promise<string | null>;
  groupCard(cardId: string, targetType: 'card' | 'group', targetId: string): Promise<boolean>;
  ungroupCard(cardId: string): Promise<boolean>;
  renameCardGroup(groupId: string, title: string): Promise<boolean>;
  dissolveCardGroup(groupId: string): Promise<boolean>;
  moveCardGroup(groupId: string, targetColumnId: string): Promise<boolean>;
  updateColumn(
    columnId: string,
    patch: { title?: string; accent?: ColumnAccent; isActionColumn?: boolean },
  ): Promise<boolean>;
  moveColumn(columnId: string, direction: -1 | 1): Promise<boolean>;
  deleteColumn(columnId: string): Promise<boolean>;
}

/** Result of a Private Mode toggle; 'revealed' requests the reveal theater. */
export type PrivateModeOutcome = 'revealed' | 'applied' | 'rejected' | 'ignored';

export interface BoardSession extends BoardMutations {
  /** Current viewer-projected Board snapshot (reactive store read). */
  board(): BoardViewDTO | null;
  isLive(): boolean;
  onlineCount(): number | null;
  nowMs(): number;
  timerClock(): (ServerClockSample & { boardId: string }) | null;
  voting(): WorkspaceVoting;
  errorMessage(): string | null;
  clearError(): void;
  isChangingPrivateMode(): boolean;
  isSavingBoardTitle(): boolean;
  isSavingColumn(): boolean;
  changeCountdown(boardId: string, change: TimerChange): Promise<BoardMutationResponse>;
  renameBoard(title: string): Promise<boolean>;
  addColumn(input: Omit<AddColumnInput, 'boardId'>): Promise<ColumnDTO | null>;
  togglePrivateMode(dramaticRequested: boolean): Promise<PrivateModeOutcome>;
  changeVote(targetType: 'card' | 'group', targetId: string, delta: VoteDelta): Promise<void>;
  saveVotingSettings(patch: Omit<UpdateVotingSettingsInput, 'boardId'>): Promise<string | null>;
  resetAllVotes(): Promise<string | null>;
  toggleBoardLock(isLocked: boolean): Promise<string | null>;
  deleteCurrentBoard(): Promise<string | null>;
}

export interface BoardSessionOptions {
  /** Route-provided Board snapshot; the session reconciles it into the store on change. */
  board: () => BoardViewDTO | null;
  /** Server-action surface; production passes the 'use server' callers, tests the fake. */
  actions: () => BoardWorkspaceActions;
  /** Injectable live transport; defaults to SSE/WebSocket. */
  liveTransport?: BoardLiveTransport;
  /** Private Mode reveal theater hook; invoked synchronously before the response applies. */
  onDramaticReveal?: () => void;
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

/**
 * Reactive Board client controller: owns the Board store, the live stream
 * application (version-gap resync included), the server clock, every mutation
 * handler, and the per-mutation pending/optimistic state. Components consume
 * it through the narrow `BoardSession` interface; `applyBoardEvent` stays the
 * single reducer seam for both mutation responses and live events.
 */
export function createBoardSession(options: BoardSessionOptions): BoardSession {
  const getActions = options.actions;

  const [store, setStore] = createStore<{ board: BoardViewDTO | null }>({
    board: untrack(() => cloneBoardView(options.board())),
  });

  const [nowMs, setNowMs] = createSignal(Date.now());
  const [liveSession, setLiveSession] = createSignal<{ boardId: string; live: BoardLive } | null>(null);
  const isLive = createMemo(() => liveSession()?.live.status() === 'live');
  const onlineCount = createMemo(() => liveSession()?.live.onlineCount() ?? null);
  const [serverClock, setServerClock] = createSignal<(ServerClockSample & { boardId: string }) | null>(null);
  const timerClock = createMemo(() => {
    const clock = serverClock();
    return clock?.boardId === store.board?.id ? clock : null;
  });
  let serverTimeOffsetMs = 0;
  let reconnectLive: (() => void) | undefined;
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  type PendingVote = ChangeVoteInput & { baseVersion: number };
  const [pendingVote, setPendingVote] = createSignal<PendingVote | null>(null);
  let voteInFlight = false;

  const voting = createMemo<WorkspaceVoting>(() => {
    const board = store.board;
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
      onChange: changeVote,
    };
  });

  const [isChangingPrivateMode, setIsChangingPrivateMode] = createSignal(false);
  let optimisticCardSeq = 0;
  const [isSavingBoardTitle, setIsSavingBoardTitle] = createSignal(false);
  const [isSavingColumn, setIsSavingColumn] = createSignal(false);

  function applySnapshot(nextBoard: BoardViewDTO | null, fromLive = false): void {
    if (nextBoard === null) setErrorMessage(null);
    untrack(() => {
      setStore((draft) => {
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
      const current = store.board;
      return !current || current.id !== nextBoard.id || nextBoard.version < current.version;
    });
    if (stale) return;
    syncServerClock(nextBoard.id, serverNow);
    applySnapshot(nextBoard, true);
  }

  function applyVersionedEvents(boardId: string, version: number, events: BoardEvent[]): void {
    if (events.some((event) => event.type === 'board:deleted')) {
      if (untrack(() => store.board?.id) === boardId) {
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
      setStore((draft) => {
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

  createEffect(() => options.board(), (nextBoard) => applySnapshot(nextBoard));

  const liveBoardId = createMemo(() => store.board?.id);
  createEffect(liveBoardId, (boardId) => {
    if (!boardId) return;
    if (typeof window === 'undefined') return;
    const live = createBoardLive(boardId, options.liveTransport);
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

  function applyMutationResponse(boardId: string, response: BoardMutationResponse): boolean {
    if (store.board?.id !== boardId) return false;
    if (!response.ok) {
      setErrorMessage(response.message);
      return false;
    }
    setErrorMessage(null);
    applyVersionedEvents(boardId, response.version, response.events);
    return true;
  }

  async function changeCountdown(boardId: string, change: TimerChange): Promise<BoardMutationResponse> {
    const response = await getActions().updateTimer({ boardId, change });
    if (response.ok) applyVersionedEvents(boardId, response.version, response.events);
    return response;
  }

  async function togglePrivateMode(dramaticRequested: boolean): Promise<PrivateModeOutcome> {
    const board = store.board;
    if (!board || !canControlFacilitation(board) || isChangingPrivateMode()) return 'ignored';
    const { id: boardId, isBlurred } = board;
    setIsChangingPrivateMode(true);
    try {
      const response = await getActions().setPrivateMode({ boardId, isBlurred: !isBlurred });
      const revealed = dramaticRequested && response.ok && store.board?.id === boardId;
      if (revealed) options.onDramaticReveal?.();
      applyMutationResponse(boardId, response);
      return revealed ? 'revealed' : response.ok ? 'applied' : 'rejected';
    } finally {
      setIsChangingPrivateMode(false);
    }
  }

  async function renameBoard(title: string): Promise<boolean> {
    const board = store.board;
    const trimmed = title.trim();
    if (!board || trimmed.length === 0 || isSavingBoardTitle()) return false;
    setIsSavingBoardTitle(true);
    try {
      const response = await getActions().renameBoard({ boardId: board.id, title: trimmed });
      return applyMutationResponse(board.id, response);
    } finally {
      setIsSavingBoardTitle(false);
    }
  }

  function removeOptimisticCard(boardId: string, tempId: string): void {
    setStore((draft) => {
      const current = draft.board;
      if (!current || current.id !== boardId) return;
      const idx = current.cards.findIndex((item) => item.id === tempId);
      if (idx === -1) return;
      const [removed] = current.cards.splice(idx, 1);
      const col = current.columns.find((c) => c.id === removed.columnId);
      if (col) col.cardCount = Math.max(0, col.cardCount - 1);
    });
  }

  async function createCard(
    columnId: string,
    content: string,
  ): Promise<string | null> {
    const board = store.board;
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

    setStore((draft) => {
      const current = draft.board;
      if (!current || current.id !== boardId) return;
      current.cards.push(optimisticCard);
      const col = current.columns.find((c) => c.id === columnId);
      if (col) col.cardCount += 1;
    });
    setNowMs(createdAt);

    try {
      const response = await getActions().createCard({
        boardId,
        columnId,
        content,
      });
      if (response.ok) {
        const upserted = response.events.find(
          (ev) => ev.type === 'card:upserted',
        );
        if (upserted && upserted.type === 'card:upserted') {
          setStore((draft) => {
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
      if (store.board?.id === boardId) {
        applyVersionedEvents(boardId, response.version, response.events);
        setNowMs(Date.now() + serverTimeOffsetMs);
      }
      return null;
    } catch {
      removeOptimisticCard(boardId, tempId);
      return 'Could not create Card. Try again.';
    }
  }

  async function updateCard(
    cardId: string,
    content: string,
  ): Promise<string | null> {
    const board = store.board;
    if (!board || !canManageCard(board, cardId)) return 'This Card can no longer be edited.';
    try {
      const response = await getActions().updateCard({ boardId: board.id, cardId, content });
      if (!response.ok) return response.message;
      return applyMutationResponse(board.id, response) ? null : 'This Card can no longer be edited.';
    } catch {
      return 'Could not save the Card. Try again.';
    }
  }

  async function updateActionItem(
    cardId: string,
    patch: ActionItemPatch,
  ): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const card = board.cards.find((item) => item.id === cardId);
    if (!card || !canEditActionItem(board, card, patch)) return false;
    const response = await getActions().updateActionItem({
      boardId: board.id,
      cardId,
      ...patch,
    });
    return response.ok && applyMutationResponse(board.id, response);
  }

  async function moveCard(
    cardId: string,
    targetColumnId: string,
  ): Promise<boolean> {
    const board = store.board;
    if (!board || !canManageCard(board, cardId)) return false;
    const response = await getActions().moveCard({
      boardId: board.id,
      cardId,
      targetColumnId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function deleteCard(cardId: string): Promise<boolean> {
    const board = store.board;
    if (!board || !canManageCard(board, cardId)) return false;
    const response = await getActions().deleteCard({
      boardId: board.id,
      cardId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function groupCard(
    cardId: string,
    targetType: 'card' | 'group',
    targetId: string,
  ): Promise<boolean> {
    const board = store.board;
    if (!board || !canManageGrouping(board)) return false;
    const response = await getActions().groupCards({
      boardId: board.id,
      cardId,
      targetType,
      targetId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function renameCardGroup(
    groupId: string,
    title: string,
  ): Promise<boolean> {
    const board = store.board;
    if (!board || !canManageGrouping(board)) return false;
    const response = await getActions().renameCardGroup({
      boardId: board.id,
      groupId,
      title,
    });
    return applyMutationResponse(board.id, response);
  }

  async function ungroupCard(cardId: string): Promise<boolean> {
    const board = store.board;
    if (!board || !canManageGrouping(board)) return false;
    const response = await getActions().ungroupCard({
      boardId: board.id,
      cardId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function dissolveCardGroup(groupId: string): Promise<boolean> {
    const board = store.board;
    if (!board || !canManageGrouping(board)) return false;
    const response = await getActions().dissolveCardGroup({
      boardId: board.id,
      groupId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function moveCardGroup(
    groupId: string,
    targetColumnId: string,
  ): Promise<boolean> {
    const board = store.board;
    if (!board || !canManageGrouping(board)) return false;
    const response = await getActions().moveCardGroup({
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
    setStore((draft) => {
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

  async function toggleReaction(
    cardId: string,
    emoji: ReactionEmoji,
  ): Promise<string | null> {
    const board = store.board;
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
      const response = await getActions().toggleReaction({
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

  async function createComment(
    cardId: string,
    content: string,
  ): Promise<string | null> {
    const board = store.board;
    const card = board?.cards.find((item) => item.id === cardId);
    if (!board || !card || !canInteractWithCard(board, card)) {
      return 'This Card can no longer receive comments.';
    }
    try {
      const response = await getActions().createComment({ boardId: board.id, cardId, content });
      if (!response.ok) return response.message;
      if (applyMutationResponse(board.id, response)) {
        setNowMs(Date.now() + serverTimeOffsetMs);
      }
      return null;
    } catch {
      return 'Could not post comment. Try again.';
    }
  }

  async function deleteComment(
    cardId: string,
    commentId: string,
  ): Promise<string | null> {
    const board = store.board;
    const card = board?.cards.find((item) => item.id === cardId);
    if (!board || !card || !canInteractWithCard(board, card)) {
      return 'This comment can no longer be deleted.';
    }
    try {
      const response = await getActions().deleteComment({ boardId: board.id, cardId, commentId });
      if (!response.ok) return response.message;
      applyMutationResponse(board.id, response);
      return null;
    } catch {
      return 'Could not delete comment. Try again.';
    }
  }

  async function addColumn(input: Omit<AddColumnInput, 'boardId'>): Promise<ColumnDTO | null> {
    const board = store.board;
    if (!board || input.title.trim().length === 0 || isSavingColumn()) return null;
    setIsSavingColumn(true);
    try {
      const response = await getActions().addColumn({
        boardId: board.id,
        title: input.title,
        accent: input.accent,
        isActionColumn: input.isActionColumn,
      });
      if (!applyMutationResponse(board.id, response)) return null;
      const upserted = response.ok
        ? response.events.find((ev) => ev.type === 'column:upserted')
        : undefined;
      return upserted && upserted.type === 'column:upserted' ? upserted.column : null;
    } finally {
      setIsSavingColumn(false);
    }
  }

  async function updateColumn(
    columnId: string,
    patch: { title?: string; accent?: ColumnAccent; isActionColumn?: boolean },
  ): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const response = await getActions().updateColumn({
      boardId: board.id,
      columnId,
      ...patch,
    });
    return applyMutationResponse(board.id, response);
  }

  async function moveColumn(
    columnId: string,
    direction: -1 | 1,
  ): Promise<boolean> {
    const board = store.board;
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
    const response = await getActions().reorderColumns({
      boardId: board.id,
      columnIds: reordered,
    });
    return applyMutationResponse(board.id, response);
  }

  async function deleteColumn(columnId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const response = await getActions().deleteColumn({
      boardId: board.id,
      columnId,
    });
    return applyMutationResponse(board.id, response);
  }

  async function changeVote(
    targetType: 'card' | 'group',
    targetId: string,
    delta: VoteDelta,
  ): Promise<void> {
    const board = store.board;
    if (!board || !canContribute(board) || voteInFlight || isOptimisticId(targetId)) return;

    const boardId = board.id;
    const input = { boardId, targetType, targetId, delta } as const;
    voteInFlight = true;
    setPendingVote({ ...input, baseVersion: board.version });
    try {
      const response = await getActions().changeVote(input);
      applyMutationResponse(boardId, response);
    } catch {
      if (store.board?.id === boardId) setErrorMessage('Could not update your Vote. Try again.');
    } finally {
      voteInFlight = false;
      setPendingVote(null);
    }
  }

  async function runVotingSettingsMutation(
    mutate: (boardId: string) => Promise<BoardMutationResponse>,
  ): Promise<string | null> {
    const board = store.board;
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

  function saveVotingSettings(patch: Omit<UpdateVotingSettingsInput, 'boardId'>): Promise<string | null> {
    const update = getActions().updateVotingSettings;
    return runVotingSettingsMutation((boardId) => update({ boardId, ...patch }));
  }

  function resetAllVotes(): Promise<string | null> {
    const reset = getActions().resetVotes;
    return runVotingSettingsMutation((boardId) => reset({ boardId }));
  }

  async function toggleBoardLock(isLocked: boolean): Promise<string | null> {
    const board = store.board;
    if (!board || !canFacilitate(board)) return 'Only a Facilitator can Lock or Unlock the Board.';
    const boardId = board.id;
    try {
      const response = await getActions().setBoardLock({ boardId, isLocked });
      if (!response.ok) return response.message;
      applyMutationResponse(boardId, response);
      return null;
    } catch {
      return 'Could not update Board lock state. Try again.';
    }
  }

  async function deleteCurrentBoard(): Promise<string | null> {
    const board = store.board;
    if (!board || !canFacilitate(board)) return 'Only a Facilitator can delete this Board.';
    const boardId = board.id;
    try {
      const response = await getActions().deleteBoard({ boardId });
      if (!response.ok) return response.message;
      applyMutationResponse(boardId, response);
      return null;
    } catch {
      return 'Could not delete this Board. Try again.';
    }
  }

  return {
    board: () => store.board,
    isLive,
    onlineCount,
    nowMs,
    timerClock,
    voting,
    errorMessage,
    clearError: () => setErrorMessage(null),
    isChangingPrivateMode,
    isSavingBoardTitle,
    isSavingColumn,
    changeCountdown,
    togglePrivateMode,
    renameBoard,
    createCard,
    updateCard,
    updateActionItem,
    moveCard,
    deleteCard,
    toggleReaction,
    createComment,
    deleteComment,
    addColumn,
    updateColumn,
    moveColumn,
    deleteColumn,
    groupCard,
    renameCardGroup,
    ungroupCard,
    dissolveCardGroup,
    moveCardGroup,
    changeVote,
    saveVotingSettings,
    resetAllVotes,
    toggleBoardLock,
    deleteCurrentBoard,
  };
}
