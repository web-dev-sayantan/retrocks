import 'server-only';

import {
  decideVoteChange,
  type BoardPolicyDenialReason,
  type VoteLimitFacts,
} from '../../lib/board-policy';
import type { BoardMutationActor, BoardMutationCommand, BoardMutationOutcome, RawBoardRow } from './raw-types';
import type { SqlRunner } from './sql-runner';

export type ChangeVoteResult =
  | { ok: true; decrementedMemberCardId?: string }
  | Extract<BoardMutationOutcome, { ok: false }>;

type VoteFailure = Extract<BoardMutationOutcome, { ok: false }>;

function mapVotePolicyDenial(
  reason: BoardPolicyDenialReason,
  targetKind: 'card' | 'group',
): VoteFailure {
  const label = targetKind === 'card' ? 'Card' : 'Card Group';
  switch (reason) {
    case 'board-locked':
      return {
        ok: false,
        code: 'BOARD_LOCKED',
        message: 'This Board is Locked and cannot be edited.',
      };
    case 'private-mode-restricted':
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: "Cannot change another Participant's Card while Private Mode is active.",
      };
    case 'card-in-group':
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Vote on the Card Group instead.',
      };
    case 'target-vote-limit-reached':
      return {
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message: `You reached the Vote limit for this ${label}.`,
      };
    case 'board-vote-limit-reached':
      return {
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message: 'You have no Votes left.',
      };
    case 'no-votes-to-remove':
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: `You have no Votes to remove from this ${label}.`,
      };
    default:
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'You do not have permission to vote here.',
      };
  }
}

function buildVoteLimits(
  sql: SqlRunner,
  board: RawBoardRow,
  participantHash: string,
): VoteLimitFacts {
  const { id: boardId, voteLimit, maxVotesPerCard } = board;
  return {
    maxVotesPerCard,
    remainingVotes:
      voteLimit === null
        ? null
        : () => {
            const cast =
              sql.get<{ total: number }>(
                'SELECT COALESCE(SUM(count), 0) AS total FROM votes WHERE board_id = ? AND voter_token_hash = ?',
                boardId,
                participantHash,
              )?.total ?? 0;
            return voteLimit - cast;
          },
  };
}

export function changeVote(
  sql: SqlRunner,
  board: RawBoardRow,
  actor: BoardMutationActor,
  command: Extract<BoardMutationCommand, { type: 'vote:change' }>,
  now: number,
): ChangeVoteResult {
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

  const current = sql.get<{ count: number }>(
    'SELECT count FROM votes WHERE board_id = ? AND target_type = ? AND target_id = ? AND voter_token_hash = ?',
    boardId,
    targetType,
    targetId,
    participantHash,
  )?.count ?? 0;

  const decision = decideVoteChange(
    { isLocked: board.isLocked, isPrivateMode: board.isBlurred },
    {
      kind: 'card',
      isMine: card.author_token_hash === participantHash,
      groupId: card.group_id,
      myVotes: current,
    },
    buildVoteLimits(sql, board, participantHash),
    delta,
  );
  if (!decision.allowed) {
    return mapVotePolicyDenial(decision.reason, 'card');
  }

  return writeVoteCount(sql, boardId, targetType, targetId, participantHash, current + delta, now);
}

function changeGroupVote(
  sql: SqlRunner,
  board: RawBoardRow,
  actor: BoardMutationActor,
  groupId: string,
  delta: 1 | -1,
  now: number,
): ChangeVoteResult {
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

  const decision = decideVoteChange(
    { isLocked: board.isLocked, isPrivateMode: board.isBlurred },
    {
      kind: 'group',
      allCardsAreMine: members.every(
        (member) => member.author_token_hash === participantHash,
      ),
      myVotes: combinedMine,
    },
    buildVoteLimits(sql, board, participantHash),
    delta,
  );
  if (!decision.allowed) {
    return mapVotePolicyDenial(decision.reason, 'group');
  }

  if (delta === 1) {
    return writeVoteCount(sql, boardId, 'group', groupId, participantHash, directVotes + 1, now);
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
    return mapVotePolicyDenial('no-votes-to-remove', 'group');
  }
  writeVoteCount(
    sql,
    boardId,
    'card',
    memberVote.target_id,
    participantHash,
    memberVote.count - 1,
    now,
  );
  return { ok: true, decrementedMemberCardId: memberVote.target_id };
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
