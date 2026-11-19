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
