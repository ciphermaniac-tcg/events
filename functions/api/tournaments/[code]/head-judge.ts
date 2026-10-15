/**
 * The event's head judge, who may approve a result correction as the
 * organizer may (see corrections.ts).
 *
 * GET — for staff: the head judge, and the staff accounts that could be named.
 * PUT { userId } — the organizer names one of the event's staff accounts, or
 * with null names none. Answers as GET does.
 */

import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { answerMiss, askerOf, openForOwner, openForStaffRead, privateJson } from '../../../lib/tournaments/access.js';
import { setHeadJudge, staffContext } from '../../../lib/tournaments/headJudge.js';

const ONLY_ORGANIZER = 'Only the organizer can name the head judge';

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await openForStaffRead(context);
  return access instanceof Response ? access : privateJson(await staffContext(access));
}

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForOwner(context, ONLY_ORGANIZER);
  if (access instanceof Response) {
    return access;
  }
  const { userId } = (await readJsonObject(context.request, 512)) ?? {};
  if (userId !== null && typeof userId !== 'string') {
    return jsonError('Say who the head judge is', 400);
  }
  const named = await setHeadJudge(access.db, access.row.code, userId, askerOf(access));
  return named
    ? privateJson(named)
    : answerMiss(access, () => jsonError('The head judge must be on this event’s staff', 400), ONLY_ORGANIZER);
}
