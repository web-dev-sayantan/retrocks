import 'server-only';

import type { BoardTemplateId, ColumnAccent } from '../../lib/board-types';
import type {
  CreateBoardRecord,
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

  getBoardSnapshot(
    boardId: string,
    now: number = Date.now(),
  ): RawBoardSnapshot | null {
    this.ensureSchema();

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
        'SELECT * FROM card_groups WHERE board_id = ? ORDER BY created_at ASC',
        boardId,
      )
      .map(mapGroupRow);

    const cards = this.sql
      .all<CardDbRow>(
        'SELECT * FROM cards WHERE board_id = ? ORDER BY created_at DESC',
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
        'SELECT * FROM comments WHERE board_id = ? ORDER BY created_at ASC',
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
    this.ensureSchema();
    const { changes } = this.sql.run('DELETE FROM boards WHERE id = ?', boardId);
    return changes > 0;
  }

  touchActivity(boardId: string, now: number = Date.now()): RawBoardRow | null {
    this.ensureSchema();
    this.sql.run(
      'UPDATE boards SET last_active_at = ? WHERE id = ?',
      now,
      boardId,
    );
    const row = this.sql.get<BoardDbRow>(
      'SELECT * FROM boards WHERE id = ?',
      boardId,
    );
    return row ? mapBoardRow(row) : null;
  }

  updateFacilitatorTokenEncryption(
    boardId: string,
    encryptedToken: string,
  ): void {
    this.ensureSchema();
    this.sql.run(
      'UPDATE boards SET facilitator_token_encrypted = ? WHERE id = ?',
      encryptedToken,
      boardId,
    );
  }

  purgeExpiredBoards(now: number = Date.now()): number {
    this.ensureSchema();
    const { changes } = this.sql.run(
      `DELETE FROM boards WHERE (last_active_at + retention_days * ?) <= ?`,
      MS_PER_DAY,
      now,
    );
    return changes;
  }
}
