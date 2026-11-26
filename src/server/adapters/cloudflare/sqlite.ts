import 'server-only';

import type { SqlParam, SqlRunResult, SqlRunner } from '../../db/sql-runner';

export function wrapDurableObjectSql(storage: DurableObjectStorage): SqlRunner {
  const { sql } = storage;

  return {
    exec(query: string): void {
      sql.exec(query);
    },
    run(query: string, ...params: SqlParam[]): SqlRunResult {
      const cursor = sql.exec(query, ...params);
      return { changes: cursor.rowsWritten };
    },
    get<T extends Record<string, unknown>>(
      query: string,
      ...params: SqlParam[]
    ): T | undefined {
      const rows = sql.exec(query, ...params).toArray();
      return rows[0] as T | undefined;
    },
    all<T extends Record<string, unknown>>(
      query: string,
      ...params: SqlParam[]
    ): T[] {
      return sql.exec(query, ...params).toArray() as T[];
    },
    transaction<T>(fn: () => T): T {
      return storage.transactionSync(fn);
    },
  };
}
