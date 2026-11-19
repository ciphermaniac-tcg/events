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
 * never lands on standings nobody saw. With `repair`, the round being played
 * is also paired again from the corrected standings, as staff would by hand
 * (deleted, then paired), in the same write: refused (409) once that round is
 * in play (see repairable.ts), and the correction with it. Answers with the
 * console's new copy of the event.
 */

import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { type Access, askerOf, openForStaff, openForStaffRead, privateJson } from '../../../lib/tournaments/access.js';
import { answerStaff } from '../../../lib/tournaments/answers.js';
import { loadCorrections } from '../../../lib/tournaments/corrections.js';
import { headJudgeOf } from '../../../lib/tournaments/headJudge.js';
import { commandChanges } from '../../../lib/tournaments/results.js';
import { type Changes, type TournamentRow, tryChange } from '../../../lib/tournaments/store.js';
import type { Command } from '../../../../shared/tournament/commands.js';
import { repairableRound } from '../../../../shared/tournament/repairable.js';
import type { PodCategory, Tournament } from '../../../../shared/tournament/types.js';
import {
  type ApproverRole,
  correctableMatch,
  correctedTournament,
  readCorrection
} from '../../../../shared/tournament/corrections.js';
import { isTomDateTime, tomDateTime } from '../../../../shared/tournament/divisions.js';
import type { StaffAccount } from '../../../../shared/tournament/staffRecords.js';
import { msg } from '../../../../shared/i18n.js';

const CHANGED = msg('The event changed since you looked. Look again and try once more.');

/** As what the signed-in account approves a correction: the head judge, or the organizer; null for other staff. */
function approverRole(access: Pick<Access, 'role' | 'user'>, headJudge: StaffAccount | null): ApproverRole | null {
  if (headJudge && headJudge.id === access.user?.id) {
    return 'head-judge';
  }
  return access.role === 'owner' ? 'organizer' : null;
}

/** The event after `command`, or why it was refused. */
function applied(row: TournamentRow, command: Command, localTime: string): Tournament | string {
  const changes = commandChanges(row, command, localTime);
  return typeof changes === 'string' ? changes : (changes.refusal ?? changes.tournament ?? row.tournament);
}

/** `row`'s event with `pod`'s latest round paired again, the way staff would by hand: deleted, then paired. */
function repaired(row: TournamentRow, pod: PodCategory, localTime: string): Tournament | string {
  const deleted = applied(row, { type: 'deleteRound', pod }, localTime);
  return typeof deleted === 'string'
    ? deleted
    : applied({ ...row, tournament: deleted }, { type: 'pairRound', pod }, localTime);
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await openForStaffRead(context);
  if (access instanceof Response) {
    return access;
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
  // A round in play since the preview has changed, as any other write would: the dialog looks again.
  if (
    request.version !== row.version ||
    (request.repair && !repairableRound(row.tournament, row, request.pod, request.round))
  ) {
    return jsonError(CHANGED, 409);
  }
  const ctx = { tom: row.mode === 'tom', finished: row.settings.finished, paired: row.pairedThrough ?? {} };
  const match = correctableMatch(row.tournament, request, ctx);
  if (typeof match === 'string') {
    return jsonError(match, 400);
  }
  const localTime = isTomDateTime(body.localTime) ? body.localTime : tomDateTime(new Date());
  const change = (): Changes | string => {
    const corrected = correctedTournament(row.tournament, request, localTime);
    const tournament = request.repair ? repaired({ ...row, tournament: corrected }, request.pod, localTime) : corrected;
    if (typeof tournament === 'string') {
      return tournament;
    }
    return {
      tournament,
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
    };
  };
  const outcome = await tryChange(access.db, row, change, askerOf(access));
  return outcome ? answerStaff(context, access, outcome) : jsonError(CHANGED, 409);
}
