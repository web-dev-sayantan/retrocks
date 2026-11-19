import type {
  BoardTemplateId,
  BoardViewDTO,
  CardGroupDTO,
  CardViewDTO,
  ColumnAccent,
  ColumnDTO,
} from './board-types';

export const EXPORT_FORMATS = ['md', 'csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const REDACTED_CARD_PLACEHOLDER = '[Hidden in Private Mode]';

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;
const CSV_NEEDS_QUOTING = /[",\r\n]/;

export interface BoardExportJson {
  exportedAt: string;
  board: {
    id: string;
    title: string;
    subtitle: string;
    templateId: BoardTemplateId;
    isBlurred: boolean;
    blindVoting: boolean;
    isLocked: boolean;
    allowParticipantGroup: boolean;
    voteLimit: number | null;
    maxVotesPerCard: number | null;
    version: number;
    retentionDays: number;
    createdAt: number;
    lastActiveAt: number;
  };
  columns: Array<{
    id: string;
    title: string;
    accent: ColumnAccent;
    position: number;
    isActionColumn: boolean;
    cardCount: number;
  }>;
  groups: Array<{
    id: string;
    columnId: string;
    title: string;
    redacted: boolean;
    cardIds: string[];
    votes: number | null;
  }>;
  cards: Array<{
    id: string;
    columnId: string;
    groupId: string | null;
    content: string;
    redacted: boolean;
    isActionItem: boolean;
    actionDone: boolean;
    actionOwner: string;
    votes: number | null;
    reactions: Record<string, number>;
    comments: Array<{
      id: string;
      content: string;
      createdAt: number;
    }>;
    createdAt: number;
    updatedAt: number;
  }>;
  actionItems: Array<{
    cardId: string;
    columnId: string;
    columnTitle: string;
    content: string;
    done: boolean;
    owner: string;
  }>;
}

export function parseExportFormat(raw: string | null): ExportFormat | null {
  if (raw === 'md' || raw === 'csv' || raw === 'json') {
    return raw;
  }
  return null;
}

export function sanitizeBoardSlug(title: string): string {
  const normalized = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return normalized.length > 0 ? normalized : 'retrocks-board';
}

export function buildExportFilename(title: string, format: ExportFormat): string {
  return `${sanitizeBoardSlug(title)}.${format}`;
}

export function buildExportUrl(boardId: string, format: ExportFormat): string {
  return `/api/boards/${encodeURIComponent(boardId)}/export?format=${format}`;
}

function getSortedColumns(board: BoardViewDTO): ColumnDTO[] {
  return [...board.columns].sort((a, b) => a.position - b.position);
}

function isGroupRedacted(
  group: CardGroupDTO,
  memberCards: readonly CardViewDTO[],
): boolean {
  return Boolean(group.redacted) || memberCards.some((card) => card.redacted);
}

function getGroupVisibleVotes(
  board: BoardViewDTO,
  group: CardGroupDTO,
  memberCards: readonly CardViewDTO[],
): number | null {
  if (board.blindVoting || group.votes === null) {
    return null;
  }
  if (isGroupRedacted(group, memberCards)) {
    return null;
  }
  return group.votes;
}

function getCardVisibleVotes(
  board: BoardViewDTO,
  card: CardViewDTO,
): number | null {
  if (board.blindVoting || card.redacted || card.votes === null) {
    return null;
  }
  return card.votes;
}

function formatVotesSuffix(votes: number | null): string {
  if (votes === null || votes <= 0) return '';
  return ` (${votes} ${votes === 1 ? 'vote' : 'votes'})`;
}

function formatIndentedBullet(text: string, prefix: string, continuationIndent: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines
    .map((line, index) => (index === 0 ? `${prefix}${line}` : `${continuationIndent}${line}`))
    .join('\n');
}

function appendCardCommentsMarkdown(lines: string[], card: CardViewDTO): void {
  if (card.redacted || card.comments.length === 0) return;
  for (const comment of card.comments) {
    lines.push(
      formatIndentedBullet(comment.content.trim(), '  - Comment: ', '    '),
    );
  }
}

export function formatBoardMarkdown(board: BoardViewDTO): string {
  const lines: string[] = [];
  lines.push(`# ${board.title}`);

  const subtitle = board.subtitle.trim();
  if (subtitle.length > 0) {
    lines.push('');
    lines.push(subtitle);
  }

  const columns = getSortedColumns(board);
  const visibleActionItems: CardViewDTO[] = [];

  for (const column of columns) {
    lines.push('');
    lines.push(`## ${column.title}`);

    const columnCards = board.cards.filter((card) => card.columnId === column.id);
    const columnGroups = board.groups
      .filter((group) => group.columnId === column.id)
      .map((group) => ({
        group,
        cards: columnCards.filter((card) => card.groupId === group.id),
      }))
      .filter((entry) => entry.cards.length > 0);
    const standaloneCards = columnCards.filter((card) => card.groupId === null);

    for (const card of columnCards) {
      if (!card.redacted && card.isActionItem) {
        visibleActionItems.push(card);
      }
    }

    if (columnGroups.length === 0 && standaloneCards.length === 0) {
      lines.push('');
      lines.push('_No Cards_');
      continue;
    }

    for (const { group, cards: memberCards } of columnGroups) {
      const groupRedacted = isGroupRedacted(group, memberCards);
      const groupTitle = groupRedacted
        ? REDACTED_CARD_PLACEHOLDER
        : group.title.trim() || 'Card Group';
      const groupVotes = groupRedacted
        ? null
        : getGroupVisibleVotes(board, group, memberCards);
      lines.push('');
      lines.push(`### ${groupTitle}${formatVotesSuffix(groupVotes)}`);
      lines.push('');
      for (const card of memberCards) {
        if (card.redacted) {
          lines.push(`- ${REDACTED_CARD_PLACEHOLDER}`);
          continue;
        }
        lines.push(formatIndentedBullet(card.content, '- ', '  '));
        appendCardCommentsMarkdown(lines, card);
      }
    }

    if (standaloneCards.length > 0) {
      lines.push('');
      for (const card of standaloneCards) {
        if (card.redacted) {
          lines.push(`- ${REDACTED_CARD_PLACEHOLDER}`);
          continue;
        }
        const cardVotes = getCardVisibleVotes(board, card);
        const contentLines = card.content.replace(/\r\n?/g, '\n').split('\n');
        const firstLine = `${contentLines[0]}${formatVotesSuffix(cardVotes)}`;
        const formatted = [
          `- ${firstLine}`,
          ...contentLines.slice(1).map((line) => `  ${line}`),
        ].join('\n');
        lines.push(formatted);
        appendCardCommentsMarkdown(lines, card);
      }
    }
  }

  if (visibleActionItems.length > 0) {
    lines.push('');
    lines.push('## Action Items');
    lines.push('');
    for (const card of visibleActionItems) {
      const content = card.content.replace(/\s+/g, ' ').trim();
      const owner = card.actionOwner.trim();
      lines.push(
        `- [${card.actionDone ? 'x' : ' '}] ${content}${
          owner.length > 0 ? ` (Owner: ${owner})` : ''
        }`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Neutralizes spreadsheet formula injection (leading `=`, `+`, `-`, `@`, `\t`, `\r`)
 * and applies RFC 4180 quoting.
 */
export function escapeCsvCell(value: string): string {
  const safe = CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (CSV_NEEDS_QUOTING.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function formatReactionsSummary(reactions: Record<string, number>): string {
  return Object.entries(reactions)
    .filter(([, count]) => count > 0)
    .map(([emoji, count]) => `${emoji} ${count}`)
    .join('; ');
}

export function formatBoardCsv(board: BoardViewDTO): string {
  const header = [
    'Column',
    'Group',
    'Card',
    'Redacted',
    'Votes',
    'Action Item',
    'Action Status',
    'Action Owner',
    'Reactions',
    'Comments',
    'Created At',
  ];

  const rows: string[][] = [header];
  const columns = getSortedColumns(board);
  const groupsById = new Map(board.groups.map((group) => [group.id, group]));
  const cardsByGroupId = new Map<string, CardViewDTO[]>();
  for (const card of board.cards) {
    if (card.groupId !== null) {
      let list = cardsByGroupId.get(card.groupId);
      if (!list) {
        list = [];
        cardsByGroupId.set(card.groupId, list);
      }
      list.push(card);
    }
  }

  for (const column of columns) {
    const columnCards = board.cards.filter((card) => card.columnId === column.id);
    const orderedCards: CardViewDTO[] = [];
    const columnGroups = board.groups.filter((g) => g.columnId === column.id);
    for (const group of columnGroups) {
      orderedCards.push(
        ...columnCards.filter((card) => card.groupId === group.id),
      );
    }
    orderedCards.push(
      ...columnCards.filter((card) => card.groupId === null),
    );

    for (const card of orderedCards) {
      const group = card.groupId ? groupsById.get(card.groupId) ?? null : null;
      const groupMembers = group ? (cardsByGroupId.get(group.id) ?? []) : [];
      const groupRedacted = group ? isGroupRedacted(group, groupMembers) : false;
      const groupTitle = group
        ? groupRedacted
          ? REDACTED_CARD_PLACEHOLDER
          : group.title.trim() || 'Card Group'
        : '';

      if (card.redacted) {
        rows.push([
          column.title,
          groupTitle,
          REDACTED_CARD_PLACEHOLDER,
          'Yes',
          '',
          '',
          '',
          '',
          '',
          '',
          new Date(card.createdAt).toISOString(),
        ]);
        continue;
      }

      let votesCell = '';
      if (!board.blindVoting) {
        if (group) {
          const members = cardsByGroupId.get(group.id) ?? [];
          const groupVotes = getGroupVisibleVotes(board, group, members);
          votesCell = groupVotes === null ? '' : String(groupVotes);
        } else {
          const cardVotes = getCardVisibleVotes(board, card);
          votesCell = cardVotes === null ? '' : String(cardVotes);
        }
      }

      rows.push([
        column.title,
        groupTitle,
        card.content,
        'No',
        votesCell,
        card.isActionItem ? 'Yes' : 'No',
        card.isActionItem ? (card.actionDone ? 'Done' : 'Open') : '',
        card.isActionItem ? card.actionOwner : '',
        formatReactionsSummary(card.reactions),
        card.comments.map((comment) => comment.content).join(' | '),
        new Date(card.createdAt).toISOString(),
      ]);
    }
  }

  const csvBody = rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
    .join('\r\n');

  return `\uFEFF${csvBody}\r\n`;
}

export function buildBoardExportJson(
  board: BoardViewDTO,
  exportedAt: string = new Date().toISOString(),
): BoardExportJson {
  const columns = getSortedColumns(board);
  const columnTitleById = new Map(columns.map((col) => [col.id, col.title]));
  const cardsByGroupId = new Map<string, CardViewDTO[]>();
  for (const card of board.cards) {
    if (card.groupId !== null) {
      let list = cardsByGroupId.get(card.groupId);
      if (!list) {
        list = [];
        cardsByGroupId.set(card.groupId, list);
      }
      list.push(card);
    }
  }

  const exportedCards: BoardExportJson['cards'] = board.cards.map((card) => {
    if (card.redacted) {
      return {
        id: card.id,
        columnId: card.columnId,
        groupId: card.groupId,
        content: REDACTED_CARD_PLACEHOLDER,
        redacted: true,
        isActionItem: false,
        actionDone: false,
        actionOwner: '',
        votes: null,
        reactions: {},
        comments: [],
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      };
    }

    return {
      id: card.id,
      columnId: card.columnId,
      groupId: card.groupId,
      content: card.content,
      redacted: false,
      isActionItem: card.isActionItem,
      actionDone: card.actionDone,
      actionOwner: card.actionOwner,
      votes: getCardVisibleVotes(board, card),
      reactions: { ...card.reactions },
      comments: card.comments.map((comment) => ({
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt,
      })),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  });

  const exportedGroups: BoardExportJson['groups'] = board.groups.map((group) => {
    const memberCards = cardsByGroupId.get(group.id) ?? [];
    const redacted = isGroupRedacted(group, memberCards);
    return {
      id: group.id,
      columnId: group.columnId,
      title: redacted ? '' : group.title,
      redacted,
      cardIds: [...group.cardIds],
      votes: redacted ? null : getGroupVisibleVotes(board, group, memberCards),
    };
  });

  const actionItems: BoardExportJson['actionItems'] = [];
  for (const column of columns) {
    for (const card of board.cards) {
      if (card.columnId === column.id && !card.redacted && card.isActionItem) {
        actionItems.push({
          cardId: card.id,
          columnId: card.columnId,
          columnTitle: columnTitleById.get(card.columnId) ?? '',
          content: card.content,
          done: card.actionDone,
          owner: card.actionOwner,
        });
      }
    }
  }

  return {
    exportedAt,
    board: {
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
      version: board.version,
      retentionDays: board.retentionDays,
      createdAt: board.createdAt,
      lastActiveAt: board.lastActiveAt,
    },
    columns: columns.map((column) => ({
      id: column.id,
      title: column.title,
      accent: column.accent,
      position: column.position,
      isActionColumn: column.isActionColumn,
      cardCount: column.cardCount,
    })),
    groups: exportedGroups,
    cards: exportedCards,
    actionItems,
  };
}

export function formatBoardJson(
  board: BoardViewDTO,
  exportedAt?: string,
): string {
  return `${JSON.stringify(buildBoardExportJson(board, exportedAt), null, 2)}\n`;
}

export function serializeBoardExport(
  board: BoardViewDTO,
  format: ExportFormat,
): string {
  switch (format) {
    case 'md':
      return formatBoardMarkdown(board);
    case 'csv':
      return formatBoardCsv(board);
    case 'json':
      return formatBoardJson(board);
  }
}
