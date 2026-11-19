/**
 * GET /api/admin/users — every account on the site, the newest first: its
 * name, username, email, POP ID and role, the stores it owns or manages, and
 * when it was made.
 */

import { foundAccount, type FoundAccountRow } from '../../lib/accounts/admin.js';
import type { AdminUser, RunStore } from '../../../shared/accounts/types.js';
import { displayNameSql } from '../../lib/accounts/handles.js';
import { openForAdmin } from '../../lib/auth/admin.js';
import type { Context } from '../../lib/auth/env.js';
import { privateJson } from '../../lib/tournaments/access.js';

/** More accounts than the list is any use past; a bound on the read. */
const MAX_USERS = 1000;

interface UserRow extends FoundAccountRow {
  handle: string | null;
  /** A JSON array of the stores it runs. */
  stores: string;
}

const userOf = (row: UserRow): AdminUser => ({
  ...foundAccount(row),
  handle: row.handle ?? '',
  stores: JSON.parse(row.stores) as RunStore[]
});

/** The stores each account owns or manages, by the members index. */
const STORES =
  "(SELECT json_group_array(json_object('id', s.id, 'name', s.name, 'role', m.role)) FROM store_members m " +
  "JOIN stores s ON s.id = m.store_id WHERE m.user_id = users.id AND m.role IN ('owner', 'manager')) AS stores";

const QUERY =
  `SELECT id, ${displayNameSql('users')} AS name, handle, email, pop_id, role, created_at, ${STORES} FROM users ` +
  `ORDER BY created_at DESC LIMIT ${MAX_USERS}`;

export async function onRequestGet(context: Context): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const { results } = await access.db.prepare(QUERY).all<UserRow>();
  return privateJson({ users: results.map(userOf) });
}
