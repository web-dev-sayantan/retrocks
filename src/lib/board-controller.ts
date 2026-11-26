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

import { boardLivePath, type BoardLiveMessage } from './board-live-protocol';
import { subscribeFacilitatorLinkClaim, takeFacilitatorLinkToken } from './facilitator-link';
import { createLiveStream, type LiveTransport } from './live-stream';
import type { FacilitatorClaimInput, FacilitatorClaimResponse } from './sharing-actions';
import { parseBoardLiveMessage, parseBoardView } from './wire-schemas';
import {
  canAddColumn,
  canChangeVote,
  canDeleteColumn,
  canDeleteComment,
  canEditActionItem,
  canInteractWithCard,
  canManageCard,
  canManageGroup,
  canMergeCard,
  canUngroupCard,
  toBoardPolicyContext,
} from './board-permissions';
import { decideBoardAction, decideColumnAction } from './board-policy';
import {
  cloneCardGroup,
  cloneCardView,
  type ActionItemPatch,
  type ActionError,
  type BoardEvent,
  type BoardMutationResponse,
  type BoardMutationSuccess,
  type BoardViewDTO,
  type CardViewDTO,
  type ColumnAccent,
  type ColumnDTO,
  type ReactionEmoji,
} from './board-types';
import type { ServerClockSample } from './timer';
import type { BoardCommand, TimerChange } from './schemas';

type AddColumnPayload = Omit<Extract<BoardCommand, { type: 'column:add' }>, 'type'>;
type VoteDelta = Extract<BoardCommand, { type: 'vote:change' }>['delta'];
type VotingSettingsPatch = Omit<
  Extract<BoardCommand, { type: 'voting:configure' }>,
  'type'
>;

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

type ReportMutationFailure = (message: string) => void;

/** Card, Card Group, and Column mutations the workspace panels call. */
export interface BoardMutations {
  createCard(columnId: string, content: string): Promise<string | null>;
  updateCard(cardId: string, content: string): Promise<string | null>;
  updateActionItem(cardId: string, patch: ActionItemPatch): Promise<boolean>;
  moveCard(cardId: string, targetColumnId: string, onFailure?: ReportMutationFailure): Promise<boolean>;
  deleteCard(cardId: string): Promise<boolean>;
  toggleReaction(cardId: string, emoji: ReactionEmoji): Promise<string | null>;
  createComment(cardId: string, content: string): Promise<string | null>;
  deleteComment(cardId: string, commentId: string): Promise<string | null>;
  groupCard(cardId: string, targetType: 'card' | 'group', targetId: string, onFailure?: ReportMutationFailure): Promise<boolean>;
  ungroupCard(cardId: string): Promise<boolean>;
  renameCardGroup(groupId: string, title: string): Promise<boolean>;
  dissolveCardGroup(groupId: string): Promise<boolean>;
  moveCardGroup(groupId: string, targetColumnId: string, onFailure?: ReportMutationFailure): Promise<boolean>;
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
  reportError(message: string): void;
  clearError(): void;
  /** True while a `#f=` Co-Facilitator Link claim is in flight. */
  claimPending(): boolean;
  /** Error message from the most recent failed Co-Facilitator Link claim, or `null`. */
  claimError(): string | null;
  clearClaimError(): void;
  isChangingPrivateMode(): boolean;
  isSavingBoardTitle(): boolean;
  isSavingColumn(): boolean;
  changeCountdown(boardId: string, change: TimerChange): Promise<BoardMutationResponse>;
  renameBoard(title: string): Promise<boolean>;
  addColumn(input: AddColumnPayload): Promise<ColumnDTO | null>;
  togglePrivateMode(dramaticRequested: boolean): Promise<PrivateModeOutcome>;
  changeVote(targetType: 'card' | 'group', targetId: string, delta: VoteDelta): Promise<void>;
  saveVotingSettings(patch: VotingSettingsPatch): Promise<string | null>;
  resetAllVotes(): Promise<string | null>;
  toggleBoardLock(isLocked: boolean): Promise<string | null>;
  deleteCurrentBoard(): Promise<string | null>;
}

export type BoardCommandDispatcher = (
  boardId: string,
  command: BoardCommand,
) => Promise<BoardMutationResponse>;

export type BoardFacilitatorClaimer = (
  input: FacilitatorClaimInput,
) => Promise<FacilitatorClaimResponse>;

export interface BoardFragmentAdapter {
  /** Reads and scrubs any `#f=<token>` fragment for `boardPath` from the current URL. */
  takeToken(boardPath: string): string | null;
  /** Subscribes to subsequent URL hash changes and returns an unsubscribe callback. */
  onHashChange(listener: () => void): () => void;
}

const browserBoardFragmentAdapter: BoardFragmentAdapter = {
  takeToken: (boardPath) =>
    typeof window === 'undefined' ? null : takeFacilitatorLinkToken(boardPath),
  onHashChange: (listener) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  },
};

export interface BoardControllerOptions {
  /** Route-provided Board ID (used for `#f=` fragment scrubbing/claiming even when `board()` is `null`). */
  boardId?: string;
  /** Route-provided Board snapshot; the controller reconciles it into the store on change. */
  board: () => BoardViewDTO | null;
  /** Single command-dispatch seam; production passes `dispatchBoardCommand`, tests inject a fake. */
  dispatchCommand: BoardCommandDispatcher;
  /** Co-Facilitator Link claim seam; production passes `claimFacilitatorRole`, tests inject a fake. */
  claimFacilitatorLink?: BoardFacilitatorClaimer;
  /** Injectable URL fragment adapter for `#f=` reading/scrubbing; defaults to browser `window.location`/`history`. */
  fragment?: BoardFragmentAdapter;
  /** Injectable live transport; defaults to SSE/WebSocket. */
  liveTransport?: LiveTransport;
  /** Private Mode reveal theater hook; invoked synchronously before the response applies. */
  onDramaticReveal?: () => void;
}

function cloneBoardView(board: BoardViewDTO | null): BoardViewDTO | null {
  if (!board) return null;
  return {
    ...board,
    timer: { ...board.timer },
    columns: board.columns.map((c) => ({ ...c })),
    groups: board.groups.map(cloneCardGroup),
    cards: board.cards.map(cloneCardView),
  };
}

function adjustColumnCardCount(
  draft: BoardViewDTO,
  columnId: string,
  delta: number,
): void {
  const column = draft.columns.find((c) => c.id === columnId);
  if (column) {
    column.cardCount = Math.max(0, column.cardCount + delta);
  }
}

export interface BoardReconcileOutcome {
  /** Server timestamp carried by a `board:snapshot` or `timer:updated` event. */
  serverNow?: number;
  /** True when a version gap (`version > current.version + 1`) requires a live resync. */
  needsResync: boolean;
  /** Updated online presence count from `presence:count`. */
  presenceCount?: number;
  /** True when `board:deleted` cleared the active Board. */
  deleted: boolean;
}

/**
 * Exhaustive, idempotent event patcher for Solid 2.0 `createStore` Board state.
 * Handles snapshots, terminal deletions, presence updates, server timer clock
 * samples, and all incremental Board mutations in one place. Card and Card Group
 * upserts hand the whole cloned item to `reconcile(..., 'id')` so downstream
 * keyed projections preserve item proxy identity.
 */
function applyBoardEvent(
  draft: { board: BoardViewDTO | null },
  boardId: string,
  event: BoardEvent,
  outcome: BoardReconcileOutcome,
): void {
  switch (event.type) {
    case 'board:snapshot': {
      const current = draft.board;
      if (
        !current ||
        current.id !== boardId ||
        event.board.id !== boardId ||
        event.board.version < current.version
      ) {
        return;
      }
      reconcile({ board: cloneBoardView(event.board) }, 'id')(draft);
      outcome.serverNow = event.serverNow;
      return;
    }

    case 'board:deleted': {
      if (draft.board?.id === boardId) {
        reconcile({ board: null }, 'id')(draft);
        outcome.deleted = true;
      }
      return;
    }

    case 'presence:count': {
      outcome.presenceCount = event.count;
      return;
    }
  }

  const board = draft.board;
  if (!board) return;

  if (event.version > board.version) {
    board.version = event.version;
  }

  switch (event.type) {
    case 'board:updated': {
      const { patch } = event;
      if (patch.title !== undefined) board.title = patch.title;
      if (patch.subtitle !== undefined) board.subtitle = patch.subtitle;
      if (patch.isBlurred !== undefined) board.isBlurred = patch.isBlurred;
      if (patch.blindVoting !== undefined) {
        board.blindVoting = patch.blindVoting;
      }
      if (patch.isLocked !== undefined) board.isLocked = patch.isLocked;
      if (patch.allowParticipantGroup !== undefined) {
        board.allowParticipantGroup = patch.allowParticipantGroup;
      }
      if (patch.voteLimit !== undefined) board.voteLimit = patch.voteLimit;
      if (patch.maxVotesPerCard !== undefined) {
        board.maxVotesPerCard = patch.maxVotesPerCard;
      }
      if (patch.retentionDays !== undefined) {
        board.retentionDays = patch.retentionDays;
      }
      break;
    }

    case 'timer:updated': {
      board.timer.endsAt = event.timer.endsAt;
      board.timer.remainingMs = event.timer.remainingMs;
      board.timer.durationMs = event.timer.durationMs;
      outcome.serverNow = event.serverNow;
      break;
    }

    case 'column:upserted': {
      const existing = board.columns.find((c) => c.id === event.column.id);
      if (existing) {
        existing.title = event.column.title;
        existing.accent = event.column.accent;
        existing.position = event.column.position;
        existing.isActionColumn = event.column.isActionColumn;
      } else {
        board.columns.push({ ...event.column });
      }
      board.columns.sort((a, b) => a.position - b.position);
      break;
    }

    case 'columns:reordered': {
      const orderIndex = new Map(
        event.columnIds.map((id, index) => [id, index]),
      );
      board.columns.sort((a, b) => {
        const aIdx = orderIndex.get(a.id) ?? a.position;
        const bIdx = orderIndex.get(b.id) ?? b.position;
        return aIdx - bIdx;
      });
      for (let i = 0; i < board.columns.length; i += 1) {
        board.columns[i].position = i;
      }
      break;
    }

    case 'column:deleted': {
      const colIndex = board.columns.findIndex((c) => c.id === event.columnId);
      if (colIndex !== -1) {
        board.columns.splice(colIndex, 1);
      }
      for (let i = 0; i < board.columns.length; i += 1) {
        board.columns[i].position = i;
      }
      for (let i = board.cards.length - 1; i >= 0; i -= 1) {
        if (board.cards[i].columnId === event.columnId) {
          board.cards.splice(i, 1);
        }
      }
      for (let i = board.groups.length - 1; i >= 0; i -= 1) {
        if (board.groups[i].columnId === event.columnId) {
          board.groups.splice(i, 1);
        }
      }
      break;
    }

    case 'card:upserted': {
      const existingIndex = board.cards.findIndex(
        (c) => c.id === event.card.id,
      );
      if (existingIndex !== -1) {
        const previousColumnId = board.cards[existingIndex].columnId;
        if (previousColumnId !== event.card.columnId) {
          adjustColumnCardCount(board, previousColumnId, -1);
          adjustColumnCardCount(board, event.card.columnId, 1);
        }
        reconcile(cloneCardView(event.card), 'id')(board.cards[existingIndex]);
      } else {
        const card = cloneCardView(event.card);
        const insertAt = board.cards.findIndex((item) => item.createdAt < card.createdAt);
        if (insertAt === -1) board.cards.push(card);
        else board.cards.splice(insertAt, 0, card);
        adjustColumnCardCount(board, event.card.columnId, 1);
      }
      break;
    }

    case 'card:deleted': {
      const cardIndex = board.cards.findIndex((c) => c.id === event.cardId);
      if (cardIndex !== -1) {
        const [removed] = board.cards.splice(cardIndex, 1);
        adjustColumnCardCount(board, removed.columnId, -1);
        for (const group of board.groups) {
          const memberIdx = group.cardIds.indexOf(event.cardId);
          if (memberIdx !== -1) {
            group.cardIds.splice(memberIdx, 1);
          }
        }
      }
      break;
    }

    case 'group:upserted': {
      const existingIndex = board.groups.findIndex(
        (g) => g.id === event.group.id,
      );
      if (existingIndex !== -1) {
        reconcile(cloneCardGroup(event.group), 'id')(board.groups[existingIndex]);
      } else {
        const group = cloneCardGroup(event.group);
        const insertAt = board.groups.findIndex((item) => item.createdAt > group.createdAt);
        if (insertAt === -1) board.groups.push(group);
        else board.groups.splice(insertAt, 0, group);
      }
      break;
    }

    case 'group:dissolved': {
      const groupIndex = board.groups.findIndex((g) => g.id === event.groupId);
      if (groupIndex !== -1) {
        board.groups.splice(groupIndex, 1);
      }
      for (const card of board.cards) {
        if (card.groupId === event.groupId) {
          card.groupId = null;
        }
      }
      break;
    }

    case 'vote:updated': {
      const targets = event.targetType === 'card' ? board.cards : board.groups;
      const target = targets.find((item) => item.id === event.targetId);
      if (target) {
        target.votes = event.totalVotes;
        target.myVotes = event.myVotes;
      }
      board.remainingVotes = event.remainingVotes;
      break;
    }

    case 'vote:balance':
      board.remainingVotes = event.remainingVotes;
      break;

    case 'reaction:updated': {
      const card = board.cards.find((c) => c.id === event.cardId);
      if (card) {
        reconcile({ ...event.counts })(card.reactions);
        reconcile([...event.myReactions])(card.myReactions);
      }
      break;
    }

    case 'comment:created': {
      const card = board.cards.find((c) => c.id === event.cardId);
      if (card && !card.comments.some((c) => c.id === event.comment.id)) {
        const insertAt = card.comments.findIndex(
          (c) => c.createdAt > event.comment.createdAt,
        );
        if (insertAt === -1) card.comments.push({ ...event.comment });
        else card.comments.splice(insertAt, 0, { ...event.comment });
        card.commentCount = card.comments.length;
      }
      break;
    }

    case 'comment:deleted': {
      const card = board.cards.find((c) => c.id === event.cardId);
      if (card) {
        const idx = card.comments.findIndex((c) => c.id === event.commentId);
        if (idx !== -1) {
          card.comments.splice(idx, 1);
          card.commentCount = card.comments.length;
        }
      }
      break;
    }
  }
}

/**
 * Unified Board state reconciliation pipeline shared by live stream frames and
 * HTTP mutation responses. Enforces version ordering and gap detection while
 * returning side-effect metadata (server clock, presence count, deletion, resync)
 * for the controller to apply outside the store draft.
 */
export function reconcileBoardUpdate(
  draft: { board: BoardViewDTO | null },
  boardId: string,
  message: BoardLiveMessage,
): BoardReconcileOutcome {
  const outcome: BoardReconcileOutcome = {
    needsResync: false,
    deleted: false,
  };

  switch (message.type) {
    case 'board:snapshot':
    case 'board:deleted':
    case 'presence:count':
      applyBoardEvent(draft, boardId, message, outcome);
      return outcome;

    case 'board:mutation': {
      const deletedEvent = message.events.find((event) => event.type === 'board:deleted');
      if (deletedEvent) {
        applyBoardEvent(draft, boardId, deletedEvent, outcome);
        return outcome;
      }
      const snapshotEvent = message.events.find((event) => event.type === 'board:snapshot');
      if (snapshotEvent) {
        applyBoardEvent(draft, boardId, snapshotEvent, outcome);
        return outcome;
      }
      const board = draft.board;
      if (!board || board.id !== boardId || message.version <= board.version) {
        return outcome;
      }
      if (message.version > board.version + 1) {
        outcome.needsResync = true;
        return outcome;
      }
      for (const event of message.events) {
        applyBoardEvent(draft, boardId, event, outcome);
      }
      if (draft.board) {
        draft.board.version = message.version;
        if (message.lastActiveAt !== undefined) {
          draft.board.lastActiveAt = message.lastActiveAt;
        }
      }
      return outcome;
    }

    case 'heartbeat':
      return outcome;
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
  preserveError?: boolean;
  send: () => Promise<BoardMutationResponse>;
}

interface GuardedMutation extends Omit<MutationRequest, 'boardId' | 'send' | 'preserveError'> {
  /** Shared Board authorization policy check evaluated once before opening the action. */
  authorize: (board: BoardViewDTO) => boolean;
  guardMessage?: string;
  failureMessage: string;
  reportFailure?: true | ReportMutationFailure;
  send: (boardId: string) => Promise<BoardMutationResponse>;
}

type MutationOutcome<T> =
  | { ok: true; response: BoardMutationSuccess; value?: T }
  | { ok: false; message?: string; reason: 'guard' | 'rejection' | 'network' };

const GENERIC_FAILURE = 'Could not update the Board. Try again.';

/**
 * Reactive Board client controller: owns the Board store, unified event
 * reconciliation (snapshots, deletions, presence, version-gap resync, and
 * server clock sync), and every mutation. All mutations share one Solid 2.0
 * `action` over an optimistic store: handlers write the expected value inside
 * the action, the server response commits through `reconcileServerUpdate`, and
 * any rejection reverts the guesses automatically. Permission/lock checks
 * happen once, through the shared Board authorization policy, before an action
 * opens.
 */
export function createBoardController(options: BoardControllerOptions): BoardController {
  const { dispatchCommand } = options;
  const initialBoard = untrack(() => cloneBoardView(options.board()));
  const boardId = options.boardId ?? initialBoard?.id ?? '';
  const fragment = options.fragment ?? browserBoardFragmentAdapter;

  // Authoritative server state: the route snapshot, live events, and mutation
  // responses patch `serverStore` incrementally. `createOptimisticStore` chains
  // directly to `serverStore` so optimistic writes overlay it without cloning
  // the entire Board on every server revision.
  const [serverStore, setServerStore] = createStore<{ board: BoardViewDTO | null }>({
    board: initialBoard,
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
  const [claimPending, setClaimPending] = createSignal(false);
  const [claimError, setClaimError] = createSignal<string | null>(null);
  // Process affordances: optimistic flags show immediately and clear when the
  // action settles, without needing isPending on an optimistically-writable slot.
  const [savingVotes, setSavingVotes] = createOptimistic(false);
  const [pendingActionItems, setPendingActionItems] = createOptimistic<readonly string[]>([]);

  const [isChangingPrivateMode, setIsChangingPrivateMode] = createSignal(false);
  const [isSavingBoardTitle, setIsSavingBoardTitle] = createSignal(false);
  const [isSavingColumn, setIsSavingColumn] = createSignal(false);

  function applyRouteSnapshot(nextBoard: BoardViewDTO | null): void {
    if (nextBoard === null) setErrorMessage(null);
    untrack(() => {
      setServerStore((draft) => {
        const current = draft.board;
        if (nextBoard && current?.id === nextBoard.id) {
          if (nextBoard.version < current.version) return;
          if (
            nextBoard.version === current.version &&
            (nextBoard.isFacilitator === current.isFacilitator ||
              (current.isFacilitator && !nextBoard.isFacilitator))
          ) {
            return;
          }
        }
        reconcile({ board: cloneBoardView(nextBoard) }, 'id')(draft);
      });
    });
  }

  function applyClaimedBoard(claimedBoard: BoardViewDTO): void {
    if (claimedBoard.id !== boardId) return;
    setClaimError(null);
    const hadLiveBoard = untrack(() => serverStore.board?.id === boardId);
    untrack(() => {
      setServerStore((draft) => {
        const current = draft.board;
        if (current?.id === claimedBoard.id) {
          if (claimedBoard.version < current.version) {
            if (claimedBoard.isFacilitator && !current.isFacilitator) {
              current.isFacilitator = true;
            }
            return;
          }
          if (
            claimedBoard.version === current.version &&
            claimedBoard.isFacilitator === current.isFacilitator
          ) {
            return;
          }
        }
        reconcile({ board: cloneBoardView(claimedBoard) }, 'id')(draft);
      });
    });
    if (hadLiveBoard) {
      reconnectLive?.();
    }
  }

  function syncServerClock(boardId: string, serverNow: number): void {
    setServerClock({ boardId, serverNow, receivedAt: performance.now() });
    serverTimeOffsetMs = serverNow - Date.now();
    setNowMs(serverNow);
  }

  function reconcileServerUpdate(boardId: string, message: BoardLiveMessage): void {
    let outcome: BoardReconcileOutcome = { needsResync: false, deleted: false };
    untrack(() => {
      setServerStore((draft) => {
        outcome = reconcileBoardUpdate(draft, boardId, message);
      });
    });
    if (outcome.deleted) setErrorMessage(null);
    if (outcome.presenceCount !== undefined) setOnlineCount(outcome.presenceCount);
    if (outcome.serverNow !== undefined) syncServerClock(boardId, outcome.serverNow);
    if (outcome.needsResync) reconnectLive?.();
  }

  createEffect(() => options.board(), (nextBoard) => applyRouteSnapshot(nextBoard));

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
          reconcileServerUpdate(boardId, message);
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

  onSettled(() => {
    if (!boardId || typeof window === 'undefined') return;
    const claimLink = options.claimFacilitatorLink;
    return subscribeFacilitatorLinkClaim({
      path: `/b/${boardId}`,
      takeToken: fragment.takeToken,
      onHashChange: fragment.onHashChange,
      shouldClaim: () => Boolean(claimLink),
      claim: (token) => (
        claimLink
          ? claimLink({ boardId, token })
          : Promise.resolve({ ok: false as const, code: 'FORBIDDEN' as const, message: '' })
      ),
      onStart: () => setClaimError(null),
      onPendingChange: setClaimPending,
      onSuccess: (result) => {
        if (result.ok) {
          applyClaimedBoard(parseBoardView(result.board));
        } else {
          setClaimError(result.message);
        }
      },
      onError: () => {
        setClaimError('Could not claim Facilitator access. Reopen the link to try again.');
      },
    });
  });

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
    if (!request.preserveError) setErrorMessage(null);
    reconcileServerUpdate(request.boardId, {
      type: 'board:mutation',
      version: response.version,
      lastActiveAt: response.lastActiveAt,
      events: response.events,
    });
    return response;
  });

  async function runGuardedMutation<T>(
    mutation: GuardedMutation,
    select?: (response: BoardMutationSuccess) => T,
  ): Promise<MutationOutcome<T>> {
    // Commit caller-owned process flags written in this tick before the action
    // opens; the action's transaction would otherwise hold them until it settles.
    flush();
    const reportFailure = mutation.reportFailure;
    const board = store.board;
    if (!board) {
      const message = 'This Board is no longer available.';
      if (typeof reportFailure === 'function') reportFailure(message);
      return { ok: false, reason: 'guard', message };
    }
    if (!mutation.authorize(board)) {
      if (typeof reportFailure === 'function') {
        reportFailure(mutation.guardMessage ?? mutation.failureMessage);
      }
      return { ok: false, reason: 'guard', message: mutation.guardMessage };
    }
    const boardId = board.id;
    try {
      const response = await performMutation({
        boardId,
        begin: mutation.begin,
        optimistic: mutation.optimistic,
        pending: mutation.pending,
        beforeCommit: mutation.beforeCommit,
        preserveError: typeof reportFailure === 'function',
        send: () => mutation.send(boardId),
      });
      return { ok: true, response, value: select?.(response) };
    } catch (error) {
      const rejection = error instanceof MutationRejected ? error : undefined;
      const message = rejection?.message ?? mutation.failureMessage ?? GENERIC_FAILURE;
      if (typeof reportFailure === 'function') reportFailure(message);
      else if (reportFailure) setErrorMessage(message);
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
      authorize: (current) => decideBoardAction(toBoardPolicyContext(current), 'timer:update').allowed,
      send: () => dispatchCommand(boardId, { type: 'timer:update', change }),
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
        authorize: (current) =>
          decideBoardAction(toBoardPolicyContext(current), 'board:set-private-mode').allowed,
        send: () =>
          dispatchCommand(board.id, {
            type: 'board:set-private-mode',
            isBlurred: !board.isBlurred,
          }),
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
        authorize: (current) => decideBoardAction(toBoardPolicyContext(current), 'board:rename').allowed,
        send: () => dispatchCommand(board.id, { type: 'board:rename', title: trimmed }),
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
      authorize: (current) => decideBoardAction(toBoardPolicyContext(current), 'board:contribute').allowed,
      guardMessage: 'This Board is not accepting new Cards.',
      optimistic: (draft) => {
        draft.cards.push({ ...optimisticCard });
        const col = draft.columns.find((item) => item.id === columnId);
        if (col) col.cardCount += 1;
      },
      send: () => dispatchCommand(board.id, { type: 'card:create', columnId, content }),
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
      authorize: (current) => canManageCard(current, cardId),
      guardMessage: 'This Card can no longer be edited.',
      send: () => dispatchCommand(board.id, { type: 'card:update', cardId, content }),
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
      authorize: (current) => canEditActionItem(current, cardId, patch),
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
      send: () => dispatchCommand(board.id, { type: 'card:set-action', cardId, ...patch }),
      failureMessage: 'Could not update the Action Item. Try again.',
    });
    return outcome.ok;
  }

  async function moveCard(cardId: string, targetColumnId: string, onFailure?: ReportMutationFailure): Promise<boolean> {
    const outcome = await runGuardedMutation({
      authorize: (current) => canManageCard(current, cardId),
      send: (boardId) => dispatchCommand(boardId, { type: 'card:move', cardId, targetColumnId }),
      failureMessage: 'Could not move the Card. Try again.',
      reportFailure: onFailure ?? true,
    });
    return outcome.ok;
  }

  async function deleteCard(cardId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      authorize: (current) => canManageCard(current, cardId),
      send: () => dispatchCommand(board.id, { type: 'card:delete', cardId }),
      failureMessage: 'Could not delete the Card. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function groupCard(
    cardId: string,
    targetType: 'card' | 'group',
    targetId: string,
    onFailure?: ReportMutationFailure,
  ): Promise<boolean> {
    const outcome = await runGuardedMutation({
      authorize: (current) => canMergeCard(current, cardId, targetType, targetId),
      send: (boardId) => dispatchCommand(boardId, { type: 'group:merge', cardId, targetType, targetId }),
      failureMessage: 'Could not group the Card. Try again.',
      reportFailure: onFailure ?? true,
    });
    return outcome.ok;
  }

  async function renameCardGroup(groupId: string, title: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      authorize: (current) => canManageGroup(current, groupId),
      send: () => dispatchCommand(board.id, { type: 'group:rename', groupId, title }),
      failureMessage: 'Could not rename the Card Group. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function ungroupCard(cardId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      authorize: (current) => canUngroupCard(current, cardId),
      send: () => dispatchCommand(board.id, { type: 'group:ungroup', cardId }),
      failureMessage: 'Could not ungroup the Card. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function dissolveCardGroup(groupId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      authorize: (current) => canManageGroup(current, groupId),
      send: () => dispatchCommand(board.id, { type: 'group:dissolve', groupId }),
      failureMessage: 'Could not dissolve the Card Group. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function moveCardGroup(groupId: string, targetColumnId: string, onFailure?: ReportMutationFailure): Promise<boolean> {
    const outcome = await runGuardedMutation({
      authorize: (current) => canManageGroup(current, groupId),
      send: (boardId) => dispatchCommand(boardId, { type: 'group:move', groupId, targetColumnId }),
      failureMessage: 'Could not move the Card Group. Try again.',
      reportFailure: onFailure ?? true,
    });
    return outcome.ok;
  }

  async function toggleReaction(cardId: string, emoji: ReactionEmoji): Promise<string | null> {
    const board = store.board;
    if (!board) return 'This Card can no longer receive reactions.';
    const outcome = await runGuardedMutation({
      authorize: (current) => canInteractWithCard(current, cardId),
      guardMessage: 'This Card can no longer receive reactions.',
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
      send: () => dispatchCommand(board.id, { type: 'reaction:toggle', cardId, emoji }),
      failureMessage: 'Could not update reaction. Try again.',
    });
    return outcome.ok ? null : outcome.message ?? 'Could not update reaction. Try again.';
  }

  async function createComment(cardId: string, content: string): Promise<string | null> {
    const board = store.board;
    if (!board) return 'This Card can no longer receive comments.';
    const outcome = await runGuardedMutation({
      authorize: (current) => canInteractWithCard(current, cardId),
      guardMessage: 'This Card can no longer receive comments.',
      send: () => dispatchCommand(board.id, { type: 'comment:create', cardId, content }),
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
      authorize: (current) => canDeleteComment(current, cardId, commentId),
      guardMessage: 'This comment can no longer be deleted.',
      send: () => dispatchCommand(board.id, { type: 'comment:delete', cardId, commentId }),
      failureMessage: 'Could not delete comment. Try again.',
    });
    return outcome.ok ? null : outcome.message ?? 'Could not delete comment. Try again.';
  }

  async function addColumn(input: AddColumnPayload): Promise<ColumnDTO | null> {
    const board = store.board;
    if (!board || input.title.trim().length === 0 || isSavingColumn()) return null;
    setIsSavingColumn(true);
    try {
      const outcome = await runGuardedMutation(
        {
          authorize: (current) => canAddColumn(current),
          send: () =>
            dispatchCommand(board.id, {
              type: 'column:add',
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
      authorize: (current) =>
        decideColumnAction(toBoardPolicyContext(current), { type: 'column:update' }).allowed,
      send: () => dispatchCommand(board.id, { type: 'column:update', columnId, ...patch }),
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
      authorize: (current) =>
        decideColumnAction(toBoardPolicyContext(current), { type: 'column:reorder' }).allowed,
      send: () => dispatchCommand(board.id, { type: 'column:reorder', columnIds: reordered }),
      failureMessage: 'Could not move the Column. Try again.',
      reportFailure: true,
    });
    return outcome.ok;
  }

  async function deleteColumn(columnId: string): Promise<boolean> {
    const board = store.board;
    if (!board) return false;
    const outcome = await runGuardedMutation({
      authorize: (current) =>
        canDeleteColumn(
          current,
          current.columns.length,
          current.cards.filter((card) => card.columnId === columnId),
        ),
      send: () => dispatchCommand(board.id, { type: 'column:delete', columnId }),
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
      authorize: (current) => canChangeVote(current, targetType, targetId, delta),
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
      send: () =>
        dispatchCommand(board.id, { type: 'vote:change', targetType, targetId, delta }),
      failureMessage: 'Could not update your Vote. Try again.',
      reportFailure: true,
    });
  }

  async function runVotingSettingsMutation(
    command: Extract<BoardCommand, { type: 'voting:configure' | 'voting:reset' }>,
  ): Promise<string | null> {
    const board = store.board;
    if (!board) return 'Voting settings are unavailable.';
    const outcome = await runGuardedMutation({
      authorize: (current) => decideBoardAction(toBoardPolicyContext(current), command.type).allowed,
      send: () => dispatchCommand(board.id, command),
      failureMessage: 'Could not update Voting. Try again.',
    });
    if (outcome.ok) return null;
    return outcome.reason === 'guard'
      ? 'Voting settings are unavailable.'
      : outcome.message ?? 'Could not update Voting. Try again.';
  }

  function saveVotingSettings(patch: VotingSettingsPatch): Promise<string | null> {
    return runVotingSettingsMutation({ type: 'voting:configure', ...patch });
  }

  function resetAllVotes(): Promise<string | null> {
    return runVotingSettingsMutation({ type: 'voting:reset' });
  }

  async function toggleBoardLock(isLocked: boolean): Promise<string | null> {
    const board = store.board;
    if (!board) return 'Only a Facilitator can Lock or Unlock the Board.';
    const outcome = await runGuardedMutation({
      authorize: (current) => decideBoardAction(toBoardPolicyContext(current), 'board:set-lock').allowed,
      send: () => dispatchCommand(board.id, { type: 'board:set-lock', isLocked }),
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
      authorize: (current) => decideBoardAction(toBoardPolicyContext(current), 'board:delete').allowed,
      send: () => dispatchCommand(board.id, { type: 'board:delete' }),
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
    reportError: (message) => setErrorMessage(message),
    clearError: () => setErrorMessage(null),
    claimPending,
    claimError,
    clearClaimError: () => setClaimError(null),
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
