import type { TemplateColumnDef } from './templates';

export const SECRET_THEMES = [
  { id: 'retro', name: 'Retro 1984', colorScheme: 'dark' },
  { id: 'parchment', name: 'Parchment', colorScheme: 'light' },
] as const;

export type HiddenTemplateId = 'dungeon-quest' | 'coffee-shop' | 'mission-control' | 'pirate-ship';

export interface HiddenTemplate {
  id: HiddenTemplateId;
  name: string;
  keywords: RegExp;
  columns: readonly TemplateColumnDef[];
}

const hiddenTemplates: readonly HiddenTemplate[] = [
  {
    id: 'dungeon-quest',
    name: 'Dungeon Quest',
    keywords: /\b(?:dnd|d&d|dungeon|quest|dragon)\b/i,
    columns: [
      { title: 'Loot', accent: 'amber' },
      { title: 'Monsters', accent: 'coral' },
      { title: 'Traps', accent: 'rose' },
      { title: 'Next Quest', accent: 'sage', isActionColumn: true },
    ],
  },
  {
    id: 'coffee-shop',
    name: 'Coffee Shop',
    keywords: /\b(?:coffee|cafe|espresso|barista|latte)\b/i,
    columns: [
      { title: 'Strong Shot', accent: 'amber' },
      { title: 'Bitter Notes', accent: 'coral' },
      { title: 'Sweet Finish', accent: 'sage' },
      { title: 'Refill', accent: 'sky', isActionColumn: true },
    ],
  },
  {
    id: 'mission-control',
    name: 'Mission Control',
    keywords: /\b(?:space|orbit|launch|apollo|rocket)\b/i,
    columns: [
      { title: 'Liftoff', accent: 'sky' },
      { title: 'Turbulence', accent: 'coral' },
      { title: 'Gravity', accent: 'slate' },
      { title: 'Next Orbit', accent: 'violet', isActionColumn: true },
    ],
  },
  {
    id: 'pirate-ship',
    name: 'Pirate Ship',
    keywords: /\b(?:pirate|ahoy|treasure|kraken)\b/i,
    columns: [
      { title: 'Treasure', accent: 'amber' },
      { title: 'Kraken', accent: 'rose' },
      { title: 'Walk the Plank', accent: 'coral' },
      { title: 'New Horizon', accent: 'teal', isActionColumn: true },
    ],
  },
];

export function matchHiddenTemplate(
  text: string,
  excluded: readonly HiddenTemplateId[],
): HiddenTemplate | undefined {
  return hiddenTemplates.find((template) =>
    !excluded.includes(template.id) && template.keywords.test(text),
  );
}

export const RETROSPECTIVE_PRIME_DIRECTIVE = {
  excerpt:
    'Regardless of what we discover, we must understand and truly believe that everyone did the best job he or she could',
  source: 'https://www.dorsethouse.com/features/interviews/intkerthv11n2.html',
} as const;

const SECRET_SEARCHES = [
  {
    queries: ['blame'],
    id: 'blame',
    message: 'No blame found here.',
  },
  {
    queries: ['meetings'],
    id: 'meetings',
    message: 'No Cards matched — this search could have been an email.',
  },
  {
    queries: ['42'],
    id: '42',
    message: 'The answer to life, the sprint, and everything.',
  },
  {
    queries: ['scope creep'],
    id: 'scope-creep',
    message: "Careful, don't let it grow.",
  },
  {
    queries: ['retrocks', 'rock'],
    id: 'rock',
    message: 'Retrospectives that rock.',
  },
  {
    queries: ['pivot'],
    id: 'pivot',
    message: 'Pivot!',
  },
  {
    queries: ['kudos', 'party'],
    id: 'kudos',
    message: 'Kudos all around!',
  },
] as const;

export function matchSecretSearch(query: string) {
  const normalized = query.trim().toLowerCase();
  return SECRET_SEARCHES.find((egg) => egg.queries.some((keyword) => keyword === normalized));
}
