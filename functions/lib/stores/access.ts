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
import { liveSession, sessionHash, sessionUserQuery, type User, userFromRow, type UserRow } from '../auth/session.js';
import { both, firstRow, type Guard } from '../d1.js';
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

/**
 * Reads a route has go in the same round trip as the store and its asker,
 * given the store's ID and `guard`: what the route needs of the asker, in
 * SQL, so the reads find nothing for anyone it refuses.
 */
export type Along = (db: D1Like, storeId: string, guard?: Guard) => D1Statement[];

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

/** That the session `hash` names is live at `now`, signed up, and meets `required` at store `id`, as SQL. */
const standsAt = (required: Exclude<Need, 'anyone'>, hash: string, now: number, id: string): Guard => ({
  sql:
    `EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE ${liveSession('s', 'u')} AND ` +
    `(${required === 'owner' ? '' : "u.role = 'admin' OR "}EXISTS (SELECT 1 FROM store_members m WHERE m.store_id = ? ` +
    `AND m.user_id = u.id${ROW_NEEDS[required]})))`,
  values: [hash, now, id]
});

/** The store is there: what an Admin's standing, which names no store, also asks of a read. */
const storeThere = (id: string): Guard => ({ sql: 'EXISTS (SELECT 1 FROM stores WHERE id = ?)', values: [id] });

/** What `along` sends: for a route that needs someone signed in, the standing first, then each read held to it. */
function sentAlong(
  db: D1Like,
  storeId: string,
  { need, along }: { need: Need; along?: Along },
  session: { hash: string; now: number } | null
): { held: boolean; extra: D1Statement[] } {
  if (!along || (need !== 'anyone' && !session)) {
    return { held: false, extra: [] };
  }
  if (need === 'anyone' || !session) {
    return { held: false, extra: along(db, storeId) };
  }
  const guard = both(storeThere(storeId), standsAt(need, session.hash, session.now, storeId));
  return {
    held: true,
    extra: [db.prepare(`SELECT ${guard.sql} AS admitted`).bind(...guard.values), ...along(db, storeId, guard)]
  };
}

/**
 * The store, the asker and their role in it, and what `along` reads, in one
 * round trip with the session. A route that needs someone signed in sends
 * no `along` read without a session. With one, it sends first whether the
 * asker meets `need` there (`standsAt`), and holds each read to the same:
 * that standing, not the role, then decides whether they are let in.
 */
async function asker(db: D1Like, request: Request, storeId: string, wants: { need: Need; along?: Along }) {
  const hash = await sessionHash(request);
  const now = Date.now();
  const { held, extra } = sentAlong(db, storeId, wants, hash ? { hash, now } : null);
  if (!hash) {
    return { ...(await storeAlone(db, storeId, extra)), standing: null };
  }
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
    along: held ? rest.slice(1) : rest,
    standing: held ? Boolean(firstRow<{ admitted: number }>(rest[0])?.admitted) : null
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
  try {
    return admitted(db, await asker(db, context.request, id, { need, along }), need, id);
  } catch (error) {
    // A batch that fails over the route's reads does not answer a refused asker with the error.
    const alone = along && admitted(db, await asker(db, context.request, id, { need, along: () => [] }), need, id);
    if (alone instanceof Response) {
      return alone;
    }
    throw error;
  }
}

/** The store as `need` lets the asker have it, or why not. */
function admitted(db: D1Like, who: Awaited<ReturnType<typeof asker>>, need: Need, id: string): StoreAccess | Response {
  const { store } = who;
  if (!store) {
    return jsonError('No such store', 404);
  }
  if (need !== 'anyone' && !who.user) {
    return jsonError('Sign in first', 401);
  }
  const guard = (required: Exclude<Need, 'anyone'>): Guard => standsAt(required, who.hash, Date.now(), id);
  return (who.standing ?? meets(need, who.role))
    ? { db, store, user: who.user, role: who.role, guard, along: who.along }
    : jsonError(REFUSALS[need as Exclude<Need, 'anyone'>], 403);
}
