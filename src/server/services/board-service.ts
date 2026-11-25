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
  BoardCommandSchema,
  BoardIdSchema,
  CreateBoardInputSchema,
} from '../../lib/schemas';
import {
  formatDefaultBoardTitle,
  getBoardTemplate,
} from '../../lib/templates';
import { getBoardRealtime, getBoardStore } from '../adapters/runtime';
import {
  generateBoardId,
  generateEntityId,
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
import { mintFacilitatorCapability } from '../facilitator-capability';
import { checkBoardCreateRateLimit } from '../rate-limit';
import {
  ensureParticipantSession,
  getSessionSecrets,
  grantFacilitatorSession,
  isFacilitatorForBoard,
} from '../session';

function httpStatusForBoardError(code: BoardErrorCode): number {
  switch (code) {
    case 'BOARD_LOCKED':
    case 'FORBIDDEN':
      return 403;
    case 'BOARD_NOT_FOUND':
    case 'NOT_FOUND':
      return 404;
    case 'RATE_LIMITED':
      return 429;
    case 'VALIDATION_ERROR':
    case 'LIMIT_EXCEEDED':
      return 400;
    case 'INTERNAL_ERROR':
      return 500;
  }
}

export class BoardDomainError extends Error {
  readonly code: BoardErrorCode;
  readonly status: number;

  constructor(code: BoardErrorCode, message: string) {
    super(message);
    this.name = 'BoardDomainError';
    this.code = code;
    this.status = httpStatusForBoardError(code);
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
  const {
    hash: facilitatorTokenHash,
    encrypted: facilitatorTokenEncrypted,
  } = await mintFacilitatorCapability({
    salt: tokenSalt,
    aad: boardId,
    secrets: getSessionSecrets(),
  });

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

export async function executeBoardMutation(
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

  try {
    await getBoardRealtime().publish(boardId, {
      snapshot: outcome.snapshot,
      events: outcome.rawEvents,
    });
  } catch (error) {
    // The write is already committed. Returning a failed write would invite retries.
    console.error('Board live delivery failed', error);
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

async function deleteBoardById(boardId: string): Promise<BoardMutationSuccess> {
  requireRequest();
  const store = await getBoardStore();

  const snapshot = await store.getBoardSnapshot(boardId);
  if (!snapshot) {
    throw new BoardDomainError('BOARD_NOT_FOUND', 'Board not found or expired.');
  }

  const session = await ensureParticipantSession({ renew: true });
  const isFacilitator = isFacilitatorForBoard(session, boardId);
  if (!isFacilitator) {
    if (snapshot.board.isLocked) {
      throw new BoardDomainError(
        'BOARD_LOCKED',
        'This Board is Locked and cannot be edited.',
      );
    }
    throw new BoardDomainError(
      'FORBIDDEN',
      'Only a Facilitator can delete this Board.',
    );
  }

  const deletedVersion = snapshot.board.version + 1;
  const deleted = await store.deleteBoard(boardId);
  if (!deleted) {
    throw new BoardDomainError('BOARD_NOT_FOUND', 'Board not found or expired.');
  }

  const event: Extract<BoardEvent, { type: 'board:deleted' }> = {
    type: 'board:deleted',
    version: deletedVersion,
  };
  try {
    await getBoardRealtime().publish(boardId, event);
  } catch (error) {
    // Storage is already purged; returning a failed delete would invite retries.
    console.error('Board delete live delivery failed', error);
  }

  return {
    ok: true,
    version: deletedVersion,
    events: [event],
  };
}

type ParsedBoardCommand = v.InferOutput<typeof BoardCommandSchema>;

function toStoreMutationCommand(
  command: Exclude<ParsedBoardCommand, { type: 'board:delete' }>,
): BoardMutationCommand {
  switch (command.type) {
    case 'card:create':
      return { ...command, id: generateEntityId() };
    case 'comment:create':
      return { ...command, id: generateEntityId() };
    case 'column:add':
      return { ...command, id: generateEntityId() };
    case 'group:merge':
      return { ...command, groupId: generateEntityId() };
    case 'board:rename':
    case 'timer:update':
    case 'board:set-private-mode':
    case 'board:set-lock':
    case 'card:update':
    case 'card:set-action':
    case 'card:move':
    case 'card:delete':
    case 'reaction:toggle':
    case 'comment:delete':
    case 'column:update':
    case 'column:reorder':
    case 'column:delete':
    case 'group:rename':
    case 'group:ungroup':
    case 'group:dissolve':
    case 'group:move':
    case 'vote:change':
    case 'voting:configure':
    case 'voting:reset':
      return command;
  }
}

export async function dispatchBoardCommandForRequest(
  rawBoardId: unknown,
  rawCommand: unknown,
): Promise<BoardMutationSuccess> {
  const boardId = parseMutationInput(BoardIdSchema, rawBoardId);
  const command = parseMutationInput(BoardCommandSchema, rawCommand);
  if (command.type === 'board:delete') {
    return deleteBoardById(boardId);
  }
  return executeBoardMutation(boardId, toStoreMutationCommand(command));
}
