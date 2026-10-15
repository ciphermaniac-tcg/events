/**
 * Result corrections (see shared/tournament/corrections.ts), for the event's
 * staff only.
 *
 * GET — the event's corrections, newest first; its head judge; and as what
 * the viewer may approve one ('organizer', 'head-judge'), or null when they
 * may not.
 * POST — the organizer or the head judge corrects a result: { pod, round,
 * table, p1, p2, outcome, note, version, localTime? }. `version` is the
 * event's version the correction was previewed on: if anything has been
 * written since, it is refused (409) rather than tried again, so a correction
 * never lands on standings nobody saw. Answers with the console's new copy of
 * the event.
 */

import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { type Access, open, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { answerStaff } from '../../../lib/tournaments/answers.js';
import { loadCorrections } from '../../../lib/tournaments/corrections.js';
import { headJudgeOf } from '../../../lib/tournaments/headJudge.js';
import { tryChange } from '../../../lib/tournaments/store.js';
import {
  type ApproverRole,
  correctableMatch,
  correctedTournament,
  readCorrection
} from '../../../../shared/tournament/corrections.js';
import { isTomDateTime, tomDateTime } from '../../../../shared/tournament/divisions.js';
import type { StaffAccount } from '../../../../shared/tournament/staffRecords.js';

const CHANGED = 'The event changed since you looked. Look again and try once more.';

/** As what the signed-in account approves a correction: the head judge, or the organizer; null for other staff. */
function approverRole(access: Pick<Access, 'role' | 'user'>, headJudge: StaffAccount | null): ApproverRole | null {
  if (headJudge && headJudge.id === access.user?.id) {
    return 'head-judge';
  }
  return access.role === 'owner' ? 'organizer' : null;
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.role) {
    return access.user ? jsonError('Only this event’s staff can do that', 403) : jsonError('Sign in first', 401);
  }
  const [corrections, headJudge] = await Promise.all([
    loadCorrections(access.db, access.row.code),
    headJudgeOf(access)
  ]);
  return privateJson({ corrections, headJudge, approver: approverRole(access, headJudge) });
}

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const headJudge = await headJudgeOf(access);
  const role = approverRole(access, headJudge);
  if (!role) {
    return jsonError('Only the organizer or the head judge can correct a result', 403);
  }
  const body = (await readJsonObject(context.request, 4096)) ?? {};
  const request = readCorrection(body);
  if (typeof request === 'string') {
    return jsonError(request, 400);
  }
  const { row } = access;
  if (request.version !== row.version) {
    return jsonError(CHANGED, 409);
  }
  const ctx = { tom: row.mode === 'tom', finished: row.settings.finished };
  const match = correctableMatch(row.tournament, request, ctx);
  if (typeof match === 'string') {
    return jsonError(match, 400);
  }
  const localTime = isTomDateTime(body.localTime) ? body.localTime : tomDateTime(new Date());
  const outcome = await tryChange(access.db, row, () => ({
    tournament: correctedTournament(row.tournament, request, localTime),
    correction: {
      pod: request.pod,
      round: request.round,
      table: request.table,
      p1: request.p1,
      p2: request.p2,
      from: match.outcome,
      to: request.outcome,
      note: request.note,
      approver: access.user?.id ?? '',
      role,
      alone: role === 'organizer' && headJudge === null,
      // The round being played: always the corrected round's next (see roundRefusal).
      during: request.round + 1
    }
  }));
  return outcome ? answerStaff(context, access, outcome) : jsonError(CHANGED, 409);
}
