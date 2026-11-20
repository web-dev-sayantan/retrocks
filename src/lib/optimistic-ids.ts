const OPTIMISTIC_ID_PREFIX = 'optimistic:';

/** True for client-only Card ids that must never reach the server. */
export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

export function makeOptimisticCardId(sequence: number): string {
  return `${OPTIMISTIC_ID_PREFIX}card:${sequence}`;
}
