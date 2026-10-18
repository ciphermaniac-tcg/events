/**
 * POST /api/admin/pop-ids — an Admin settles a POP ID dispute: { popId,
 * accountId } moves the POP ID to that account, and { popId, accountId: null }
 * only takes it off the account that holds it. History follows the POP ID,
 * so it moves with it. Each account lets go of the players it was at events
 * as the POP ID it lost, as saving a new one on its own page does. Answers
 * { from, to }: the account that held it, and the one that holds it now.
 */

import { isPopId } from '../../../shared/tournament/profile.js';
import { readJsonObject } from '../../lib/api/body.js';
import { jsonError } from '../../lib/api/responses.js';
import { answerAdminMiss, openForAdmin } from '../../lib/auth/admin.js';
import type { Context } from '../../lib/auth/env.js';
import { firstRow, type Guard, rowsChanged } from '../../lib/d1.js';
import { privateJson } from '../../lib/tournaments/access.js';
import type { D1Like, D1Statement } from '../../lib/types.js';
import { msg } from '../../../shared/i18n.js';

interface Move {
  popId: string;
  /** The account to give it to; null to take it off whoever holds it. */
  to: string | null;
}

/** The move a body asks for, or why it asks for none. */
function readMove(body: Record<string, unknown> | null): Move | string {
  const popId = typeof body?.popId === 'string' ? body.popId.trim() : '';
  if (!isPopId(popId)) {
    return msg('A POP ID is up to ten digits');
  }
  const to = body?.accountId;
  return typeof to === 'string' || to === null ? { popId, to } : msg('Name an account, or none');
}

/**
 * The holder this takes the POP ID from (?1) is any account but the one it
 * goes to (?2), and only while that account exists, or when it goes to none.
 */
const TAKEN_FROM = 'pop_id = ?1 AND id IS NOT ?2 AND (?2 IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = ?2))';

/**
 * The move's statements, in one batch, so it lands whole or not at all: who
 * held the POP ID; that holder's players under it let go, and the POP ID off
 * it; then the new holder's players under its old POP ID let go, and the
 * POP ID on it. Every write holds to `guard`, the asker still an Admin, its
 * values bound after the POP ID and the account (?1 and ?2).
 */
function moveStatements(db: D1Like, { popId, to }: Move, guard: Guard): D1Statement[] {
  const write = (sql: string) => db.prepare(`${sql} AND ${guard.sql}`).bind(popId, to, ...guard.values);
  const taken = [
    db.prepare('SELECT id FROM users WHERE pop_id = ?').bind(popId),
    write(`DELETE FROM report_devices WHERE player_id = ?1 AND user_id = (SELECT id FROM users WHERE ${TAKEN_FROM})`),
    write(`UPDATE users SET pop_id = NULL WHERE ${TAKEN_FROM}`)
  ];
  if (to === null) {
    return taken;
  }
  return [
    ...taken,
    write(
      'DELETE FROM report_devices WHERE user_id = ?2 AND player_id = (SELECT pop_id FROM users WHERE id = ?2) ' +
        'AND player_id <> ?1'
    ),
    write('UPDATE users SET pop_id = ?1 WHERE id = ?2')
  ];
}

export async function onRequestPost(context: Context): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const move = readMove(await readJsonObject(context.request, 512));
  if (typeof move === 'string') {
    return jsonError(move, 400);
  }
  const results = await access.db.batch(moveStatements(access.db, move, access.guard));
  const answer = () =>
    move.to !== null && rowsChanged(results.at(-1)) === 0
      ? jsonError('No such account', 404)
      : privateJson({ from: firstRow<{ id: string }>(results[0])?.id ?? null, to: move.to });
  // Nothing moved: the move was already made, or the asker lost the role or signed out meanwhile.
  return results.slice(1).some(result => rowsChanged(result) > 0) ? answer() : answerAdminMiss(context, answer);
}
