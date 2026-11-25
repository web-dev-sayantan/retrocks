import { render, within } from '@solidjs/testing-library';
import { expect, it } from 'vitest';

import {
  buildBoardExportJson,
  formatBoardCsv,
  formatBoardMarkdown,
  REDACTED_CARD_PLACEHOLDER,
} from '../lib/board-export';
import { makeBoardView, makeCard } from '../lib/board-fixtures';
import PrintBoard from './PrintBoard';

it('keeps grouped Cards, Action Items, and viewer privacy consistent across export formats', () => {
  const board = makeBoardView({ isBlurred: true, blindVoting: true });
  board.columns.reverse();
  board.groups = [{
    id: 'group',
    columnId: 'col_1',
    title: 'Private group title',
    cardIds: ['member', 'hidden'],
    votes: 83,
    myVotes: 9,
    createdAt: 0,
  }];
  board.cards = [
    makeCard({ id: 'standalone', content: 'Standalone Card', votes: 77, myVotes: 2 }),
    makeCard({
      id: 'member', groupId: 'group', content: 'Visible group member', isActionItem: true,
      actionDone: true, actionOwner: 'Platform', comments: [{
        id: 'visible_comment', cardId: 'member', content: 'Visible comment', isMine: true, createdAt: 1,
      }],
    }),
    makeCard({
      id: 'hidden', groupId: 'group', content: 'Private Card text', redacted: true,
      isActionItem: true, actionOwner: 'Private owner', votes: 88, myVotes: 8, comments: [{
        id: 'hidden_comment', cardId: 'hidden', content: 'Private comment', isMine: false, createdAt: 1,
      }],
    }),
  ];

  const { getByRole } = render(() => <PrintBoard board={board} />);
  const print = getByRole('article', { name: 'Printable Board' });
  const markdown = formatBoardMarkdown(board);
  const csv = formatBoardCsv(board);
  const json = buildBoardExportJson(board);

  for (const content of [print.textContent ?? '', markdown, csv]) {
    expect(content).toMatch(/Went Well[\s\S]+Visible group member[\s\S]+Standalone Card/);
  }
  for (const content of [print.textContent ?? '', markdown, csv, JSON.stringify(json)]) {
    expect(content).toContain(REDACTED_CARD_PLACEHOLDER);
    expect(content).toContain('Visible comment');
    expect(content).toContain('Platform');
    expect(content).not.toMatch(/Private (group title|Card text|owner|comment)/);
  }

  expect(within(print).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
    .toEqual(['Went Well', 'To Improve', 'Action Items']);
  expect(print).toHaveTextContent('2 of your Votes');
  expect(print).not.toHaveTextContent(/77 Votes|9 of your Votes|8 of your Votes/);
  expect(markdown).not.toMatch(/77 votes|83 votes/i);
  expect(csv).toContain('Standalone Card,No,,');
  expect(json.cards.map((card) => [card.id, card.votes]))
    .toEqual([['standalone', null], ['member', null], ['hidden', null]]);
  expect(json.groups[0]).toMatchObject({ redacted: true, title: '', votes: null });
  expect(json.actionItems).toMatchObject([{ cardId: 'member', owner: 'Platform', done: true }]);
  expect(JSON.stringify(json)).not.toContain('myVotes');
});
