/**
 * The event's head judge: an account on its staff the organizer names, who
 * may approve a result correction as the organizer may (see corrections.ts).
 */

import type { StaffAccount } from '../../../shared/tournament/staffRecords.js';
import { rowsChanged } from '../d1.js';
import type { D1Like } from '../types.js';
import type { Access } from './access.js';
import { type Asker, askerValues, asksStill, onStaff } from './roles.js';
import { staffAccounts } from './staffRecords.js';

/**
 * The event's head judge, while they are on its staff; null when it names
 * none, or the account has left the staff or been deleted.
 */
export async function headJudgeOf(access: Access): Promise<StaffAccount | null> {
  const [named, staff] = await Promise.all([
    access.db.prepare('SELECT head_judge FROM tournaments WHERE code = ?').bind(access.row.code).first<{
      head_judge: string | null;
    }>(),
    staffAccounts(access)
  ]);
  return staff.find(account => account.id === named?.head_judge) ?? null;
}

/**
 * Names the head judge, or with null names none: one of the event's staff,
 * and only while the asker still organizes it. A new version, as a new invite
 * link makes one, so a correction previewed under the old head judge is
 * refused.
 * @returns Whether it landed
 */
export async function setHeadJudge(db: D1Like, code: string, userId: string | null, asker: Asker): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE tournaments SET head_judge = ?1, version = version + 1, updated_at = ?2 WHERE code = ?3 ' +
        `AND (?1 IS NULL OR ${onStaff('?1')}) AND ${asksStill(asker, '?4', '?5')}`
    )
    .bind(userId, Date.now(), code, ...askerValues(asker))
    .run();
  return rowsChanged(result) === 1;
}
