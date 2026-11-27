/**
 * Thin client-side DTO adapter over the shared pure Board authorization policy
 * (`src/lib/board-policy.ts`). Maps viewer-projected client state (`BoardViewDTO`,
 * `BoardWorkspaceContextValue`, `CardViewDTO`, `CardGroupDTO`, `CommentViewDTO`)
 * into plain policy facts with zero Solid reactivity.
 */

import {
  decideActionItemAction,
  decideBoardAction,
  decideCardAction,
  decideColumnAction,
  decideCommentDelete,
  decideGroupAction,
  decideVoteChange,
  type BoardPolicyContext,
  type BoardPolicyDecision,
  type CardGroupPolicyFacts,
  type CardPolicyFacts,
  type MergeCardFacts,
  type MergeGroupFacts,
  type VoteDelta,
} from './board-policy';
import type {
  ActionItemPatch,
  BoardViewDTO,
  CardGroupDTO,
  CardViewDTO,
  CommentViewDTO,
} from './board-types';

type PolicyBoardInput = Pick<
  BoardViewDTO,
  'isFacilitator' | 'isLocked' | 'isBlurred' | 'allowParticipantGroup'
>;

export function toBoardPolicyContext(
  board: PolicyBoardInput,
): BoardPolicyContext {
  return {
    isFacilitator: board.isFacilitator,
    isLocked: board.isLocked,
    isPrivateMode: board.isBlurred,
    allowParticipantGroup: board.allowParticipantGroup,
  };
}

function toCardPolicyFacts(
  card: Pick<CardViewDTO, 'isMine' | 'redacted' | 'pending'>,
): CardPolicyFacts {
  return {
    isMine: card.isMine,
    isRedacted: card.redacted,
    isPending: card.pending,
  };
}

function toGroupPolicyFacts(
  group: Pick<CardGroupDTO, 'cardIds' | 'redacted'>,
  cards: readonly Pick<CardViewDTO, 'id' | 'isMine'>[],
): CardGroupPolicyFacts {
  return {
    allCardsAreMine: group.cardIds.every(
      (id) => cards.find((card) => card.id === id)?.isMine === true,
    ),
    isRedacted: group.redacted,
  };
}

function toMergeCardFacts(
  card: Pick<
    CardViewDTO,
    'id' | 'columnId' | 'groupId' | 'isMine' | 'redacted' | 'pending'
  >,
): MergeCardFacts {
  return {
    id: card.id,
    columnId: card.columnId,
    groupId: card.groupId,
    ...toCardPolicyFacts(card),
  };
}

function toMergeGroupFacts(
  group: Pick<CardGroupDTO, 'id' | 'columnId' | 'cardIds' | 'redacted'>,
  cards: readonly Pick<CardViewDTO, 'id' | 'isMine'>[],
): MergeGroupFacts {
  return {
    id: group.id,
    columnId: group.columnId,
    ...toGroupPolicyFacts(group, cards),
  };
}

// ── Facilitation gates ──────────────────────────────────────────────────────────

export function canFacilitate(
  board: Pick<BoardViewDTO, 'isFacilitator'> &
    Partial<Pick<BoardViewDTO, 'isLocked'>>,
): boolean {
  return decideBoardAction(
    { isFacilitator: board.isFacilitator, isLocked: board.isLocked ?? false },
    'board:set-lock',
  ).allowed;
}

export function canControlFacilitation(
  board: Pick<BoardViewDTO, 'isFacilitator' | 'isLocked'>,
): boolean {
  return decideBoardAction(board, 'board:rename').allowed;
}

export function canContribute(board: Pick<BoardViewDTO, 'isLocked'>): boolean {
  return decideBoardAction(
    { isFacilitator: false, isLocked: board.isLocked },
    'board:contribute',
  ).allowed;
}

export function canAddColumn(
  board: Pick<BoardViewDTO, 'isFacilitator' | 'isLocked' | 'columns'>,
): boolean {
  return decideColumnAction(
    {
      isFacilitator: board.isFacilitator,
      isLocked: board.isLocked,
      isPrivateMode: false,
    },
    { type: 'column:add', columnCount: board.columns.length },
  ).allowed;
}

// ── Card gates ──────────────────────────────────────────────────────────────────

type CardInteractBoard = Pick<BoardViewDTO, 'isLocked'> &
  Partial<Pick<BoardViewDTO, 'isBlurred'>>;
type CardInteractState = Pick<CardViewDTO, 'redacted' | 'pending'> &
  Partial<Pick<CardViewDTO, 'isMine'>>;

export function canInteractWithCard(
  board: CardInteractBoard,
  card: CardInteractState,
): boolean;
export function canInteractWithCard(
  board: CardInteractBoard & {
    readonly cards: readonly (CardInteractState & { readonly id: string })[];
  },
  cardId: string,
): boolean;
export function canInteractWithCard(
  board: CardInteractBoard & {
    readonly cards?: readonly (CardInteractState & { readonly id: string })[];
  },
  cardOrId: CardInteractState | string,
): boolean {
  const card =
    typeof cardOrId === 'string'
      ? board.cards?.find((item) => item.id === cardOrId)
      : cardOrId;
  if (!card) return false;
  return decideCardAction(
    {
      isFacilitator: false,
      isLocked: board.isLocked,
      isPrivateMode: board.isBlurred ?? false,
    },
    'card:interact',
    {
      isMine: card.isMine ?? true,
      isRedacted: card.redacted,
      isPending: card.pending,
    },
  ).allowed;
}

type CardManageBoard = Pick<
  BoardViewDTO,
  'isLocked' | 'isFacilitator' | 'isBlurred'
>;
type CardManageState = Pick<CardViewDTO, 'redacted' | 'isMine' | 'pending'>;

export function canManageCard(
  board: CardManageBoard,
  card: CardManageState,
): boolean;
export function canManageCard(
  board: CardManageBoard & {
    readonly cards: readonly (CardManageState & { readonly id: string })[];
  },
  cardId: string,
): boolean;
export function canManageCard(
  board: CardManageBoard & {
    readonly cards?: readonly (CardManageState & { readonly id: string })[];
  },
  cardOrId: CardManageState | string,
): boolean {
  const card =
    typeof cardOrId === 'string'
      ? board.cards?.find((item) => item.id === cardOrId)
      : cardOrId;
  if (!card) return false;
  return decideCardAction(
    {
      isFacilitator: board.isFacilitator,
      isLocked: board.isLocked,
      isPrivateMode: board.isBlurred,
    },
    'card:update',
    toCardPolicyFacts(card),
  ).allowed;
}

// ── Grouping gates ──────────────────────────────────────────────────────────────

export function canManageGrouping(
  board: Pick<BoardViewDTO, 'isLocked' | 'isFacilitator' | 'allowParticipantGroup'>,
): boolean {
  return decideGroupAction(
    {
      isFacilitator: board.isFacilitator,
      isLocked: board.isLocked,
      isPrivateMode: false,
      allowParticipantGroup: board.allowParticipantGroup,
    },
    { type: 'group:manage-access' },
  ).allowed;
}

export function canManageGroup(
  board: PolicyBoardInput,
  group: Pick<CardGroupDTO, 'redacted' | 'cardIds'>,
  cards: readonly Pick<CardViewDTO, 'id' | 'isMine'>[],
): boolean;
export function canManageGroup(
  board: PolicyBoardInput & {
    readonly groups: readonly Pick<CardGroupDTO, 'id' | 'redacted' | 'cardIds'>[];
    readonly cards: readonly Pick<CardViewDTO, 'id' | 'isMine'>[];
  },
  groupId: string,
): boolean;
export function canManageGroup(
  board: PolicyBoardInput & {
    readonly groups?: readonly Pick<CardGroupDTO, 'id' | 'redacted' | 'cardIds'>[];
    readonly cards?: readonly Pick<CardViewDTO, 'id' | 'isMine'>[];
  },
  groupOrId: Pick<CardGroupDTO, 'redacted' | 'cardIds'> | string,
  cards?: readonly Pick<CardViewDTO, 'id' | 'isMine'>[],
): boolean {
  const group =
    typeof groupOrId === 'string'
      ? board.groups?.find((item) => item.id === groupOrId)
      : groupOrId;
  const cardList = cards ?? board.cards;
  if (!group || !cardList) return false;
  return decideGroupAction(toBoardPolicyContext(board), {
    type: 'group:rename',
    group: toGroupPolicyFacts(group, cardList),
  }).allowed;
}

export function canInteractWithGroup(
  board: Pick<BoardViewDTO, 'isLocked' | 'isBlurred'>,
  group: Pick<CardGroupDTO, 'redacted' | 'cardIds'>,
  cards: readonly Pick<CardViewDTO, 'id' | 'isMine'>[],
): boolean {
  return decideVoteChange(
    { isLocked: board.isLocked, isPrivateMode: board.isBlurred },
    {
      kind: 'group',
      myVotes: 0,
      ...toGroupPolicyFacts(group, cards),
    },
    { maxVotesPerCard: null, remainingVotes: null },
    1,
  ).allowed;
}

export function canUngroupCard(
  board: PolicyBoardInput,
  card: Pick<CardViewDTO, 'groupId' | 'isMine' | 'redacted' | 'pending'>,
  groups: readonly Pick<CardGroupDTO, 'id' | 'cardIds' | 'redacted'>[],
  cards: readonly Pick<CardViewDTO, 'id' | 'isMine'>[],
): boolean;
export function canUngroupCard(
  board: PolicyBoardInput & {
    readonly cards: readonly Pick<
      CardViewDTO,
      'id' | 'groupId' | 'isMine' | 'redacted' | 'pending'
    >[];
    readonly groups: readonly Pick<CardGroupDTO, 'id' | 'cardIds' | 'redacted'>[];
  },
  cardId: string,
): boolean;
export function canUngroupCard(
  board: PolicyBoardInput & {
    readonly cards?: readonly Pick<
      CardViewDTO,
      'id' | 'groupId' | 'isMine' | 'redacted' | 'pending'
    >[];
    readonly groups?: readonly Pick<CardGroupDTO, 'id' | 'cardIds' | 'redacted'>[];
  },
  cardOrId:
    | Pick<CardViewDTO, 'groupId' | 'isMine' | 'redacted' | 'pending'>
    | string,
  groups?: readonly Pick<CardGroupDTO, 'id' | 'cardIds' | 'redacted'>[],
  cards?: readonly Pick<CardViewDTO, 'id' | 'isMine'>[],
): boolean {
  const cardList = cards ?? board.cards;
  const groupList = groups ?? board.groups;
  const card =
    typeof cardOrId === 'string'
      ? board.cards?.find((item) => item.id === cardOrId)
      : cardOrId;
  if (!card || !cardList || !groupList) return false;
  const group =
    card.groupId !== null
      ? (groupList.find((item) => item.id === card.groupId) ?? null)
      : null;
  return decideGroupAction(toBoardPolicyContext(board), {
    type: 'group:ungroup',
    card: toCardPolicyFacts(card),
    group: group ? toGroupPolicyFacts(group, cardList) : null,
  }).allowed;
}

type MergeBoard = PolicyBoardInput & {
  readonly cards: readonly Pick<
    CardViewDTO,
    'id' | 'columnId' | 'groupId' | 'isMine' | 'redacted' | 'pending'
  >[];
  readonly groups: readonly Pick<
    CardGroupDTO,
    'id' | 'columnId' | 'cardIds' | 'redacted'
  >[];
};

export function canMergeCard(
  board: MergeBoard,
  cardId: string,
  targetType: 'card' | 'group',
  targetId: string,
): boolean {
  const sourceCard = board.cards.find((item) => item.id === cardId);
  if (!sourceCard) return false;
  const sourceGroup =
    sourceCard.groupId !== null
      ? board.groups.find((item) => item.id === sourceCard.groupId)
      : null;
  if (sourceCard.groupId !== null && !sourceGroup) return false;
  const sourceGroupFacts = sourceGroup
    ? toGroupPolicyFacts(sourceGroup, board.cards)
    : null;
  const policyBoard = toBoardPolicyContext(board);

  if (targetType === 'group') {
    const group = board.groups.find((item) => item.id === targetId);
    if (!group) return false;
    return decideGroupAction(policyBoard, {
      type: 'group:merge',
      sourceCard: toMergeCardFacts(sourceCard),
      sourceGroup: sourceGroupFacts,
      target: {
        kind: 'group',
        group: toMergeGroupFacts(group, board.cards),
      },
    }).allowed;
  }

  const targetCard = board.cards.find((item) => item.id === targetId);
  if (!targetCard) return false;
  const targetGroup =
    targetCard.groupId !== null
      ? board.groups.find((item) => item.id === targetCard.groupId)
      : null;
  if (targetCard.groupId !== null && !targetGroup) return false;

  return decideGroupAction(policyBoard, {
    type: 'group:merge',
    sourceCard: toMergeCardFacts(sourceCard),
    sourceGroup: sourceGroupFacts,
    target: {
      kind: 'card',
      card: toMergeCardFacts(targetCard),
      group: targetGroup ? toMergeGroupFacts(targetGroup, board.cards) : null,
    },
  }).allowed;
}

export function getCardMergeTargets(
  board: PolicyBoardInput,
  card: CardViewDTO,
  columnCards: readonly CardViewDTO[],
  columnGroups: readonly CardGroupDTO[],
): { cards: CardViewDTO[]; groups: CardGroupDTO[] } {
  const sourceGroup =
    card.groupId !== null
      ? (columnGroups.find((item) => item.id === card.groupId) ?? null)
      : null;
  if (card.groupId !== null && !sourceGroup) {
    return { cards: [], groups: [] };
  }
  const sourceGroupFacts = sourceGroup
    ? toGroupPolicyFacts(sourceGroup, columnCards)
    : null;
  const policyBoard = toBoardPolicyContext(board);
  const sourceCard = toMergeCardFacts(card);
  const cards = columnCards.filter(
    (other) =>
      other.groupId === null &&
      decideGroupAction(policyBoard, {
        type: 'group:merge',
        sourceCard,
        sourceGroup: sourceGroupFacts,
        target: {
          kind: 'card',
          card: toMergeCardFacts(other),
          group: null,
        },
      }).allowed,
  );
  const groups = columnGroups.filter(
    (group) =>
      decideGroupAction(policyBoard, {
        type: 'group:merge',
        sourceCard,
        sourceGroup: sourceGroupFacts,
        target: {
          kind: 'group',
          group: toMergeGroupFacts(group, columnCards),
        },
      }).allowed,
  );
  return { cards, groups };
}

// ── Action Item gates ───────────────────────────────────────────────────────────

export function canEditActionItems(
  board: Pick<BoardViewDTO, 'isLocked' | 'isFacilitator'>,
): boolean {
  return decideBoardAction(board, 'action-item:follow-up').allowed;
}

type ActionItemBoard = Pick<BoardViewDTO, 'isLocked' | 'isFacilitator'> &
  Partial<Pick<BoardViewDTO, 'isBlurred'>>;
type ActionItemState = Pick<
  CardViewDTO,
  'redacted' | 'isActionItem' | 'pending'
> &
  Partial<Pick<CardViewDTO, 'isMine'>>;

export function canEditActionItemFollowUp(
  board: ActionItemBoard,
  card: Pick<CardViewDTO, 'isActionItem' | 'pending'> &
    Partial<Pick<CardViewDTO, 'redacted' | 'isMine'>>,
): boolean {
  return decideActionItemAction(
    {
      isFacilitator: board.isFacilitator,
      isLocked: board.isLocked,
      isPrivateMode: board.isBlurred ?? false,
    },
    {
      isMine: card.isMine ?? true,
      isRedacted: card.redacted,
      isPending: card.pending,
      isActionItem: card.isActionItem,
    },
    { actionDone: true },
  ).allowed;
}

export function canEditActionItem(
  board: ActionItemBoard,
  card: ActionItemState,
  patch: ActionItemPatch,
): boolean;
export function canEditActionItem(
  board: ActionItemBoard & {
    readonly cards: readonly (ActionItemState & { readonly id: string })[];
  },
  cardId: string,
  patch: ActionItemPatch,
): boolean;
export function canEditActionItem(
  board: ActionItemBoard & {
    readonly cards?: readonly (ActionItemState & { readonly id: string })[];
  },
  cardOrId: ActionItemState | string,
  patch: ActionItemPatch,
): boolean {
  const card =
    typeof cardOrId === 'string'
      ? board.cards?.find((item) => item.id === cardOrId)
      : cardOrId;
  if (!card) return false;
  return decideActionItemAction(
    {
      isFacilitator: board.isFacilitator,
      isLocked: board.isLocked,
      isPrivateMode: board.isBlurred ?? false,
    },
    {
      isMine: card.isMine ?? true,
      isRedacted: card.redacted,
      isPending: card.pending,
      isActionItem: card.isActionItem,
    },
    patch,
  ).allowed;
}

// ── Comment gates ───────────────────────────────────────────────────────────────

type CommentDeleteBoard = Pick<
  BoardViewDTO,
  'isLocked' | 'isFacilitator' | 'isBlurred'
>;

export function canDeleteComment(
  board: CommentDeleteBoard,
  comment: Pick<CommentViewDTO, 'isMine'>,
  card?: Pick<CardViewDTO, 'isMine' | 'redacted' | 'pending'>,
): boolean;
export function canDeleteComment(
  board: CommentDeleteBoard & {
    readonly cards: readonly (Pick<
      CardViewDTO,
      'id' | 'isMine' | 'redacted' | 'pending'
    > & {
      readonly comments: readonly Pick<CommentViewDTO, 'id' | 'isMine'>[];
    })[];
  },
  cardId: string,
  commentId: string,
): boolean;
export function canDeleteComment(
  board: CommentDeleteBoard & {
    readonly cards?: readonly (Pick<
      CardViewDTO,
      'id' | 'isMine' | 'redacted' | 'pending'
    > & {
      readonly comments: readonly Pick<CommentViewDTO, 'id' | 'isMine'>[];
    })[];
  },
  commentOrCardId: Pick<CommentViewDTO, 'isMine'> | string,
  cardOrCommentId?:
    | Pick<CardViewDTO, 'isMine' | 'redacted' | 'pending'>
    | string,
): boolean {
  let comment: Pick<CommentViewDTO, 'isMine'> | undefined;
  let card: Pick<CardViewDTO, 'isMine' | 'redacted' | 'pending'> | undefined;

  if (typeof commentOrCardId === 'string') {
    if (typeof cardOrCommentId !== 'string') return false;
    const parentCard = board.cards?.find((item) => item.id === commentOrCardId);
    card = parentCard;
    comment = parentCard?.comments.find((item) => item.id === cardOrCommentId);
    if (!card || !comment) return false;
  } else {
    comment = commentOrCardId;
    card = typeof cardOrCommentId === 'object' ? cardOrCommentId : undefined;
  }

  return decideCommentDelete(
    {
      isFacilitator: board.isFacilitator,
      isLocked: board.isLocked,
      isPrivateMode: board.isBlurred,
    },
    { isMine: comment.isMine },
    {
      card: card ? toCardPolicyFacts(card) : undefined,
      mode: 'client-conservative',
    },
  ).allowed;
}

// ── Vote gates ──────────────────────────────────────────────────────────────────

export function canCastVote(
  voting: { remainingVotes: number | null; maxVotesPerCard: number | null },
  myVotes: number,
): boolean {
  return decideVoteChange(
    { isLocked: false, isPrivateMode: false },
    { kind: 'card', groupId: null, myVotes, isMine: true },
    {
      maxVotesPerCard: voting.maxVotesPerCard,
      remainingVotes: voting.remainingVotes,
    },
    1,
  ).allowed;
}

export function canRemoveVote(myVotes: number): boolean {
  return decideVoteChange(
    { isLocked: false, isPrivateMode: false },
    { kind: 'card', groupId: null, myVotes, isMine: true },
    { maxVotesPerCard: null, remainingVotes: null },
    -1,
  ).allowed;
}

export function canChangeVote(
  board: Pick<
    BoardViewDTO,
    | 'isLocked'
    | 'isBlurred'
    | 'maxVotesPerCard'
    | 'remainingVotes'
    | 'cards'
    | 'groups'
  >,
  targetType: 'card' | 'group',
  targetId: string,
  delta: VoteDelta,
): boolean {
  const policyBoard = {
    isLocked: board.isLocked,
    isPrivateMode: board.isBlurred,
  };
  const limits = {
    maxVotesPerCard: board.maxVotesPerCard,
    remainingVotes: board.remainingVotes,
  };

  if (targetType === 'group') {
    const group = board.groups.find((item) => item.id === targetId);
    if (!group) return false;
    return decideVoteChange(
      policyBoard,
      {
        kind: 'group',
        myVotes: group.myVotes,
        ...toGroupPolicyFacts(group, board.cards),
      },
      limits,
      delta,
    ).allowed;
  }

  const card = board.cards.find((item) => item.id === targetId);
  if (!card) return false;
  return decideVoteChange(
    policyBoard,
    {
      kind: 'card',
      groupId: card.groupId,
      myVotes: card.myVotes,
      ...toCardPolicyFacts(card),
    },
    limits,
    delta,
  ).allowed;
}

// ── Column gates ────────────────────────────────────────────────────────────────

export function decideColumnDeletion(
  board: Pick<BoardViewDTO, 'isFacilitator' | 'isLocked'> &
    Partial<Pick<BoardViewDTO, 'isBlurred'>>,
  totalColumns: number,
  cards: readonly (Pick<CardViewDTO, 'redacted'> &
    Partial<Pick<CardViewDTO, 'isMine'>>)[],
): BoardPolicyDecision {
  return decideColumnAction(
    {
      isFacilitator: board.isFacilitator,
      isLocked: board.isLocked,
      isPrivateMode: board.isBlurred ?? false,
    },
    {
      type: 'column:delete',
      columnCount: totalColumns,
      hasRedactedCards: cards.some((card) => card.redacted),
      hasOtherParticipantCards: cards.some((card) => card.isMine === false),
    },
  );
}

export function canDeleteColumn(
  board: Pick<BoardViewDTO, 'isFacilitator' | 'isLocked'> &
    Partial<Pick<BoardViewDTO, 'isBlurred'>>,
  totalColumns: number,
  cards: readonly (Pick<CardViewDTO, 'redacted'> &
    Partial<Pick<CardViewDTO, 'isMine'>>)[],
): boolean {
  return decideColumnDeletion(board, totalColumns, cards).allowed;
}
