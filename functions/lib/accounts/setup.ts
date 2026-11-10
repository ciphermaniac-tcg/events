/**
 * An account's username and name, as the age check asks a new account for
 * them and /api/me/setup asks once of an account made before. Every part may
 * be left out: nothing makes anyone finish their account.
 */

import { handleProblem, normalizeHandle } from '../../../shared/accounts/handle.js';
import { msgf } from '../../../shared/i18n.js';
import { NAME_MAX } from '../../../shared/tournament/profile.js';
import type { AccountSetup } from '../auth/session.js';
import type { D1Like } from '../types.js';
import { handleFreeSql } from './handleSql.js';

/** A random first username (`randomHandle`). Checked here, not in SQL: D1 refuses a GLOB this long. */
const RANDOM_HANDLE = /^player-[a-z0-9]{8}$/;

/** The text in `value`, trimmed; null when it is none. */
function text(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

/** The username and name `body` gives, or what is wrong with them. */
export function readSetup(body: Record<string, unknown>): AccountSetup | string {
  const typed = text(body.handle);
  const handle = typed === null ? null : normalizeHandle(typed);
  const problem = handle === null ? null : handleProblem(handle);
  if (problem) {
    return problem;
  }
  const firstName = text(body.firstName);
  const lastName = text(body.lastName);
  if ((firstName?.length ?? 0) > NAME_MAX || (lastName?.length ?? 0) > NAME_MAX) {
    return msgf('Use up to {max} characters for each name', { max: NAME_MAX });
  }
  return { handle, firstName, lastName };
}

/** Whether `handle` is free for the account `self` (null for one not made yet). */
export async function handleFree(db: D1Like, handle: string, self: string | null, now = Date.now()): Promise<boolean> {
  const row = await db
    .prepare(`SELECT ${handleFreeSql('?1', '?2', '?3')} AS free`)
    .bind(handle, self, now)
    .first<{ free: number }>();
  return row?.free === 1;
}

/** Whether to offer the account its username and name: it still has the random one, and was never offered. */
export async function offerSetup(db: D1Like, userId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT handle FROM users WHERE id = ? AND setup_offered_at IS NULL')
    .bind(userId)
    .first<{ handle: string }>();
  return RANDOM_HANDLE.test(row?.handle ?? '');
}
