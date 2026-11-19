import 'server-only';

import { checkPrivateCardPermission } from '../domain/card-permissions';
import type { BoardMutationActor, BoardMutationCommand, BoardMutationOutcome, RawBoardRow } from './raw-types';
import type { SqlRunner } from './sql-runner';

export function changeVote(
  sql: SqlRunner,
  board: RawBoardRow,
  actor: BoardMutationActor,
  command: Extract<BoardMutationCommand, { type: 'vote:change' }>,
  now: number,
): { ok: true } | Extract<BoardMutationOutcome, { ok: false }> {
  const { id: boardId } = board;
  const { participantHash } = actor;
  const { targetType, targetId, delta } = command;

  if (targetType === 'group') {
    return changeGroupVote(sql, board, actor, targetId, delta, now);
  }

  const card = sql.get<{ author_token_hash: string; group_id: string | null }>(
    'SELECT author_token_hash, group_id FROM cards WHERE board_id = ? AND id = ?',
    boardId,
    targetId,
  );
  if (!card) {
    return { ok: false, code: 'NOT_FOUND', message: 'Card not found.' };
  }
  const permission = checkPrivateCardPermission(board, actor, card.author_token_hash);
  if (!permission.ok) return permission;
  if (card.group_id !== null) {
    return { ok: false, code: 'FORBIDDEN', message: 'Vote on the Card Group instead.' };
  }

  const current = sql.get<{ count: number }>(
    'SELECT count FROM votes WHERE board_id = ? AND target_type = ? AND target_id = ? AND voter_token_hash = ?',
    boardId,
    targetType,
    targetId,
    participantHash,
  )?.count ?? 0;

  if (delta === 1) {
    if (board.maxVotesPerCard !== null && current >= board.maxVotesPerCard) {
      return { ok: false, code: 'LIMIT_EXCEEDED', message: 'You reached the Vote limit for this Card.' };
    }
    if (board.voteLimit !== null) {
      const cast = sql.get<{ total: number }>(
        'SELECT COALESCE(SUM(count), 0) AS total FROM votes WHERE board_id = ? AND voter_token_hash = ?',
        boardId,
        participantHash,
      )?.total ?? 0;
      if (cast >= board.voteLimit) {
        return { ok: false, code: 'LIMIT_EXCEEDED', message: 'You have no Votes left.' };
      }
    }
  } else if (current === 0) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'You have no Votes to remove from this Card.' };
  }

  const next = current + delta;
  if (next === 0) {
    sql.run(
      'DELETE FROM votes WHERE board_id = ? AND target_type = ? AND target_id = ? AND voter_token_hash = ?',
      boardId,
      targetType,
      targetId,
      participantHash,
    );
  } else {
    sql.run(
      `INSERT INTO votes (board_id, target_type, target_id, voter_token_hash, count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (target_type, target_id, voter_token_hash) DO UPDATE
       SET count = excluded.count, updated_at = excluded.updated_at`,
      boardId,
      targetType,
      targetId,
      participantHash,
      next,
      now,
    );
  }
  return { ok: true };
}

function changeGroupVote(
  sql: SqlRunner,
  board: RawBoardRow,
  actor: BoardMutationActor,
  groupId: string,
  delta: 1 | -1,
  now: number,
): { ok: true } | Extract<BoardMutationOutcome, { ok: false }> {
  const { id: boardId } = board;
  const { participantHash } = actor;

  const group = sql.get<{ id: string }>(
    'SELECT id FROM card_groups WHERE board_id = ? AND id = ?',
    boardId,
    groupId,
  );
  if (!group) {
    return { ok: false, code: 'NOT_FOUND', message: 'Card Group not found.' };
  }

  const members = sql.all<{ id: string; author_token_hash: string }>(
    `SELECT id, author_token_hash FROM cards
     WHERE board_id = ? AND group_id = ?
     ORDER BY created_at ASC, id ASC`,
    boardId,
    groupId,
  );
  if (members.length === 0) {
    return { ok: false, code: 'NOT_FOUND', message: 'Card Group not found.' };
  }
  for (const member of members) {
    const permission = checkPrivateCardPermission(board, actor, member.author_token_hash);
    if (!permission.ok) return permission;
  }

  const directVotes = sql.get<{ count: number }>(
    `SELECT count FROM votes
     WHERE board_id = ? AND target_type = 'group' AND target_id = ? AND voter_token_hash = ?`,
    boardId,
    groupId,
    participantHash,
  )?.count ?? 0;

  const memberVotes = sql.all<{
    target_id: string;
    count: number;
    updated_at: number;
  }>(
    `SELECT target_id, count, updated_at FROM votes
     WHERE board_id = ? AND target_type = 'card' AND voter_token_hash = ?
       AND target_id IN (SELECT id FROM cards WHERE board_id = ? AND group_id = ?)`,
    boardId,
    participantHash,
    boardId,
    groupId,
  );
  const combinedMine =
    directVotes + memberVotes.reduce((sum, vote) => sum + vote.count, 0);

  if (delta === 1) {
    if (board.maxVotesPerCard !== null && combinedMine >= board.maxVotesPerCard) {
      return {
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message: 'You reached the Vote limit for this Card Group.',
      };
    }
    if (board.voteLimit !== null) {
      const cast = sql.get<{ total: number }>(
        'SELECT COALESCE(SUM(count), 0) AS total FROM votes WHERE board_id = ? AND voter_token_hash = ?',
        boardId,
        participantHash,
      )?.total ?? 0;
      if (cast >= board.voteLimit) {
        return { ok: false, code: 'LIMIT_EXCEEDED', message: 'You have no Votes left.' };
      }
    }
    const next = directVotes + 1;
    sql.run(
      `INSERT INTO votes (board_id, target_type, target_id, voter_token_hash, count, updated_at)
       VALUES (?, 'group', ?, ?, ?, ?)
       ON CONFLICT (target_type, target_id, voter_token_hash) DO UPDATE
       SET count = excluded.count, updated_at = excluded.updated_at`,
      boardId,
      groupId,
      participantHash,
      next,
      now,
    );
    return { ok: true };
  }

  // Direct group Votes are removed first, then grandfathered member Card Votes
  // (most recently cast first).
  if (directVotes > 0) {
    return writeVoteCount(sql, boardId, 'group', groupId, participantHash, directVotes - 1, now);
  }
  const memberVote = memberVotes
    .filter((vote) => vote.count > 0)
    .sort((a, b) => b.updated_at - a.updated_at || a.target_id.localeCompare(b.target_id))[0];
  if (!memberVote) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'You have no Votes to remove from this Card Group.',
    };
  }
  return writeVoteCount(
    sql,
    boardId,
    'card',
    memberVote.target_id,
    participantHash,
    memberVote.count - 1,
    now,
  );
}

function writeVoteCount(
  sql: SqlRunner,
  boardId: string,
  targetType: 'card' | 'group',
  targetId: string,
  voterTokenHash: string,
  count: number,
  now: number,
): { ok: true } {
  if (count <= 0) {
    sql.run(
      'DELETE FROM votes WHERE board_id = ? AND target_type = ? AND target_id = ? AND voter_token_hash = ?',
      boardId,
      targetType,
      targetId,
      voterTokenHash,
    );
  } else {
    sql.run(
      `INSERT INTO votes (board_id, target_type, target_id, voter_token_hash, count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (target_type, target_id, voter_token_hash) DO UPDATE
       SET count = excluded.count, updated_at = excluded.updated_at`,
      boardId,
      targetType,
      targetId,
      voterTokenHash,
      count,
      now,
    );
  }
  return { ok: true };
}

export function configureVoting(
  sql: SqlRunner,
  board: RawBoardRow,
  command: Extract<BoardMutationCommand, { type: 'voting:configure' }>,
): void {
  sql.run(
    `UPDATE boards SET vote_limit = ?, max_votes_per_card = ?, blind_voting = ?,
                       allow_participant_group = ? WHERE id = ?`,
    command.voteLimit === undefined ? board.voteLimit : command.voteLimit,
    command.maxVotesPerCard === undefined ? board.maxVotesPerCard : command.maxVotesPerCard,
    Number(command.blindVoting ?? board.blindVoting),
    Number(command.allowParticipantGroup ?? board.allowParticipantGroup),
    board.id,
  );
}
