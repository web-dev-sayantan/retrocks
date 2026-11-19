import 'server-only';

import type {
  BoardEvent,
  BoardViewDTO,
  CardGroupDTO,
  CardViewDTO,
  ColumnDTO,
  CommentViewDTO,
} from '../../lib/board-types';
import type {
  RawBoardMutationEvent,
  RawBoardSnapshot,
} from '../db/raw-types';

function computePlaceholderLines(content: string): 1 | 2 | 3 {
  if (content.length <= 70) return 1;
  if (content.length <= 180) return 2;
  return 3;
}

/**
 * Pure, runtime-agnostic viewer projection (SPEC §6 Redacted DTO Contract).
 *
 * Explicitly constructs every DTO object from an allowlist of safe fields so
 * hashes, salts, and encrypted secrets can never escape the server boundary.
 * Enforces zero-peeking Private Mode redaction (even for Facilitators) and
 * Blind Voting aggregate total redaction.
 */
export function projectBoardForViewer(
  raw: RawBoardSnapshot,
  viewerParticipantHash: string | null,
  isFacilitator: boolean,
): BoardViewDTO {
  const { board } = raw;

  // Tally votes per target and total votes cast by the viewer.
  const cardTotalVotes = new Map<string, number>();
  const cardMyVotes = new Map<string, number>();
  const groupTotalVotes = new Map<string, number>();
  const groupMyVotes = new Map<string, number>();
  let viewerTotalVotes = 0;

  for (const vote of raw.votes) {
    const isViewerVote =
      viewerParticipantHash !== null &&
      vote.voterTokenHash === viewerParticipantHash;

    if (isViewerVote) {
      viewerTotalVotes += vote.count;
    }

    if (vote.targetType === 'card') {
      cardTotalVotes.set(
        vote.targetId,
        (cardTotalVotes.get(vote.targetId) ?? 0) + vote.count,
      );
      if (isViewerVote) {
        cardMyVotes.set(
          vote.targetId,
          (cardMyVotes.get(vote.targetId) ?? 0) + vote.count,
        );
      }
    } else {
      groupTotalVotes.set(
        vote.targetId,
        (groupTotalVotes.get(vote.targetId) ?? 0) + vote.count,
      );
      if (isViewerVote) {
        groupMyVotes.set(
          vote.targetId,
          (groupMyVotes.get(vote.targetId) ?? 0) + vote.count,
        );
      }
    }
  }

  // Group reactions per card.
  const reactionsByCard = new Map<string, Record<string, number>>();
  const myReactionsByCard = new Map<string, string[]>();
  for (const reaction of raw.reactions) {
    let counts = reactionsByCard.get(reaction.cardId);
    if (!counts) {
      counts = {};
      reactionsByCard.set(reaction.cardId, counts);
    }
    counts[reaction.emoji] = (counts[reaction.emoji] ?? 0) + 1;

    if (
      viewerParticipantHash !== null &&
      reaction.reactorTokenHash === viewerParticipantHash
    ) {
      let mine = myReactionsByCard.get(reaction.cardId);
      if (!mine) {
        mine = [];
        myReactionsByCard.set(reaction.cardId, mine);
      }
      if (!mine.includes(reaction.emoji)) {
        mine.push(reaction.emoji);
      }
    }
  }

  // Group comments per card.
  const commentsByCard = new Map<string, CommentViewDTO[]>();
  for (const comment of raw.comments) {
    let list = commentsByCard.get(comment.cardId);
    if (!list) {
      list = [];
      commentsByCard.set(comment.cardId, list);
    }
    list.push({
      id: comment.id,
      cardId: comment.cardId,
      content: comment.content,
      isMine:
        viewerParticipantHash !== null &&
        comment.authorTokenHash === viewerParticipantHash,
      createdAt: comment.createdAt,
    });
  }

  // Count cards per column and track member cards per group.
  const cardCountByColumn = new Map<string, number>();
  const cardIdsByGroup = new Map<string, string[]>();
  for (const card of raw.cards) {
    cardCountByColumn.set(
      card.columnId,
      (cardCountByColumn.get(card.columnId) ?? 0) + 1,
    );
    if (card.groupId !== null) {
      let ids = cardIdsByGroup.get(card.groupId);
      if (!ids) {
        ids = [];
        cardIdsByGroup.set(card.groupId, ids);
      }
      ids.push(card.id);
    }
  }

  const columns: ColumnDTO[] = [...raw.columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => ({
      id: column.id,
      title: column.title,
      accent: column.accent,
      position: column.position,
      isActionColumn: column.isActionColumn,
      cardCount: cardCountByColumn.get(column.id) ?? 0,
    }));

  const cards: CardViewDTO[] = raw.cards.map((card) => {
    const isMine =
      viewerParticipantHash !== null &&
      card.authorTokenHash === viewerParticipantHash;
    const isRedacted = board.isBlurred && !isMine;
    const rawComments = isRedacted ? [] : (commentsByCard.get(card.id) ?? []);
    const totalVotes = cardTotalVotes.get(card.id) ?? 0;
    const myVotes = cardMyVotes.get(card.id) ?? 0;

    return {
      id: card.id,
      columnId: card.columnId,
      groupId: card.groupId,
      content: isRedacted ? '' : card.content,
      redacted: isRedacted,
      ...(isRedacted
        ? { placeholderLines: computePlaceholderLines(card.content) }
        : {}),
      isMine,
      isActionItem: isRedacted ? false : card.isActionItem,
      actionDone: isRedacted ? false : card.actionDone,
      actionOwner: isRedacted ? '' : card.actionOwner,
      votes: board.blindVoting ? null : totalVotes,
      myVotes,
      reactions: isRedacted ? {} : (reactionsByCard.get(card.id) ?? {}),
      myReactions: isRedacted ? [] : (myReactionsByCard.get(card.id) ?? []),
      commentCount: rawComments.length,
      comments: rawComments,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  });

  const groups: CardGroupDTO[] = raw.groups.map((group) => {
    const memberCardIds = cardIdsByGroup.get(group.id) ?? [];
    let combinedTotal = groupTotalVotes.get(group.id) ?? 0;
    let combinedMine = groupMyVotes.get(group.id) ?? 0;

    for (const cardId of memberCardIds) {
      combinedTotal += cardTotalVotes.get(cardId) ?? 0;
      combinedMine += cardMyVotes.get(cardId) ?? 0;
    }

    return {
      id: group.id,
      columnId: group.columnId,
      title: group.title,
      cardIds: memberCardIds,
      votes: board.blindVoting ? null : combinedTotal,
      myVotes: combinedMine,
      createdAt: group.createdAt,
    };
  });

  const remainingVotes =
    board.voteLimit === null
      ? null
      : Math.max(0, board.voteLimit - viewerTotalVotes);

  return {
    id: board.id,
    title: board.title,
    subtitle: board.subtitle,
    templateId: board.templateId,
    isBlurred: board.isBlurred,
    blindVoting: board.blindVoting,
    isLocked: board.isLocked,
    allowParticipantGroup: board.allowParticipantGroup,
    voteLimit: board.voteLimit,
    maxVotesPerCard: board.maxVotesPerCard,
    remainingVotes,
    isFacilitator,
    timer: {
      endsAt: board.timerEndsAt,
      remainingMs: board.timerRemainingMs,
      durationMs: board.timerDurationMs,
    },
    version: board.version,
    retentionDays: board.retentionDays,
    createdAt: board.createdAt,
    lastActiveAt: board.lastActiveAt,
    columns,
    groups,
    cards,
  };
}

/**
 * Projects raw domain mutation events into viewer-scoped `BoardEvent`s using
 * `projectBoardForViewer`, ensuring Private Mode redaction, Blind Voting
 * totals, and viewer flags (`isMine`, `myVotes`, `myReactions`) stay consistent
 * across HTTP responses and live WebSocket/SSE broadcasts.
 */
export function projectMutationEventsForViewer(
  rawSnapshot: RawBoardSnapshot,
  rawEvents: readonly RawBoardMutationEvent[],
  viewerParticipantHash: string | null,
  isFacilitator: boolean,
): BoardEvent[] {
  const projected = projectBoardForViewer(
    rawSnapshot,
    viewerParticipantHash,
    isFacilitator,
  );
  if (rawEvents.some((event) =>
    event.type === 'board:snapshot' ||
    (event.type === 'board:updated' &&
      (event.patch.isBlurred !== undefined || event.patch.blindVoting !== undefined)),
  )) {
    // Privacy transitions change the presentation of existing Cards and Votes.
    return [{
      type: 'board:snapshot',
      version: projected.version,
      serverNow: Date.now(),
      board: projected,
    }];
  }

  const cardsById = new Map(projected.cards.map((card) => [card.id, card]));
  const columnsById = new Map(
    projected.columns.map((column) => [column.id, column]),
  );

  const events: BoardEvent[] = [];
  for (const rawEvent of rawEvents) {
    switch (rawEvent.type) {
      case 'board:updated':
        events.push({
          type: 'board:updated',
          version: rawEvent.version,
          patch: rawEvent.patch,
        });
        break;
      case 'card:upserted': {
        const card = cardsById.get(rawEvent.cardId);
        if (card) {
          events.push({
            type: 'card:upserted',
            version: rawEvent.version,
            card,
          });
        }
        break;
      }
      case 'card:deleted':
        events.push({
          type: 'card:deleted',
          version: rawEvent.version,
          cardId: rawEvent.cardId,
        });
        break;
      case 'reaction:updated': {
        const card = cardsById.get(rawEvent.cardId);
        if (card && !card.redacted) {
          events.push({
            type: 'reaction:updated',
            version: rawEvent.version,
            cardId: rawEvent.cardId,
            counts: card.reactions,
            myReactions: card.myReactions,
          });
        }
        break;
      }
      case 'comment:created': {
        const card = cardsById.get(rawEvent.cardId);
        if (!card || card.redacted) break;
        const comment = card.comments.find((item) => item.id === rawEvent.commentId);
        if (comment) {
          events.push({
            type: 'comment:created',
            version: rawEvent.version,
            cardId: rawEvent.cardId,
            comment,
          });
        }
        break;
      }
      case 'comment:deleted': {
        const card = cardsById.get(rawEvent.cardId);
        if (card && !card.redacted) {
          events.push({
            type: 'comment:deleted',
            version: rawEvent.version,
            cardId: rawEvent.cardId,
            commentId: rawEvent.commentId,
          });
        }
        break;
      }
      case 'column:upserted': {
        const column = columnsById.get(rawEvent.columnId);
        if (column) {
          events.push({
            type: 'column:upserted',
            version: rawEvent.version,
            column,
          });
        }
        break;
      }
      case 'column:deleted':
        events.push({
          type: 'column:deleted',
          version: rawEvent.version,
          columnId: rawEvent.columnId,
        });
        break;
      case 'columns:reordered':
        events.push({
          type: 'columns:reordered',
          version: rawEvent.version,
          columnIds: rawEvent.columnIds,
        });
        break;
      case 'group:dissolved':
        events.push({
          type: 'group:dissolved',
          version: rawEvent.version,
          groupId: rawEvent.groupId,
        });
        break;
    }
  }

  return events;
}
