import type {
  BoardEvent,
  BoardViewDTO,
  CardGroupDTO,
  CardViewDTO,
  ReactionEmoji,
} from './board-types';

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

function patchStringArray(target: string[], next: readonly string[]): void {
  let i = 0;
  for (; i < next.length; i += 1) {
    if (i >= target.length) {
      target.push(next[i]);
    } else if (target[i] !== next[i]) {
      target[i] = next[i];
    }
  }
  if (target.length > next.length) {
    target.splice(next.length);
  }
}

function patchReactionsRecord(
  target: Partial<Record<ReactionEmoji, number>>,
  next: Partial<Record<ReactionEmoji, number>>,
): void {
  for (const key of Object.keys(target) as ReactionEmoji[]) {
    if (next[key] === undefined) {
      delete target[key];
    }
  }
  for (const key of Object.keys(next) as ReactionEmoji[]) {
    const value = next[key];
    if (value !== undefined && target[key] !== value) {
      target[key] = value;
    }
  }
}

function patchCardDraft(target: CardViewDTO, next: CardViewDTO): void {
  if (target.columnId !== next.columnId) target.columnId = next.columnId;
  if (target.groupId !== next.groupId) target.groupId = next.groupId;
  if (target.content !== next.content) target.content = next.content;
  if (target.redacted !== next.redacted) target.redacted = next.redacted;
  if (target.placeholderLines !== next.placeholderLines) {
    target.placeholderLines = next.placeholderLines;
  }
  if (target.isMine !== next.isMine) target.isMine = next.isMine;
  if (target.isActionItem !== next.isActionItem) {
    target.isActionItem = next.isActionItem;
  }
  if (target.actionDone !== next.actionDone) target.actionDone = next.actionDone;
  if (target.actionOwner !== next.actionOwner) {
    target.actionOwner = next.actionOwner;
  }
  if (target.votes !== next.votes) target.votes = next.votes;
  if (target.myVotes !== next.myVotes) target.myVotes = next.myVotes;
  if (target.commentCount !== next.commentCount) {
    target.commentCount = next.commentCount;
  }
  if (target.createdAt !== next.createdAt) target.createdAt = next.createdAt;
  if (target.updatedAt !== next.updatedAt) target.updatedAt = next.updatedAt;

  patchReactionsRecord(target.reactions, next.reactions);
  patchStringArray(target.myReactions, next.myReactions);

  const nextIds = new Set(next.comments.map((c) => c.id));
  for (let i = target.comments.length - 1; i >= 0; i -= 1) {
    if (!nextIds.has(target.comments[i].id)) {
      target.comments.splice(i, 1);
    }
  }
  for (let i = 0; i < next.comments.length; i += 1) {
    const incoming = next.comments[i];
    const existing = target.comments[i];
    if (existing && existing.id === incoming.id) {
      if (existing.content !== incoming.content) {
        existing.content = incoming.content;
      }
      if (existing.isMine !== incoming.isMine) {
        existing.isMine = incoming.isMine;
      }
      if (existing.createdAt !== incoming.createdAt) {
        existing.createdAt = incoming.createdAt;
      }
    } else {
      const movedIdx = target.comments.findIndex((c) => c.id === incoming.id);
      if (movedIdx !== -1) {
        const [moved] = target.comments.splice(movedIdx, 1);
        target.comments.splice(i, 0, moved);
      } else {
        target.comments.splice(i, 0, { ...incoming });
      }
    }
  }
}

function patchGroupDraft(target: CardGroupDTO, next: CardGroupDTO): void {
  if (target.columnId !== next.columnId) target.columnId = next.columnId;
  if (target.title !== next.title) target.title = next.title;
  if (target.redacted !== next.redacted) target.redacted = next.redacted;
  if (target.votes !== next.votes) target.votes = next.votes;
  if (target.myVotes !== next.myVotes) target.myVotes = next.myVotes;
  if (target.createdAt !== next.createdAt) target.createdAt = next.createdAt;
  patchStringArray(target.cardIds, next.cardIds);
}

/**
 * Pure, idempotent draft patcher for Solid 2.0 `createStore` Board state.
 * Shared by client mutation responses (Issue #3) and incoming live WebSocket/SSE
 * `BoardEvent`s (Issue #4) so optimistic/HTTP and realtime updates stay unified.
 */
export function applyBoardEvent(draft: BoardViewDTO, event: BoardEvent): void {
  if ('version' in event && event.version > draft.version) {
    draft.version = event.version;
  }

  switch (event.type) {
    case 'board:updated': {
      const { patch } = event;
      if (patch.title !== undefined) draft.title = patch.title;
      if (patch.subtitle !== undefined) draft.subtitle = patch.subtitle;
      if (patch.isBlurred !== undefined) draft.isBlurred = patch.isBlurred;
      if (patch.blindVoting !== undefined)
        draft.blindVoting = patch.blindVoting;
      if (patch.isLocked !== undefined) draft.isLocked = patch.isLocked;
      if (patch.allowParticipantGroup !== undefined) {
        draft.allowParticipantGroup = patch.allowParticipantGroup;
      }
      if (patch.voteLimit !== undefined) draft.voteLimit = patch.voteLimit;
      if (patch.maxVotesPerCard !== undefined) {
        draft.maxVotesPerCard = patch.maxVotesPerCard;
      }
      if (patch.retentionDays !== undefined) {
        draft.retentionDays = patch.retentionDays;
      }
      break;
    }

    case 'timer:updated': {
      draft.timer.endsAt = event.timer.endsAt;
      draft.timer.remainingMs = event.timer.remainingMs;
      draft.timer.durationMs = event.timer.durationMs;
      break;
    }

    case 'column:upserted': {
      const existing = draft.columns.find((c) => c.id === event.column.id);
      if (existing) {
        existing.title = event.column.title;
        existing.accent = event.column.accent;
        existing.position = event.column.position;
        existing.isActionColumn = event.column.isActionColumn;
      } else {
        draft.columns.push({ ...event.column });
      }
      draft.columns.sort((a, b) => a.position - b.position);
      break;
    }

    case 'columns:reordered': {
      const orderIndex = new Map(
        event.columnIds.map((id, index) => [id, index]),
      );
      draft.columns.sort((a, b) => {
        const aIdx = orderIndex.get(a.id) ?? a.position;
        const bIdx = orderIndex.get(b.id) ?? b.position;
        return aIdx - bIdx;
      });
      for (let i = 0; i < draft.columns.length; i += 1) {
        draft.columns[i].position = i;
      }
      break;
    }

    case 'column:deleted': {
      const colIndex = draft.columns.findIndex((c) => c.id === event.columnId);
      if (colIndex !== -1) {
        draft.columns.splice(colIndex, 1);
      }
      for (let i = 0; i < draft.columns.length; i += 1) {
        draft.columns[i].position = i;
      }
      for (let i = draft.cards.length - 1; i >= 0; i -= 1) {
        if (draft.cards[i].columnId === event.columnId) {
          draft.cards.splice(i, 1);
        }
      }
      for (let i = draft.groups.length - 1; i >= 0; i -= 1) {
        if (draft.groups[i].columnId === event.columnId) {
          draft.groups.splice(i, 1);
        }
      }
      break;
    }

    case 'card:upserted': {
      const existingIndex = draft.cards.findIndex(
        (c) => c.id === event.card.id,
      );
      if (existingIndex !== -1) {
        const previousColumnId = draft.cards[existingIndex].columnId;
        if (previousColumnId !== event.card.columnId) {
          adjustColumnCardCount(draft, previousColumnId, -1);
          adjustColumnCardCount(draft, event.card.columnId, 1);
        }
        patchCardDraft(draft.cards[existingIndex], event.card);
      } else {
        draft.cards.push({
          ...event.card,
          reactions: { ...event.card.reactions },
          myReactions: [...event.card.myReactions],
          comments: event.card.comments.map((comment) => ({ ...comment })),
        });
        adjustColumnCardCount(draft, event.card.columnId, 1);
      }
      break;
    }

    case 'card:deleted': {
      const cardIndex = draft.cards.findIndex((c) => c.id === event.cardId);
      if (cardIndex !== -1) {
        const [removed] = draft.cards.splice(cardIndex, 1);
        adjustColumnCardCount(draft, removed.columnId, -1);
        for (const group of draft.groups) {
          const memberIdx = group.cardIds.indexOf(event.cardId);
          if (memberIdx !== -1) {
            group.cardIds.splice(memberIdx, 1);
          }
        }
      }
      break;
    }

    case 'group:upserted': {
      const existingIndex = draft.groups.findIndex(
        (g) => g.id === event.group.id,
      );
      if (existingIndex !== -1) {
        patchGroupDraft(draft.groups[existingIndex], event.group);
      } else {
        draft.groups.push({
          ...event.group,
          cardIds: [...event.group.cardIds],
        });
      }
      break;
    }

    case 'group:dissolved': {
      const groupIndex = draft.groups.findIndex((g) => g.id === event.groupId);
      if (groupIndex !== -1) {
        draft.groups.splice(groupIndex, 1);
      }
      for (const card of draft.cards) {
        if (card.groupId === event.groupId) {
          card.groupId = null;
        }
      }
      break;
    }

    case 'vote:updated': {
      const targets = event.targetType === 'card' ? draft.cards : draft.groups;
      const target = targets.find((item) => item.id === event.targetId);
      if (target) {
        target.votes = event.totalVotes;
        target.myVotes = event.myVotes;
      }
      draft.remainingVotes = event.remainingVotes;
      break;
    }

    case 'vote:balance':
      draft.remainingVotes = event.remainingVotes;
      break;

    case 'reaction:updated': {
      const card = draft.cards.find((c) => c.id === event.cardId);
      if (card) {
        patchReactionsRecord(card.reactions, event.counts);
        patchStringArray(card.myReactions, event.myReactions);
      }
      break;
    }

    case 'comment:created': {
      const card = draft.cards.find((c) => c.id === event.cardId);
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
      const card = draft.cards.find((c) => c.id === event.cardId);
      if (card) {
        const idx = card.comments.findIndex((c) => c.id === event.commentId);
        if (idx !== -1) {
          card.comments.splice(idx, 1);
          card.commentCount = card.comments.length;
        }
      }
      break;
    }

    case 'board:snapshot':
    case 'board:deleted':
    case 'presence:count':
      break;
  }
}

export function applyBoardEvents(
  draft: BoardViewDTO,
  events: readonly BoardEvent[],
): void {
  for (const event of events) {
    applyBoardEvent(draft, event);
  }
}
