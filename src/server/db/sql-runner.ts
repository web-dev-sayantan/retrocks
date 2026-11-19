import 'server-only';

export type SqlParam = string | number | null;

export interface SqlRunResult {
  changes: number;
}

/**
 * Minimal synchronous SQL execution interface shared by Cloudflare Durable
 * Object SQLite (`ctx.storage.sql`) and Node SQLite (`node:sqlite` `DatabaseSync`).
 */
export interface SqlRunner {
  exec(sql: string): void;
  run(sql: string, ...params: SqlParam[]): SqlRunResult;
  get<T extends Record<string, unknown>>(
    sql: string,
    ...params: SqlParam[]
  ): T | undefined;
  all<T extends Record<string, unknown>>(
    sql: string,
    ...params: SqlParam[]
  ): T[];
  transaction<T>(fn: () => T): T;
}
