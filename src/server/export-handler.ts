import 'server-only';
import { safeParse } from 'valibot';

import {
  EXPORT_CONTENT_TYPES,
  buildExportFilename,
  parseExportFormat,
  serializeBoardExport,
} from '../lib/board-export';
import { BoardIdSchema } from '../lib/schemas';
import { getBoardStore } from './adapters/runtime';
import { hashTokenWithSalt } from './crypto';
import { projectBoardForViewer } from './domain/projection';
import { getSessionFromRequest, isFacilitatorForBoard } from './session';

const BASE_EXPORT_HEADERS = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
} as const;

export async function handleExportRequest(
  boardId: string,
  request: Request,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, {
      status: 405,
      headers: {
        ...BASE_EXPORT_HEADERS,
        allow: 'GET, HEAD',
      },
    });
  }

  const url = new URL(request.url);
  const format = parseExportFormat(url.searchParams.get('format'));
  if (!format) {
    return new Response('Invalid or missing export format. Expected md, csv, or json.', {
      status: 400,
      headers: {
        ...BASE_EXPORT_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  const idCheck = safeParse(BoardIdSchema, boardId);
  if (!idCheck.success) {
    return new Response('Board not found or expired.', {
      status: 404,
      headers: {
        ...BASE_EXPORT_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  const store = await getBoardStore();
  const rawSnapshot = await store.getBoardSnapshot(idCheck.output);
  if (!rawSnapshot) {
    return new Response('Board not found or expired.', {
      status: 404,
      headers: {
        ...BASE_EXPORT_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  const session = await getSessionFromRequest(request);
  const viewerParticipantHash = session
    ? await hashTokenWithSalt(session.participantId, rawSnapshot.board.tokenSalt)
    : null;
  const isFacilitator = isFacilitatorForBoard(session, rawSnapshot.board.id);

  // Strictly project through the viewer DTO contract with zero bypass flags.
  const projected = projectBoardForViewer(
    rawSnapshot,
    viewerParticipantHash,
    isFacilitator,
  );

  const body = serializeBoardExport(projected, format);
  const filename = buildExportFilename(projected.title, format);

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      ...BASE_EXPORT_HEADERS,
      'content-type': EXPORT_CONTENT_TYPES[format],
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
