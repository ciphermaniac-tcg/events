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
import { type Access, open, openForOwner, privateJson } from '../../../lib/tournaments/access.js';
import { headJudgeOf, setHeadJudge } from '../../../lib/tournaments/headJudge.js';
import { staffAccounts } from '../../../lib/tournaments/staffRecords.js';

async function answer(access: Access): Promise<Response> {
  const [headJudge, staff] = await Promise.all([headJudgeOf(access), staffAccounts(access)]);
  return privateJson({ headJudge, staff });
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.role) {
    return access.user ? jsonError('Only this event’s staff can do that', 403) : jsonError('Sign in first', 401);
  }
  return answer(access);
}

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForOwner(context, 'Only the organizer can name the head judge');
  if (access instanceof Response) {
    return access;
  }
  const { userId } = (await readJsonObject(context.request, 512)) ?? {};
  if (userId !== null && typeof userId !== 'string') {
    return jsonError('Say who the head judge is', 400);
  }
  if (userId !== null && !(await staffAccounts(access)).some(staff => staff.id === userId)) {
    return jsonError('The head judge must be on this event’s staff', 400);
  }
  await setHeadJudge(access.db, access.row.code, userId);
  return answer(access);
}
