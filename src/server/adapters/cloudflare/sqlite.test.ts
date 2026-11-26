import { describe, expect, it } from 'vitest';

import { wrapDurableObjectSql } from './sqlite';

describe('wrapDurableObjectSql', () => {
  it('preserves the DurableObjectStorage receiver on transactionSync and SqlStorage on exec', () => {
    const sql = {
      exec(this: unknown, query: string, ...params: unknown[]) {
        if (this !== sql) {
          throw new TypeError("Illegal invocation: function called with incorrect 'this' reference.");
        }
        return {
          rowsWritten: 1,
          toArray: () => [{ query, params }],
        };
      },
    };

    const storage = {
      sql,
      transactionSync<T>(this: unknown, fn: () => T): T {
        if (this !== storage) {
          throw new TypeError("Illegal invocation: function called with incorrect 'this' reference.");
        }
        return fn();
      },
    } as unknown as DurableObjectStorage;

    const runner = wrapDurableObjectSql(storage);

    expect(runner.transaction(() => {
      runner.exec('SELECT 1');
      expect(runner.run('DELETE FROM poker_rooms WHERE id = ?', 'room-1')).toEqual({ changes: 1 });
      expect(runner.get('SELECT * FROM poker_rooms WHERE id = ?', 'room-1')).toEqual({
        query: 'SELECT * FROM poker_rooms WHERE id = ?',
        params: ['room-1'],
      });
      expect(runner.all('SELECT * FROM poker_rooms')).toEqual([
        { query: 'SELECT * FROM poker_rooms', params: [] },
      ]);
      return 'ok';
    })).toBe('ok');
  });
});
