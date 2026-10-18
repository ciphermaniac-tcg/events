/**
 * Tournaments in D1: one row per event holding the whole document.
 *
 * Every write names the version it read and bumps it, so a stale write fails
 * instead of undoing someone else's: two staff reporting at once each apply to
 * the latest document, because a failed write is retried from a fresh read by
 * the caller (see `mutate`).
 */

import { ADULT_AGE, mayBeMinor } from '../../../shared/accounts/age.js';
import { birthYear } from '../../../shared/tournament/divisions.js';
import { managesStore, storeRoleOf } from '../../../shared/accounts/stores.js';
import { DAY_MS, eventDay } from '../../../shared/tournament/limits.js';
import { type MatchKey, normalizeCutPods } from '../../../shared/tournament/rounds.js';
import { POD_CATEGORIES, type Tournament } from '../../../shared/tournament/types.js';
import {
  applyPending,
  assignKeys,
  DEFAULT_SETTINGS,
  type PendingResult,
  type Role,
  type StaffMember,
  storedSettings,
  type TournamentMode,
  type TournamentSettings,
  type TournamentSummary
} from '../../../shared/tournament/view.js';
import { type PlayerReport, pruneReports } from '../../../shared/tournament/reports.js';
import { type PlayerRequest, withRequestIds } from '../../../shared/tournament/requests.js';
import type { CheckIns } from '../../../shared/tournament/checkins.js';
import { randomToken, sessionHash, sessionUserQuery, type User, userFromRow, type UserRow } from '../auth/session.js';
import { displayNameSql } from '../accounts/handles.js';
import { firstRow, type Guard, rowsChanged } from '../d1.js';
import type { D1Like, D1Statement } from '../types.js';
import { deleteWrites, firstIndexWrites, rosterWrites } from './rosterWrites.js';
import { correctionGuard, type CorrectionWrite, correctionWrites } from './corrections.js';
import { type PairedThrough, pairedThrough } from '../../../shared/tournament/corrections.js';
import { type ReportEvidence, reportEvidenceWrites } from './reportHistory.js';
import { type Asker, askerValues, asksStill, onStaff, roleSql } from './roles.js';
import { winWrites } from './winWrites.js';
import { msg } from '../../../shared/i18n.js';

export interface TournamentRow {
  lastImportAt?: number | null;
  code: string;
  ownerId: string;
  mode: TournamentMode;
  tournament: Tournament;
  pending: PendingResult[];
  /** Results players reported and staff have not settled (see shared/tournament/reports.ts). */
  reports: PlayerReport[];
  /** What players asked staff for (see shared/tournament/requests.ts). */
  requests: PlayerRequest[];
  settings: TournamentSettings;
  keys: Record<string, string>;
  /** POP ID to archetype label. */
  decks: Record<string, string>;
  /** What staff checked for each player before round 1 (see shared/tournament/checkins.ts). */
  checkins: CheckIns;
  /** POP ID to the archetype the player's pasted list reads as; `decks`, set by staff, wins over it. */
  inferredDecks: Record<string, string>;
  staffToken: string;
  version: number;
  updatedAt: number;
  /** The store that runs the event; null for one run under an account's own name. */
  storeId: string | null;
  /** The day a Community organizer's event holds (see shared/tournament/limits.ts); null otherwise. */
  communityDay: string | null;
  /** The highest round each pod has ever paired; only ever rises (see shared/tournament/corrections.ts). */
  pairedThrough?: PairedThrough;
  /** The account the organizer named head judge (see headJudge.ts); null for none. */
  headJudge?: string | null;
}

interface RawRow {
  last_import_at: number | null;
  code: string;
  owner_id: string;
  mode: string;
  state: string;
  pending: string;
  reports: string;
  requests: string;
  settings: string;
  player_keys: string;
  decks: string;
  checkins?: string | null;
  inferred_decks?: string | null;
  staff_token: string;
  version: number;
  updated_at: number;
  store_id: string | null;
  community_day: string | null;
  paired_through?: string | null;
  head_judge?: string | null;
}

function legacyMatchKeys<T extends MatchKey>(tournament: Tournament, keys: T[]): T[] {
  const parents = new Map(tournament.pods.filter(p => p.cutOf).map(p => [p.category, p.cutOf!]));
  return keys.map(key => ({ ...key, pod: parents.get(key.pod) ?? key.pod }));
}

function fromRaw(raw: RawRow): TournamentRow {
  const tournament = JSON.parse(raw.state) as Tournament;
  // Rows imported before the writer matched TOM byte for byte carry the file's bytes; the next write drops them.
  delete (tournament.passthrough as { original?: unknown } | undefined)?.original;
  return {
    lastImportAt: raw.last_import_at ?? null,
    code: raw.code,
    ownerId: raw.owner_id,
    mode: raw.mode === 'tom' ? 'tom' : 'swiss',
    tournament: normalizeCutPods(tournament),
    pending: legacyMatchKeys(tournament, JSON.parse(raw.pending) as PendingResult[]),
    reports: legacyMatchKeys(tournament, JSON.parse(raw.reports) as PlayerReport[]),
    requests: withRequestIds(JSON.parse(raw.requests) as PlayerRequest[]),
    settings: storedSettings(JSON.parse(raw.settings) as Record<string, unknown>),
    keys: JSON.parse(raw.player_keys) as Record<string, string>,
    decks: JSON.parse(raw.decks) as Record<string, string>,
    checkins: JSON.parse(raw.checkins ?? '{}') as CheckIns,
    inferredDecks: JSON.parse(raw.inferred_decks ?? '{}') as Record<string, string>,
    staffToken: raw.staff_token,
    version: raw.version,
    updatedAt: raw.updated_at,
    storeId: raw.store_id ?? null,
    communityDay: raw.community_day ?? null,
    // Raised to the rounds the event holds now, so an event saved before the column existed starts there.
    pairedThrough: pairedThrough(JSON.parse(raw.paired_through ?? '{}') as PairedThrough, tournament),
    headJudge: raw.head_judge ?? null
  };
}

/** Codes are short enough to read aloud and type from a table sign: no 0/O or 1/I/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** A random code in that alphabet; a public profile's address is a longer one (functions/lib/accounts/publicProfile.ts). */
export function newCode(length = CODE_LENGTH, random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Whether `value` could be a code `length` long: an event's, or a public profile's address. */
export function isCode(value: string, length = CODE_LENGTH): boolean {
  return value.length === length && [...value].every(char => CODE_ALPHABET.includes(char));
}

const tournamentQuery = (db: D1Like, code: string) => db.prepare('SELECT * FROM tournaments WHERE code = ?').bind(code);

export async function loadTournament(db: D1Like, code: string): Promise<TournamentRow | null> {
  const raw = await tournamentQuery(db, code).first<RawRow>();
  return raw ? fromRaw(raw) : null;
}

/**
 * Events under way and not ended that nobody has changed since `before`, at
 * most `limit` of them. Under way means round 1 is paired: an event set up
 * ahead of its day may sit untouched for as long as it likes.
 */
export async function loadIdle(db: D1Like, before: number, limit: number, expiredBefore = 0): Promise<TournamentRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM tournaments WHERE coalesce(json_extract(settings, '$.finished'), 0) = 0 " +
        "AND (coalesce(json_extract(settings, '$.idle'), 0) = 0 OR updated_at <= ?) " +
        `AND updated_at < ? AND (${pairedRounds('state')}) > 0 ORDER BY updated_at ASC, code ASC LIMIT ?`
    )
    .bind(expiredBefore, before, limit)
    .all<RawRow>();
  return results.map(fromRaw);
}

export interface Opened {
  row: TournamentRow;
  user: User | null;
  role: Role | null;
  /**
   * The player the signed-in account is at this event through a reporter row
   * it holds (its Claim, see reporters.ts), when the route asked; null when it
   * holds none, or the route did not ask.
   */
  claimed: string | null;
  /** The SHA-256 of the request's session token; null without one. */
  hash: string | null;
}

/** What a route asks of `openTournament` beyond the event and who is asking. */
export interface OpenOptions {
  /** Read the asking account's Claim too, in the same batch. */
  claim?: boolean;
}

/**
 * The event, the signed-in user and their role in it. Every tournament request
 * starts here, so for a signed-in asker the three reads go as one batch: one
 * wait on the database where there were three in a row. A route that shows
 * the asker who they are in the event asks for their Claim as a fourth.
 */
export async function openTournament(
  db: D1Like,
  code: string,
  request: Request,
  options: OpenOptions = {}
): Promise<Opened | null> {
  const hash = await sessionHash(request);
  if (!hash) {
    const row = await loadTournament(db, code);
    return row && { row, user: null, role: null, claimed: null, hash };
  }
  return openAs(db, code, hash, options);
}

/** As `openTournament`, for the session under `hash`. */
async function openAs(db: D1Like, code: string, hash: string, options: OpenOptions = {}): Promise<Opened | null> {
  const now = Date.now();
  const [event, account, staff, claim] = await db.batch([
    tournamentQuery(db, code),
    sessionUserQuery(db, hash, now),
    roleQuery(db, code, hash, now),
    ...(options.claim ? [claimQuery(db, code, hash, now)] : [])
  ]);
  const raw = firstRow<RawRow>(event);
  if (!raw) {
    return null;
  }
  const found = firstRow<UserRow>(account);
  const user = found && userFromRow(found);
  const claimed = firstRow<{ player_id: string }>(claim)?.player_id ?? null;
  const role = (user && firstRow<{ role: Role | null }>(staff)?.role) ?? null;
  return { row: fromRaw(raw), user, role, claimed, hash };
}

/** The role the session's account holds at the event (see roles.ts). */
const roleQuery = (db: D1Like, code: string, hash: string, now: number) =>
  db
    .prepare(
      `SELECT ${roleSql('sessions.user_id')} AS role FROM sessions JOIN tournaments ON tournaments.code = ?1 ` +
        'WHERE sessions.token_hash = ?2 AND sessions.expires_at > ?3'
    )
    .bind(code, hash, now);

/** The player the session's account holds a reporter row for at the event. */
const claimQuery = (db: D1Like, code: string, hash: string, now: number) =>
  db
    .prepare(
      'SELECT player_id FROM report_devices JOIN sessions ON sessions.user_id = report_devices.user_id ' +
        'WHERE report_devices.code = ? AND sessions.token_hash = ? AND sessions.expires_at > ?'
    )
    .bind(code, hash, now);

/** Just the version, for a cheap "has anything changed" check. */
export async function loadVersion(db: D1Like, code: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT version FROM tournaments WHERE code = ?')
    .bind(code)
    .first<{ version: number }>();
  return row?.version ?? null;
}

export interface NewTournament {
  ownerId: string;
  mode: TournamentMode;
  tournament: Tournament;
  settings?: TournamentSettings;
  /** The store that runs it, when one does. */
  storeId?: string | null;
  /** The day a Community organizer's event holds, one per owner (see shared/tournament/limits.ts). */
  communityDay?: string | null;
  /** Who the day's creations count against, and how many they may make; none for an Admin's own. */
  admission?: { owner: string; limit: number } | null;
  /** Authorization and retained-event quota, evaluated inside the creation transaction. */
  guard?: { sql: string; values: unknown[] };
}

/** The day's creations are used up (shared/tournament/limits.ts). */
export class LimitReached extends Error {}

/** The owner already holds an event on that day (shared/tournament/limits.ts). */
export class DayTaken extends Error {}

/** The creation no longer meets its authorization or retained-event quota. */
export class CreationRefused extends Error {}

/** Whether a failed write broke the one-event-per-day index. */
const breaksDay = (error: unknown) => error instanceof Error && error.message.includes('community_day');

/**
 * The writes that count a creation against `owner`, kept a day: the ones
 * older go first, then this one goes in only while the day's count is under
 * the limit. `id` names it, so a retry with the same id counts nothing more.
 */
function admissionWrites(
  db: D1Like,
  admission: { owner: string; limit: number },
  creation: { id: string; now: number; guard: { sql: string; values: unknown[] } }
) {
  const { id, now, guard } = creation;
  return [
    db.prepare('DELETE FROM event_creations WHERE owner = ? AND at <= ?').bind(admission.owner, now - DAY_MS),
    db
      .prepare(
        'INSERT OR IGNORE INTO event_creations (owner, at, id) SELECT ?1, ?2, ?3 ' +
          `WHERE (SELECT COUNT(*) FROM event_creations WHERE owner = ?1 AND at > ?4) < ?5 AND (${guard.sql})`
      )
      .bind(admission.owner, now, id, now - DAY_MS, admission.limit, ...guard.values)
  ];
}

/**
 * Stores a new event under a code nobody holds, and hands back the row as
 * stored. The insert itself refuses a code already taken, so two events made
 * at once cannot land on one code, and there is no read before or after it.
 * A file's players go into the history index in the same batch, only where
 * the row this insert made stands (see rosterWrites.ts).
 */
export async function createTournament(db: D1Like, input: NewTournament): Promise<TournamentRow> {
  const { ownerId, mode, tournament } = input;
  const settings = input.settings ?? DEFAULT_SETTINGS;
  const storeId = input.storeId ?? null;
  const communityDay = input.communityDay ?? null;
  const state = stateJson(tournament);
  const keys = assignKeys(tournament, {});
  const staffToken = randomToken(16);
  const now = Date.now();
  const lastImportAt = mode === 'tom' ? now : null;
  const admissionId = randomToken(8);
  // With a limit, the event goes in only where its creation was counted in.
  const admitted = input.admission
    ? {
        sql: ' AND EXISTS (SELECT 1 FROM event_creations WHERE owner = ? AND at = ? AND id = ?)',
        values: [input.admission.owner, now, admissionId]
      }
    : { sql: '', values: [] };
  const guard = input.guard ?? { sql: '1 = 1', values: [] };
  const allowed = db.prepare(`SELECT (${guard.sql}) AS allowed`).bind(...guard.values);
  const admission = input.admission ? admissionWrites(db, input.admission, { id: admissionId, now, guard }) : [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const insert = db
      .prepare(
        'INSERT INTO tournaments (code, owner_id, mode, state, settings, player_keys, staff_token, created_at, ' +
          'updated_at, store_id, community_day, last_import_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ' +
          `WHERE NOT EXISTS (SELECT 1 FROM tournaments WHERE code = ?)${admitted.sql} AND (${guard.sql})`
      )
      .bind(
        code,
        ownerId,
        mode,
        state,
        JSON.stringify(settings),
        JSON.stringify(keys),
        staffToken,
        now,
        now,
        storeId,
        communityDay,
        lastImportAt,
        code,
        ...admitted.values,
        ...guard.values
      );
    const results = await db
      .batch([allowed, ...admission, insert, ...firstIndexWrites(db, { code, staffToken, mode, settings, tournament })])
      .catch((error: unknown) => {
        throw breaksDay(error) ? new DayTaken(msg('You already have an event that day')) : error;
      });
    checkCreationAdmission(results, input, attempt);
    if (rowsChanged(results[admission.length + 1]) === 1) {
      const empty = { pending: [], reports: [], requests: [], decks: {}, checkins: {}, inferredDecks: {} };
      const made = { code, ownerId, mode, tournament, settings, keys, staffToken, version: 1, updatedAt: now };
      const paired = pairedThrough({}, tournament);
      return { ...made, ...empty, storeId, communityDay, lastImportAt, pairedThrough: paired, headJudge: null };
    }
  }
  throw new Error(msg('Could not find a free tournament code'));
}

/** Interpret the admission snapshot from the same transaction as the event insert. */
function checkCreationAdmission(
  results: Awaited<ReturnType<D1Like['batch']>>,
  input: NewTournament,
  attempt: number
): void {
  const permission = (results[0]?.results as { allowed: number }[] | undefined)?.[0]?.allowed;
  if (!permission) {
    throw new CreationRefused(msg('You can no longer start this event, or have too many events'));
  }
  // A retry can reuse its admission; the first try must have recorded one.
  if (attempt === 0 && input.admission && rowsChanged(results[2]) === 0) {
    throw new LimitReached('You’ve started as many events as you can today; try again tomorrow');
  }
}

/**
 * D1 refuses a row over 2,000,000 bytes, so the stored document stops short of
 * it. A League Cup is a few kilobytes; this is room for a large Regional's
 * day one, and a larger event fails here with a message rather than in D1.
 */
export const MAX_STATE_BYTES = 1_800_000;

export class TooLarge extends Error {}

function stateJson(tournament: Tournament): string {
  const json = JSON.stringify(tournament);
  if (new TextEncoder().encode(json).length > MAX_STATE_BYTES) {
    throw new TooLarge(msg('This event is too large to store'));
  }
  return json;
}

export interface Changes {
  lastImportAt?: number;
  /** A refused action can still persist TOM's phase transition without a round. */
  refusal?: string;
  /** Preserve the last activity time when the idle sweep only changes bookkeeping. */
  updatedAt?: number;
  tournament?: Tournament;
  pending?: PendingResult[];
  reports?: PlayerReport[];
  requests?: PlayerRequest[];
  /** Claimant evidence for a successful player filing, kept in the same transaction. */
  reportEvidence?: Omit<ReportEvidence, 'version'>;
  /** A result correction's audit entry, written only where the event's own write lands (see corrections.ts). */
  correction?: CorrectionWrite;
  settings?: TournamentSettings;
  decks?: Record<string, string>;
  checkins?: CheckIns;
  inferredDecks?: Record<string, string>;
  /** A Community organizer's event moving to another day (see dayChange). */
  communityDay?: string;
}

/**
 * The day a settings change moves a Community organizer's event to, when it
 * moves it: its start time names another date. Clearing the start time keeps
 * the day it holds.
 */
export function dayChange(row: TournamentRow, settings: TournamentSettings): Pick<Changes, 'communityDay'> {
  if (row.communityDay === null) {
    return {};
  }
  const day = eventDay(settings.startsAt, row.communityDay);
  return day === row.communityDay ? {} : { communityDay: day };
}

/**
 * Whether setting `next` where the row holds `held` changes nothing: the same
 * JSON, at an event that is not idle, which any change from staff ends. Read
 * as written, so a difference in key order only costs the write it always did.
 */
export const changesNothing = (row: TournamentRow, held: unknown, next: unknown): boolean =>
  !row.settings.idle && JSON.stringify(held) === JSON.stringify(next);

/**
 * The reports a change leaves: its own, or the row's less any whose match it
 * settled or took away, since a result from staff settles a disputed match.
 * Turning player reporting off drops them all, as does ending the event, whose
 * results no report settles.
 */
function reportsAfter(row: TournamentRow, changes: Changes): PlayerReport[] {
  const settings = changes.settings ?? row.settings;
  if (!settings.playerReporting || settings.finished) {
    return [];
  }
  const reports = changes.reports ?? row.reports;
  return changes.tournament || changes.pending
    ? pruneReports(applyPending(changes.tournament ?? row.tournament, changes.pending ?? row.pending), reports)
    : reports;
}

/**
 * The row as a change leaves it, short of its new version: the public keys
 * and the reports follow from the change, and are worked out here once for
 * both the write and the row handed back.
 */
function changedRow(row: TournamentRow, changes: Changes): TournamentRow {
  // The keys as saved, so a player added by this change is already under a public key.
  const keys = changes.tournament ? assignKeys(changes.tournament, row.keys) : row.keys;
  const { reportEvidence: _evidence, correction: _correction, ...state } = changes;
  // A deleted or re-paired round never lowers it: the correction window stays shut (see corrections.ts).
  const paired = changes.tournament ? pairedThrough(row.pairedThrough ?? {}, changes.tournament) : row.pairedThrough;
  return { ...row, ...state, keys, reports: reportsAfter(row, changes), pairedThrough: paired };
}

/** The columns a new copy of the event's document rewrites: the document, its public keys, and its rounds paired. */
function documentColumns(tournament: Tournament | undefined, next: TournamentRow): [string, string | undefined][] {
  return tournament
    ? [
        ['state', stateJson(tournament)],
        ['player_keys', JSON.stringify(next.keys)],
        ['paired_through', JSON.stringify(next.pairedThrough ?? {})]
      ]
    : [];
}

/** The columns a change writes, and their values: only what it changed. */
function columnsFor(changes: Changes, next: TournamentRow): [string, string][] {
  const { tournament, pending, settings, decks, checkins, inferredDecks, communityDay } = changes;
  const columns: [string, string | false | undefined][] = [
    ['community_day', communityDay],
    ['last_import_at', changes.lastImportAt?.toString()],
    ...documentColumns(tournament, next),
    ['pending', pending && JSON.stringify(pending)],
    ['settings', settings && JSON.stringify(settings)],
    ['decks', decks && JSON.stringify(decks)],
    ['checkins', checkins && JSON.stringify(checkins)],
    ['inferred_decks', inferredDecks && JSON.stringify(inferredDecks)],
    ['requests', changes.requests && JSON.stringify(changes.requests)],
    // Reports follow the results and the reporting setting, so any of those rewrites them.
    ['reports', (changes.reports ?? tournament ?? pending ?? settings) && JSON.stringify(next.reports)]
  ];
  return columns.filter((column): column is [string, string] => typeof column[1] === 'string');
}

/** A staff asker's standing, as what must still hold where their change lands (see roles.ts). */
const askerStanding = (asker: Asker): Guard => ({ sql: asksStill(asker), values: askerValues(asker) });

/**
 * The two writes that hold a change to its asker's standing as it lands, one
 * first in its batch and one last. Where the standing no longer holds (staff
 * removed from staff or the store or signed out, a player's reporting seat
 * released), the first turns the event's version aside, to its negative, so
 * each write between, every one of which names the version read or the one
 * it makes, misses; the last turns it back. The batch then changes nothing,
 * and the caller reads the event and the standing again. A batch is one
 * transaction: nothing outside it sees the version turned, and a guard that
 * holds as it starts holds to its end.
 */
function askerGate(db: D1Like, row: TournamentRow, standing: Guard | undefined): [D1Statement[], D1Statement[]] {
  if (!standing) {
    return [[], []];
  }
  const turn = 'UPDATE tournaments SET version = -version WHERE code = ? AND ';
  return [
    [db.prepare(`${turn}version = ? AND NOT ${standing.sql}`).bind(row.code, row.version, ...standing.values)],
    [db.prepare(`${turn}version < 0`).bind(row.code)]
  ];
}

/**
 * Writes the changes if the row is still at `row.version`, and the asker's
 * standing, when there is one, still holds (see askerGate). Only the columns the
 * change touches are written, so a result reported mid-event does not send
 * the whole document back. A change to the player list or to whether the
 * event is sanctioned also keeps the history index, in the same batch and on
 * the same version (see rosterWrites.ts); any other change is the one update
 * alone.
 * @returns The row as written, or null when someone else wrote first or the asker may no longer write
 */
async function saveTournament(
  db: D1Like,
  row: TournamentRow,
  input: Changes,
  standing?: Guard
): Promise<TournamentRow | null> {
  const changes =
    row.settings.idle && !input.settings ? { ...input, settings: { ...row.settings, idle: false } } : input;
  const next = changedRow(row, changes);
  const columns = columnsFor(changes, next);
  const updatedAt = changes.updatedAt ?? Date.now();
  const roster = changes.tournament || changes.settings ? rosterWrites(db, row, next) : [];
  const guard = changes.correction ? correctionGuard(changes.correction) : { sql: '', values: [] };
  const update = db
    .prepare(
      `UPDATE tournaments SET ${columns.map(([name]) => `${name} = ?, `).join('')}` +
        `version = version + 1, updated_at = ? WHERE code = ? AND version = ?${guard.sql}`
    )
    .bind(...columns.map(([, value]) => value), updatedAt, row.code, row.version, ...guard.values);
  const ending =
    next.settings.finished && !row.settings.finished ? [minorCardsCut(db, next, row.version + 1, updatedAt)] : [];
  const evidence = [
    ...(changes.reportEvidence ? reportEvidenceWrites(db, row, changes.reportEvidence) : []),
    ...(changes.correction ? correctionWrites(db, row, changes.correction) : [])
  ];
  const [check, restore] = askerGate(db, row, standing);
  const before = [...check, ...roster, ...evidence];
  const results = await db.batch([...before, update, ...ending, ...winWrites(db, row, next), ...restore]);
  return rowsChanged(results[before.length]) === 1 ? { ...next, version: row.version + 1, updatedAt } : null;
}

/**
 * Deletes the cards of every list whose player may be under 18, as the event
 * ends: deck checks needed them while it ran, and nothing needs them after
 * (Play! Pokémon sets no time to keep them). The archetype stays. Either
 * birth year says so: the one the list was sent with, or the one the roster
 * holds for its Player ID as the event ends, since staff may have corrected
 * it since. Runs after the event's own write in the same batch, and only
 * where that write landed: the row must stand at the version it wrote and be
 * finished, so an end that lost a race to another write deletes nothing. An
 * unsanctioned event's lists carry no birth year, so its lists are kept.
 */
function minorCardsCut(db: D1Like, next: TournamentRow, version: number, now: number): D1Statement {
  // Born in this year or later, someone may still be 17 (shared/accounts/age.ts).
  const youngest = new Date(now).getUTCFullYear() - ADULT_AGE;
  const minors = next.tournament.players
    .filter(player => mayBeMinor(birthYear(player.birthDate), new Date(now)))
    .map(player => player.id);
  return db
    .prepare(
      "UPDATE decklists SET deck = '' WHERE code = ?1 AND deck <> '' " +
        'AND (CAST(substr(birth_date, -4) AS INTEGER) >= ?2 OR pop_id IN (SELECT value FROM json_each(?4) AS ids)) ' +
        'AND EXISTS (SELECT 1 FROM tournaments WHERE code = ?1 AND version = ?3 ' +
        "AND coalesce(json_extract(settings, '$.finished'), 0) = 1)"
    )
    .bind(next.code, youngest, version, JSON.stringify(minors));
}

/**
 * What a change comes to: the row as written, or why it was refused. A change
 * staff asked for carries the role the asker held as it landed.
 */
export type Mutation = { row: TournamentRow; refusal?: string; role?: Role } | Refused;

/** Why a change was refused, and the status that says so. */
export interface Refused {
  error: string;
  status: number;
}

/** A change to the row as it stands, judged with the asker's role as it stands too; or why not (a message is a 400). */
export type Change = (row: TournamentRow, role: Role | null) => Changes | string | Refused;

/**
 * A round's end is many writes to one row at once, each player's report among
 * them; this many tries lets them all through in turn.
 */
const MAX_TRIES = 5;

/** Why a staff asker who has lost their place is refused. */
export const SIGN_IN = msg('Sign in first');
export const NOT_STAFF = msg('Only this event’s staff can do that');

/** The event and the asker's role read again after a write missed; or why the asker's change ends there. */
export async function readAgain(
  db: D1Like,
  code: string,
  asker: Asker | undefined
): Promise<{ row: TournamentRow; asker?: Asker } | { error: string; status: number }> {
  if (!asker) {
    const row = await loadTournament(db, code);
    return row ? { row } : { error: msg('No such tournament'), status: 404 };
  }
  const opened = await openAs(db, code, asker.hash);
  if (!opened) {
    return { error: msg('No such tournament'), status: 404 };
  }
  if (!opened.user) {
    return { error: SIGN_IN, status: 401 };
  }
  return opened.role ? { row: opened.row, asker: { ...asker, role: opened.role } } : { error: NOT_STAFF, status: 403 };
}

/**
 * Changes the row a request read and writes it, trying again from a fresh
 * read each time another write got there first. `change` returns the changes
 * or an error message. With an asker, each try lands only while they still
 * hold the role it was judged with, and a miss reads their role again with
 * the row, so a change never outlives the asker's place on staff.
 */
export function mutate(db: D1Like, read: TournamentRow, change: Change, asker?: Asker): Promise<Mutation> {
  return retried(db, { row: read, ...writerOf(asker) }, change, async () => {
    const fresh = await readAgain(db, read.code, asker);
    return 'error' in fresh ? fresh : { row: fresh.row, ...writerOf(fresh.asker) };
  });
}

/**
 * What a change from a player holds to: their standing, as SQL over the
 * event's `tournaments` row, and what they are told once it no longer holds.
 */
export interface Held {
  standing: Guard;
  refusal: Refused;
}

/**
 * As `mutate`, for a change only `held.standing` lets the asker make: each try
 * lands only while it holds, and a miss where it no longer does ends with
 * `held.refusal`, never with a try on a standing had afresh.
 */
export function mutateHeld(db: D1Like, read: TournamentRow, change: Change, held: Held): Promise<Mutation> {
  const writer = { role: null, standing: held.standing };
  return retried(db, { row: read, ...writer }, change, async () => {
    if (!(await holds(db, read.code, held.standing))) {
      return held.refusal;
    }
    const row = await loadTournament(db, read.code);
    return row ? { row, ...writer } : { error: msg('No such tournament'), status: 404 };
  });
}

/** Who a try writes as: the role its change is judged with, and the standing it lands only while (see askerGate). */
interface Writer {
  row: TournamentRow;
  role: Role | null;
  standing?: Guard;
}

const writerOf = (asker: Asker | undefined) =>
  asker ? { role: asker.role, standing: askerStanding(asker) } : { role: null };

/** Tries `change` until it lands or is refused, reading the event and the writer `again` after each miss. */
async function retried(
  db: D1Like,
  first: Writer,
  change: Change,
  again: () => Promise<Writer | Refused>
): Promise<Mutation> {
  let current = first;
  for (let tries = 1; ; tries += 1) {
    const outcome = await attempt(db, current, change);
    if (outcome) {
      return outcome;
    }
    if (tries === MAX_TRIES) {
      return { error: 'Busy; try again', status: 409 };
    }
    const fresh = await again();
    if ('error' in fresh) {
      return fresh;
    }
    current = fresh;
  }
}

/** Whether the event at `code` stands as `standing` says, at whatever version. */
async function holds(db: D1Like, code: string, standing: Guard): Promise<boolean> {
  const found = await db
    .prepare(`SELECT 1 AS yes FROM tournaments WHERE code = ? AND ${standing.sql}`)
    .bind(code, ...standing.values)
    .first<{ yes: number }>();
  return found !== null;
}

/** Whether the event is still at the version `row` read, and the writer's standing, when there is one, still holds. */
const stillStands = (db: D1Like, row: TournamentRow, standing: Guard | undefined) =>
  holds(db, row.code, {
    sql: `version = ?${standing ? ` AND ${standing.sql}` : ''}`,
    values: [row.version, ...(standing?.values ?? [])]
  });

/**
 * One read-change-write, never tried again from a fresh read: for a change
 * staff approved against the event as they saw it. Null when another write
 * got there first, or the asker no longer holds their role.
 */
export const tryChange = (db: D1Like, row: TournamentRow, change: Change, asker?: Asker): Promise<Mutation | null> =>
  attempt(db, { row, ...writerOf(asker) }, change);

/** One read-change-write as `writer`; null when another write got there first, or their standing no longer holds. */
async function attempt(db: D1Like, writer: Writer, change: Change): Promise<Mutation | null> {
  const { row, role: judged, standing } = writer;
  const changes = change(row, judged);
  if (typeof changes === 'string') {
    return { error: changes, status: 400 };
  }
  if ('error' in changes) {
    return changes;
  }
  const role = judged ? { role: judged } : {};
  // A change that changes nothing writes nothing: no new version, nothing to publish. It was judged on the
  // row as read, though, so it holds only while the row and the writer stand as they did; else try again.
  if (Object.keys(changes).length === 0) {
    return (await stillStands(db, row, standing)) ? { row, ...role } : null;
  }
  const saved = await saveTournament(db, row, changes, standing).catch((error: unknown) => {
    if (error instanceof TooLarge) {
      return error;
    }
    if (breaksDay(error)) {
      return new DayTaken(msg('You already have an event that day'));
    }
    throw error;
  });
  if (saved instanceof TooLarge) {
    return { error: saved.message, status: 413 };
  }
  if (saved instanceof DayTaken) {
    return { error: saved.message, status: 409 };
  }
  return saved && { row: saved, ...role, ...(changes.refusal ? { refusal: changes.refusal } : {}) };
}

/** What the console's polls check before anything else: whether the copy they hold still stands. */
export interface TournamentHead {
  version: number;
  /** Whether the request's session belongs to the event's organizer or one of its staff. */
  staff: boolean;
}

/** The head as the request's session sees it, in one read: a console polls this every few seconds. */
export async function loadHead(db: D1Like, code: string, request: Request): Promise<TournamentHead | null> {
  const raw = await db
    .prepare(
      'SELECT version, EXISTS (SELECT 1 FROM sessions WHERE sessions.token_hash = ? ' +
        `AND sessions.expires_at > ? AND ${onStaff('sessions.user_id')}) AS staff FROM tournaments WHERE code = ?`
    )
    .bind((await sessionHash(request)) ?? '', Date.now(), code)
    .first<{ version: number; staff: number }>();
  return raw && { version: raw.version, staff: raw.staff === 1 };
}

export async function isStaffMember(db: D1Like, code: string, userId: string): Promise<boolean> {
  const staff = await db
    .prepare('SELECT 1 AS yes FROM staff WHERE code = ? AND user_id = ?')
    .bind(code, userId)
    .first<{ yes: number }>();
  return staff !== null;
}

/**
 * Joins the user to the event's staff if `token` is its invite token at the
 * moment of writing: checked in the insert itself, so a join that read the
 * old token cannot land after the organizer replaced it.
 * @returns Whether the user joined
 */
export async function joinStaff(db: D1Like, code: string, userId: string, token: string): Promise<boolean> {
  const result = await db
    .prepare(
      'INSERT OR IGNORE INTO staff (code, user_id, joined_at) ' +
        'SELECT code, ?, ? FROM tournaments WHERE code = ? AND staff_token = ?'
    )
    .bind(userId, Date.now(), code, token)
    .run();
  return rowsChanged(result) === 1;
}

/** Everyone the invite link has let onto the event's staff, earliest first. */
export async function listStaff(db: D1Like, code: string): Promise<StaffMember[]> {
  const { results } = await db
    .prepare(
      `SELECT staff.user_id AS id, ${displayNameSql('users')} AS name, staff.joined_at AS joined_at FROM staff ` +
        'LEFT JOIN users ON users.id = staff.user_id WHERE staff.code = ? ORDER BY staff.joined_at'
    )
    .bind(code)
    .all<{ id: string; name: string | null; joined_at: number | null }>();
  return results.map(row => ({ id: row.id, name: row.name ?? 'Unknown', joinedAt: row.joined_at }));
}

/** Whether the asker, as organizer, took `userId` off the event's staff. */
export async function removeStaff(db: D1Like, code: string, userId: string, asker: Asker): Promise<boolean> {
  const result = await db
    .prepare(
      'DELETE FROM staff WHERE code = ?1 AND user_id = ?2 ' +
        `AND EXISTS (SELECT 1 FROM tournaments WHERE code = ?1 AND ${asksStill(asker, '?3', '?4')})`
    )
    .bind(code, userId, ...askerValues(asker))
    .run();
  return rowsChanged(result) === 1;
}

/**
 * How many rounds the event in the `state` column has paired across its
 * pods: any pod may pair first, as each division plays on its own. A stored
 * event has no more pods than there are pod categories
 * (shared/tournament/validate.ts), so these slots are all of them.
 */
export const pairedRounds = (state: string) =>
  POD_CATEGORIES.map((_, i) => `ifnull(json_array_length(${state}, '$.pods[${i}].rounds'), 0)`).join(' + ');

interface SummaryRow {
  community_day: string | null;
  code: string;
  mode: string;
  name: string | null;
  players: number | null;
  start_date: string | null;
  finished: number | null;
  rounds: number | null;
  owner_id: string;
  updated_at: number;
  store_id: string | null;
  store_role: string | null;
}

/** Every event this user owns or staffs, their stores' among them, newest first. */
export async function listTournaments(db: D1Like, userId: string): Promise<TournamentSummary[]> {
  const { results } = await db
    .prepare(
      "SELECT code, mode, json_extract(state, '$.info.name') AS name, " +
        "json_array_length(state, '$.players') AS players, json_extract(state, '$.info.startDate') AS start_date, " +
        "json_extract(settings, '$.finished') AS finished, " +
        `community_day, ${pairedRounds('state')} AS rounds, owner_id, updated_at, store_id, ` +
        '(SELECT m.role FROM store_members m WHERE m.store_id = tournaments.store_id AND m.user_id = ?1) AS store_role ' +
        'FROM tournaments WHERE (owner_id = ?1 AND store_id IS NULL) OR code IN (SELECT code FROM staff WHERE user_id = ?1) ' +
        'OR store_id IN (SELECT store_id FROM store_members WHERE user_id = ?1) ORDER BY updated_at DESC LIMIT 200'
    )
    .bind(userId)
    .all<SummaryRow>();
  return results.map(row => ({
    code: row.code,
    mode: row.mode === 'tom' ? 'tom' : 'swiss',
    name: row.name ?? '',
    role: (row.store_id === null ? row.owner_id === userId : managesStore(storeRoleOf(row.store_role)))
      ? 'owner'
      : 'staff',
    players: row.players ?? 0,
    startDate: row.start_date ?? '',
    finished: row.finished === 1,
    rounds: row.rounds ?? 0,
    updatedAt: row.updated_at,
    ...(row.owner_id === userId && row.store_id === null && row.community_day
      ? { communityDay: row.community_day }
      : {})
  }));
}

/**
 * A new invite token and nobody on staff, in one transaction: no join can
 * fall between the two and keep a place the old link gave. Only while the
 * asker still organizes the event.
 * @returns Whether it landed
 */
export async function rotateStaff(db: D1Like, code: string, asker: Asker): Promise<boolean> {
  // The same check on both, in one transaction: the staff go only where the new link lands.
  const organizes = asksStill(asker, '?2', '?3');
  const values = askerValues(asker);
  const results = await db.batch([
    db
      .prepare(
        'UPDATE tournaments SET staff_token = ?4, version = version + 1, updated_at = ?5 ' +
          `WHERE code = ?1 AND ${organizes}`
      )
      .bind(code, ...values, randomToken(16), Date.now()),
    db
      .prepare(
        `DELETE FROM staff WHERE code = ?1 AND EXISTS (SELECT 1 FROM tournaments WHERE code = ?1 AND ${organizes})`
      )
      .bind(code, ...values)
  ]);
  return rowsChanged(results[0]) === 1;
}

/**
 * Deletes the event and everything kept under its code, its players' places
 * in the history index included, all on the version `row` read (see
 * deleteWrites) and only while the asker still organizes it (see askerGate):
 * a change between means a fresh read of both and another try, so no player
 * it gained meanwhile stays in the index, and nobody gone from the event
 * deletes it. `refusal` is what an asker who no longer organizes it is told.
 * @returns Null once the event is gone, by this or another request; else why not
 */
export async function deleteTournament(
  db: D1Like,
  row: TournamentRow,
  asker: Asker,
  refusal: string
): Promise<Refused | null> {
  let current: { row: TournamentRow; asker?: Asker } = { row, asker };
  for (let tries = 1; ; tries += 1) {
    const [check, restore] = askerGate(db, current.row, current.asker && askerStanding(current.asker));
    const before = [...check, ...deleteWrites(db, current.row)];
    const gone = db
      .prepare('DELETE FROM tournaments WHERE code = ? AND version = ?')
      .bind(row.code, current.row.version);
    const results = await db.batch([...before, gone, ...restore]);
    if (rowsChanged(results[before.length]) === 1) {
      return null;
    }
    if (tries === MAX_TRIES) {
      return { error: 'Busy; try again', status: 409 };
    }
    const fresh = await readAgain(db, row.code, current.asker);
    if ('error' in fresh) {
      // Deleted by another request meanwhile, which took its rows with it.
      return fresh.status === 404 ? null : fresh;
    }
    if (fresh.asker?.role !== 'owner') {
      return { error: refusal, status: 403 };
    }
    current = fresh;
  }
}
