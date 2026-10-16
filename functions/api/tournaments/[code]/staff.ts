/**
 * POST /api/tournaments/:code/staff — joins the event's staff with the invite
 * token the organizer shared ({ token }), or, for the organizer, replaces the
 * token and removes every current staff member ({ rotate: true }).
 * GET — the organizer sees everyone the invite link let in, and when.
 * DELETE ?user=<id> — the organizer removes one of them.
 */

import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import {
  type Access,
  answerMiss,
  askerOf,
  manageView,
  open,
  openForOwner,
  privateJson
} from '../../../lib/tournaments/access.js';
import {
  isStaffMember,
  joinStaff,
  listStaff,
  loadTournament,
  removeStaff,
  rotateStaff
} from '../../../lib/tournaments/store.js';
import { msg } from '../../../../shared/i18n.js';

const ONLY_ORGANIZER = msg('Only the organizer can do that');

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await openForOwner(context);
  if (access instanceof Response) {
    return access;
  }
  return privateJson({ staff: await listStaff(access.db, access.row.code) });
}

export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  const access = await openForOwner(context);
  if (access instanceof Response) {
    return access;
  }
  const user = new URL(context.request.url).searchParams.get('user') ?? '';
  if (!user) {
    return jsonError('Say who to remove', 400);
  }
  const list = async () => privateJson({ staff: await listStaff(access.db, access.row.code) });
  // Nobody removed is someone already gone, unless the organizer is no longer one.
  return (await removeStaff(access.db, access.row.code, user, askerOf(access)))
    ? list()
    : answerMiss(access, list, msg('Only the organizer can do that'));
}

/**
 * A new invite token, and nobody on staff: the old link stops working and
 * everyone who joined through it has to be invited again. Organizer only.
 */
async function rotate(access: Access): Promise<Response> {
  const { role, hash } = access;
  if (role !== 'owner' || !hash) {
    return jsonError(ONLY_ORGANIZER, 403);
  }
  const owner = { ...access, role, hash };
  if (!(await rotateStaff(access.db, access.row.code, askerOf(owner)))) {
    return answerMiss(owner, () => jsonError('Busy; try again', 409), ONLY_ORGANIZER);
  }
  const row = await loadTournament(access.db, access.row.code);
  return row ? privateJson(manageView({ role, row })) : jsonError('No such tournament', 404);
}

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.user) {
    return jsonError('Sign in first', 401);
  }
  const value = (await readJsonObject(context.request, 512)) ?? {};
  if (value.rotate === true) {
    return rotate(access);
  }
  if (access.role) {
    return privateJson({ role: access.role });
  }
  const { db, row, user } = access;
  const joined = typeof value.token === 'string' && (await joinStaff(db, row.code, user.id, value.token));
  // Not joined can still mean a second join that raced the first in.
  return joined || (await isStaffMember(db, row.code, user.id))
    ? privateJson({ role: 'staff' })
    : jsonError('That invite link is no longer valid', 403);
}
