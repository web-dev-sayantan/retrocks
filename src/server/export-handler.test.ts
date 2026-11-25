import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function withSession<T>(request: Request, run: () => Promise<T>) {
  const event = createRequestEvent(request);
  return provideRequestEvent(event, async () => {
    const result = await run();
    const response = commitEventResponse(new Response(), event);
    const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
    return { result, cookie };
  });
}

describe('handleExportRequest()', () => {
  beforeEach(() => {
    vi.stubEnv(
      'SESSION_SECRET',
      'test-export-session-secret-with-at-least-32-chars',
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 400 for missing or invalid format, 404 for unknown board, and sets security/download headers', async () => {
    const { createBoardForRequest } = await import('./services/board-service');
    const { handleExportRequest } = await import('./export-handler');
    const origin = 'https://retrocks.app';

    const { result: board, cookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () =>
        createBoardForRequest({
          title: 'Sprint 42: Checkout / Retro!',
          subtitle: 'Checkout Team',
        }),
    );

    const missingFormat = await handleExportRequest(
      board.id,
      new Request(`${origin}/api/boards/${board.id}/export`, {
        headers: { cookie: cookie! },
      }),
    );
    expect(missingFormat.status).toBe(400);
    expect(missingFormat.headers.get('cache-control')).toBe('no-store');
    expect(missingFormat.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    const invalidFormat = await handleExportRequest(
      board.id,
      new Request(`${origin}/api/boards/${board.id}/export?format=pdf`, {
        headers: { cookie: cookie! },
      }),
    );
    expect(invalidFormat.status).toBe(400);

    const unknownBoard = await handleExportRequest(
      'nonexistent_board_id_1234',
      new Request(
        `${origin}/api/boards/nonexistent_board_id_1234/export?format=md`,
      ),
    );
    expect(unknownBoard.status).toBe(404);
    expect(unknownBoard.headers.get('cache-control')).toBe('no-store');
    expect(unknownBoard.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    const mdRes = await handleExportRequest(
      board.id,
      new Request(`${origin}/api/boards/${board.id}/export?format=md`, {
        headers: { cookie: cookie! },
      }),
    );
    expect(mdRes.status).toBe(200);
    expect(mdRes.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(mdRes.headers.get('content-disposition')).toBe(
      'attachment; filename="sprint-42-checkout-retro.md"',
    );
    expect(mdRes.headers.get('cache-control')).toBe('no-store');
    expect(mdRes.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    const csvRes = await handleExportRequest(
      board.id,
      new Request(`${origin}/api/boards/${board.id}/export?format=csv`, {
        headers: { cookie: cookie! },
      }),
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csvRes.headers.get('content-disposition')).toBe(
      'attachment; filename="sprint-42-checkout-retro.csv"',
    );

    const jsonRes = await handleExportRequest(
      board.id,
      new Request(`${origin}/api/boards/${board.id}/export?format=json`, {
        headers: { cookie: cookie! },
      }),
    );
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
    expect(jsonRes.headers.get('content-disposition')).toBe(
      'attachment; filename="sprint-42-checkout-retro.json"',
    );

    const postRes = await handleExportRequest(
      board.id,
      new Request(`${origin}/api/boards/${board.id}/export?format=md`, {
        method: 'POST',
        headers: { cookie: cookie! },
      }),
    );
    expect(postRes.status).toBe(405);
  });

  it('structures Markdown with Columns, Card Groups, revealed Votes, visible comments, and trailing Action Items checklist', async () => {
    const boardService = await import('./services/board-service');
    const { handleExportRequest } = await import('./export-handler');
    const origin = 'https://retrocks.app';

    const { result: board, cookie: facilitatorCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () =>
        boardService.createBoardForRequest({
          title: 'Sprint 42 Retro',
          subtitle: 'Checkout Squad',
        }),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    const dispatch = (cookie: string, command: unknown) =>
      withSession(
        new Request(boardUrl, { method: 'POST', headers: { cookie } }),
        () => boardService.dispatchBoardCommandForRequest(board.id, command),
      ).then((r) => r.result);

    const col0 = board.columns[0].id;
    const col1 = board.columns[1].id;
    const col2 = board.columns[2].id; // Action Items column

    const c1 = await dispatch(facilitatorCookie!, {
      type: 'card:create',
      columnId: col0,
      content: 'CI runs took 25m',
    });
    const card1Id = c1.events[0].type === 'card:upserted' ? c1.events[0].card.id : '';

    const c2 = await dispatch(facilitatorCookie!, {
      type: 'card:create',
      columnId: col0,
      content: 'Flaky integration suite',
    });
    const card2Id = c2.events[0].type === 'card:upserted' ? c2.events[0].card.id : '';

    const merged = await dispatch(facilitatorCookie!, {
      type: 'group:merge',
      cardId: card2Id,
      targetType: 'card',
      targetId: card1Id,
    });
    const groupEvent = merged.events.find((e) => e.type === 'group:upserted');
    const groupId = groupEvent?.type === 'group:upserted' ? groupEvent.group.id : '';

    await dispatch(facilitatorCookie!, {
      type: 'group:rename',
      groupId,
      title: 'CI Flakiness',
    });
    await dispatch(facilitatorCookie!, {
      type: 'vote:change',
      targetType: 'group',
      targetId: groupId,
      delta: 1,
    });
    await dispatch(facilitatorCookie!, {
      type: 'vote:change',
      targetType: 'group',
      targetId: groupId,
      delta: 1,
    });

    const standalone = await dispatch(facilitatorCookie!, {
      type: 'card:create',
      columnId: col1,
      content: 'Clarify release checklist',
    });
    const standaloneId =
      standalone.events[0].type === 'card:upserted' ? standalone.events[0].card.id : '';

    await dispatch(facilitatorCookie!, {
      type: 'vote:change',
      targetType: 'card',
      targetId: standaloneId,
      delta: 1,
    });
    await dispatch(facilitatorCookie!, {
      type: 'comment:create',
      cardId: standaloneId,
      content: 'Let us link the runbook here.',
    });

    const openAction = await dispatch(facilitatorCookie!, {
      type: 'card:create',
      columnId: col2,
      content: 'Split slow Playwright spec',
    });
    const openActionId =
      openAction.events[0].type === 'card:upserted' ? openAction.events[0].card.id : '';
    await dispatch(facilitatorCookie!, {
      type: 'card:set-action',
      cardId: openActionId,
      actionOwner: 'Platform',
    });

    const doneAction = await dispatch(facilitatorCookie!, {
      type: 'card:create',
      columnId: col2,
      content: 'Document rollback steps',
    });
    const doneActionId =
      doneAction.events[0].type === 'card:upserted' ? doneAction.events[0].card.id : '';
    await dispatch(facilitatorCookie!, {
      type: 'card:set-action',
      cardId: doneActionId,
      actionDone: true,
    });

    const res = await handleExportRequest(
      board.id,
      new Request(`${origin}/api/boards/${board.id}/export?format=md`, {
        headers: { cookie: facilitatorCookie! },
      }),
    );
    const md = await res.text();

    expect(md).toContain('# Sprint 42 Retro');
    expect(md).toContain('Checkout Squad');
    expect(md).toContain('## Went Well');
    expect(md).toContain('### CI Flakiness (2 votes)');
    expect(md).toContain('- CI runs took 25m');
    expect(md).toContain('- Flaky integration suite');
    expect(md).toContain('## To Improve');
    expect(md).toContain('- Clarify release checklist (1 vote)');
    expect(md).toContain('  - Comment: Let us link the runbook here.');
    expect(md).toContain('## Action Items');
    expect(md).toContain('- [ ] Split slow Playwright spec (Owner: Platform)');
    expect(md).toContain('- [x] Document rollback steps');
  });

  it('enforces Private Mode redaction across MD, CSV, and JSON exports even for the Facilitator', async () => {
    const boardService = await import('./services/board-service');
    const { handleExportRequest } = await import('./export-handler');
    const origin = 'https://retrocks.app';

    const { result: board, cookie: facilitatorCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => boardService.createBoardForRequest({ title: 'Private Export Test' }),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    const { cookie: participantCookie } = await withSession(
      new Request(boardUrl),
      () => boardService.getBoardForRequest(board.id),
    );
    const dispatch = (cookie: string, command: unknown) =>
      withSession(
        new Request(boardUrl, { method: 'POST', headers: { cookie } }),
        () => boardService.dispatchBoardCommandForRequest(board.id, command),
      ).then((r) => r.result);

    // Create cards, comments, reactions, and votes while revealed, then enable Private Mode
    // so we verify zero leakage of pre-existing votes, comments, reactions, or text!
    const secretCardText = 'TOP_SECRET_PARTICIPANT_NOTE_XYZ';
    const secretCommentText = 'TOP_SECRET_COMMENT_XYZ';
    const facilitatorCardText = 'FACILITATOR_OWN_NOTE_ABC';

    const participantCard = await dispatch(participantCookie!, {
      type: 'card:create',
      columnId: board.columns[0].id,
      content: secretCardText,
    });
    const participantCardId =
      participantCard.events[0].type === 'card:upserted'
        ? participantCard.events[0].card.id
        : '';

    await dispatch(participantCookie!, {
      type: 'comment:create',
      cardId: participantCardId,
      content: secretCommentText,
    });
    await dispatch(participantCookie!, {
      type: 'reaction:toggle',
      cardId: participantCardId,
      emoji: '🔥',
    });
    await dispatch(participantCookie!, {
      type: 'vote:change',
      targetType: 'card',
      targetId: participantCardId,
      delta: 1,
    });
    await dispatch(participantCookie!, {
      type: 'vote:change',
      targetType: 'card',
      targetId: participantCardId,
      delta: 1,
    });

    await dispatch(facilitatorCookie!, {
      type: 'card:create',
      columnId: board.columns[0].id,
      content: facilitatorCardText,
    });

    // Enable Private Mode
    await dispatch(facilitatorCookie!, {
      type: 'board:set-private-mode',
      isBlurred: true,
    });

    // Facilitator exports in MD, CSV, and JSON — participant's card MUST remain redacted!
    const [mdText, csvText, jsonText] = await Promise.all(
      (['md', 'csv', 'json'] as const).map(async (format) => {
        const res = await handleExportRequest(
          board.id,
          new Request(`${origin}/api/boards/${board.id}/export?format=${format}`, {
            headers: { cookie: facilitatorCookie! },
          }),
        );
        expect(res.status).toBe(200);
        return res.text();
      }),
    );

    for (const payload of [mdText, csvText, jsonText]) {
      expect(payload).not.toContain(secretCardText);
      expect(payload).not.toContain(secretCommentText);
      expect(payload).not.toContain('🔥');
      expect(payload).toContain(facilitatorCardText);
      expect(payload).toContain('[Hidden in Private Mode]');
    }

    // Verify zero leaked votes for the hidden card in Markdown, CSV, and JSON
    expect(mdText).not.toContain('2 votes');
    const jsonData = JSON.parse(jsonText) as {
      cards: Array<{
        id: string;
        redacted: boolean;
        content: string;
        votes: number | null;
        reactions: Record<string, number>;
        comments: unknown[];
      }>;
    };
    const hiddenCard = jsonData.cards.find((c) => c.id === participantCardId)!;
    expect(hiddenCard).toMatchObject({
      redacted: true,
      content: '[Hidden in Private Mode]',
      votes: null,
      reactions: {},
      comments: [],
    });

    // CSV row for hidden card has blank Votes, Reactions, Comments
    const csvLines = csvText.replace(/^\uFEFF/, '').trim().split('\r\n');
    const hiddenRow = csvLines.find((line) =>
      line.includes('[Hidden in Private Mode]'),
    )!;
    expect(hiddenRow).toContain(',[Hidden in Private Mode],Yes,,,,,,');
  });

  it('redacts Private Mode Card Group title and Vote totals across MD, CSV, and JSON exports for other Participants and Facilitators', async () => {
    const boardService = await import('./services/board-service');
    const { handleExportRequest } = await import('./export-handler');
    const origin = 'https://retrocks.app';

    const { result: board, cookie: facilitatorCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () =>
        boardService.createBoardForRequest({
          title: 'Private Group Export Test',
          isBlurred: true,
        }),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    const dispatch = (cookie: string, command: unknown) =>
      withSession(
        new Request(boardUrl, { method: 'POST', headers: { cookie } }),
        () => boardService.dispatchBoardCommandForRequest(board.id, command),
      ).then((r) => r.result);

    await dispatch(facilitatorCookie!, {
      type: 'voting:configure',
      allowParticipantGroup: true,
    });

    const { cookie: participantACookie } = await withSession(
      new Request(boardUrl),
      () => boardService.getBoardForRequest(board.id),
    );
    const { cookie: participantBCookie } = await withSession(
      new Request(boardUrl),
      () => boardService.getBoardForRequest(board.id),
    );

    const secretGroupTitle = 'CONFIDENTIAL_MERGED_THEME_999';
    const cardA1 = await dispatch(participantACookie!, {
      type: 'card:create',
      columnId: board.columns[0].id,
      content: secretGroupTitle,
    });
    const cardA1Id = cardA1.events[0].type === 'card:upserted' ? cardA1.events[0].card.id : '';
    const cardA2 = await dispatch(participantACookie!, {
      type: 'card:create',
      columnId: board.columns[0].id,
      content: 'CONFIDENTIAL_SECOND_CARD_999',
    });
    const cardA2Id = cardA2.events[0].type === 'card:upserted' ? cardA2.events[0].card.id : '';

    const merged = await dispatch(participantACookie!, {
      type: 'group:merge',
      cardId: cardA2Id,
      targetType: 'card',
      targetId: cardA1Id,
    });
    const groupEvent = merged.events.find((e) => e.type === 'group:upserted');
    const groupId = groupEvent?.type === 'group:upserted' ? groupEvent.group.id : '';

    await dispatch(participantACookie!, {
      type: 'vote:change',
      targetType: 'group',
      targetId: groupId,
      delta: 1,
    });
    await dispatch(participantACookie!, {
      type: 'vote:change',
      targetType: 'group',
      targetId: groupId,
      delta: 1,
    });

    // Neither Participant B nor Facilitator sees the group's title or votes in MD/CSV/JSON
    for (const viewerCookie of [participantBCookie!, facilitatorCookie!]) {
      const [mdText, csvText, jsonText] = await Promise.all(
        (['md', 'csv', 'json'] as const).map(async (format) => {
          const res = await handleExportRequest(
            board.id,
            new Request(`${origin}/api/boards/${board.id}/export?format=${format}`, {
              headers: { cookie: viewerCookie },
            }),
          );
          expect(res.status).toBe(200);
          return res.text();
        }),
      );

      for (const payload of [mdText, csvText, jsonText]) {
        expect(payload).not.toContain(secretGroupTitle);
        expect(payload).not.toContain('CONFIDENTIAL_SECOND_CARD_999');
      }

      expect(mdText).toContain('### [Hidden in Private Mode]\n');
      expect(mdText).not.toContain('2 votes');

      const csvLines = csvText.replace(/^\uFEFF/, '').trim().split('\r\n');
      expect(csvLines[1]).toContain(',[Hidden in Private Mode],[Hidden in Private Mode],Yes,,,,,,');

      const jsonData = JSON.parse(jsonText) as {
        groups: Array<{ id: string; title: string; redacted: boolean; votes: number | null }>;
      };
      expect(jsonData.groups).toEqual([
        expect.objectContaining({
          id: groupId,
          redacted: true,
          title: '',
          votes: null,
        }),
      ]);
    }
  });

  it('omits aggregate Vote totals in MD, CSV, and JSON while Blind Voting is ON even for the Facilitator', async () => {
    const boardService = await import('./services/board-service');
    const { handleExportRequest } = await import('./export-handler');
    const origin = 'https://retrocks.app';

    const { result: board, cookie: facilitatorCookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => boardService.createBoardForRequest({ title: 'Blind Voting Export' }),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    const dispatch = (cookie: string, command: unknown) =>
      withSession(
        new Request(boardUrl, { method: 'POST', headers: { cookie } }),
        () => boardService.dispatchBoardCommandForRequest(board.id, command),
      ).then((r) => r.result);

    const created = await dispatch(facilitatorCookie!, {
      type: 'card:create',
      columnId: board.columns[0].id,
      content: 'Invest in observability',
    });
    const cardId =
      created.events[0].type === 'card:upserted' ? created.events[0].card.id : '';

    await dispatch(facilitatorCookie!, {
      type: 'voting:configure',
      blindVoting: true,
    });
    await dispatch(facilitatorCookie!, {
      type: 'vote:change',
      targetType: 'card',
      targetId: cardId,
      delta: 1,
    });
    await dispatch(facilitatorCookie!, {
      type: 'vote:change',
      targetType: 'card',
      targetId: cardId,
      delta: 1,
    });

    const [mdText, csvText, jsonText] = await Promise.all(
      (['md', 'csv', 'json'] as const).map(async (format) => {
        const res = await handleExportRequest(
          board.id,
          new Request(`${origin}/api/boards/${board.id}/export?format=${format}`, {
            headers: { cookie: facilitatorCookie! },
          }),
        );
        return res.text();
      }),
    );

    expect(mdText).toContain('- Invest in observability');
    expect(mdText).not.toContain('2 votes');

    const jsonData = JSON.parse(jsonText) as {
      board: { blindVoting: boolean };
      cards: Array<{ id: string; votes: number | null }>;
    };
    expect(jsonData.board.blindVoting).toBe(true);
    expect(jsonData.cards[0].votes).toBeNull();

    // CSV Votes column (index 4) is blank
    const csvRows = csvText.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(csvRows[1].split(',')[4]).toBe('');
  });

  it('produces UTF-8 BOM CSV with RFC 4180 quoting and neutralizes all 6 formula-injection prefixes', async () => {
    const boardService = await import('./services/board-service');
    const { handleExportRequest } = await import('./export-handler');
    const origin = 'https://retrocks.app';

    const { result: board, cookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => boardService.createBoardForRequest({ title: 'CSV Safety Test' }),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    const post = <T>(run: () => Promise<T>) =>
      withSession(
        new Request(boardUrl, { method: 'POST', headers: { cookie: cookie! } }),
        run,
      ).then((r) => r.result);

    const dangerousPayloads = [
      '=SUM(A1:A2)',
      '+CMD("calc")',
      '-2+3',
      '@HYPERLINK("https://evil.example")',
      '\t=1+1',
      '\r=1+1',
      'Quoted "hello", with comma\nand newline',
    ];

    // Note: createCard trims leading/trailing whitespace via schema, so test \t and \r
    // via unit-level `formatBoardCsv` as well as full HTTP round-trip for non-trimmed payloads.
    for (const content of dangerousPayloads.slice(0, 4)) {
      await post(() =>
        boardService.dispatchBoardCommandForRequest(board.id, {
          type: 'card:create',
          columnId: board.columns[0].id,
          content,
        }),
      );
    }
    await post(() =>
      boardService.dispatchBoardCommandForRequest(board.id, {
        type: 'card:create',
        columnId: board.columns[0].id,
        content: dangerousPayloads[6],
      }),
    );

    const res = await handleExportRequest(
      board.id,
      new Request(`${origin}/api/boards/${board.id}/export?format=csv`, {
        headers: { cookie: cookie! },
      }),
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Verify real UTF-8 BOM bytes (0xEF 0xBB 0xBF) on the HTTP wire
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);

    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=SUM(A1:A2)");
    expect(csv).toContain(`"'+CMD(""calc"")"`);
    expect(csv).toContain("'-2+3");
    expect(csv).toContain(`"'@HYPERLINK(""https://evil.example"")"`);
    expect(csv).toContain('"Quoted ""hello"", with comma\nand newline"');

    // Direct check for all 6 leading formula characters including \t and \r
    const { escapeCsvCell } = await import('../lib/board-export');
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('-1+1')).toBe("'-1+1");
    expect(escapeCsvCell('@SUM(1,2)')).toBe(`"'@SUM(1,2)"`);
    expect(escapeCsvCell('\t=1+1')).toBe("'\t=1+1");
    expect(escapeCsvCell('\r=1+1')).toBe(`"'\r=1+1"`);
  });

  it('returns 404 when a Board has expired', async () => {
    const boardService = await import('./services/board-service');
    const { handleExportRequest } = await import('./export-handler');
    const origin = 'https://retrocks.app';

    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-01T00:00:00Z') });
    try {
      const { result: board, cookie } = await withSession(
        new Request(origin, { method: 'POST' }),
        () =>
          boardService.createBoardForRequest({
            title: 'Short Lived Board',
            retentionDays: 30,
          }),
      );

      // Advance 31 days past retention
      vi.setSystemTime(new Date('2026-02-02T00:00:00Z'));

      const expiredRes = await handleExportRequest(
        board.id,
        new Request(`${origin}/api/boards/${board.id}/export?format=md`, {
          headers: { cookie: cookie! },
        }),
      );
      expect(expiredRes.status).toBe(404);
      expect(expiredRes.headers.get('cache-control')).toBe('no-store');
      expect(expiredRes.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    } finally {
      vi.useRealTimers();
    }
  });

  it('strips all token hashes, salts, and encrypted secrets from JSON exports', async () => {
    const boardService = await import('./services/board-service');
    const { getBoardStore } = await import('./adapters/runtime');
    const { handleExportRequest } = await import('./export-handler');
    const origin = 'https://retrocks.app';

    const { result: board, cookie } = await withSession(
      new Request(origin, { method: 'POST' }),
      () => boardService.createBoardForRequest({ title: 'Secret Stripping Test' }),
    );
    const boardUrl = `${origin}/b/${board.id}`;
    await withSession(
      new Request(boardUrl, { method: 'POST', headers: { cookie: cookie! } }),
      () =>
        boardService.dispatchBoardCommandForRequest(board.id, {
          type: 'card:create',
          columnId: board.columns[0].id,
          content: 'Public card',
        }),
    );

    const store = await getBoardStore();
    const raw = await store.getBoardSnapshot(board.id);
    expect(raw).not.toBeNull();

    const res = await handleExportRequest(
      board.id,
      new Request(`${origin}/api/boards/${board.id}/export?format=json`, {
        headers: { cookie: cookie! },
      }),
    );
    const jsonText = await res.text();

    // Zero secret field names
    for (const forbiddenKey of [
      'facilitatorTokenHash',
      'facilitatorTokenEncrypted',
      'tokenSalt',
      'authorTokenHash',
      'voterTokenHash',
      'reactorTokenHash',
      'shareSecret',
    ]) {
      expect(jsonText).not.toContain(forbiddenKey);
    }

    // Zero raw secret values from storage
    expect(jsonText).not.toContain(raw!.board.facilitatorTokenHash);
    expect(jsonText).not.toContain(raw!.board.facilitatorTokenEncrypted);
    expect(jsonText).not.toContain(raw!.board.tokenSalt);
    expect(jsonText).not.toContain(raw!.cards[0].authorTokenHash);

    const parsed = JSON.parse(jsonText) as {
      board: { id: string; title: string };
      columns: unknown[];
      groups: unknown[];
      cards: Array<{ content: string }>;
      actionItems: unknown[];
    };
    expect(parsed.board.id).toBe(board.id);
    expect(parsed.board.title).toBe('Secret Stripping Test');
    expect(parsed.columns).toHaveLength(3);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].content).toBe('Public card');
    expect(parsed.actionItems).toEqual([]);
  });
});
