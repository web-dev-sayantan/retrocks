import 'server-only';
import { getRequestEvent, markSafeError } from '@solidjs/web';
import * as v from 'valibot';

import type {
  BoardErrorCode,
  BoardEvent,
  BoardMutationSuccess,
  BoardViewDTO,
} from '../../lib/board-types';
import {
  AddColumnInputSchema,
  BoardIdSchema,
  CreateBoardInputSchema,
  CreateCardInputSchema,
  DeleteCardInputSchema,
  DeleteColumnInputSchema,
  MoveCardInputSchema,
  RenameBoardInputSchema,
  ReorderColumnsInputSchema,
  UpdateCardInputSchema,
  UpdateColumnInputSchema,
} from '../../lib/schemas';
import {
  formatDefaultBoardTitle,
  getBoardTemplate,
} from '../../lib/templates';
import { getBoardStore } from '../adapters/runtime';
import {
  encryptFacilitatorToken,
  generateBoardId,
  generateEntityId,
  generateFacilitatorToken,
  generateTokenSalt,
  hashTokenWithSalt,
} from '../crypto';
import type {
  BoardMutationActor,
  BoardMutationCommand,
  CreateBoardRecord,
} from '../db/raw-types';
import {
  projectBoardForViewer,
  projectMutationEventsForViewer,
} from '../domain/projection';
import { checkBoardCreateRateLimit } from '../rate-limit';
import {
  ensureParticipantSession,
  getSessionSecrets,
  grantFacilitatorSession,
  isFacilitatorForBoard,
} from '../session';

export class BoardDomainError extends Error {
  readonly code: BoardErrorCode;

  constructor(code: BoardErrorCode, message: string) {
    super(message);
    this.name = 'BoardDomainError';
    this.code = code;
    markSafeError(this);
  }
}

function requireRequest(): Request {
  const event = getRequestEvent();
  if (!event) {
    throw new Error(
      'board-service: no request event — call within a server function or SSR handler',
    );
  }
  return event.request;
}

/**
 * Validates input, enforces Board-creation rate limits (zero IP persistence),
 * generates cryptographic Board/Facilitator capabilities, persists the Board
 * and Columns via `BoardStore`, and grants the signed `HttpOnly` Facilitator cookie.
 */
export async function createBoardForRequest(
  rawInput: unknown,
): Promise<BoardViewDTO> {
  const request = requireRequest();

  const parsed = v.safeParse(CreateBoardInputSchema, rawInput ?? {});
  if (!parsed.success) {
    const firstMessage =
      parsed.issues[0]?.message ?? 'Invalid Board configuration.';
    throw new BoardDomainError('VALIDATION_ERROR', firstMessage);
  }

  const rateLimit = await checkBoardCreateRateLimit(request);
  if (!rateLimit.allowed) {
    throw new BoardDomainError(
      'RATE_LIMITED',
      'Too many Boards created recently. Please wait a minute and try again.',
    );
  }

  const input = parsed.output;
  const now = Date.now();
  const title =
    input.title.length > 0 ? input.title : formatDefaultBoardTitle(new Date(now));
  const template = getBoardTemplate(input.templateId);
  const columnDefs = input.columns ?? template.columns;

  const boardId = generateBoardId();
  const tokenSalt = generateTokenSalt();
  const facilitatorToken = generateFacilitatorToken();
  const [facilitatorTokenHash, facilitatorTokenEncrypted] = await Promise.all([
    hashTokenWithSalt(facilitatorToken, tokenSalt),
    encryptFacilitatorToken(facilitatorToken, boardId, getSessionSecrets()),
  ]);

  const record: CreateBoardRecord = {
    id: boardId,
    title,
    subtitle: input.subtitle,
    templateId: input.templateId,
    facilitatorTokenHash,
    facilitatorTokenEncrypted,
    tokenSalt,
    isBlurred: input.isBlurred,
    voteLimit: input.voteLimit,
    maxVotesPerCard: input.maxVotesPerCard,
    retentionDays: input.retentionDays,
    createdAt: now,
    columns: columnDefs.map((col, index) => ({
      id: generateEntityId(),
      title: col.title,
      accent: col.accent,
      position: index,
      isActionColumn: Boolean(col.isActionColumn),
    })),
  };

  const store = await getBoardStore();
  const rawSnapshot = await store.createBoard(record);
  const session = await grantFacilitatorSession(boardId);
  const viewerParticipantHash = await hashTokenWithSalt(
    session.participantId,
    rawSnapshot.board.tokenSalt,
  );

  return projectBoardForViewer(rawSnapshot, viewerParticipantHash, true);
}

/**
 * Loads a Board for SSR or client refresh, lazily minting the anonymous
 * `participantId` cookie if absent (never on missing/expired Boards), and
 * returns the strictly secret-stripped viewer projection.
 */
export async function getBoardForRequest(
  boardId: string,
): Promise<BoardViewDTO | null> {
  const idCheck = v.safeParse(BoardIdSchema, boardId);
  if (!idCheck.success) {
    return null;
  }

  const store = await getBoardStore();
  const rawSnapshot = await store.getBoardSnapshot(idCheck.output);
  if (!rawSnapshot) {
    return null;
  }

  const session = await ensureParticipantSession();
  const isFacilitator = isFacilitatorForBoard(session, rawSnapshot.board.id);
  const viewerParticipantHash = await hashTokenWithSalt(
    session.participantId,
    rawSnapshot.board.tokenSalt,
  );

  return projectBoardForViewer(rawSnapshot, viewerParticipantHash, isFacilitator);
}

function parseMutationInput<
  TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(schema: TSchema, rawInput: unknown): v.InferOutput<TSchema> {
  const parsed = v.safeParse(schema, rawInput);
  if (!parsed.success) {
    const firstMessage =
      parsed.issues[0]?.message ?? 'Invalid request payload.';
    throw new BoardDomainError('VALIDATION_ERROR', firstMessage);
  }
  return parsed.output;
}

async function executeBoardMutation(
  boardId: string,
  command: BoardMutationCommand,
): Promise<BoardMutationSuccess> {
  requireRequest();
  const store = await getBoardStore();

  const tokenSalt = await store.getBoardTokenSalt(boardId);
  if (!tokenSalt) {
    throw new BoardDomainError('BOARD_NOT_FOUND', 'Board not found or expired.');
  }

  // Sliding 90-day cookie renewal on writes (SPEC §2.1)
  const session = await ensureParticipantSession({ renew: true });
  const isFacilitator = isFacilitatorForBoard(session, boardId);
  const participantHash = await hashTokenWithSalt(
    session.participantId,
    tokenSalt,
  );
  const actor: BoardMutationActor = { participantHash, isFacilitator };

  const outcome = await store.mutateBoard(boardId, actor, command);
  if (!outcome.ok) {
    throw new BoardDomainError(outcome.code, outcome.message);
  }

  const events: BoardEvent[] = projectMutationEventsForViewer(
    outcome.snapshot,
    outcome.rawEvents,
    participantHash,
    isFacilitator,
  );

  return {
    ok: true,
    version: outcome.version,
    events,
  };
}

export async function renameBoardForRequest(
  rawInput: unknown,
): Promise<BoardMutationSuccess> {
  const input = parseMutationInput(RenameBoardInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'board:rename',
    title: input.title,
    ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
  });
}

export async function createCardForRequest(
  rawInput: unknown,
): Promise<BoardMutationSuccess> {
  const input = parseMutationInput(CreateCardInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'card:create',
    id: generateEntityId(),
    columnId: input.columnId,
    content: input.content,
  });
}

export async function updateCardForRequest(
  rawInput: unknown,
): Promise<BoardMutationSuccess> {
  const input = parseMutationInput(UpdateCardInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'card:update',
    cardId: input.cardId,
    content: input.content,
  });
}

export async function moveCardForRequest(
  rawInput: unknown,
): Promise<BoardMutationSuccess> {
  const input = parseMutationInput(MoveCardInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'card:move',
    cardId: input.cardId,
    targetColumnId: input.targetColumnId,
  });
}

export async function deleteCardForRequest(
  rawInput: unknown,
): Promise<BoardMutationSuccess> {
  const input = parseMutationInput(DeleteCardInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'card:delete',
    cardId: input.cardId,
  });
}

export async function addColumnForRequest(
  rawInput: unknown,
): Promise<BoardMutationSuccess> {
  const input = parseMutationInput(AddColumnInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'column:add',
    id: generateEntityId(),
    title: input.title,
    accent: input.accent,
    isActionColumn: input.isActionColumn,
  });
}

export async function updateColumnForRequest(
  rawInput: unknown,
): Promise<BoardMutationSuccess> {
  const input = parseMutationInput(UpdateColumnInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'column:update',
    columnId: input.columnId,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.accent !== undefined ? { accent: input.accent } : {}),
    ...(input.isActionColumn !== undefined
      ? { isActionColumn: input.isActionColumn }
      : {}),
  });
}

export async function reorderColumnsForRequest(
  rawInput: unknown,
): Promise<BoardMutationSuccess> {
  const input = parseMutationInput(ReorderColumnsInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'column:reorder',
    columnIds: input.columnIds,
  });
}

export async function deleteColumnForRequest(
  rawInput: unknown,
): Promise<BoardMutationSuccess> {
  const input = parseMutationInput(DeleteColumnInputSchema, rawInput);
  return executeBoardMutation(input.boardId, {
    type: 'column:delete',
    columnId: input.columnId,
  });
}
