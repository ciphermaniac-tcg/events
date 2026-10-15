/**
 * Result corrections on the server (see shared/tournament/corrections.ts):
 * the audit entry each one leaves, written in the same batch as the event.
 *
 * Entries are only ever added. A wrong correction is put right by another
 * one inside the window, which leaves a second entry beside the first.
 */

import type { ApproverRole, CorrectionEntry } from '../../../shared/tournament/corrections.js';
import type { Outcome, PodCategory } from '../../../shared/tournament/types.js';
import { displayNameSql } from '../accounts/handles.js';
import type { D1Like, D1Statement } from '../types.js';
import { onStaff, organizes } from './roles.js';

/** What a correction writes beside the event: everything its entry says but when and by which version. */
export type CorrectionWrite = Omit<CorrectionEntry, 'id' | 'approvedBy' | 'recordedAt'> & { approver: string };

/** Whether `who` may still approve as `role`, read from the event's row as the write lands. */
const mayApprove = (role: ApproverRole, who: string) =>
  role === 'head-judge' ? `(tournaments.head_judge = ${who} AND ${onStaff(who)})` : organizes(who);

/**
 * What the event's own update adds to its WHERE for a correction: the
 * approver may still approve, so a head judge replaced or an organizer gone
 * from the store between the route's check and the write changes nothing.
 */
export function correctionGuard(write: CorrectionWrite): { sql: string; values: string[] } {
  return {
    sql: ` AND EXISTS (SELECT 1 FROM (SELECT ? AS who) w WHERE ${mayApprove(write.role, 'w.who')})`,
    values: [write.approver]
  };
}

/**
 * The entry, written only while the event stands at the version this
 * correction read and its approver may still approve: it lands with the
 * event's own write (see correctionGuard), or neither does.
 */
export function correctionWrites(
  db: D1Like,
  row: { code: string; version: number },
  write: CorrectionWrite
): D1Statement[] {
  return [
    db
      .prepare(
        'INSERT INTO result_corrections (code, id, version, pod, round, table_no, p1, p2, from_outcome, to_outcome, ' +
          'note, approved_by, role, alone, during, recorded_at) ' +
          'SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16 ' +
          `FROM tournaments WHERE code = ?1 AND version = ?17 AND ${mayApprove(write.role, '?12')}`
      )
      .bind(
        row.code,
        crypto.randomUUID(),
        row.version + 1,
        write.pod,
        write.round,
        write.table,
        write.p1,
        write.p2,
        write.from,
        write.to,
        write.note,
        write.approver,
        write.role,
        write.alone ? 1 : 0,
        write.during,
        Date.now(),
        row.version
      )
  ];
}

interface EntryRow {
  id: string;
  pod: PodCategory;
  round: number;
  table_no: number;
  p1: string;
  p2: string;
  from_outcome: Outcome;
  to_outcome: Outcome;
  note: string;
  approver: string | null;
  role: ApproverRole;
  alone: number;
  during: number;
  recorded_at: number;
}

/** The event's corrections, newest first. */
export async function loadCorrections(db: D1Like, code: string): Promise<CorrectionEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*, (SELECT ${displayNameSql('u')} FROM users u WHERE u.id = c.approved_by) AS approver ` +
        'FROM result_corrections c WHERE c.code = ? ORDER BY c.recorded_at DESC, c.id'
    )
    .bind(code)
    .all<EntryRow>();
  return results.map(row => ({
    id: row.id,
    pod: row.pod,
    round: row.round,
    table: row.table_no,
    p1: row.p1,
    p2: row.p2,
    from: row.from_outcome,
    to: row.to_outcome,
    note: row.note,
    approvedBy: row.approver,
    role: row.role,
    alone: row.alone === 1,
    during: row.during,
    recordedAt: row.recorded_at
  }));
}
