import type {
  BoardTemplateId,
  BoardViewDTO,
  CardViewDTO,
  ColumnAccent,
  ReactionEmoji,
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
    reactions: Partial<Record<ReactionEmoji, number>>;
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

type ExportCard = BoardExportJson['cards'][number];
type ExportGroup = BoardExportJson['groups'][number];

function prepareExportCard(card: CardViewDTO, blindVoting: boolean): ExportCard {
  return {
    id: card.id,
    columnId: card.columnId,
    groupId: card.groupId,
    content: card.redacted ? REDACTED_CARD_PLACEHOLDER : card.content,
    redacted: card.redacted,
    isActionItem: !card.redacted && card.isActionItem,
    actionDone: !card.redacted && card.actionDone,
    actionOwner: card.redacted ? '' : card.actionOwner,
    votes: blindVoting || card.redacted ? null : card.votes,
    reactions: card.redacted ? {} : { ...card.reactions },
    comments: card.redacted ? [] : card.comments.map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
    })),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

export function prepareBoardExport(board: BoardViewDTO) {
  const cards = board.cards.map((card) => prepareExportCard(card, board.blindVoting));
  const cardsByGroup = Map.groupBy(cards, (card) => card.groupId);
  const cardsByColumn = Map.groupBy(cards, (card) => card.columnId);
  const ownGroupVotes = new Map<string, number>();
  const groups: ExportGroup[] = board.groups.map((group) => {
    const members = cardsByGroup.get(group.id) ?? [];
    const redacted = Boolean(group.redacted) || members.some((card) => card.redacted);
    if (!redacted) ownGroupVotes.set(group.id, group.myVotes);
    return {
      id: group.id,
      columnId: group.columnId,
      title: redacted ? '' : group.title,
      redacted,
      cardIds: [...group.cardIds],
      votes: board.blindVoting || redacted ? null : group.votes,
    };
  });
  const groupsByColumn = Map.groupBy(groups, (group) => group.columnId);
  const actionItems: BoardExportJson['actionItems'] = [];
  const columns = [...board.columns].sort((a, b) => a.position - b.position).map((column) => {
    const columnCards = cardsByColumn.get(column.id) ?? [];
    for (const card of columnCards) {
      if (card.isActionItem) {
        actionItems.push({
          cardId: card.id,
          columnId: column.id,
          columnTitle: column.title,
          content: card.content,
          done: card.actionDone,
          owner: card.actionOwner,
        });
      }
    }
    return {
      column: {
        id: column.id,
        title: column.title,
        accent: column.accent,
        position: column.position,
        isActionColumn: column.isActionColumn,
        cardCount: column.cardCount,
      },
      cards: columnCards.filter((card) => card.groupId === null),
      groups: (groupsByColumn.get(column.id) ?? []).flatMap((group) => {
        const members = (cardsByGroup.get(group.id) ?? []).filter((card) => card.columnId === column.id);
        const heading = group.redacted ? REDACTED_CARD_PLACEHOLDER : group.title.trim() || 'Card Group';
        return members.length ? [{ group, heading, cards: members }] : [];
      }),
    };
  });

  return {
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
    columns,
    groups,
    cards,
    actionItems,
    ownCardVotes: new Map(board.cards.filter((card) => !card.redacted).map((card) => [card.id, card.myVotes])),
    ownGroupVotes,
  };
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

function appendCardCommentsMarkdown(lines: string[], card: ExportCard): void {
  for (const comment of card.comments) {
    lines.push(
      formatIndentedBullet(comment.content.trim(), '  - Comment: ', '    '),
    );
  }
}

export function formatBoardMarkdown(board: BoardViewDTO): string {
  const document = prepareBoardExport(board);
  const lines = [`# ${document.board.title}`];
  const subtitle = document.board.subtitle.trim();
  if (subtitle.length > 0) {
    lines.push('');
    lines.push(subtitle);
  }

  for (const { column, groups, cards } of document.columns) {
    lines.push('');
    lines.push(`## ${column.title}`);

    if (groups.length === 0 && cards.length === 0) {
      lines.push('');
      lines.push('_No Cards_');
      continue;
    }

    for (const { group, heading, cards: memberCards } of groups) {
      lines.push('');
      lines.push(`### ${heading}${formatVotesSuffix(group.votes)}`);
      lines.push('');
      for (const card of memberCards) {
        lines.push(formatIndentedBullet(card.content, '- ', '  '));
        appendCardCommentsMarkdown(lines, card);
      }
    }

    if (cards.length > 0) {
      lines.push('');
      for (const card of cards) {
        const contentLines = card.content.replace(/\r\n?/g, '\n').split('\n');
        const firstLine = `${contentLines[0]}${formatVotesSuffix(card.votes)}`;
        const formatted = [
          `- ${firstLine}`,
          ...contentLines.slice(1).map((line) => `  ${line}`),
        ].join('\n');
        lines.push(formatted);
        appendCardCommentsMarkdown(lines, card);
      }
    }
  }

  if (document.actionItems.length > 0) {
    lines.push('');
    lines.push('## Action Items');
    lines.push('');
    for (const item of document.actionItems) {
      const content = item.content.replace(/\s+/g, ' ').trim();
      const owner = item.owner.trim();
      lines.push(
        `- [${item.done ? 'x' : ' '}] ${content}${owner ? ` (Owner: ${owner})` : ''}`,
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

function formatReactionsSummary(reactions: CardViewDTO['reactions']): string {
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
  const document = prepareBoardExport(board);

  function appendCard(columnTitle: string, groupTitle: string, card: ExportCard, votes: number | null): void {
    const createdAt = new Date(card.createdAt).toISOString();
    if (card.redacted) {
      rows.push([columnTitle, groupTitle, card.content, 'Yes', '', '', '', '', '', '', createdAt]);
      return;
    }

    rows.push([
      columnTitle,
      groupTitle,
      card.content,
      'No',
      votes === null ? '' : String(votes),
      card.isActionItem ? 'Yes' : 'No',
      card.isActionItem ? (card.actionDone ? 'Done' : 'Open') : '',
      card.isActionItem ? card.actionOwner : '',
      formatReactionsSummary(card.reactions),
      card.comments.map((comment) => comment.content).join(' | '),
      createdAt,
    ]);
  }

  for (const { column, groups, cards } of document.columns) {
    for (const { group, heading, cards: members } of groups) {
      for (const card of members) appendCard(column.title, heading, card, group.votes);
    }
    for (const card of cards) appendCard(column.title, '', card, card.votes);
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
  const document = prepareBoardExport(board);
  return {
    exportedAt,
    board: document.board,
    columns: document.columns.map(({ column }) => column),
    groups: document.groups,
    cards: document.cards,
    actionItems: document.actionItems,
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
