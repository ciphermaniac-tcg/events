/**
 * D1 in the browser: the D1Like surface the functions use, over sql.js, with
 * the real schema. sql.js runs each statement at once, so a batch runs in one
 * go, start to commit, and no other request's statements can land inside its
 * transaction: one batch is one transaction, as D1's is.
 */

import type { Database, SqlValue } from 'sql.js';
import type { D1Like, D1Statement } from '../../functions/lib/types';

function rows(db: Database, sql: string, args: unknown[]): Record<string, unknown>[] {
  const prepared = db.prepare(sql);
  try {
    prepared.bind(args.map(value => (value === undefined ? null : value)) as SqlValue[]);
    const out: Record<string, unknown>[] = [];
    while (prepared.step()) {
      out.push(prepared.getAsObject());
    }
    return out;
  } finally {
    prepared.free();
  }
}

/** A statement, and the way a batch runs it on the spot. */
interface BrowserStatement extends D1Statement {
  now: () => { results: Record<string, unknown>[]; changes: number };
}

function statement(db: () => Database, sql: string, args: unknown[], changed: () => void): BrowserStatement {
  const now = () => {
    const results = rows(db(), sql, args);
    const changes = db().getRowsModified();
    if (changes > 0) {
      changed();
    }
    return { results, changes };
  };
  return {
    now,
    bind: (...next: unknown[]) => statement(db, sql, next, changed),
    first: <T>() => Promise.resolve((now().results[0] ?? null) as T | null),
    all: <T>() => Promise.resolve({ results: now().results as T[] }),
    run: () => Promise.resolve({ success: true, meta: { changes: now().changes } })
  };
}

/**
 * The database `db` gives as D1, asked for at each statement, since another
 * tab's save replaces it (server/index.ts); `changed` hears of every write,
 * so the database is saved after it.
 */
export function browserD1(db: () => Database, changed: () => void): D1Like {
  return {
    prepare: sql => statement(db, sql, [], changed),
    batch: statements => {
      db().exec('BEGIN');
      try {
        const results = statements.map(item => {
          const { results: found, changes } = (item as BrowserStatement).now();
          return { results: found, meta: { changes } };
        });
        db().exec('COMMIT');
        return Promise.resolve(results);
      } catch (error) {
        db().exec('ROLLBACK');
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}
