import type { CardViewDTO } from './board-types';

export type ActionItemFilter = 'all' | 'open' | 'done';

export function filterActionItems(
  cards: readonly CardViewDTO[],
  filter: ActionItemFilter,
): CardViewDTO[] {
  return cards.filter(
    (card) =>
      card.isActionItem &&
      (filter === 'all' ||
        (filter === 'open' ? !card.actionDone : card.actionDone)),
  );
}

export function buildActionItemsMarkdown(
  cards: readonly CardViewDTO[],
): string {
  return cards
    .map((card) => {
      const content = card.content.replace(/\s+/g, ' ').trim();
      const owner = card.actionOwner.trim();
      return `- [${card.actionDone ? 'x' : ' '}] ${content}${
        owner ? ` — ${owner}` : ''
      }`;
    })
    .join('\n');
}
