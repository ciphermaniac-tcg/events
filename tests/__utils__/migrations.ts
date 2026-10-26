/** The tournaments database's migrations, run on a test's own database as D1 would run them. */

import { readdirSync, readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

const DIRECTORY = new URL('../../config/d1/migrations/tournaments/', import.meta.url);

/** Runs the migrations numbered `from` to `to` on `db`, in order. */
export function migrate(db: DatabaseSync, from: number, to: number): void {
  for (const name of readdirSync(DIRECTORY).sort()) {
    const number = Number(name.slice(0, 4));
    if (number >= from && number <= to) {
      db.exec(readFileSync(new URL(name, DIRECTORY), 'utf8'));
    }
  }
}
