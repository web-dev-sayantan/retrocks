import { describe, expect, it } from 'vitest';

import { isOptimisticId, makeOptimisticCardId } from './optimistic-ids';

describe('optimistic ids', () => {
  it('marks generated ids as optimistic and keeps server ids out', () => {
    expect(isOptimisticId(makeOptimisticCardId(7))).toBe(true);
    expect(isOptimisticId('card_1')).toBe(false);
  });
});
