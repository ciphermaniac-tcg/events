/**
 * GET /api/recent-events — the home page's proof that events run here: the
 * newest finished event of each active store, newest first, at most six. Only
 * finished events, so nothing listed can still be joined or reported to, and
 * one per store, so one busy store does not fill the list. Only stores' events:
 * a store's page already lists its past events, while an event run under an
 * organizer's own name is reached only by its code. Each is { code, name,
 * place, startsAt, startDate, players }.
 */

import { createRateLimiter, rateLimitAddress } from '../lib/api/rateLimiter.js';
import { jsonError, jsonResponse } from '../lib/api/responses.js';
import type { Context } from '../lib/auth/env.js';
import { pairedRounds } from '../lib/tournaments/store.js';
import type { D1Like } from '../lib/types.js';

const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 600 });

/** How many events the list holds. */
export const RECENT_EVENTS = 6;

export interface RecentEvent {
  code: string;
  name: string;
  /** The store's name and town, or the town the event's details give; '' for neither. */
  place: string;
  /** When it started, in the event's own local time (YYYY-MM-DDTHH:MM); '' when it set none. */
  startsAt: string;
  /** TOM's start date (MM/DD/YYYY), for an event that set no start time; '' for none. */
  startDate: string;
  players: number;
}

interface Row {
  code: string;
  name: string | null;
  starts_at: string | null;
  start_date: string | null;
  players: number | null;
  store: string | null;
  city: string | null;
  region: string | null;
}

/**
 * One row per active store, its newest finished event that paired a round.
 * An event with no start time sorts by TOM's start date, as YYYY-MM-DD, and
 * failing that by when it last changed.
 */
const RECENT_SQL = `
  SELECT code, name, starts_at, start_date, players, store, city, region FROM (
    SELECT *, row_number() OVER (PARTITION BY store_id ORDER BY sort_key DESC, updated_at DESC) AS nth FROM (
    SELECT t.code, t.store_id, t.updated_at,
      json_extract(t.state, '$.info.name') AS name,
      json_extract(t.settings, '$.startsAt') AS starts_at,
      json_extract(t.state, '$.info.startDate') AS start_date,
      coalesce(
        nullif(json_extract(t.settings, '$.startsAt'), ''),
        substr(json_extract(t.state, '$.info.startDate'), 7, 4) || '-' ||
          substr(json_extract(t.state, '$.info.startDate'), 1, 2) || '-' ||
          substr(json_extract(t.state, '$.info.startDate'), 4, 2),
        strftime('%Y-%m-%dT%H:%M', t.updated_at / 1000, 'unixepoch')
      ) AS sort_key,
      json_array_length(t.state, '$.players') AS players,
      s.name AS store,
      coalesce(nullif(s.city, ''), json_extract(t.state, '$.info.city')) AS city,
      coalesce(nullif(s.region, ''), json_extract(t.state, '$.info.state')) AS region
    FROM tournaments t JOIN stores s ON s.id = t.store_id
    WHERE coalesce(json_extract(t.settings, '$.finished'), 0) = 1
      AND s.status = 'active'
      AND (${pairedRounds('t.state')}) > 0
    )
  )
  WHERE nth = 1
  ORDER BY sort_key DESC
  LIMIT ${RECENT_EVENTS}`;

/** "Store · Town, Region", leaving out whatever is missing. */
function placeOf(row: Row): string {
  const town = [row.city, row.region].filter(Boolean).join(', ');
  return [row.store, town].filter(Boolean).join(' · ');
}

export async function recentEvents(db: D1Like): Promise<RecentEvent[]> {
  const { results } = await db.prepare(RECENT_SQL).all<Row>();
  return (results ?? []).map(row => ({
    code: row.code,
    name: row.name ?? '',
    place: placeOf(row),
    startsAt: row.starts_at ?? '',
    startDate: row.start_date ?? '',
    players: row.players ?? 0
  }));
}

/** Five minutes at the edge: the list changes when an event ends, a few times a week. */
export async function onRequestGet(context: Context): Promise<Response> {
  if (!rateLimiter.allows(rateLimitAddress(context.request))) {
    return jsonError('Too many requests from here. Try again shortly.', 429);
  }
  const db = context.env.TOURNAMENT_DB;
  const events = db ? await recentEvents(db) : [];
  return jsonResponse({ events }, { cacheControl: 'public, max-age=300', cors: false });
}
