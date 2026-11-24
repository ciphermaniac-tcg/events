import { birthYear } from '../../../shared/tournament/divisions.js';
import { RETURNING_PLAYER_LIMIT, type ReturningPlayer } from '../../../shared/tournament/returningPlayers.js';
import { type Guard, rows } from '../d1.js';
import type { D1Like, D1Statement } from '../types.js';

interface ProfileRow {
  firstName: string;
  lastName: string;
  popId: string;
  birthDate: string;
}

/**
 * Search only prior rosters the requester can still manage, in this event's store or organizer.
 * `event` is the event's code as a key held to the asker's standing (see keyHeldTo), so the search
 * goes in the batch that opens the event and finds nobody, reading no roster, unless the asker is
 * on its staff. Each player is their newest entry: with one max() in a GROUP BY, SQLite takes the
 * bare columns from the row holding the max, and the padded time then code orders rows as
 * `updated_at, code` do.
 */
export const returningPlayersQuery = (db: D1Like, event: Guard, hash: string, query: string): D1Statement =>
  db
    .prepare(
      `WITH event AS MATERIALIZED (SELECT code, store_id, owner_id, json_extract(state, '$.players') AS players, ` +
        // As the event's own settings read: true unless stored, and only a stored true counts.
        `mode = 'tom' OR json_type(settings, '$.sanctioned') IS NULL OR json_extract(settings, '$.sanctioned') IS 1 ` +
        `AS sanctioned FROM tournaments WHERE code = ${event.sql}), ` +
        `asker AS (SELECT user_id FROM sessions WHERE token_hash = ?), ` +
        `profiles AS (SELECT ` +
        `json_extract(p.value, '$.firstName') AS firstName, json_extract(p.value, '$.lastName') AS lastName, ` +
        `CASE WHEN t.mode = 'tom' OR coalesce(json_extract(t.settings, '$.sanctioned'), 1) = 1 ` +
        `THEN json_extract(p.value, '$.id') ELSE '' END AS popId, ` +
        `json_extract(p.value, '$.birthDate') AS birthDate, t.updated_at, t.code ` +
        `FROM event e, asker a, tournaments t, json_each(t.state, '$.players') p WHERE t.code <> e.code ` +
        `AND (t.store_id = e.store_id OR (e.store_id IS NULL AND t.store_id IS NULL AND t.owner_id = e.owner_id)) ` +
        `AND ((t.store_id IS NULL AND t.owner_id = a.user_id) ` +
        `OR EXISTS (SELECT 1 FROM store_members m WHERE m.store_id = t.store_id AND m.user_id = a.user_id) ` +
        `OR EXISTS (SELECT 1 FROM staff s WHERE s.code = t.code AND s.user_id = a.user_id))), ` +
        `latest AS (SELECT firstName, lastName, popId, birthDate, updated_at, ` +
        `max(printf('%016d', updated_at) || code) FROM profiles ` +
        `GROUP BY CASE WHEN popId <> '' THEN 'id:' || popId ELSE 'name:' || lower(firstName || ' ' || lastName) END) ` +
        `SELECT firstName, lastName, popId, birthDate FROM latest, event e ` +
        `WHERE instr(lower(firstName || ' ' || lastName), lower(?)) > 0 ` +
        `AND NOT EXISTS (SELECT 1 FROM json_each(e.players) c WHERE ` +
        `(popId <> '' AND json_extract(c.value, '$.id') = popId) OR ` +
        `((e.sanctioned = 0 OR popId = '') AND lower(json_extract(c.value, '$.firstName') || ' ' || json_extract(c.value, '$.lastName')) = lower(firstName || ' ' || lastName))) ` +
        `ORDER BY updated_at DESC, firstName, lastName LIMIT ?`
    )
    .bind(...event.values, hash, query, RETURNING_PLAYER_LIMIT);

/** What `returningPlayersQuery` found. */
export const returningPlayers = (read: { results?: unknown[] } | undefined): ReturningPlayer[] =>
  rows<ProfileRow>(read).map(({ birthDate, ...profile }) => ({ ...profile, birthYear: birthYear(birthDate) }));
