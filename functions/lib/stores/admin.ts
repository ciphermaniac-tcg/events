/** Stores as an Admin's page lists them: each with its status, its Owner, and its Managers' names (the Owner's among them). */

import type { StoreStatus } from '../../../shared/accounts/stores.js';
import { displayNameSql } from '../accounts/handles.js';
import { firstRow, type Guard, rowsChanged } from '../d1.js';
import { handOverWrites } from './db.js';
import type { D1Like, D1Statement } from '../types.js';

export interface AdminStore {
  id: string;
  leagueId: string | null;
  name: string;
  city: string;
  region: string;
  status: StoreStatus;
  owner: { id: string; name: string } | null;
  managers: { id: string; name: string }[];
  createdAt: number;
}

interface Row {
  id: string;
  league_id: string | null;
  name: string;
  city: string;
  region: string;
  status: string;
  created_at: number;
  owner: string | null;
  managers: string | null;
}

const COLUMNS =
  's.id, s.league_id, s.name, s.city, s.region, s.status, s.created_at, ' +
  `(SELECT json_object('id', u.id, 'name', ${displayNameSql('u')}) FROM store_members m ` +
  "JOIN users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role = 'owner') AS owner, " +
  `(SELECT json_group_array(json_object('id', u.id, 'name', ${displayNameSql('u')})) FROM store_members m ` +
  "JOIN users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role IN ('owner', 'manager')) AS managers";

function fromRow(row: Row): AdminStore {
  return {
    id: row.id,
    leagueId: row.league_id,
    name: row.name,
    city: row.city,
    region: row.region,
    status: row.status === 'revoked' ? 'revoked' : 'active',
    owner: row.owner ? (JSON.parse(row.owner) as AdminStore['owner']) : null,
    managers: JSON.parse(row.managers ?? '[]') as AdminStore['managers'],
    createdAt: row.created_at
  };
}

export async function adminStores(db: D1Like): Promise<AdminStore[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM stores s WHERE s.status IN ('active', 'revoked') ORDER BY s.name LIMIT 1000`)
    .all<Row>();
  return results.map(fromRow);
}

export async function adminStore(db: D1Like, id: string): Promise<AdminStore | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM stores s WHERE s.id = ?`).bind(id).first<Row>();
  return row && fromRow(row);
}

/** The write that makes the account a Manager of the store, joining it if need be, while `guard` holds; its Owner stays its Owner. */
const managerWrite = (db: D1Like, storeId: string, userId: string, guard: Guard): D1Statement =>
  db
    .prepare(
      "INSERT INTO store_members (store_id, user_id, role, added_at) SELECT s.id, u.id, 'manager', ? " +
        `FROM stores s JOIN users u ON u.id = ? WHERE s.id = ? AND ${guard.sql} ` +
        "ON CONFLICT (store_id, user_id) DO UPDATE SET role = CASE store_members.role WHEN 'owner' THEN 'owner' " +
        "ELSE 'manager' END"
    )
    .bind(Date.now(), userId, storeId, ...guard.values);

/**
 * Makes the account a Manager of the store, joining it if it was not in it,
 * while the Admin's `guard` holds; its Owner stays its Owner. False when
 * either is missing, or the guard no longer held.
 */
export async function makeManager(db: D1Like, storeId: string, userId: string, guard: Guard): Promise<boolean> {
  return rowsChanged(await managerWrite(db, storeId, userId, guard).run()) === 1;
}

/**
 * Hands the store to the account, joining it first if it was not in it: how
 * a store changes hands when its Owner cannot do it, or gets one when it has
 * none. The Owner before becomes a Manager. Every write, and the read that
 * says whether the account owns the store after, holds to the Admin's
 * `guard`, in one transaction. False when the store or the account is
 * missing, or the guard no longer held.
 */
export async function makeOwner(db: D1Like, storeId: string, userId: string, guard: Guard): Promise<boolean> {
  const results = await db.batch([
    managerWrite(db, storeId, userId, guard),
    ...handOverWrites(db, storeId, userId, { guard, mend: guard }),
    db
      .prepare(
        `SELECT 1 AS yes FROM store_members WHERE store_id = ? AND user_id = ? AND role = 'owner' AND ${guard.sql}`
      )
      .bind(storeId, userId, ...guard.values)
  ]);
  return firstRow<{ yes: number }>(results.at(-1)) !== null;
}
