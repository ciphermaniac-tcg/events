/**
 * The check every admin route starts with: is the database bound, did the
 * request come from this site, is someone signed in, and are they an Admin.
 * Admins are set by hand in SQL; no request grants or takes away the role.
 */

import { isAdmin } from '../../../shared/accounts/roles.js';
import { jsonError } from '../api/responses.js';
import type { Guard } from '../d1.js';
import type { D1Like } from '../types.js';
import { type Context, sameOrigin } from './env.js';
import { currentUser, sessionHash, type User } from './session.js';

export interface AdminAccess {
  db: D1Like;
  admin: User;
  /** That the asker is still an Admin, signed in by the session they asked with: what each Admin write lands only while. */
  guard: Guard;
}

/** That the session `hash` names is live and its account still an Admin, as SQL. */
const stillAdmin = (hash: string): Guard => ({
  sql:
    'EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? ' +
    "AND s.expires_at > ? AND u.age_checked_at IS NOT NULL AND u.role = 'admin')",
  values: [hash, Date.now()]
});

/** The database and the Admin asking, or the answer that turns the request away. */
export async function openForAdmin<Params extends string>(context: Context<Params>): Promise<AdminAccess | Response> {
  const { request, env } = context;
  const db = env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Admin is not available', 503);
  }
  if (!sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentUser(db, request);
  if (!user) {
    return jsonError('Sign in first', 401);
  }
  return isAdmin(user.role)
    ? { db, admin: user, guard: stillAdmin((await sessionHash(request)) ?? '') }
    : jsonError('Admins only', 403);
}

/**
 * What an Admin write that did not land answers: why the asker may no
 * longer act as an Admin, when they lost the role or signed out meanwhile;
 * otherwise what `otherwise` says.
 */
export async function answerAdminMiss<Params extends string>(
  context: Context<Params>,
  otherwise: () => Response
): Promise<Response> {
  const again = await openForAdmin(context);
  return again instanceof Response ? again : otherwise();
}
