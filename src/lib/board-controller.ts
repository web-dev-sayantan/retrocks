import {
  action,
  affects,
  createEffect,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createSignal,
  createStore,
  flush,
  isPending,
  onSettled,
  reconcile,
  untrack,
} from 'solid-js';

import type { BoardWorkspaceActions } from './board-actions';
import { boardLivePath, type BoardLiveMessage } from './board-live-protocol';
import { createLiveStream, type LiveTransport } from './live-stream';
import { parseBoardLiveMessage } from './wire-schemas';
import {
  canAddColumn,
  canContribute,
  canControlFacilitation,
  canDeleteColumn,
  canDeleteComment,
  canEditActionItem,
  canFacilitate,
  canInteractWithCard,
  canManageCard,
  canManageGroup,
  canManageGrouping,
  isGroupRedacted,
  passesPrivateMode,
} from './board-permissions';
import { applyBoardEvents } from './board-store';
import type {
  ActionItemPatch,
  ActionError,
  BoardEvent,
  BoardMutationResponse,
  BoardMutationSuccess,
  BoardViewDTO,
  CardViewDTO,
  ColumnAccent,
  ColumnDTO,
  ReactionEmoji,
} from './board-types';
import type { ServerClockSample } from './timer';
import type { AddColumnInput, TimerChange } from './schemas';
import type { ChangeVoteInput, UpdateVotingSettingsInput } from './voting-schemas';

type VoteDelta = ChangeVoteInput['delta'];

/**
 * Optimistic voting view state consumed by VoteControls; the controller derives
 * it from the optimistic Board store and its in-flight vote flag.
 */
export interface WorkspaceVoting {
  remainingVotes: number | null;
  maxVotesPerCard: number | null;
  pending: boolean;
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
  /** True while this Card's Action Item patch is in flight (`isPending`). */
  isActionItemPending(cardId: string): boolean;
}

/** Result of a Private Mode toggle; 'revealed' requests the reveal theater. */
export type PrivateModeOutcome = 'revealed' | 'applied' | 'rejected' | 'ignored';

export interface BoardController extends BoardMutations {
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

export interface BoardControllerOptions {
  /** Route-provided Board snapshot; the controller reconciles it into the store on change. */
  board: () => BoardViewDTO | null;
  /** Server-action surface; production passes the 'use server' callers, tests the fake. */
  actions: () => BoardWorkspaceActions;
  /** Injectable live transport; defaults to SSE/WebSocket. */
  liveTransport?: LiveTransport;
  /** Bumped when the viewer's session role changes (e.g. Co-Facilitator Link claim) to reconnect live updates. */
  liveReconnectKey?: () => number;
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

/** Which permission/lock rule the mutation seam checks before dispatching. */
type MutationGate =
  | { kind: 'create-card'; columnId: string }
  | { kind: 'update-card'; cardId: string }
  | { kind: 'update-action-item'; cardId: string; patch: ActionItemPatch }
  | { kind: 'move-card'; cardId: string }
  | { kind: 'delete-card'; cardId: string }
  | { kind: 'toggle-reaction'; cardId: string }
  | { kind: 'create-comment'; cardId: string }
  | { kind: 'delete-comment'; cardId: string; commentId: string }
  | { kind: 'grouping'; cardIds?: readonly string[]; groupId?: string }
  | { kind: 'vote'; targetType: 'card' | 'group'; targetId: string }
  | { kind: 'add-column' }
  | { kind: 'update-column' }
  | { kind: 'move-column' }
  | { kind: 'delete-column'; columnId: string }
  | { kind: 'facilitate' }
  | { kind: 'control-facilitation' };

interface MutationDenial {
  allowed: false;
  message?: string;
}

/**
 * The single permission/lock guard at the mutation seam. Every controller
 * mutation routes through here and board-permissions.ts predicates; no
 * handler re-derives the rules.
 */
function authorizeMutation(board: BoardViewDTO, gate: MutationGate): MutationDenial | null {
  const deny = (message?: string): MutationDenial => ({ allowed: false, message });
  const cardById = (id: string) => board.cards.find((item) => item.id === id);
  const groupById = (id: string) => board.groups.find((item) => item.id === id);
  switch (gate.kind) {
    case 'create-card':
      return canContribute(board) ? null : deny('This Board is not accepting new Cards.');
    case 'update-card':
      return canManageCard(board, gate.cardId) ? null : deny('This Card can no longer be edited.');
    case 'move-card':
    case 'delete-card':
      return canManageCard(board, gate.cardId) ? null : deny();
    case 'update-action-item': {
      const card = cardById(gate.cardId);
      return card && canEditActionItem(board, card, gate.patch) ? null : deny();
    }
    case 'toggle-reaction': {
      const card = cardById(gate.cardId);
      return card && canInteractWithCard(board, card)
        ? null
        : deny('This Card can no longer receive reactions.');
    }
    case 'create-comment': {
      const card = cardById(gate.cardId);
      return card && canInteractWithCard(board, card)
        ? null
        : deny('This Card can no longer receive comments.');
    }
    case 'delete-comment': {
      const card = cardById(gate.cardId);
      const comment = card?.comments.find((item) => item.id === gate.commentId);
      return card && comment &&
        canInteractWithCard(board, card) &&
        canDeleteComment(board, comment)
        ? null
        : deny('This comment can no longer be deleted.');
    }
    case 'grouping': {
      if (gate.groupId !== undefined) {
        const group = groupById(gate.groupId);
        return group && canManageGroup(board, group, board.cards) ? null : deny();
      }
      if (!canManageGrouping(board)) return deny();
      const cards = gate.cardIds?.map(cardById);
      return cards && cards.length > 0 &&
        cards.every(
          (card) =>
            card && !card.pending && !card.redacted && passesPrivateMode(board, card),
        )
        ? null
        : deny();
    }
    case 'vote': {
      if (!canContribute(board)) return deny();
      if (gate.targetType === 'group') {
        const group = groupById(gate.targetId);
        return group && !isGroupRedacted(group) ? null : deny();
      }
      const card = cardById(gate.targetId);
      return card && !card.pending && canInteractWithCard(board, card) ? null : deny();
    }
    case 'add-column':
      return canAddColumn(board) ? null : deny();
    case 'update-column':
    case 'move-column':
      return canControlFacilitation(board) ? null : deny();
    case 'delete-column': {
      const cards = board.cards.filter((card) => card.columnId === gate.columnId);
      return canDeleteColumn(board, board.columns.length, cards) ? null : deny();
    }
    case 'facilitate':
      return canFacilitate(board) ? null : deny();
    case 'control-facilitation':
      return canControlFacilitation(board) ? null : deny();
  }
}

/** A server rejection or stale-board answer; aborts the action so its guesses revert. */
class MutationRejected extends Error {
  constructor(readonly response: ActionError) {
    super(response.message);
  }
}

interface MutationRequest {
  boardId: string;
  /** Process affordances written inside the action (show now, clear on settle). */
  begin?: () => void;
  /** Optimistic store write; automatically reverted when the action fails. */
  optimistic?: (board: BoardViewDTO) => void;
  /** Declares the slots the in-flight server write will change, for `isPending`. */
  pending?: (board: BoardViewDTO) => void;
  /** Runs after a successful response is known, before its events apply. */
  beforeCommit?: (response: BoardMutationSuccess) => void;
  send: () => Promise<BoardMutationResponse>;
}

interface GuardedMutation extends Omit<MutationRequest, 'boardId'> {
  gate: MutationGate;
  failureMessage: string;
  /** Surface server/network rejections through the global error banner. */
  reportFailure?: boolean;
}

type MutationOutcome<T> =
  | { ok: true; response: BoardMutationSuccess; value?: T }
  | { ok: false; message?: string; reason: 'guard' | 'rejection' | 'network' };

const GENERIC_FAILURE = 'Could not update the Board. Try again.';

/**
 * Reactive Board client controller: owns the Board store, the live stream
 * application (version-gap resync included), the server clock, and every
 * mutation. All mutations share one Solid 2.0 `action` over an optimistic
 * store: handlers write the expected value inside the action, the server
 * response commits through `applyVersionedEvents`, and any rejection reverts
 * the guesses automatically. Permission/lock checks happen once, in
 * `authorizeMutation`, before an action opens.
 */
export function createBoardController(options: BoardControllerOptions): BoardController {
  const getActions = options.actions;

  // Authoritative server state: the route snapshot, live events, and mutation
  // responses patch `serverStore` incrementally. `createOptimisticStore` chains
  // directly to `serverStore` so optimistic writes overlay it without cloning
  // the entire Board on every server revision.
  const [serverStore, setServerStore] = createStore<{ board: BoardViewDTO | null }>({
    board: untrack(() => cloneBoardView(options.board())),
  });
  const [store, setStore] = createOptimisticStore<{ board: BoardViewDTO | null }>(
    () => serverStore,
    { board: null },
    { key: 'id' },
  );

  const [nowMs, setNowMs] = createSignal(Date.now());
  const [onlineCount, setOnlineCount] = createSignal<number | null>(null);
  const [liveStream, setLiveStream] = createSignal<ReturnType<typeof createLiveStream> | null>(null);
  const isLive = createMemo(() => liveStream()?.status() === 'live');
  const [serverClock, setServerClock] = createSignal<(ServerClockSample & { boardId: string }) | null>(null);
  const timerClock = createMemo(() => {
    const clock = serverClock();
    return clock?.boardId === store.board?.id ? clock : null;
  });
  let serverTimeOffsetMs = 0;
  let reconnectLive: (() => void) | undefined;
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  // Process affordances: optimistic flags show immediately and clear when the
  // action settles, without needing isPending on an optimistically-writable slot.
  const [savingVotes, setSavingVotes] = createOptimistic(false);
  const [pendingActionItems, setPendingActionItems] = createOptimistic<readonly string[]>([]);

  const [isChangingPrivateMode, setIsChangingPrivateMode] = createSignal(false);
  const [isSavingBoardTitle, setIsSavingBoardTitle] = createSignal(false);
  const [isSavingColumn, setIsSavingColumn] = createSignal(false);

  function applySnapshot(nextBoard: BoardViewDTO | null, fromLive = false): void {
    if (nextBoard === null) setErrorMessage(null);
    untrack(() => {
      setServerStore((draft) => {
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
      const current = serverStore.board;
      return !current || current.id !== nextBoard.id || nextBoard.version < current.version;
    });
    if (stale) return;
    syncServerClock(nextBoard.id, serverNow);
    applySnapshot(nextBoard, true);
  }

  function applyVersionedEvents(boardId: string, version: number, events: BoardEvent[]): void {
    if (events.some((event) => event.type === 'board:deleted')) {
      if (untrack(() => serverStore.board?.id) === boardId) {
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
      setServerStore((draft) => {
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

  const liveBoardId = createMemo(() => serverStore.board?.id);
  createEffect(liveBoardId, (boardId) => {
    if (!boardId) return;
    if (typeof window === 'undefined') return;
    const stream = createLiveStream<BoardLiveMessage>(
      boardLivePath(boardId),
      {
        parse: parseBoardLiveMessage,
        handshake: (message) => (message.type === 'board:snapshot' ? message : undefined),
        isTerminal: (message) => message.type === 'board:deleted',
        onMessage(message) {
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
            case 'presence:count':
              setOnlineCount(message.count);
              break;
          }
        },
        onDisconnect: () => setOnlineCount(null),
      },
      options.liveTransport,
    );
    setLiveStream(stream);
    reconnectLive = stream.reconnect;
    return () => {
      reconnectLive = undefined;
      setLiveStream(null);
      setOnlineCount(null);
      stream.dispose();
    };
  });

  createEffect(
    () => options.liveReconnectKey?.() ?? 0,
    (key, previous) => {
      if (previous !== undefined && key !== previous) {
        reconnectLive?.();
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

  /**
   * The one mutation transaction: optimistic writes first, then the server
   * round-trip, then the versioned commit. Rejections throw so Solid reverts
   * the guesses and no server write leaks.
   */
  const performMutation = action(function* (request: MutationRequest) {
    request.begin?.();
    setStore((draft) => {
      if (draft.board) request.optimistic?.(draft.board);
    });
    if (request.pending) {
      const board = store.board;
      if (board) request.pending(board);
    }
    const response: BoardMutationResponse = yield request.send();
    if (!response.ok) throw new MutationRejected(response);
    if (serverStore.board?.id !== request.boardId) {
      throw new MutationRejected({
        ok: false,
        code: 'BOARD_NOT_FOUND',
        message: 'This Board is no longer available.',
      });
    }
    request.beforeCommit?.(response);
    setErrorMessage(null);
    applyVersionedEvents(request.boardId, response.version, response.events);
    return response;
  });

  async function runGuardedMutation<T>(
    mutation: GuardedMutation,
    select?: (response: BoardMutationSuccess) => T,
  ): Promise<MutationOutcome<T>> {
    // Commit caller-owned process flags written in this tick before the action
    // opens; the action's transaction would otherwise hold them until it settles.
    flush();
    const board = store.board;
    if (!board) {
      return { ok: false, reason: 'guard', message: 'This Board is no longer available.' };
    }
    const denial = authorizeMutation(board, mutation.gate);
    if (denial) {
      return { ok: false, reason: 'guard', message: denial.message };
    }
    const boardId = board.id;
    try {
      const response = await performMutation({
        boardId,
        begin: mutation.begin,
        optimistic: mutation.optimistic,
        pending: mutation.pending,
        beforeCommit: mutation.beforeCommit,
        send: mutation.send,
      });
      return { ok: true, response, value: select?.(response) };
    } catch (error) {
      const rejection = error instanceof MutationRejected ? error : undefined;
      const message = rejection?.message ?? mutation.failureMessage ?? GENERIC_FAILURE;
      if (mutation.reportFailure) setErrorMessage(message);
      return {
        ok: false,
        reason: rejection ? 'rejection' : 'network',
        message,
      };
    }
  }

  function voting(): WorkspaceVoting {
    const board = store.board;
    return {
      remainingVotes: board?.remainingVotes ?? null,
      maxVotesPerCard: board?.maxVotesPerCard ?? null,
      pending: savingVotes() || isPending(() => store.board?.remainingVotes),
      onChange: changeVote,
    };
  }

  function isActionItemPending(cardId: string): boolean {
    return pendingActionItems().includes(cardId) || isPending(() => {
      const card = store.board?.cards.find((item) => item.id === cardId);
      return card ? [card.isActionItem, card.actionDone, card.actionOwner] : undefined;
    });
  }

  async function changeCountdown(
    boardId: string,
    change: TimerChange,
  ): Promise<BoardMutationResponse> {
    const outcome = await runGuardedMutation({
      gate: { kind: 'control-facilitation' },
      send: () => getActions().updateTimer({ boardId, change }),
      failureMessage: 'Could not update the Timer. Try again.',
    });
    return outcome.ok
      ? outcome.response
      : {
          ok: false,
          code: 'INTERNAL_ERROR',
          message: outcome.message ?? 'Could not update the Timer. Try again.',
        };
  }

  async function togglePrivateMode(dramaticRequested: boolean): Promise<PrivateModeOutcome> {
    const board = store.board;
    if (!board || isChangingPrivateMode()) return 'ignored';
    const revealed = dramaticRequested;
    setIsChangingPrivateMode(true);
    try {
      const outcome = await runGuardedMutation({
        gate: { kind: 'control-facilitation' },
        send: () => getActions().setPrivateMode({ boardId: board.id, isBlurred: !board.isBlurred }),
        beforeCommit: () => {
          if (revealed) options.onDramaticReveal?.();
        },
        failureMessage: 'Could not update Private Mode. Try again.',
        reportFailure: true,
      });
      if (!outcome.ok) return outcome.reason === 'guard' ? 'ignored' : 'rejected';
      return revealed ? 'revealed' : 'applied';
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
      const outcome = await runGuardedMutation({
        gate: { kind: 'control-facilitation' },
        send: () => getActions().renameBoard({ boardId: board.id, title: trimmed }),
        failureMessage: 'Could not rename the Board. Try again.',
        reportFailure: true,
      });
      return outcome.ok;
    } finally {
      setIsSavingBoardTitle(false);
    }
  }

  async function createCard(columnId: string, content: string): Promise<string | null> {
    const board = store.board;
    const trimmed = content.trim();
    if (!board) return 'This Board is not accepting new Cards.';
    const column = board.columns.find((col) => col.id === columnId);
    if (!column) return 'This Column is no longer available.';

    const createdAt = Date.now() + serverTimeOffsetMs;
    const optimisticCard: CardViewDTO = {
      id: crypto.randomUUID(),
      columnId,
      groupId: null,
      content: trimmed,
      redacted: false,
      pending: true,
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

    const outcome = await runGuardedMutation({
      gate: { kind: 'create-card', columnId },
      optimistic: (draft) => {
        draft.cards.push({ ...optimisticCard });
        const col = draft.columns.find((item) => item.id === columnId);
        if (col) col.cardCount += 1;
      },
      send: () => getActions().createCard({ boardId: board.id, columnId, content }),
      failureMessage: 'Could not create Card. Try again.',
    });
    if (!outcome.ok) return outcome.message ?? 'Could not create Card. Try again.';
    setNowMs(Date.now() + serverTimeOffsetMs);
    return null;
  }

  async function updateCard(cardId: string, content: string): Promise<string | null> {
    const board = store.board;
    if (!board) return 'This Card can no longer be edited.';
    const outcome = await runGuardedMutation({
      gate: { kind: 'update-card', cardId },
      send: () => getActions().updateCard({ boardId: board.id, cardId, content }),
      failureMessage: 'Could not save the Card. Try again.',
    });
    return outcome.ok ? null : outcome.message ?? 'Could not save the Card. Try again.';
  }

  async function updateActionItem(
    cardId: string,
    patch: ActionItemPatch,
  ): Promise<boolean> {
    const board = store.board;
    if (!board || isActionItemPending(cardId)) return false;
    const outcome = await runGuardedMutation({
      gate: { kind: 'update-action-item', cardId, patch },
      begin: () => setPendingActionItems((ids) => [...ids, cardId]),
      optimistic: (draft) => {
        const card = draft.cards.find((item) => item.id === cardId);
        if (!card) return;
        if (patch.isActionItem !== undefined) {
          card.isActionItem = patch.isActionItem;
          if (!patch.isActionItem) {
            card.actionDone = false;
            card.actionOwner = '';
          }
        }
        if (patch.actionDone !== undefined) card.actionDone = patch.actionDone;
        if (patch.actionOwner !== undefined) card.actionOwner = patch.actionOwner;
        card.updatedAt = Date.now() + serverTimeOffsetMs;
      },
      pending: (draft) => {
        const card = draft.cards.find((item) => item.id === cardId);
        if (!card) return;
        if (patch.isActionItem !== undefined) affects(card, 'isActionItem');
        if (patch.actionDone !== undefined) affects(card, 'actionDone');
        if (patch.actionOwner !== undefined) affects(card, 'actionOwner');
      },
      send: () => getActions().updateActionItem({ boardId: board.id, cardId, ...patch }),
      failureMessage: 'Could not update the Action Item. Try again.',
    });
    return outcome.ok;
  }

  async function moveCard(cardId: string, targetColumnId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      gate: { kind: 'move-card', cardId },
      send: () => getActions().moveCard({ boardId: board.id, cardId, targetColumnId }),
      failureMessage: 'Could not move the Card. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function deleteCard(cardId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      gate: { kind: 'delete-card', cardId },
      send: () => getActions().deleteCard({ boardId: board.id, cardId }),
      failureMessage: 'Could not delete the Card. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function groupCard(
    cardId: string,
    targetType: 'card' | 'group',
    targetId: string,
  ): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      gate: {
        kind: 'grouping',
        cardIds: targetType === 'card' ? [cardId, targetId] : [cardId],
        groupId: targetType === 'group' ? targetId : undefined,
      },
      send: () => getActions().groupCards({ boardId: board.id, cardId, targetType, targetId }),
      failureMessage: 'Could not group the Card. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function renameCardGroup(groupId: string, title: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      gate: { kind: 'grouping', groupId },
      send: () => getActions().renameCardGroup({ boardId: board.id, groupId, title }),
      failureMessage: 'Could not rename the Card Group. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function ungroupCard(cardId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      gate: { kind: 'grouping', cardIds: [cardId] },
      send: () => getActions().ungroupCard({ boardId: board.id, cardId }),
      failureMessage: 'Could not ungroup the Card. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function dissolveCardGroup(groupId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      gate: { kind: 'grouping', groupId },
      send: () => getActions().dissolveCardGroup({ boardId: board.id, groupId }),
      failureMessage: 'Could not dissolve the Card Group. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function moveCardGroup(groupId: string, targetColumnId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      gate: { kind: 'grouping', groupId },
      send: () => getActions().moveCardGroup({ boardId: board.id, groupId, targetColumnId }),
      failureMessage: 'Could not move the Card Group. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function toggleReaction(cardId: string, emoji: ReactionEmoji): Promise<string | null> {
    const board = store.board;
    if (!board) return 'This Card can no longer receive reactions.';
    const outcome = await runGuardedMutation({
      gate: { kind: 'toggle-reaction', cardId },
      optimistic: (draft) => {
        const card = draft.cards.find((item) => item.id === cardId);
        if (!card) return;
        const adding = !card.myReactions.includes(emoji);
        const count = card.reactions[emoji] ?? 0;
        if (adding) {
          card.myReactions.push(emoji);
          card.reactions[emoji] = count + 1;
        } else {
          const idx = card.myReactions.indexOf(emoji);
          if (idx !== -1) card.myReactions.splice(idx, 1);
          if (count <= 1) delete card.reactions[emoji];
          else card.reactions[emoji] = count - 1;
        }
      },
      pending: (draft) => {
        const card = draft.cards.find((item) => item.id === cardId);
        if (!card) return;
        affects(card, 'reactions');
        affects(card, 'myReactions');
      },
      send: () => getActions().toggleReaction({ boardId: board.id, cardId, emoji }),
      failureMessage: 'Could not update reaction. Try again.',
    });
    return outcome.ok ? null : outcome.message ?? 'Could not update reaction. Try again.';
  }

  async function createComment(cardId: string, content: string): Promise<string | null> {
    const board = store.board;
    if (!board) return 'This Card can no longer receive comments.';
    const outcome = await runGuardedMutation({
      gate: { kind: 'create-comment', cardId },
      send: () => getActions().createComment({ boardId: board.id, cardId, content }),
      failureMessage: 'Could not post comment. Try again.',
    });
    if (!outcome.ok) return outcome.message ?? 'Could not post comment. Try again.';
    setNowMs(Date.now() + serverTimeOffsetMs);
    return null;
  }

  async function deleteComment(cardId: string, commentId: string): Promise<string | null> {
    const board = store.board;
    if (!board) return 'This comment can no longer be deleted.';
    const outcome = await runGuardedMutation({
      gate: { kind: 'delete-comment', cardId, commentId },
      send: () => getActions().deleteComment({ boardId: board.id, cardId, commentId }),
      failureMessage: 'Could not delete comment. Try again.',
    });
    return outcome.ok ? null : outcome.message ?? 'Could not delete comment. Try again.';
  }

  async function addColumn(input: Omit<AddColumnInput, 'boardId'>): Promise<ColumnDTO | null> {
    const board = store.board;
    if (!board || input.title.trim().length === 0 || isSavingColumn()) return null;
    setIsSavingColumn(true);
    try {
      const outcome = await runGuardedMutation(
        {
          gate: { kind: 'add-column' },
          send: () => getActions().addColumn({
            boardId: board.id,
            title: input.title,
            accent: input.accent,
            isActionColumn: input.isActionColumn,
          }),
          failureMessage: 'Could not add the Column. Try again.',
          reportFailure: true,
        },
        (response) => {
          const upserted = response.events.find((event) => event.type === 'column:upserted');
          return upserted?.type === 'column:upserted' ? upserted.column : null;
        },
      );
      return outcome.ok ? outcome.value ?? null : null;
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
    const outcome = await runGuardedMutation({
      gate: { kind: 'update-column' },
      send: () => getActions().updateColumn({ boardId: board.id, columnId, ...patch }),
      failureMessage: 'Could not update the Column. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function moveColumn(columnId: string, direction: -1 | 1): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const ids = board.columns.map((column) => column.id);
    const currentIndex = ids.indexOf(columnId);
    const nextIndex = currentIndex + direction;
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= ids.length) {
      return false;
    }
    const reordered = [...ids];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    const outcome = await runGuardedMutation({
      gate: { kind: 'move-column' },
      send: () => getActions().reorderColumns({ boardId: board.id, columnIds: reordered }),
      failureMessage: 'Could not move the Column. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function deleteColumn(columnId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      gate: { kind: 'delete-column', columnId },
      send: () => getActions().deleteColumn({ boardId: board.id, columnId }),
      failureMessage: 'Could not delete the Column. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function changeVote(
    targetType: 'card' | 'group',
    targetId: string,
    delta: VoteDelta,
  ): Promise<void> {
    // A cast already in flight drops the next one.
    if (savingVotes() || isPending(() => store.board?.remainingVotes)) return;
    const board = store.board;
    if (!board) return;
    await runGuardedMutation({
      gate: { kind: 'vote', targetType, targetId },
      begin: () => setSavingVotes(true),
      optimistic: (draft) => {
        const targets = targetType === 'card' ? draft.cards : draft.groups;
        const target = targets.find((item) => item.id === targetId);
        if (!target) return;
        target.myVotes = Math.max(0, target.myVotes + delta);
        if (target.votes !== null) target.votes = Math.max(0, target.votes + delta);
        if (draft.remainingVotes !== null) {
          draft.remainingVotes = Math.max(0, draft.remainingVotes - delta);
        }
      },
      pending: (draft) => {
        const targets = targetType === 'card' ? draft.cards : draft.groups;
        const target = targets.find((item) => item.id === targetId);
        if (target) {
          affects(target, 'myVotes');
          affects(target, 'votes');
        }
        if (draft.remainingVotes !== null) affects(draft, 'remainingVotes');
      },
      send: () => getActions().changeVote({ boardId: board.id, targetType, targetId, delta }),
      failureMessage: 'Could not update your Vote. Try again.',
      reportFailure: true,
    });
  }

  async function runVotingSettingsMutation(
    mutate: (boardId: string) => Promise<BoardMutationResponse>,
  ): Promise<string | null> {
    const board = store.board;
    if (!board) return 'Voting settings are unavailable.';
    const outcome = await runGuardedMutation({
      gate: { kind: 'control-facilitation' },
      send: () => mutate(board.id),
      failureMessage: 'Could not update Voting. Try again.',
    });
    if (outcome.ok) return null;
    return outcome.reason === 'guard'
      ? 'Voting settings are unavailable.'
      : outcome.message ?? 'Could not update Voting. Try again.';
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
    if (!board) return 'Only a Facilitator can Lock or Unlock the Board.';
    const outcome = await runGuardedMutation({
      gate: { kind: 'facilitate' },
      send: () => getActions().setBoardLock({ boardId: board.id, isLocked }),
      failureMessage: 'Could not update Board lock state. Try again.',
    });
    if (outcome.ok) return null;
    return outcome.reason === 'guard'
      ? 'Only a Facilitator can Lock or Unlock the Board.'
      : outcome.message ?? 'Could not update Board lock state. Try again.';
  }

  async function deleteCurrentBoard(): Promise<string | null> {
    const board = store.board;
    if (!board) return 'Only a Facilitator can delete this Board.';
    const outcome = await runGuardedMutation({
      gate: { kind: 'facilitate' },
      send: () => getActions().deleteBoard({ boardId: board.id }),
      failureMessage: 'Could not delete this Board. Try again.',
    });
    if (outcome.ok) return null;
    return outcome.reason === 'guard'
      ? 'Only a Facilitator can delete this Board.'
      : outcome.message ?? 'Could not delete this Board. Try again.';
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
    isActionItemPending,
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
