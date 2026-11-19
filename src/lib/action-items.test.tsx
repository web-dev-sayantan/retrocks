import { describe, expect, it } from 'vitest';

import type { CardViewDTO } from './board-types';
import { buildActionItemsMarkdown, filterActionItems } from './action-items';

function card(overrides: Partial<CardViewDTO>): CardViewDTO {
  return {
    id: 'card_1',
    columnId: 'col_1',
    groupId: null,
    content: 'Follow-up',
    redacted: false,
    isMine: false,
    isActionItem: true,
    actionDone: false,
    actionOwner: '',
    votes: 0,
    myVotes: 0,
    reactions: {},
    myReactions: [],
    commentCount: 0,
    comments: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('Action Item helpers', () => {
  it('builds GitHub-ready Markdown checklist lines with completion and optional owner', () => {
    const items = [
      card({
        id: 'a',
        content: 'Ship the API',
        actionDone: true,
        actionOwner: 'Platform',
      }),
      card({ id: 'b', content: 'Pair on flaky tests' }),
      card({
        id: 'c',
        content: 'Write\nthe  runbook',
        actionOwner: 'API squad',
      }),
    ];
    expect(buildActionItemsMarkdown(items)).toBe(
      [
        '- [x] Ship the API — Platform',
        '- [ ] Pair on flaky tests',
        '- [ ] Write the runbook — API squad',
      ].join('\n'),
    );
    expect(buildActionItemsMarkdown([])).toBe('');
  });

  it('filters Action Items by All, Open, and Done', () => {
    const open = card({ id: 'open' });
    const done = card({ id: 'done', actionDone: true });
    const regular = card({ id: 'regular', isActionItem: false });
    const items = [open, done, regular];

    expect(filterActionItems(items, 'all').map((item) => item.id)).toEqual([
      'open',
      'done',
    ]);
    expect(filterActionItems(items, 'open').map((item) => item.id)).toEqual([
      'open',
    ]);
    expect(filterActionItems(items, 'done').map((item) => item.id)).toEqual([
      'done',
    ]);
  });
});
