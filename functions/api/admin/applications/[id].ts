/**
 * POST /api/admin/applications/:id — an Admin decides a pending Application:
 * { decision: 'approve' | 'reject', note? }, the note being the Admin's own
 * words to the applicant. Approving makes the store it asks for, with the
 * applicant its Owner; for a league whose store is orphaned (it has no
 * Owner), it makes the applicant that store's Owner instead, its details,
 * nights and events as they were. A league whose store has an Owner is
 * refused (409), since a store changes hands only by an Admin moving it.
 * Answers { application }; 409 when it was already decided.
 */

import { NOTE_MAX } from '../../../../shared/accounts/applications.js';
import {
  ADMIN_APPLICATIONS,
  adminApplication,
  type AdminApplicationRow,
  storeOf
} from '../../../lib/accounts/applications.js';
import { randomToken } from '../../../lib/auth/session.js';
import { breaksLeague, ownerFillWrite, storeInserts, storeOfLeague } from '../../../lib/stores/db.js';
import { publishStores } from '../../../lib/stores/publish.js';
import type { StoreApplication } from '../../../../shared/accounts/stores.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import { type AdminAccess, answerAdminMiss, openForAdmin } from '../../../lib/auth/admin.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { both, firstRow, type Guard, rowsChanged } from '../../../lib/d1.js';
import { privateJson } from '../../../lib/tournaments/access.js';
import type { D1Like, D1Statement } from '../../../lib/types.js';
import { msg, msgf } from '../../../../shared/i18n.js';

interface Decision {
  approve: boolean;
  /** Null when the Admin left none. */
  note: string | null;
}

/** The decision a body asks for, or why it asks for none. */
function readDecision(body: Record<string, unknown> | null): Decision | string {
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (note.length > NOTE_MAX) {
    return msgf('Up to {limit} characters', { limit: NOTE_MAX });
  }
  const { decision } = body ?? {};
  return decision === 'approve' || decision === 'reject'
    ? { approve: decision === 'approve', note: note || null }
    : msg('Approve or reject');
}

const LEAGUE_HELD = msg('That league already has a store');

/** The store already holding the league asked for, when one does. */
type Held = Awaited<ReturnType<typeof storeOfLeague>>;

/** The writes that give an approved applicant their store: a new one, or the orphaned one holding its league. */
function storeWrites(
  db: AdminAccess['db'],
  approval: { userId: string; store: StoreApplication; held: Held },
  guard: Guard,
  now: number
): D1Statement[] {
  const { userId, store, held } = approval;
  if (held) {
    return [ownerFillWrite(db, { storeId: held.id, userId, now, guard })];
  }
  return storeInserts(db, {
    id: randomToken(12),
    store: {
      leagueId: store.leagueId,
      details: store.details,
      lat: store.place?.lat ?? null,
      lon: store.place?.lon ?? null,
      timeZone: store.timeZone,
      nights: store.nights
    },
    member: { id: userId, role: 'owner' },
    now,
    guard
  });
}

/**
 * The decision's writes, then the Application read back. Each write holds only while the
 * Application is still pending and the asker still an Admin, inside the one
 * transaction a batch is, so two Admins deciding at once cannot both land,
 * no store is made for an Application someone else rejected meanwhile, and
 * nothing lands for an Admin who lost the role or signed out meanwhile.
 * An approval lands only once the applicant owns the league's store, so one
 * whose orphaned store found an Owner meanwhile stays pending.
 */
function decisionWrites(
  access: AdminAccess,
  application: { id: string; userId: string; store: StoreApplication | null; held: Held },
  decision: Decision
): D1Statement[] {
  const { db, admin } = access;
  const { id, userId, store, held } = application;
  const now = Date.now();
  const pending = both(access.guard, {
    sql: "EXISTS (SELECT 1 FROM applications WHERE id = ? AND status = 'pending')",
    values: [id]
  });
  const approving = decision.approve && store;
  const made = approving ? storeWrites(db, { userId, store, held }, pending, now) : [];
  const owns: Guard = approving
    ? {
        sql:
          'EXISTS (SELECT 1 FROM store_members m JOIN stores s ON s.id = m.store_id ' +
          "WHERE s.league_id = ? AND m.user_id = ? AND m.role = 'owner')",
        values: [store.leagueId, userId]
      }
    : { sql: '1 = 1', values: [] };
  const decide = db
    .prepare(
      'UPDATE applications SET status = ?, decided_at = ?, decided_by = ?, note = ? ' +
        `WHERE id = ? AND status = 'pending' AND ${access.guard.sql} AND ${owns.sql}`
    )
    .bind(
      decision.approve ? 'approved' : 'rejected',
      now,
      admin.id,
      decision.note,
      id,
      ...access.guard.values,
      ...owns.values
    );
  const read = db.prepare(`${ADMIN_APPLICATIONS} WHERE a.id = ?`).bind(id);
  return [...made, decide, read];
}

export async function onRequestPost(context: Context<'id'>): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const decision = readDecision(await readJsonObject(context.request, 4096));
  if (typeof decision === 'string') {
    return jsonError(decision, 400);
  }
  const { db } = access;
  const found = await db
    .prepare(`${ADMIN_APPLICATIONS} WHERE a.id = ?`)
    .bind(param(context.params.id))
    .first<AdminApplicationRow>();
  if (!found) {
    return jsonError('No such application', 404);
  }
  const application = await applicationFor(db, found, decision);
  if (application instanceof Response) {
    return application;
  }
  const results = await db.batch(decisionWrites(access, application, decision)).catch((error: unknown) => {
    if (breaksLeague(error)) {
      return null;
    }
    throw error;
  });
  return results ? answer(context, results, decision) : jsonError(LEAGUE_HELD, 409);
}

/** The Application to decide, with the store holding its league; a refusal when it cannot be approved. */
async function applicationFor(db: AdminAccess['db'], found: AdminApplicationRow, decision: Decision) {
  const store = storeOf(found);
  if (decision.approve && !store) {
    return jsonError('This application asks for no store; reject it so they can apply again', 400);
  }
  const held = decision.approve && store ? await storeOfLeague(db, store.leagueId) : null;
  return held?.owned ? jsonError(LEAGUE_HELD, 409) : { id: found.id, userId: found.user_id, store, held };
}

/** The decided Application, or why the decision did not land: a lost race, or the asker no longer an Admin. */
async function answer(
  context: Context<'id'>,
  results: Awaited<ReturnType<D1Like['batch']>>,
  decision: Decision
): Promise<Response> {
  const row = firstRow<AdminApplicationRow>(results.at(-1));
  if (!row) {
    return jsonError('No such application', 404);
  }
  if (rowsChanged(results.at(-2)) === 0) {
    const lost = row.status === 'pending' ? LEAGUE_HELD : msg('Already decided');
    return answerAdminMiss(context, () => jsonError(lost, 409));
  }
  if (decision.approve) {
    await publishStores(context);
  }
  return privateJson({ application: adminApplication(row) });
}
