/**
 * The checks every store route starts with: is the database bound, is the
 * store real, who is asking, and may they do this. An Admin may do anything
 * a store's Manager may; handing the store over is its Owner's, or an
 * Admin's through the admin route.
 */

import { managesStore, type StoreRole, storeRoleOf } from '../../../shared/accounts/stores.js';
import { isAdmin } from '../../../shared/accounts/roles.js';
import type { Store } from '../../../shared/accounts/types.js';
import { jsonError } from '../api/responses.js';
import { type Context, param, sameOrigin } from '../auth/env.js';
import { sessionHash, sessionUserQuery, type User, userFromRow, type UserRow } from '../auth/session.js';
import { firstRow, type Guard } from '../d1.js';
import type { D1Like, D1Statement } from '../types.js';
import { storeOf, storeQuery, type StoreRow } from './db.js';
import { msg } from '../../../shared/i18n.js';

export interface StoreAccess {
  db: D1Like;
  user: User | null;
  store: Store;
  /** What the asker is in the store; an Admin not in it reads as its Manager. */
  role: StoreRole | null;
  guard: (need: Exclude<Need, 'anyone'>) => Guard;
  /** What the reads the route asked to have along (see openStore) found, in the order it gave them. */
  along: D1Result[];
}

type D1Result = Awaited<ReturnType<D1Like['batch']>>[number];

/** Reads a route has go in the same round trip as the store and its asker, given the store's ID. */
export type Along = (db: D1Like, storeId: string) => D1Statement[];

type Need = 'anyone' | 'member' | 'manager' | 'owner';

/** The stored role, an Admin raised to at least a Manager; null for someone not in the store. */
function roleOf(stored: string | undefined, admin: boolean): StoreRole | null {
  const role = stored === undefined ? null : storeRoleOf(stored);
  return admin && !managesStore(role) ? 'manager' : role;
}

/** Whether `role` meets `need`. */
const meets = (need: Need, role: StoreRole | null): boolean =>
  need === 'anyone' ||
  (need === 'member' && role !== null) ||
  (need === 'manager' && managesStore(role)) ||
  (need === 'owner' && role === 'owner');

/** What the guard asks of the asker's row: being in the store, managing it, or owning it. */
const ROW_NEEDS: Record<Exclude<Need, 'anyone'>, string> = {
  member: '',
  manager: " AND m.role IN ('owner', 'manager')",
  owner: " AND m.role = 'owner'"
};

/** The store, and anything `along` adds, read alone: nobody is signed in. */
async function storeAlone(db: D1Like, storeId: string, along: D1Statement[]) {
  const store = storeQuery(db, storeId);
  if (along.length === 0) {
    return { store: storeOf(await store.first<StoreRow>()), user: null, role: null, hash: '', along: [] };
  }
  const [found, ...rest] = await db.batch([store, ...along]);
  return { store: storeOf(firstRow<StoreRow>(found)), user: null, role: null, hash: '', along: rest };
}

/** The store, the asker and their role in it, and what `along` reads, in one round trip with the session. */
async function asker(db: D1Like, request: Request, storeId: string, along: Along | undefined) {
  const hash = await sessionHash(request);
  const extra = along ? along(db, storeId) : [];
  if (!hash) {
    return storeAlone(db, storeId, extra);
  }
  const now = Date.now();
  const [found, account, member, ...rest] = await db.batch([
    storeQuery(db, storeId),
    sessionUserQuery(db, hash, now),
    db
      .prepare(
        'SELECT m.role FROM store_members m JOIN sessions ON sessions.user_id = m.user_id ' +
          'WHERE m.store_id = ? AND sessions.token_hash = ? AND sessions.expires_at > ?'
      )
      .bind(storeId, hash, now),
    ...extra
  ]);
  const row = firstRow<UserRow>(account);
  const user = row && userFromRow(row);
  const stored = firstRow<{ role: string }>(member)?.role;
  return {
    store: storeOf(firstRow<StoreRow>(found)),
    user,
    role: user ? roleOf(stored, isAdmin(user.role)) : null,
    hash,
    along: rest
  };
}

const REFUSALS: Record<Exclude<Need, 'anyone'>, string> = {
  member: msg('Only this store’s staff can do that'),
  manager: msg('Only this store’s managers can do that'),
  owner: msg('Only this store’s owner can do that')
};

/**
 * The store the route names and who is asking; a Response when either cannot
 * be had or `need` is not met. Reads `along` gives go in the same round trip.
 */
export async function openStore(context: Context<'id'>, need: Need, along?: Along): Promise<StoreAccess | Response> {
  const db = context.env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Stores are not available', 503);
  }
  if (context.request.method !== 'GET' && !sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const id = param(context.params.id);
  const who = await asker(db, context.request, id, along);
  const { store } = who;
  if (!store) {
    return jsonError('No such store', 404);
  }
  if (need !== 'anyone' && !who.user) {
    return jsonError('Sign in first', 401);
  }
  const guard = (required: Exclude<Need, 'anyone'>): Guard => ({
    sql:
      'EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id ' +
      'WHERE s.token_hash = ? AND s.expires_at > ? AND u.age_checked_at IS NOT NULL AND ' +
      `(${required === 'owner' ? '' : "u.role = 'admin' OR "}EXISTS (SELECT 1 FROM store_members m WHERE m.store_id = ? ` +
      `AND m.user_id = u.id${ROW_NEEDS[required]})))`,
    values: [who.hash, Date.now(), id]
  });
  return meets(need, who.role)
    ? { db, store, user: who.user, role: who.role, guard, along: who.along }
    : jsonError(REFUSALS[need as Exclude<Need, 'anyone'>], 403);
}
