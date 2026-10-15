/**
 * The event's head judge: an account on its staff the organizer names, who
 * may approve a result correction as the organizer may (see corrections.ts).
 */

import type { StaffAccount } from '../../../shared/tournament/staffRecords.js';
import type { D1Like } from '../types.js';
import type { Access } from './access.js';
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

/** Names the head judge, or with null names none. Whether they are on the event's staff is the route's to check. */
export async function setHeadJudge(db: D1Like, code: string, userId: string | null): Promise<void> {
  await db.prepare('UPDATE tournaments SET head_judge = ? WHERE code = ?').bind(userId, code).run();
}
