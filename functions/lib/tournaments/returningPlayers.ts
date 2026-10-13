import { birthYear } from '../../../shared/tournament/divisions.js';
import { RETURNING_PLAYER_LIMIT, type ReturningPlayer } from '../../../shared/tournament/returningPlayers.js';
import { isSanctioned } from '../../../shared/tournament/view.js';
import type { StaffAccess } from './access.js';

interface ProfileRow {
  firstName: string;
  lastName: string;
  popId: string;
  birthDate: string;
}

/** Search only prior rosters the requester can still manage, in this event's store or organizer. */
export async function returningPlayers(access: StaffAccess, query: string): Promise<ReturningPlayer[]> {
  const { row, db } = access;
  const scope = row.storeId === null ? 't.store_id IS NULL AND t.owner_id = ?2' : 't.store_id = ?2';
  const { results } = await db
    .prepare(
      `WITH profiles AS (SELECT ` +
        `json_extract(p.value, '$.firstName') AS firstName, json_extract(p.value, '$.lastName') AS lastName, ` +
        `CASE WHEN t.mode = 'tom' OR coalesce(json_extract(t.settings, '$.sanctioned'), 1) = 1 ` +
        `THEN json_extract(p.value, '$.id') ELSE '' END AS popId, ` +
        `json_extract(p.value, '$.birthDate') AS birthDate, t.updated_at, t.code ` +
        `FROM tournaments t, json_each(t.state, '$.players') p WHERE t.code <> ?1 AND ${
          scope
        } AND ((t.store_id IS NULL AND t.owner_id = ?3) ` +
        `OR EXISTS (SELECT 1 FROM store_members m WHERE m.store_id = t.store_id AND m.user_id = ?3) ` +
        `OR EXISTS (SELECT 1 FROM staff s WHERE s.code = t.code AND s.user_id = ?3))), ` +
        `latest AS (SELECT *, row_number() OVER (` +
        `PARTITION BY CASE WHEN popId <> '' THEN 'id:' || popId ELSE 'name:' || lower(firstName || ' ' || lastName) END ` +
        `ORDER BY updated_at DESC, code DESC) AS position FROM profiles) ` +
        `SELECT firstName, lastName, popId, birthDate FROM latest WHERE position = 1 ` +
        `AND instr(lower(firstName || ' ' || lastName), lower(?4)) > 0 ` +
        `AND NOT EXISTS (SELECT 1 FROM json_each(?5) c WHERE ` +
        `(popId <> '' AND json_extract(c.value, '$.id') = popId) OR ` +
        `((?7 = 0 OR popId = '') AND lower(json_extract(c.value, '$.firstName') || ' ' || json_extract(c.value, '$.lastName')) = lower(firstName || ' ' || lastName))) ` +
        `ORDER BY updated_at DESC, firstName, lastName LIMIT ?6`
    )
    .bind(
      row.code,
      row.storeId ?? row.ownerId,
      access.user!.id,
      query,
      JSON.stringify(row.tournament.players),
      RETURNING_PLAYER_LIMIT,
      Number(isSanctioned(row))
    )
    .all<ProfileRow>();
  return results.map(({ birthDate, ...profile }) => ({ ...profile, birthYear: birthYear(birthDate) }));
}
