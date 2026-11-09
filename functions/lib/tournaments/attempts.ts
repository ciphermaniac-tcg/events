/**
 * Wrong birth years given with a Player ID at a sanctioned event (the
 * `identify_failures` table in config/d1/tournaments.sql). A Player ID is no
 * secret and a birth year is one of some seventy, so wrong tries are counted
 * per event and Player ID, wherever they come from: from the FREE_TRIES-th
 * the Player ID is refused for a minute, doubling with each wrong try after,
 * up to an hour. The count is in D1 rather than in an isolate's memory, which
 * a guesser spreading requests would never fill.
 *
 * Every try is let in or refused by one statement, so D1 takes tries landing
 * at once one at a time: a burst gets FREE_TRIES answers, not one per request
 * read before any was counted. A wrong year is counted in the statement that
 * lets it in; a right year resets unlocked failures in its admission statement; a try
 * whose year only a later write can judge is counted before that write, and
 * forgiven once it lands.
 */

import type { Guard } from '../d1.js';
import type { D1Like, D1Statement } from '../types.js';
import { msg } from '../../../shared/i18n.js';

export const FREE_TRIES = 5;
const FIRST_LOCK_MS = 60_000;
const MAX_LOCK_MS = 60 * 60_000;

export const LOCKED_OUT = msg('Too many tries. Ask staff for help.');

/**
 * Forgives the Player ID's wrong tries, unless it is refused now: a lock that
 * tries landing alongside earned stays theirs.
 */
export function forgive(db: D1Like, code: string, popId: string, now: number) {
  return db
    .prepare('DELETE FROM identify_failures WHERE code = ? AND pop_id = ? AND locked_until <= ?')
    .bind(code, popId, now)
    .run();
}

/** One try: the event, the Player ID it names, whether its year is right, and when it lands. */
interface Try {
  db: D1Like;
  code: string;
  popId: string;
  right: boolean;
  now: number;
}

/** Lets in a right year by resetting unlocked failures, or a wrong one by counting it. */
export async function admitTry({ db, code, popId, right, now }: Try): Promise<boolean> {
  const sql = right
    ? 'INSERT INTO identify_failures (code, pop_id, failures, locked_until) VALUES (?1, ?2, 0, 0) ' +
      'ON CONFLICT (code, pop_id) DO UPDATE SET failures = 0, locked_until = 0 ' +
      'WHERE identify_failures.locked_until <= ?3 RETURNING failures'
    : 'INSERT INTO identify_failures (code, pop_id, failures, locked_until) VALUES (?1, ?2, 1, 0) ' +
      'ON CONFLICT (code, pop_id) DO UPDATE SET failures = failures + 1, locked_until = CASE ' +
      'WHEN failures + 1 >= ?3 THEN ?4 + min(?5, ?6 * (1 << min(failures + 1 - ?3, 6))) ' +
      'ELSE locked_until END ' +
      'WHERE identify_failures.locked_until <= ?4 RETURNING failures';
  const values = right ? [code, popId, now] : [code, popId, FREE_TRIES, now, MAX_LOCK_MS, FIRST_LOCK_MS];
  return (
    (await db
      .prepare(sql)
      .bind(...values)
      .first<{ failures: number }>()) !== null
  );
}

/** Forgets a Player ID's wrong tries outright, while `guard` holds: staff vouch for the player. */
export function clearFailures(db: D1Like, code: string, popId: string, guard: Guard): D1Statement {
  return db
    .prepare(`DELETE FROM identify_failures WHERE code = ? AND pop_id = ? AND ${guard.sql}`)
    .bind(code, popId, ...guard.values);
}
