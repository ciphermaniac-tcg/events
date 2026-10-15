/**
 * Who is what at an event, as SQL over its `tournaments` row: the one reading
 * of it that opening an event, every write its staff make and a correction's
 * approval share. A store's event is the store's: its Owner and Managers
 * organize it and its Staff staff it, whoever started it, and anyone who
 * leaves the store leaves its events. Any other event is organized by the
 * account that started it. Either way, anyone the invite link let in is staff.
 */

import type { Role } from '../../../shared/tournament/view.js';

/** Whether account `who` (an SQL expression) organizes the event in `tournaments`: its owner, or its store's Owner or a Manager. */
export const organizes = (who: string) =>
  `((tournaments.store_id IS NULL AND tournaments.owner_id = ${who}) OR EXISTS (SELECT 1 FROM store_members m ` +
  `WHERE m.store_id = tournaments.store_id AND m.user_id = ${who} AND m.role IN ('owner', 'manager')))`;

/** Whether `who` is on the event's staff: organizer, store member, or let in by the link. */
export const onStaff = (who: string) =>
  `((tournaments.store_id IS NULL AND tournaments.owner_id = ${who}) OR EXISTS (SELECT 1 FROM store_members m ` +
  `WHERE m.store_id = tournaments.store_id AND m.user_id = ${who}) OR EXISTS (SELECT 1 FROM staff s ` +
  `WHERE s.code = tournaments.code AND s.user_id = ${who}))`;

/** The role `who` holds at the event: 'owner', 'staff', or NULL for none. */
export const roleSql = (who: string) =>
  `CASE WHEN ${organizes(who)} THEN 'owner' WHEN ${onStaff(who)} THEN 'staff' END`;

/** Who asks for a change: the SHA-256 of their session token, and the role they held when the request read the event. */
export interface Asker {
  hash: string;
  role: Role;
}

/**
 * Whether the asker still holds their role at the event in `tournaments`: the
 * session is live, its account signed up, and as able as it was. `hash` and
 * `now` are the SQL that binds the session hash and the time; `askerValues`
 * gives what they bind.
 */
export const asksStill = (asker: Asker, hash = '?', now = '?') =>
  `EXISTS (SELECT 1 FROM sessions asking JOIN users asking_user ON asking_user.id = asking.user_id ` +
  `WHERE asking.token_hash = ${hash} AND asking.expires_at > ${now} AND asking_user.age_checked_at IS NOT NULL ` +
  `AND ${asker.role === 'owner' ? organizes('asking.user_id') : onStaff('asking.user_id')})`;

export const askerValues = (asker: Asker): [string, number] => [asker.hash, Date.now()];
