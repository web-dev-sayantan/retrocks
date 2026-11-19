import 'server-only';

import {
  MAX_CARDS_PER_BOARD,
  MAX_CARD_CONTENT_LENGTH,
  MAX_COLUMNS_PER_BOARD,
  type BoardSettingsDTO,
  type BoardTemplateId,
  type ColumnAccent,
} from '../../lib/board-types';
import { checkPrivateCardPermission } from '../domain/card-permissions';
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

  getBoardVersion(boardId: string): number | null {
    this.ensureSchema();
    return this.sql.get<{ version: number }>('SELECT version FROM boards WHERE id = ?', boardId)?.version ?? null;
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

  getFacilitatorCapability(
    boardId: string,
    now: number = Date.now(),
  ): FacilitatorCapability | null {
    this.ensureSchema();
    const row = this.sql.get<Pick<
      BoardDbRow,
      'facilitator_token_hash' | 'facilitator_token_encrypted'
    >>(
      `SELECT facilitator_token_hash, facilitator_token_encrypted
       FROM boards WHERE id = ? AND last_active_at + retention_days * ? > ?`,
      boardId,
      MS_PER_DAY,
      now,
    );
    return row
      ? {
          facilitatorTokenHash: row.facilitator_token_hash,
          facilitatorTokenEncrypted: row.facilitator_token_encrypted,
        }
      : null;
  }

  getBoardTokenSalt(boardId: string, now: number = Date.now()): string | null {
    this.ensureSchema();
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
  }

  private checkCardManagePermission(
    board: RawBoardRow,
    card: CardDbRow,
    actor: BoardMutationActor,
    verb: 'edit' | 'move' | 'delete',
  ): { ok: true } | { ok: false; code: 'FORBIDDEN'; message: string } {
    const privacy = checkPrivateCardPermission(board, actor, card.author_token_hash);
    if (!privacy.ok) return privacy;
    if (!actor.isFacilitator && card.author_token_hash !== actor.participantHash) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: `You can only ${verb} your own Cards.`,
      };
    }
    return { ok: true };
  }

  mutateBoard(
    boardId: string,
    actor: BoardMutationActor,
    command: BoardMutationCommand,
    now: number = Date.now(),
  ): BoardMutationOutcome {
    this.ensureSchema();

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

      if (board.isLocked && command.type !== 'facilitator:rotate') {
        return {
          ok: false,
          code: 'BOARD_LOCKED',
          message: 'This Board is Locked and cannot be edited.',
        };
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
          if (!actor.isFacilitator) {
            return { ok: false, code: 'FORBIDDEN', message: 'Only a Facilitator can change Voting settings or reset Votes.' };
          }
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
          return finalize(nextVersion, now);
        }

        case 'facilitator:rotate': {
          if (!actor.isFacilitator) {
            return {
              ok: false,
              code: 'FORBIDDEN',
              message: 'Only a Facilitator can rotate the Co-Facilitator Link.',
            };
          }

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

        case 'board:rename': {
          if (!actor.isFacilitator) {
            return {
              ok: false,
              code: 'FORBIDDEN',
              message: 'Only a Facilitator can rename the Board.',
            };
          }
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
          if (!actor.isFacilitator) {
            return {
              ok: false,
              code: 'FORBIDDEN',
              message: 'Only a Facilitator can change Private Mode.',
            };
          }

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

          const perm = this.checkCardManagePermission(
            board,
            card,
            actor,
            'edit',
          );
          if (!perm.ok) {
            return perm;
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

          const perm = this.checkCardManagePermission(
            board,
            card,
            actor,
            'move',
          );
          if (!perm.ok) {
            return perm;
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

          const perm = this.checkCardManagePermission(
            board,
            card,
            actor,
            'delete',
          );
          if (!perm.ok) {
            return perm;
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

        case 'column:add': {
          if (!actor.isFacilitator) {
            return {
              ok: false,
              code: 'FORBIDDEN',
              message: 'Only a Facilitator can add Columns.',
            };
          }

          const countRow = this.sql.get<{ count: number }>(
            'SELECT COUNT(*) AS count FROM columns WHERE board_id = ?',
            boardId,
          );
          const currentCount = countRow?.count ?? 0;
          if (currentCount >= MAX_COLUMNS_PER_BOARD) {
            return {
              ok: false,
              code: 'LIMIT_EXCEEDED',
              message: `A Board can have at most ${MAX_COLUMNS_PER_BOARD} Columns.`,
            };
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
          if (!actor.isFacilitator) {
            return {
              ok: false,
              code: 'FORBIDDEN',
              message: 'Only a Facilitator can edit Columns.',
            };
          }

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
          if (!actor.isFacilitator) {
            return {
              ok: false,
              code: 'FORBIDDEN',
              message: 'Only a Facilitator can reorder Columns.',
            };
          }

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
          if (!actor.isFacilitator) {
            return {
              ok: false,
              code: 'FORBIDDEN',
              message: 'Only a Facilitator can delete Columns.',
            };
          }

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
          if (existingColumns.length <= 1) {
            return {
              ok: false,
              code: 'VALIDATION_ERROR',
              message: 'A Board must have at least 1 Column.',
            };
          }

          if (board.isBlurred && this.sql.get<{ id: string }>(
            'SELECT id FROM cards WHERE board_id = ? AND column_id = ? AND author_token_hash != ? LIMIT 1',
            boardId,
            command.columnId,
            actor.participantHash,
          )) {
            return {
              ok: false,
              code: 'FORBIDDEN',
              message: 'Reveal All before deleting a Column with hidden Cards.',
            };
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
