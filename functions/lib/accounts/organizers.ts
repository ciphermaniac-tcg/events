/**
 * The accounts with a role, as the admin page lists them: Community
 * organizers, those whose access was removed, and Admins, then a row for
 * each store an account owns or manages, each with how many events the
 * account owns.
 * The list reads the partial role index, and the stores by status with each
 * one's members; each count reads the owner index.
 */

import { readAccountRole } from '../../../shared/accounts/roles.js';
import type { RoleHolder } from '../../../shared/accounts/types.js';
import { displayNameSql } from './handles.js';
import type { D1Like, D1Statement } from '../types.js';

export interface RoleHolderRow {
  id: string;
  name: string;
  email: string | null;
  pop_id: string | null;
  role: string | null;
  role_at: number | null;
  events: number;
  store_id?: string | null;
  store_name?: string | null;
}

const COLUMNS =
  `u.id, ${displayNameSql('u')} AS name, u.email, u.pop_id, ` +
  '(SELECT COUNT(*) FROM tournaments t WHERE t.owner_id = u.id) AS events';

const ROLE_COLUMNS = `${COLUMNS}, u.role, u.role_at`;

/** More rows than the site will have for a long while; a bound on a read gone wrong. */
const MAX_ROLE_HOLDERS = 500;

export async function roleHolders(db: D1Like): Promise<RoleHolder[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ROLE_COLUMNS}, NULL AS store_id, NULL AS store_name FROM users u ` +
        "WHERE u.role IN ('community', 'revoked', 'admin') UNION ALL " +
        // From the stores by their status index, each one's members by its key: no table scanned.
        `SELECT ${COLUMNS}, m.role, m.added_at, s.id, s.name FROM stores s CROSS JOIN store_members m ` +
        "ON m.store_id = s.id JOIN users u ON u.id = m.user_id WHERE s.status IN ('active', 'revoked') " +
        `AND m.role IN ('owner', 'manager') ORDER BY name, store_name LIMIT ${MAX_ROLE_HOLDERS}`
    )
    .all<RoleHolderRow>();
  return results.flatMap(row => holderOf(row) ?? []);
}

/** The read of one account's role row as the list shows it, for a batch to answer with. */
export const roleHolderQuery = (db: D1Like, id: string): D1Statement =>
  db.prepare(`SELECT ${ROLE_COLUMNS} FROM users u WHERE u.id = ?`).bind(id);

/** The row as the list shows it; null when it holds no role and names no store. */
export function holderOf(row: RoleHolderRow): RoleHolder | null {
  const { store_id: storeId, store_name: storeName } = row;
  const store = storeId
    ? { id: storeId, name: storeName ?? '', role: row.role === 'owner' ? ('owner' as const) : ('manager' as const) }
    : null;
  const role = store ? null : readAccountRole(row.role);
  return role || store
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        popId: row.pop_id,
        role,
        store,
        roleAt: row.role_at,
        events: row.events
      }
    : null;
}
