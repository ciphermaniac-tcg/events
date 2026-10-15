/**
 * The event's head judge: an account on its staff the organizer names, who
 * may approve a result correction as the organizer may (see corrections.ts).
 */

import type { StaffAccount } from '../../../shared/tournament/staffRecords.js';
import { rowsChanged } from '../d1.js';
import type { D1Like } from '../types.js';
import type { Access } from './access.js';
import { type Asker, askerValues, asksStill, onStaff } from './roles.js';
import { staffAccounts, staffAccountsQuery } from './staffRecords.js';

/** The event's staff accounts, and the head judge among them. */
export interface StaffContext {
  /** Null when the event names none, or the account has left the staff or been deleted. */
  headJudge: StaffAccount | null;
  staff: StaffAccount[];
}

const contextOf = (staff: StaffAccount[], headJudge: string | null | undefined): StaffContext => ({
  headJudge: staff.find(account => account.id === headJudge) ?? null,
  staff
});

/** The staff context as the request read the event: its head judge came with the row. */
export async function staffContext(access: Access): Promise<StaffContext> {
  return contextOf(await staffAccounts(access), access.row.headJudge);
}

/** The event's head judge, while they are on its staff. */
export async function headJudgeOf(access: Access): Promise<StaffContext['headJudge']> {
  return (await staffContext(access)).headJudge;
}

/**
 * Names the head judge, or with null names none: one of the event's staff,
 * and only while the asker still organizes it. A new version, as a new invite
 * link makes one, so a correction previewed under the old head judge is
 * refused.
 * @returns The staff context it leaves, read in the same batch; null when it did not land
 */
export async function setHeadJudge(
  db: D1Like,
  code: string,
  userId: string | null,
  asker: Asker
): Promise<StaffContext | null> {
  const [result, staff] = await db.batch([
    db
      .prepare(
        'UPDATE tournaments SET head_judge = ?1, version = version + 1, updated_at = ?2 WHERE code = ?3 ' +
          `AND (?1 IS NULL OR ${onStaff('?1')}) AND ${asksStill(asker, '?4', '?5')}`
      )
      .bind(userId, Date.now(), code, ...askerValues(asker)),
    staffAccountsQuery(db, code)
  ]);
  return rowsChanged(result) === 1 ? contextOf((staff?.results ?? []) as StaffAccount[], userId) : null;
}
