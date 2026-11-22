import 'server-only';

import type { SqlParam, SqlRunResult, SqlRunner } from '../../db/sql-runner';

interface NodeStatementSync {
  run(...params: SqlParam[]): { changes: number | bigint };
  get(...params: SqlParam[]): Record<string, unknown> | undefined;
  all(...params: SqlParam[]): Record<string, unknown>[];
}

interface NodeDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): NodeStatementSync;
  close(): void;
}

export function wrapDatabaseSync(db: NodeDatabaseSync): SqlRunner {
  let inTransaction = false;

  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    run(sql: string, ...params: SqlParam[]): SqlRunResult {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    get<T extends Record<string, unknown>>(
      sql: string,
      ...params: SqlParam[]
    ): T | undefined {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    all<T extends Record<string, unknown>>(
      sql: string,
      ...params: SqlParam[]
    ): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    transaction<T>(fn: () => T): T {
      if (inTransaction) {
        return fn();
      }
      db.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  };
}

export async function openNodeDatabase(dbPath: string): Promise<NodeDatabaseSync> {
  if (dbPath !== ':memory:') {
    const fsSpecifier = 'node:fs';
    const pathSpecifier = 'node:path';
    const [{ mkdirSync }, { dirname }] = (await Promise.all([
      import(/* @vite-ignore */ fsSpecifier),
      import(/* @vite-ignore */ pathSpecifier),
    ])) as [
      { mkdirSync: (path: string, opts: { recursive: boolean }) => void },
      { dirname: (path: string) => string },
    ];
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqliteSpecifier = 'node:sqlite';
  const { DatabaseSync } = (await import(
    /* @vite-ignore */ sqliteSpecifier
  )) as {
    DatabaseSync: new (location: string) => NodeDatabaseSync;
  };

  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA foreign_keys = ON');

  return db;
}
