/**
 * POST /api/admin/organizers/:id — an Admin removes a Community organizer's
 * access ({ role: 'revoked' }) or gives it back ({ role: 'community' }). A
 * revoked account keeps every event it owns, every staff seat it holds and
 * every store it belongs to; it only starts no more events of its own, and
 * cannot become a Community organizer again by asking. Only a Community
 * organizer or a revoked one changes here: an Admin, or an account with no
 * role, is 404. Answers { account }.
 * Revoking a store's Manager ({ role: 'revoked', store: <store id> }) takes
 * them out of that store; its events and the account stay. Answers 204; 404
 * when they are not one of its Managers (an Owner stays).
 */

import { holderOf, roleHolderQuery, type RoleHolderRow } from '../../../lib/accounts/organizers.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError, noContent } from '../../../lib/api/responses.js';
import { type AdminAccess, answerAdminMiss, openForAdmin } from '../../../lib/auth/admin.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { both, firstRow, rowsChanged } from '../../../lib/d1.js';
import { removeMember } from '../../../lib/stores/db.js';
import { privateJson } from '../../../lib/tournaments/access.js';

export async function onRequestPost(context: Context<'id'>): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const { role, store } = (await readJsonObject(context.request, 256)) ?? {};
  const id = param(context.params.id);
  if (role === 'revoked' && typeof store === 'string' && store) {
    const removed = await removeMember(
      access.db,
      store,
      id,
      both(access.guard, { sql: "role = 'manager'", values: [] })
    );
    return removed ? noContent() : answerAdminMiss(context, () => jsonError('Not a manager of that store', 404));
  }
  if (role !== 'community' && role !== 'revoked') {
    return jsonError('Revoke or reinstate', 400);
  }
  return setRole(context, access, { id, role });
}

async function setRole(
  context: Context<'id'>,
  { db, admin, guard }: AdminAccess,
  { id, role }: { id: string; role: 'community' | 'revoked' }
): Promise<Response> {
  const [changed, account] = await db.batch([
    db
      .prepare(
        "UPDATE users SET role = ?, role_at = ?, role_by = ? WHERE id = ? AND role IN ('community', 'revoked') " +
          `AND ${guard.sql}`
      )
      .bind(role, Date.now(), admin.id, id, ...guard.values),
    roleHolderQuery(db, id)
  ]);
  const row = firstRow<RoleHolderRow>(account);
  return rowsChanged(changed) === 1 && row
    ? privateJson({ account: holderOf(row) })
    : answerAdminMiss(context, () => jsonError('Not an organizer', 404));
}
