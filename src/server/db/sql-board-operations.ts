import 'server-only';

import {
  decideActionItemAction,
  decideBoardAction,
  decideCardAction,
  decideColumnAction,
  decideCommentDelete,
  decideGroupAction,
  type BoardPolicyContext,
  type BoardPolicyDenialReason,
  type CardGroupPolicyFacts,
  type GroupPolicyAction,
  type MergeGroupFacts,
} from '../../lib/board-policy';
import {
  MAX_ACTION_OWNER_LENGTH,
  MAX_CARDS_PER_BOARD,
  MAX_CARD_CONTENT_LENGTH,
  MAX_COLUMNS_PER_BOARD,
  MAX_COMMENT_LENGTH,
  MAX_COMMENTS_PER_CARD,
  MAX_GROUP_TITLE_LENGTH,
  type BoardSettingsDTO,
  type BoardTemplateId,
  type ColumnAccent,
} from '../../lib/board-types';
import { applyTimerChange } from '../domain/timer';
import type {
  BoardMutationActor,
  BoardMutationCommand,
  BoardMutationOutcome,
  CreateBoardRecord,
  FacilitatorCapability,
  RawBoardMutationEvent,
  RawBoardRow,
  RawBoardSnapshot,
  RawCardGroupRow,
  RawCardRow,
  RawColumnRow,
  RawCommentRow,
  RawReactionRow,
  RawVoteRow,
} from './raw-types';
import { BOARD_SCHEMA_STATEMENTS } from './schema';
import type { SqlRunner } from './sql-runner';
import { changeVote, configureVoting } from './sql-voting-operations';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface BoardDbRow extends Record<string, unknown> {
  id: string;
  title: string;
  subtitle: string;
  template_id: string;
  facilitator_token_hash: string;
  facilitator_token_encrypted: string;
  token_salt: string;
  is_blurred: number;
  blind_voting: number;
  is_locked: number;
  allow_participant_group: number;
  vote_limit: number | null;
  max_votes_per_card: number | null;
  timer_ends_at: number | null;
  timer_remaining_ms: number | null;
  timer_duration_ms: number | null;
  version: number;
  retention_days: number;
  created_at: number;
  last_active_at: number;
}

interface ColumnDbRow extends Record<string, unknown> {
  id: string;
  board_id: string;
  title: string;
  accent: string;
  position: number;
  is_action_column: number;
}

interface CardGroupDbRow extends Record<string, unknown> {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  created_at: number;
}

interface CardDbRow extends Record<string, unknown> {
  id: string;
  board_id: string;
  column_id: string;
  group_id: string | null;
  content: string;
  author_token_hash: string;
  is_action_item: number;
  action_done: number;
  action_owner: string;
  created_at: number;
  updated_at: number;
}

interface VoteDbRow extends Record<string, unknown> {
  board_id: string;
  target_type: string;
  target_id: string;
  voter_token_hash: string;
  count: number;
  updated_at: number;
}

interface ReactionDbRow extends Record<string, unknown> {
  board_id: string;
  card_id: string;
  emoji: string;
  reactor_token_hash: string;
  created_at: number;
}

interface CommentDbRow extends Record<string, unknown> {
  id: string;
  board_id: string;
  card_id: string;
  content: string;
  author_token_hash: string;
  created_at: number;
}

function mapBoardRow(row: BoardDbRow): RawBoardRow {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    templateId: row.template_id as BoardTemplateId,
    facilitatorTokenHash: row.facilitator_token_hash,
    facilitatorTokenEncrypted: row.facilitator_token_encrypted,
    tokenSalt: row.token_salt,
    isBlurred: row.is_blurred === 1,
    blindVoting: row.blind_voting === 1,
    isLocked: row.is_locked === 1,
    allowParticipantGroup: row.allow_participant_group === 1,
    voteLimit: row.vote_limit,
    maxVotesPerCard: row.max_votes_per_card,
    timerEndsAt: row.timer_ends_at,
    timerRemainingMs: row.timer_remaining_ms,
    timerDurationMs: row.timer_duration_ms,
    version: row.version,
    retentionDays: row.retention_days,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

function mapColumnRow(row: ColumnDbRow): RawColumnRow {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    accent: row.accent as ColumnAccent,
    position: row.position,
    isActionColumn: row.is_action_column === 1,
  };
}

function mapGroupRow(row: CardGroupDbRow): RawCardGroupRow {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    createdAt: row.created_at,
  };
}

function mapCardRow(row: CardDbRow): RawCardRow {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    groupId: row.group_id,
    content: row.content,
    authorTokenHash: row.author_token_hash,
    isActionItem: row.is_action_item === 1,
    actionDone: row.action_done === 1,
    actionOwner: row.action_owner,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVoteRow(row: VoteDbRow): RawVoteRow {
  return {
    boardId: row.board_id,
    targetType: row.target_type === 'group' ? 'group' : 'card',
    targetId: row.target_id,
    voterTokenHash: row.voter_token_hash,
    count: row.count,
    updatedAt: row.updated_at,
  };
}

function mapReactionRow(row: ReactionDbRow): RawReactionRow {
  return {
    boardId: row.board_id,
    cardId: row.card_id,
    emoji: row.emoji,
    reactorTokenHash: row.reactor_token_hash,
    createdAt: row.created_at,
  };
}

function mapCommentRow(row: CommentDbRow): RawCommentRow {
  return {
    id: row.id,
    boardId: row.board_id,
    cardId: row.card_id,
    content: row.content,
    authorTokenHash: row.author_token_hash,
    createdAt: row.created_at,
  };
}

export function isBoardExpired(
  board: Pick<RawBoardRow, 'lastActiveAt' | 'retentionDays'>,
  now: number,
): boolean {
  return board.lastActiveAt + board.retentionDays * MS_PER_DAY <= now;
}

export function computeBoardExpiryAt(
  lastActiveAt: number,
  retentionDays: number,
): number {
  return lastActiveAt + retentionDays * MS_PER_DAY;
}

type MutationFailure = Extract<BoardMutationOutcome, { ok: false }>;

const BOARD_LOCKED_ERROR: MutationFailure = {
  ok: false,
  code: 'BOARD_LOCKED',
  message: 'This Board is Locked and cannot be edited.',
};

const PRIVATE_MODE_ERROR: MutationFailure = {
  ok: false,
  code: 'FORBIDDEN',
  message: "Cannot change another Participant's Card while Private Mode is active.",
};

const COLUMN_FACILITATOR_MESSAGES: Record<
  'column:add' | 'column:update' | 'column:reorder' | 'column:delete',
  string
> = {
  'column:add': 'Only a Facilitator can add Columns.',
  'column:update': 'Only a Facilitator can edit Columns.',
  'column:reorder': 'Only a Facilitator can reorder Columns.',
  'column:delete': 'Only a Facilitator can delete Columns.',
};

function authorizeCommandAccess(
  policyBoard: BoardPolicyContext,
  command: BoardMutationCommand,
): MutationFailure | null {
  switch (command.type) {
    case 'voting:configure':
    case 'voting:reset': {
      const decision = decideBoardAction(policyBoard, command.type);
      if (decision.allowed) return null;
      return decision.reason === 'board-locked'
        ? BOARD_LOCKED_ERROR
        : {
            ok: false,
            code: 'FORBIDDEN',
            message: 'Only a Facilitator can change Voting settings or reset Votes.',
          };
    }

    case 'facilitator:rotate': {
      const decision = decideBoardAction(policyBoard, 'facilitator:rotate');
      if (decision.allowed) return null;
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Only a Facilitator can rotate the Co-Facilitator Link.',
      };
    }

    case 'timer:update': {
      const decision = decideBoardAction(policyBoard, 'timer:update');
      if (decision.allowed) return null;
      return decision.reason === 'board-locked'
        ? BOARD_LOCKED_ERROR
        : {
            ok: false,
            code: 'FORBIDDEN',
            message: 'Only a Facilitator can control the timer.',
          };
    }

    case 'board:rename': {
      const decision = decideBoardAction(policyBoard, 'board:rename');
      if (decision.allowed) return null;
      return decision.reason === 'board-locked'
        ? BOARD_LOCKED_ERROR
        : {
            ok: false,
            code: 'FORBIDDEN',
            message: 'Only a Facilitator can rename the Board.',
          };
    }

    case 'board:set-private-mode': {
      const decision = decideBoardAction(policyBoard, 'board:set-private-mode');
      if (decision.allowed) return null;
      return decision.reason === 'board-locked'
        ? BOARD_LOCKED_ERROR
        : {
            ok: false,
            code: 'FORBIDDEN',
            message: 'Only a Facilitator can change Private Mode.',
          };
    }

    case 'board:set-lock': {
      const decision = decideBoardAction(policyBoard, 'board:set-lock');
      if (decision.allowed) return null;
      return decision.reason === 'board-locked'
        ? BOARD_LOCKED_ERROR
        : {
            ok: false,
            code: 'FORBIDDEN',
            message: 'Only a Facilitator can Lock or Unlock the Board.',
          };
    }

    case 'card:set-action': {
      const decision = decideBoardAction(
        policyBoard,
        command.isActionItem === undefined
          ? 'action-item:follow-up'
          : 'board:contribute',
      );
      return decision.allowed ? null : BOARD_LOCKED_ERROR;
    }

    case 'vote:change':
    case 'card:create':
    case 'card:update':
    case 'card:move':
    case 'card:delete':
    case 'reaction:toggle':
    case 'comment:create':
    case 'comment:delete': {
      const decision = decideBoardAction(policyBoard, 'board:contribute');
      return decision.allowed ? null : BOARD_LOCKED_ERROR;
    }

    case 'group:merge':
    case 'group:rename':
    case 'group:ungroup':
    case 'group:dissolve':
    case 'group:move': {
      const decision = decideGroupAction(policyBoard, {
        type: 'group:manage-access',
      });
      if (decision.allowed) return null;
      return mapGroupPolicyDenial(decision.reason);
    }

    case 'column:add':
    case 'column:update':
    case 'column:reorder':
    case 'column:delete': {
      const decision = decideColumnAction(
        policyBoard,
        command.type === 'column:add'
          ? { type: 'column:add', columnCount: 0 }
          : command.type === 'column:delete'
            ? { type: 'column:delete', columnCount: 2 }
            : { type: command.type },
      );
      if (decision.allowed) return null;
      return mapColumnPolicyDenial(decision.reason, command.type);
    }
  }
}

function mapCardPolicyDenial(
  reason: BoardPolicyDenialReason,
  verb?: 'edit' | 'move' | 'delete',
): MutationFailure {
  switch (reason) {
    case 'board-locked':
      return BOARD_LOCKED_ERROR;
    case 'private-mode-restricted':
      return PRIVATE_MODE_ERROR;
    case 'not-card-author':
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: `You can only ${verb ?? 'edit'} your own Cards.`,
      };
    case 'not-action-item':
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Only Action Items can have completion and owner fields.',
      };
    case 'not-comment-author':
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'You can only delete your own comments.',
      };
    default:
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
      };
  }
}

function mapGroupPolicyDenial(reason: BoardPolicyDenialReason): MutationFailure {
  switch (reason) {
    case 'board-locked':
      return BOARD_LOCKED_ERROR;
    case 'grouping-restricted':
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Only a Facilitator can group Cards.',
      };
    case 'private-mode-restricted':
      return PRIVATE_MODE_ERROR;
    case 'same-card':
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Choose a different Card to group with.',
      };
    case 'different-column':
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Cards can only be grouped within the same Column.',
      };
    case 'already-in-group':
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'This Card is already in that Card Group.',
      };
    case 'card-not-in-group':
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Card is not in a Card Group.',
      };
    default:
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'You do not have permission to group Cards.',
      };
  }
}

function mapColumnPolicyDenial(
  reason: BoardPolicyDenialReason,
  actionType: 'column:add' | 'column:update' | 'column:reorder' | 'column:delete',
): MutationFailure {
  switch (reason) {
    case 'board-locked':
      return BOARD_LOCKED_ERROR;
    case 'facilitator-required':
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: COLUMN_FACILITATOR_MESSAGES[actionType],
      };
    case 'column-limit-reached':
      return {
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message: `A Board can have at most ${MAX_COLUMNS_PER_BOARD} Columns.`,
      };
    case 'last-column':
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'A Board must have at least 1 Column.',
      };
    case 'column-has-hidden-cards':
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Reveal All before deleting a Column with hidden Cards.',
      };
    default:
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: COLUMN_FACILITATOR_MESSAGES[actionType],
      };
  }
}

/**
 * Runtime-agnostic SQLite persistence operations executed identically inside
 * Cloudflare `BoardRoom` Durable Objects and standalone Node SQLite.
 */
export class SqlBoardOperations {
  private schemaInitialized = false;

  constructor(private readonly sql: SqlRunner) {}

  ensureSchema(): void {
    if (this.schemaInitialized) return;
    this.sql.exec('PRAGMA foreign_keys = ON');
    for (const statement of BOARD_SCHEMA_STATEMENTS) {
      this.sql.exec(statement);
    }
    this.schemaInitialized = true;
  }

  /**
   * Resets cached schema state after Durable Object `storage.deleteAll()` wipes
   * all SQLite tables on a live instance.
   */
  resetSchemaState(): void {
    this.schemaInitialized = false;
  }

  hasBoardsTable(): boolean {
    if (this.schemaInitialized) return true;
    const row = this.sql.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'boards'",
    );
    return Boolean(row);
  }

  createBoard(record: CreateBoardRecord): RawBoardSnapshot {
    this.ensureSchema();

    return this.sql.transaction(() => {
      this.sql.run(
        `INSERT INTO boards (
          id, title, subtitle, template_id,
          facilitator_token_hash, facilitator_token_encrypted, token_salt,
          is_blurred, blind_voting, is_locked, allow_participant_group,
          vote_limit, max_votes_per_card,
          timer_ends_at, timer_remaining_ms, timer_duration_ms,
          version, retention_days, created_at, last_active_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, NULL, NULL, NULL, 1, ?, ?, ?)`,
        record.id,
        record.title,
        record.subtitle,
        record.templateId,
        record.facilitatorTokenHash,
        record.facilitatorTokenEncrypted,
        record.tokenSalt,
        record.isBlurred ? 1 : 0,
        record.voteLimit,
        record.maxVotesPerCard,
        record.retentionDays,
        record.createdAt,
        record.createdAt,
      );

      for (const column of record.columns) {
        this.sql.run(
          `INSERT INTO columns (id, board_id, title, accent, position, is_action_column)
           VALUES (?, ?, ?, ?, ?, ?)`,
          column.id,
          record.id,
          column.title,
          column.accent,
          column.position,
          column.isActionColumn ? 1 : 0,
        );
      }

      const snapshot = this.getBoardSnapshot(record.id, record.createdAt);
      if (!snapshot) {
        throw new Error(`Failed to reload newly created Board ${record.id}`);
      }
      return snapshot;
    });
  }

  getBoardVersion(boardId: string): number | null {
    if (!this.hasBoardsTable()) return null;
    return this.sql.get<{ version: number }>('SELECT version FROM boards WHERE id = ?', boardId)?.version ?? null;
  }

  getBoardSnapshot(
    boardId: string,
    now: number = Date.now(),
  ): RawBoardSnapshot | null {
    if (!this.hasBoardsTable()) {
      return null;
    }

    const boardRow = this.sql.get<BoardDbRow>(
      'SELECT * FROM boards WHERE id = ?',
      boardId,
    );
    if (!boardRow) {
      return null;
    }

    const board = mapBoardRow(boardRow);
    if (isBoardExpired(board, now)) {
      this.deleteBoard(boardId);
      return null;
    }

    const columns = this.sql
      .all<ColumnDbRow>(
        'SELECT * FROM columns WHERE board_id = ? ORDER BY position ASC',
        boardId,
      )
      .map(mapColumnRow);

    const groups = this.sql
      .all<CardGroupDbRow>(
        'SELECT * FROM card_groups WHERE board_id = ? ORDER BY created_at ASC, rowid ASC',
        boardId,
      )
      .map(mapGroupRow);

    const cards = this.sql
      .all<CardDbRow>(
        'SELECT * FROM cards WHERE board_id = ? ORDER BY created_at DESC, rowid ASC',
        boardId,
      )
      .map(mapCardRow);

    const votes = this.sql
      .all<VoteDbRow>('SELECT * FROM votes WHERE board_id = ?', boardId)
      .map(mapVoteRow);

    const reactions = this.sql
      .all<ReactionDbRow>('SELECT * FROM reactions WHERE board_id = ?', boardId)
      .map(mapReactionRow);

    const comments = this.sql
      .all<CommentDbRow>(
        'SELECT * FROM comments WHERE board_id = ? ORDER BY created_at ASC, rowid ASC',
        boardId,
      )
      .map(mapCommentRow);

    return {
      board,
      columns,
      groups,
      cards,
      votes,
      reactions,
      comments,
    };
  }

  deleteBoard(boardId: string): boolean {
    if (!this.hasBoardsTable()) return false;
    this.sql.exec('PRAGMA foreign_keys = ON');
    const { changes } = this.sql.run('DELETE FROM boards WHERE id = ?', boardId);
    return changes > 0;
  }

  updateFacilitatorTokenEncryption(
    boardId: string,
    encryptedToken: string,
  ): void {
    if (!this.hasBoardsTable()) return;
    this.sql.run(
      'UPDATE boards SET facilitator_token_encrypted = ? WHERE id = ?',
      encryptedToken,
      boardId,
    );
  }

  purgeExpiredBoards(now: number = Date.now()): number {
    if (!this.hasBoardsTable()) return 0;
    this.sql.exec('PRAGMA foreign_keys = ON');
    const { changes } = this.sql.run(
      `DELETE FROM boards WHERE (last_active_at + retention_days * ?) <= ?`,
      MS_PER_DAY,
      now,
    );
    return changes;
  }

  getFacilitatorCapability(
    boardId: string,
    now: number = Date.now(),
  ): FacilitatorCapability | null {
    if (!this.hasBoardsTable()) return null;
    const row = this.sql.get<Pick<
      BoardDbRow,
      'facilitator_token_hash' | 'facilitator_token_encrypted' | 'last_active_at' | 'retention_days'
    >>(
      `SELECT facilitator_token_hash, facilitator_token_encrypted, last_active_at, retention_days
       FROM boards WHERE id = ?`,
      boardId,
    );
    if (!row) {
      return null;
    }
    if (
      isBoardExpired(
        { lastActiveAt: row.last_active_at, retentionDays: row.retention_days },
        now,
      )
    ) {
      this.deleteBoard(boardId);
      return null;
    }
    return {
      facilitatorTokenHash: row.facilitator_token_hash,
      facilitatorTokenEncrypted: row.facilitator_token_encrypted,
    };
  }

  getBoardTokenSalt(boardId: string, now: number = Date.now()): string | null {
    if (!this.hasBoardsTable()) return null;
    const row = this.sql.get<{
      token_salt: string;
      last_active_at: number;
      retention_days: number;
    }>(
      'SELECT token_salt, last_active_at, retention_days FROM boards WHERE id = ?',
      boardId,
    );
    if (!row) {
      return null;
    }
    if (
      isBoardExpired(
        { lastActiveAt: row.last_active_at, retentionDays: row.retention_days },
        now,
      )
    ) {
      this.deleteBoard(boardId);
      return null;
    }
    return row.token_salt;
  }

  private maybeDissolveSmallGroup(
    boardId: string,
    groupId: string,
    version: number,
    rawEvents: RawBoardMutationEvent[],
  ): void {
    const row = this.sql.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM cards WHERE board_id = ? AND group_id = ?',
      boardId,
      groupId,
    );
    if ((row?.count ?? 0) < 2) {
      this.dissolveGroup(boardId, groupId, version, rawEvents);
    } else {
      rawEvents.push({ type: 'group:upserted', version, groupId });
    }
  }

  private dissolveGroup(
    boardId: string,
    groupId: string,
    version: number,
    rawEvents: RawBoardMutationEvent[],
  ): void {
    this.sql.run(
      'UPDATE cards SET group_id = NULL WHERE board_id = ? AND group_id = ?',
      boardId,
      groupId,
    );
    this.sql.run(
      `DELETE FROM votes WHERE board_id = ? AND target_type = 'group' AND target_id = ?`,
      boardId,
      groupId,
    );
    this.sql.run(
      'DELETE FROM card_groups WHERE board_id = ? AND id = ?',
      boardId,
      groupId,
    );
    rawEvents.push({ type: 'group:dissolved', version, groupId });
  }

  private getGroupPolicyFacts(
    boardId: string,
    groupId: string,
    actor: BoardMutationActor,
  ): CardGroupPolicyFacts {
    const otherAuthorCard = this.sql.get<{ id: string }>(
      'SELECT id FROM cards WHERE board_id = ? AND group_id = ? AND author_token_hash != ? LIMIT 1',
      boardId,
      groupId,
      actor.participantHash,
    );
    return { allCardsAreMine: !otherAuthorCard };
  }

  mutateBoard(
    boardId: string,
    actor: BoardMutationActor,
    command: BoardMutationCommand,
    now: number = Date.now(),
  ): BoardMutationOutcome {
    if (!this.hasBoardsTable()) {
      return {
        ok: false,
        code: 'BOARD_NOT_FOUND',
        message: 'Board not found or expired.',
      };
    }
    this.sql.exec('PRAGMA foreign_keys = ON');

    return this.sql.transaction((): BoardMutationOutcome => {
      const boardRow = this.sql.get<BoardDbRow>(
        'SELECT * FROM boards WHERE id = ?',
        boardId,
      );
      if (!boardRow) {
        return {
          ok: false,
          code: 'BOARD_NOT_FOUND',
          message: 'Board not found or expired.',
        };
      }

      const board = mapBoardRow(boardRow);
      if (isBoardExpired(board, now)) {
        this.deleteBoard(boardId);
        return {
          ok: false,
          code: 'BOARD_NOT_FOUND',
          message: 'Board not found or expired.',
        };
      }

      const policyBoard: BoardPolicyContext = {
        isFacilitator: actor.isFacilitator,
        isLocked: board.isLocked,
        isPrivateMode: board.isBlurred,
        allowParticipantGroup: board.allowParticipantGroup,
      };

      const accessFailure = authorizeCommandAccess(policyBoard, command);
      if (accessFailure) {
        return accessFailure;
      }

      const nextVersion = board.version + 1;
      const rawEvents: RawBoardMutationEvent[] = [];

      const finalize = (
        version: number,
        lastActiveAt: number,
      ): BoardMutationOutcome => {
        const snapshot = this.getBoardSnapshot(boardId, now);
        if (!snapshot) {
          return {
            ok: false,
            code: 'BOARD_NOT_FOUND',
            message: 'Board not found or expired.',
          };
        }
        return {
          ok: true,
          version,
          lastActiveAt,
          retentionDays: snapshot.board.retentionDays,
          snapshot,
          rawEvents,
        };
      };

      const bumpBoard = (): void => {
        this.sql.run(
          'UPDATE boards SET version = ?, last_active_at = ? WHERE id = ?',
          nextVersion,
          now,
          boardId,
        );
      };

      switch (command.type) {
        case 'voting:configure':
        case 'voting:reset': {
          if (command.type === 'voting:configure') {
            configureVoting(this.sql, board, command);
          } else {
            this.sql.run('DELETE FROM votes WHERE board_id = ?', boardId);
          }
          bumpBoard();
          rawEvents.push({ type: 'board:snapshot', version: nextVersion });
          return finalize(nextVersion, now);
        }
        case 'vote:change': {
          const result = changeVote(this.sql, board, actor, command, now);
          if (!result.ok) return result;
          bumpBoard();
          rawEvents.push({
            type: 'vote:updated',
            version: nextVersion,
            targetType: command.targetType,
            targetId: command.targetId,
          });
          if (result.decrementedMemberCardId) {
            rawEvents.push({
              type: 'vote:updated',
              version: nextVersion,
              targetType: 'card',
              targetId: result.decrementedMemberCardId,
            });
          }
          return finalize(nextVersion, now);
        }

        case 'facilitator:rotate': {
          this.sql.run(
            `UPDATE boards SET facilitator_token_hash = ?, facilitator_token_encrypted = ?,
                               version = ?, last_active_at = ? WHERE id = ?`,
            command.capability.facilitatorTokenHash,
            command.capability.facilitatorTokenEncrypted,
            nextVersion,
            now,
            boardId,
          );
          rawEvents.push({ type: 'board:updated', version: nextVersion, patch: {} });
          return finalize(nextVersion, now);
        }

        case 'timer:update': {
          const timer = applyTimerChange(board, command.change, now);
          if (!timer) return finalize(board.version, board.lastActiveAt);

          this.sql.run(
            `UPDATE boards SET timer_ends_at = ?, timer_remaining_ms = ?, timer_duration_ms = ?,
                               version = ?, last_active_at = ? WHERE id = ?`,
            timer.endsAt,
            timer.remainingMs,
            timer.durationMs,
            nextVersion,
            now,
            boardId,
          );
          rawEvents.push({ type: 'timer:updated', version: nextVersion, serverNow: now });
          return finalize(nextVersion, now);
        }

        case 'board:rename': {
          const patch: Partial<BoardSettingsDTO> = { title: command.title };
          if (command.subtitle !== undefined) {
            patch.subtitle = command.subtitle;
            this.sql.run(
              'UPDATE boards SET title = ?, subtitle = ?, version = ?, last_active_at = ? WHERE id = ?',
              command.title,
              command.subtitle,
              nextVersion,
              now,
              boardId,
            );
          } else {
            this.sql.run(
              'UPDATE boards SET title = ?, version = ?, last_active_at = ? WHERE id = ?',
              command.title,
              nextVersion,
              now,
              boardId,
            );
          }
          rawEvents.push({
            type: 'board:updated',
            version: nextVersion,
            patch,
          });
          return finalize(nextVersion, now);
        }

        case 'board:set-private-mode': {
          if (command.isBlurred === board.isBlurred) {
            rawEvents.push({ type: 'board:snapshot', version: board.version });
            return finalize(board.version, board.lastActiveAt);
          }

          this.sql.run(
            'UPDATE boards SET is_blurred = ?, version = ?, last_active_at = ? WHERE id = ?',
            command.isBlurred ? 1 : 0,
            nextVersion,
            now,
            boardId,
          );
          rawEvents.push({ type: 'board:snapshot', version: nextVersion });
          return finalize(nextVersion, now);
        }

        case 'board:set-lock': {
          if (command.isLocked === board.isLocked) {
            return finalize(board.version, board.lastActiveAt);
          }

          this.sql.run(
            'UPDATE boards SET is_locked = ?, version = ?, last_active_at = ? WHERE id = ?',
            command.isLocked ? 1 : 0,
            nextVersion,
            now,
            boardId,
          );
          rawEvents.push({
            type: 'board:updated',
            version: nextVersion,
            patch: { isLocked: command.isLocked },
          });
          return finalize(nextVersion, now);
        }

        case 'card:create': {
          const column = this.sql.get<ColumnDbRow>(
            'SELECT * FROM columns WHERE board_id = ? AND id = ?',
            boardId,
            command.columnId,
          );
          if (!column) {
            return {
              ok: false,
              code: 'NOT_FOUND',
              message: 'Column not found.',
            };
          }

          const cardCountRow = this.sql.get<{ count: number }>(
            'SELECT COUNT(*) AS count FROM cards WHERE board_id = ?',
            boardId,
          );
          if ((cardCountRow?.count ?? 0) >= MAX_CARDS_PER_BOARD) {
            return {
              ok: false,
              code: 'LIMIT_EXCEEDED',
              message: `This Board has reached the maximum of ${MAX_CARDS_PER_BOARD} Cards.`,
            };
          }

          if (
            command.content.length === 0 ||
            command.content.length > MAX_CARD_CONTENT_LENGTH
          ) {
            return {
              ok: false,
              code: 'VALIDATION_ERROR',
              message: `Card text must be between 1 and ${MAX_CARD_CONTENT_LENGTH} characters.`,
            };
          }

          this.sql.run(
            `INSERT INTO cards (
              id, board_id, column_id, group_id, content,
              author_token_hash, is_action_item, action_done, action_owner,
              created_at, updated_at
            ) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, '', ?, ?)`,
            command.id,
            boardId,
            command.columnId,
            command.content,
            actor.participantHash,
            column.is_action_column === 1 ? 1 : 0,
            now,
            now,
          );
          bumpBoard();
          rawEvents.push({
            type: 'card:upserted',
            version: nextVersion,
            cardId: command.id,
          });
          return finalize(nextVersion, now);
        }

        case 'card:update': {
          const card = this.sql.get<CardDbRow>(
            'SELECT * FROM cards WHERE board_id = ? AND id = ?',
            boardId,
            command.cardId,
          );
          if (!card) {
            return {
              ok: false,
              code: 'NOT_FOUND',
              message: 'Card not found.',
            };
          }

          const decision = decideCardAction(policyBoard, 'card:update', {
            isMine: card.author_token_hash === actor.participantHash,
          });
          if (!decision.allowed) {
            return mapCardPolicyDenial(decision.reason, 'edit');
          }

          if (
            command.content.length === 0 ||
            command.content.length > MAX_CARD_CONTENT_LENGTH
          ) {
            return {
              ok: false,
              code: 'VALIDATION_ERROR',
              message: `Card text must be between 1 and ${MAX_CARD_CONTENT_LENGTH} characters.`,
            };
          }

          this.sql.run(
            'UPDATE cards SET content = ?, updated_at = ? WHERE board_id = ? AND id = ?',
            command.content,
            now,
            boardId,
            command.cardId,
          );
          bumpBoard();
          rawEvents.push({
            type: 'card:upserted',
            version: nextVersion,
            cardId: command.cardId,
          });
          return finalize(nextVersion, now);
        }

        case 'card:move': {
          const card = this.sql.get<CardDbRow>(
            'SELECT * FROM cards WHERE board_id = ? AND id = ?',
            boardId,
            command.cardId,
          );
          if (!card) {
            return {
              ok: false,
              code: 'NOT_FOUND',
              message: 'Card not found.',
            };
          }

          const decision = decideCardAction(policyBoard, 'card:move', {
            isMine: card.author_token_hash === actor.participantHash,
          });
          if (!decision.allowed) {
            return mapCardPolicyDenial(decision.reason, 'move');
          }

          const targetColumn = this.sql.get<ColumnDbRow>(
            'SELECT * FROM columns WHERE board_id = ? AND id = ?',
            boardId,
            command.targetColumnId,
          );
          if (!targetColumn) {
            return {
              ok: false,
              code: 'NOT_FOUND',
              message: 'Target Column not found.',
            };
          }

          if (card.column_id === command.targetColumnId) {
            rawEvents.push({
              type: 'card:upserted',
              version: board.version,
              cardId: card.id,
            });
            return finalize(board.version, board.lastActiveAt);
          }

          const previousGroupId = card.group_id;
          this.sql.run(
            'UPDATE cards SET column_id = ?, group_id = NULL, updated_at = ? WHERE board_id = ? AND id = ?',
            command.targetColumnId,
            now,
            boardId,
            command.cardId,
          );
          if (previousGroupId) {
            this.maybeDissolveSmallGroup(
              boardId,
              previousGroupId,
              nextVersion,
              rawEvents,
            );
          }
          bumpBoard();
          rawEvents.push({
            type: 'card:upserted',
            version: nextVersion,
            cardId: command.cardId,
          });
          return finalize(nextVersion, now);
        }

        case 'card:delete': {
          const card = this.sql.get<CardDbRow>(
            'SELECT * FROM cards WHERE board_id = ? AND id = ?',
            boardId,
            command.cardId,
          );
          if (!card) {
            return {
              ok: false,
              code: 'NOT_FOUND',
              message: 'Card not found.',
            };
          }

          const decision = decideCardAction(policyBoard, 'card:delete', {
            isMine: card.author_token_hash === actor.participantHash,
          });
          if (!decision.allowed) {
            return mapCardPolicyDenial(decision.reason, 'delete');
          }

          const previousGroupId = card.group_id;
          this.sql.run(
            `DELETE FROM votes WHERE board_id = ? AND target_type = 'card' AND target_id = ?`,
            boardId,
            command.cardId,
          );
          this.sql.run(
            'DELETE FROM cards WHERE board_id = ? AND id = ?',
            boardId,
            command.cardId,
          );
          if (previousGroupId) {
            this.maybeDissolveSmallGroup(
              boardId,
              previousGroupId,
              nextVersion,
              rawEvents,
            );
          }
          bumpBoard();
          rawEvents.push({
            type: 'card:deleted',
            version: nextVersion,
            cardId: command.cardId,
          });
          return finalize(nextVersion, now);
        }

        case 'group:merge': {
          const source = this.sql.get<CardDbRow>(
            'SELECT * FROM cards WHERE board_id = ? AND id = ?',
            boardId,
            command.cardId,
          );
          if (!source) {
            return { ok: false, code: 'NOT_FOUND', message: 'Card not found.' };
          }
          const sourcePrivacy = decideCardAction(policyBoard, 'card:interact', {
            isMine: source.author_token_hash === actor.participantHash,
          });
          if (!sourcePrivacy.allowed) {
            return mapGroupPolicyDenial(sourcePrivacy.reason);
          }

          let targetCard: CardDbRow | null = null;
          let group: CardGroupDbRow | null = null;
          let mergeTarget: Extract<GroupPolicyAction, { type: 'group:merge' }>['target'];
          if (command.targetType === 'card') {
            const foundCard = this.sql.get<CardDbRow>(
              'SELECT * FROM cards WHERE board_id = ? AND id = ?',
              boardId,
              command.targetId,
            );
            if (!foundCard) {
              return { ok: false, code: 'NOT_FOUND', message: 'Target Card not found.' };
            }
            targetCard = foundCard;
            let targetGroupFacts: MergeGroupFacts | null = null;
            if (foundCard.group_id !== null) {
              const foundGroup = this.sql.get<CardGroupDbRow>(
                'SELECT * FROM card_groups WHERE board_id = ? AND id = ?',
                boardId,
                foundCard.group_id,
              );
              if (!foundGroup) {
                return { ok: false, code: 'NOT_FOUND', message: 'Card Group not found.' };
              }
              group = foundGroup;
              targetGroupFacts = {
                id: foundGroup.id,
                columnId: foundGroup.column_id,
                ...this.getGroupPolicyFacts(boardId, foundGroup.id, actor),
              };
            }
            mergeTarget = {
              kind: 'card',
              card: {
                id: foundCard.id,
                columnId: foundCard.column_id,
                groupId: foundCard.group_id,
                isMine: foundCard.author_token_hash === actor.participantHash,
              },
              group: targetGroupFacts,
            };
          } else {
            const foundGroup = this.sql.get<CardGroupDbRow>(
              'SELECT * FROM card_groups WHERE board_id = ? AND id = ?',
              boardId,
              command.targetId,
            );
            if (!foundGroup) {
              return { ok: false, code: 'NOT_FOUND', message: 'Card Group not found.' };
            }
            group = foundGroup;
            mergeTarget = {
              kind: 'group',
              group: {
                id: foundGroup.id,
                columnId: foundGroup.column_id,
                ...this.getGroupPolicyFacts(boardId, foundGroup.id, actor),
              },
            };
          }

          const mergeDecision = decideGroupAction(policyBoard, {
            type: 'group:merge',
            sourceCard: {
              id: source.id,
              columnId: source.column_id,
              groupId: source.group_id,
              isMine: source.author_token_hash === actor.participantHash,
            },
            target: mergeTarget,
          });
          if (!mergeDecision.allowed) {
            return mapGroupPolicyDenial(mergeDecision.reason);
          }

          const targetGroupId = group?.id ?? command.groupId;

          if (!group && targetCard) {
            const title = targetCard.content.trim().slice(0, MAX_GROUP_TITLE_LENGTH);
            this.sql.run(
              `INSERT INTO card_groups (id, board_id, column_id, title, created_at)
               VALUES (?, ?, ?, ?, ?)`,
              targetGroupId,
              boardId,
              source.column_id,
              title,
              now,
            );
          }

          const previousGroupId = source.group_id;
          const cardIdsToAssign =
            targetCard !== null && group === null
              ? [source.id, targetCard.id]
              : [source.id];
          for (const cardId of cardIdsToAssign) {
            this.sql.run(
              'UPDATE cards SET group_id = ?, updated_at = ? WHERE board_id = ? AND id = ?',
              targetGroupId,
              now,
              boardId,
              cardId,
            );
          }
          if (previousGroupId) {
            this.maybeDissolveSmallGroup(
              boardId,
              previousGroupId,
              nextVersion,
              rawEvents,
            );
          }

          bumpBoard();
          rawEvents.push({
            type: 'group:upserted',
            version: nextVersion,
            groupId: targetGroupId,
          });
          rawEvents.push({
            type: 'card:upserted',
            version: nextVersion,
            cardId: source.id,
          });
          if (targetCard) {
            rawEvents.push({
              type: 'card:upserted',
              version: nextVersion,
              cardId: targetCard.id,
            });
          }
          return finalize(nextVersion, now);
        }

        case 'group:rename': {
          const group = this.sql.get<CardGroupDbRow>(
            'SELECT * FROM card_groups WHERE board_id = ? AND id = ?',
            boardId,
            command.groupId,
          );
          if (!group) {
            return { ok: false, code: 'NOT_FOUND', message: 'Card Group not found.' };
          }
          const decision = decideGroupAction(policyBoard, {
            type: 'group:rename',
            group: this.getGroupPolicyFacts(boardId, group.id, actor),
          });
          if (!decision.allowed) {
            return mapGroupPolicyDenial(decision.reason);
          }

          if (
            command.title.length === 0 ||
            command.title.length > MAX_GROUP_TITLE_LENGTH
          ) {
            return {
              ok: false,
              code: 'VALIDATION_ERROR',
              message: `Card Group title must be between 1 and ${MAX_GROUP_TITLE_LENGTH} characters.`,
            };
          }

          this.sql.run(
            'UPDATE card_groups SET title = ? WHERE board_id = ? AND id = ?',
            command.title,
            boardId,
            group.id,
          );
          bumpBoard();
          rawEvents.push({
            type: 'group:upserted',
            version: nextVersion,
            groupId: group.id,
          });
          return finalize(nextVersion, now);
        }

        case 'group:ungroup': {
          const card = this.sql.get<CardDbRow>(
            'SELECT * FROM cards WHERE board_id = ? AND id = ?',
            boardId,
            command.cardId,
          );
          if (!card) {
            return { ok: false, code: 'NOT_FOUND', message: 'Card not found.' };
          }

          const previousGroupId = card.group_id;
          const decision = decideGroupAction(policyBoard, {
            type: 'group:ungroup',
            card: { isMine: card.author_token_hash === actor.participantHash },
            group:
              previousGroupId !== null
                ? this.getGroupPolicyFacts(boardId, previousGroupId, actor)
                : null,
          });
          if (!decision.allowed) {
            return mapGroupPolicyDenial(decision.reason);
          }
          if (!previousGroupId) {
            return mapGroupPolicyDenial('card-not-in-group');
          }

          this.sql.run(
            'UPDATE cards SET group_id = NULL, updated_at = ? WHERE board_id = ? AND id = ?',
            now,
            boardId,
            card.id,
          );
          this.maybeDissolveSmallGroup(
            boardId,
            previousGroupId,
            nextVersion,
            rawEvents,
          );
          bumpBoard();
          rawEvents.push({
            type: 'card:upserted',
            version: nextVersion,
            cardId: card.id,
          });
          return finalize(nextVersion, now);
        }

        case 'group:dissolve': {
          const group = this.sql.get<CardGroupDbRow>(
            'SELECT * FROM card_groups WHERE board_id = ? AND id = ?',
            boardId,
            command.groupId,
          );
          if (!group) {
            return { ok: false, code: 'NOT_FOUND', message: 'Card Group not found.' };
          }
          const decision = decideGroupAction(policyBoard, {
            type: 'group:dissolve',
            group: this.getGroupPolicyFacts(boardId, group.id, actor),
          });
          if (!decision.allowed) {
            return mapGroupPolicyDenial(decision.reason);
          }

          this.dissolveGroup(boardId, group.id, nextVersion, rawEvents);
          bumpBoard();
          return finalize(nextVersion, now);
        }

        case 'group:move': {
          const group = this.sql.get<CardGroupDbRow>(
            'SELECT * FROM card_groups WHERE board_id = ? AND id = ?',
            boardId,
            command.groupId,
          );
          if (!group) {
            return { ok: false, code: 'NOT_FOUND', message: 'Card Group not found.' };
          }
          const decision = decideGroupAction(policyBoard, {
            type: 'group:move',
            group: this.getGroupPolicyFacts(boardId, group.id, actor),
          });
          if (!decision.allowed) {
            return mapGroupPolicyDenial(decision.reason);
          }

          const targetColumn = this.sql.get<ColumnDbRow>(
            'SELECT * FROM columns WHERE board_id = ? AND id = ?',
            boardId,
            command.targetColumnId,
          );
          if (!targetColumn) {
            return {
              ok: false,
              code: 'NOT_FOUND',
              message: 'Target Column not found.',
            };
          }

          if (group.column_id === command.targetColumnId) {
            rawEvents.push({
              type: 'group:upserted',
              version: board.version,
              groupId: group.id,
            });
            return finalize(board.version, board.lastActiveAt);
          }

          const memberIds = this.sql
            .all<{ id: string }>(
              'SELECT id FROM cards WHERE board_id = ? AND group_id = ?',
              boardId,
              group.id,
            )
            .map((member) => member.id);

          this.sql.run(
            'UPDATE card_groups SET column_id = ? WHERE board_id = ? AND id = ?',
            command.targetColumnId,
            boardId,
            group.id,
          );
          this.sql.run(
            'UPDATE cards SET column_id = ?, updated_at = ? WHERE board_id = ? AND group_id = ?',
            command.targetColumnId,
            now,
            boardId,
            group.id,
          );
          bumpBoard();
          rawEvents.push({
            type: 'group:upserted',
            version: nextVersion,
            groupId: group.id,
          });
          for (const memberId of memberIds) {
            rawEvents.push({
              type: 'card:upserted',
              version: nextVersion,
              cardId: memberId,
            });
          }
          return finalize(nextVersion, now);
        }

        case 'card:set-action': {
          const card = this.sql.get<CardDbRow>(
            'SELECT * FROM cards WHERE board_id = ? AND id = ?',
            boardId,
            command.cardId,
          );
          if (!card) {
            return {
              ok: false,
              code: 'NOT_FOUND',
              message: 'Card not found.',
            };
          }

          const decision = decideActionItemAction(
            policyBoard,
            {
              isMine: card.author_token_hash === actor.participantHash,
              isActionItem: card.is_action_item === 1,
            },
            {
              isActionItem: command.isActionItem,
              actionDone: command.actionDone,
              actionOwner: command.actionOwner,
            },
          );
          if (!decision.allowed) {
            return mapCardPolicyDenial(decision.reason);
          }

          const isActionItem =
            command.isActionItem ?? card.is_action_item === 1;
          const actionOwner = command.actionOwner ?? card.action_owner;
          if (actionOwner.length > MAX_ACTION_OWNER_LENGTH) {
            return {
              ok: false,
              code: 'VALIDATION_ERROR',
              message: `Action owner must be ${MAX_ACTION_OWNER_LENGTH} characters or fewer.`,
            };
          }

          this.sql.run(
            `UPDATE cards SET is_action_item = ?, action_done = ?, action_owner = ?, updated_at = ?
             WHERE board_id = ? AND id = ?`,
            isActionItem ? 1 : 0,
            isActionItem && (command.actionDone ?? card.action_done === 1) ? 1 : 0,
            isActionItem ? actionOwner : '',
            now,
            boardId,
            command.cardId,
          );
          bumpBoard();
          rawEvents.push({
            type: 'card:upserted',
            version: nextVersion,
            cardId: command.cardId,
          });
          return finalize(nextVersion, now);
        }
        case 'reaction:toggle':
        case 'comment:create':
        case 'comment:delete': {
          const card = this.sql.get<CardDbRow>(
            'SELECT * FROM cards WHERE board_id = ? AND id = ?',
            boardId,
            command.cardId,
          );
          if (!card) return { ok: false, code: 'NOT_FOUND', message: 'Card not found.' };
          const cardFacts = {
            isMine: card.author_token_hash === actor.participantHash,
          };
          const interactDecision = decideCardAction(
            policyBoard,
            'card:interact',
            cardFacts,
          );
          if (!interactDecision.allowed) {
            return mapCardPolicyDenial(interactDecision.reason);
          }

          if (command.type === 'reaction:toggle') {
            const { changes } = this.sql.run(
              `DELETE FROM reactions
               WHERE board_id = ? AND card_id = ? AND emoji = ? AND reactor_token_hash = ?`,
              boardId,
              command.cardId,
              command.emoji,
              actor.participantHash,
            );
            if (changes === 0) {
              this.sql.run(
                `INSERT INTO reactions (board_id, card_id, emoji, reactor_token_hash, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
                boardId,
                command.cardId,
                command.emoji,
                actor.participantHash,
                now,
              );
            }
            rawEvents.push({
              type: 'reaction:updated',
              version: nextVersion,
              cardId: command.cardId,
            });
          } else if (command.type === 'comment:create') {
            if (command.content.length === 0 || command.content.length > MAX_COMMENT_LENGTH) {
              return {
                ok: false,
                code: 'VALIDATION_ERROR',
                message: `Comment must be between 1 and ${MAX_COMMENT_LENGTH} characters.`,
              };
            }
            const count = this.sql.get<{ count: number }>(
              'SELECT COUNT(*) AS count FROM comments WHERE board_id = ? AND card_id = ?',
              boardId,
              command.cardId,
            );
            if ((count?.count ?? 0) >= MAX_COMMENTS_PER_CARD) {
              return {
                ok: false,
                code: 'LIMIT_EXCEEDED',
                message: `This Card has reached the maximum of ${MAX_COMMENTS_PER_CARD} comments.`,
              };
            }
            this.sql.run(
              `INSERT INTO comments (id, board_id, card_id, content, author_token_hash, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              command.id,
              boardId,
              command.cardId,
              command.content,
              actor.participantHash,
              now,
            );
            rawEvents.push({
              type: 'comment:created',
              version: nextVersion,
              cardId: command.cardId,
              commentId: command.id,
            });
          } else {
            const comment = this.sql.get<Pick<CommentDbRow, 'author_token_hash'>>(
              'SELECT author_token_hash FROM comments WHERE board_id = ? AND card_id = ? AND id = ?',
              boardId,
              command.cardId,
              command.commentId,
            );
            if (!comment) {
              return { ok: false, code: 'NOT_FOUND', message: 'Comment not found.' };
            }
            const commentDecision = decideCommentDelete(
              policyBoard,
              { isMine: comment.author_token_hash === actor.participantHash },
              { card: cardFacts, mode: 'authoritative' },
            );
            if (!commentDecision.allowed) {
              return mapCardPolicyDenial(commentDecision.reason);
            }
            this.sql.run(
              'DELETE FROM comments WHERE board_id = ? AND card_id = ? AND id = ?',
              boardId,
              command.cardId,
              command.commentId,
            );
            rawEvents.push({
              type: 'comment:deleted',
              version: nextVersion,
              cardId: command.cardId,
              commentId: command.commentId,
            });
          }
          bumpBoard();
          return finalize(nextVersion, now);
        }

        case 'column:add': {
          const countRow = this.sql.get<{ count: number }>(
            'SELECT COUNT(*) AS count FROM columns WHERE board_id = ?',
            boardId,
          );
          const currentCount = countRow?.count ?? 0;
          const decision = decideColumnAction(policyBoard, {
            type: 'column:add',
            columnCount: currentCount,
          });
          if (!decision.allowed) {
            return mapColumnPolicyDenial(decision.reason, 'column:add');
          }

          this.sql.run(
            `INSERT INTO columns (id, board_id, title, accent, position, is_action_column)
             VALUES (?, ?, ?, ?, ?, ?)`,
            command.id,
            boardId,
            command.title,
            command.accent,
            currentCount,
            command.isActionColumn ? 1 : 0,
          );
          bumpBoard();
          rawEvents.push({
            type: 'column:upserted',
            version: nextVersion,
            columnId: command.id,
          });
          return finalize(nextVersion, now);
        }

        case 'column:update': {
          const column = this.sql.get<ColumnDbRow>(
            'SELECT * FROM columns WHERE board_id = ? AND id = ?',
            boardId,
            command.columnId,
          );
          if (!column) {
            return {
              ok: false,
              code: 'NOT_FOUND',
              message: 'Column not found.',
            };
          }

          const nextTitle = command.title ?? column.title;
          const nextAccent = command.accent ?? column.accent;
          const nextIsAction =
            command.isActionColumn !== undefined
              ? command.isActionColumn
                ? 1
                : 0
              : column.is_action_column;

          this.sql.run(
            'UPDATE columns SET title = ?, accent = ?, is_action_column = ? WHERE board_id = ? AND id = ?',
            nextTitle,
            nextAccent,
            nextIsAction,
            boardId,
            command.columnId,
          );
          bumpBoard();
          rawEvents.push({
            type: 'column:upserted',
            version: nextVersion,
            columnId: command.columnId,
          });
          return finalize(nextVersion, now);
        }

        case 'column:reorder': {
          const existingColumns = this.sql.all<{ id: string }>(
            'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC',
            boardId,
          );
          const existingIds = new Set(existingColumns.map((c) => c.id));
          const providedUnique = new Set(command.columnIds);

          if (
            command.columnIds.length !== existingIds.size ||
            providedUnique.size !== existingIds.size ||
            command.columnIds.some((id) => !existingIds.has(id))
          ) {
            return {
              ok: false,
              code: 'VALIDATION_ERROR',
              message: 'Column order must include every Column on the Board exactly once.',
            };
          }

          for (let i = 0; i < command.columnIds.length; i += 1) {
            this.sql.run(
              'UPDATE columns SET position = ? WHERE board_id = ? AND id = ?',
              i,
              boardId,
              command.columnIds[i],
            );
          }
          bumpBoard();
          rawEvents.push({
            type: 'columns:reordered',
            version: nextVersion,
            columnIds: [...command.columnIds],
          });
          return finalize(nextVersion, now);
        }

        case 'column:delete': {
          const existingColumns = this.sql.all<{ id: string }>(
            'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC',
            boardId,
          );
          if (!existingColumns.some((c) => c.id === command.columnId)) {
            return {
              ok: false,
              code: 'NOT_FOUND',
              message: 'Column not found.',
            };
          }

          const hasOtherParticipantCards =
            board.isBlurred &&
            existingColumns.length > 1 &&
            Boolean(
              this.sql.get<{ id: string }>(
                'SELECT id FROM cards WHERE board_id = ? AND column_id = ? AND author_token_hash != ? LIMIT 1',
                boardId,
                command.columnId,
                actor.participantHash,
              ),
            );
          const decision = decideColumnAction(policyBoard, {
            type: 'column:delete',
            columnCount: existingColumns.length,
            hasOtherParticipantCards,
          });
          if (!decision.allowed) {
            return mapColumnPolicyDenial(decision.reason, 'column:delete');
          }

          // Clean up polymorphic votes targeting cards or groups in this Column
          this.sql.run(
            `DELETE FROM votes
             WHERE board_id = ? AND target_type = 'card'
               AND target_id IN (SELECT id FROM cards WHERE board_id = ? AND column_id = ?)`,
            boardId,
            boardId,
            command.columnId,
          );
          this.sql.run(
            `DELETE FROM votes
             WHERE board_id = ? AND target_type = 'group'
               AND target_id IN (SELECT id FROM card_groups WHERE board_id = ? AND column_id = ?)`,
            boardId,
            boardId,
            command.columnId,
          );

          this.sql.run(
            'DELETE FROM columns WHERE board_id = ? AND id = ?',
            boardId,
            command.columnId,
          );

          const remaining = existingColumns.filter(
            (c) => c.id !== command.columnId,
          );
          for (let i = 0; i < remaining.length; i += 1) {
            this.sql.run(
              'UPDATE columns SET position = ? WHERE board_id = ? AND id = ?',
              i,
              boardId,
              remaining[i].id,
            );
          }

          bumpBoard();
          rawEvents.push({
            type: 'column:deleted',
            version: nextVersion,
            columnId: command.columnId,
          });
          return finalize(nextVersion, now);
        }
      }
    });
  }
}
