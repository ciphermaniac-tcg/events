/**
 * The routes a staff record answers on (see shared/tournament/staffRecords.ts),
 * for the event's staff only: deck checks and penalty notes are each one
 * `RecordKind`, a table and the words its answers use.
 *
 * GET — every entry in the event's record, oldest first, with the staff
 * accounts an entry may name; `?player=<id>` narrows the entries to one
 * player's.
 * POST — records an entry; with `replaces`, the new entry edits that one.
 * The player must be on the event, the round one their division has paired,
 * and a staff member named by account one of the event's staff. Answers as
 * GET does.
 * DELETE ?id=<entry> — removes an entry, by recording one that replaces it
 * with nothing. Answers as GET does.
 *
 * An entry already edited or removed is not edited or removed again: the
 * second of two staff correcting the same entry is told to look again.
 */

import { readJsonObject } from '../api/body.js';
import { jsonError } from '../api/responses.js';
import type { Context } from '../auth/env.js';
import { rowsChanged } from '../d1.js';
import type { D1Like, D1Statement } from '../types.js';
import { displayNameSql } from '../accounts/handles.js';
import {
  type Access,
  answerMiss,
  askerOf,
  openForStaff,
  openForStaffRead,
  privateJson,
  type StaffAccess
} from './access.js';
import { askerValues, asksStill, onStaff } from './roles.js';
import { latestRoundOf, type StaffAccount, type StaffMember } from '../../../shared/tournament/staffRecords.js';
import type { Tournament } from '../../../shared/tournament/types.js';
import { msg, msgf } from '../../../shared/i18n.js';

/** An entry's row, with its columns named alike whatever its kind. */
export interface RecordRow {
  id: string;
  player_id: string;
  player_name: string;
  round: number;
  person_id: string | null;
  person_name: string;
  /** The named staff account's name now; null for a typed name or a deleted account. */
  person_account: string | null;
  verdict: string;
  notes: string;
  recorder: string | null;
  recorded_at: number;
  replaces: string | null;
  removed: number;
}

/** What every kind of entry is sent as, once read: its verdict and staff member under the kind's own names. */
export interface RecordInput {
  playerId: string;
  round: number;
  notes: string;
  replaces: string | null;
}

export interface RecordKind<Input extends RecordInput, Entry> {
  table: 'deck_checks' | 'penalty_notes';
  /** The column prefix of the staff member an entry names: `checker_id`, `checker_name`. */
  person: 'checker' | 'judge';
  /** The column holding an entry's verdict. */
  verdict: 'result' | 'penalty';
  /** The key the answer lists the event's staff under. */
  staffKey: 'checkers' | 'judges';
  read: (body: Record<string, unknown>) => Input | string;
  personOf: (input: Input) => StaffMember;
  verdictOf: (input: Input) => string;
  entry: (row: RecordRow) => Entry;
  words: { changed: string; missing: string; notStaff: string };
}

/**
 * The event's staff accounts: its organizer when no store runs it, everyone
 * in the store that does, and everyone the invite link let in.
 */
const STAFF_SQL =
  `SELECT u.id AS id, ${displayNameSql('u')} AS name FROM users u WHERE u.id IN (` +
  'SELECT owner_id FROM tournaments WHERE code = ?1 AND store_id IS NULL ' +
  'UNION SELECT m.user_id FROM tournaments t JOIN store_members m ON m.store_id = t.store_id WHERE t.code = ?1 ' +
  'UNION SELECT user_id FROM staff WHERE code = ?1) ORDER BY name';

export const staffAccountsQuery = (db: D1Like, code: string) => db.prepare(STAFF_SQL).bind(code);

export async function staffAccounts(access: Access): Promise<StaffAccount[]> {
  const { results } = await staffAccountsQuery(access.db, access.row.code).all<StaffAccount>();
  return results;
}

function playerName(tournament: Tournament, playerId: string): string {
  const player = tournament.players.find(candidate => candidate.id === playerId);
  return player ? `${player.firstName} ${player.lastName}` : '';
}

/**
 * Lands only while the event is there and the asker still on its staff: one
 * deleted, or an asker taken off it, between the request's read and its write
 * leaves no entry behind it. `hash` and `now` bind the asker (see roles.ts);
 * `also` is what else the event's row must say.
 */
const eventStands = (access: StaffAccess, hash: string, now: string, also = '1') =>
  `EXISTS (SELECT 1 FROM tournaments WHERE code = ?1 AND ${also} AND ${asksStill(askerOf(access), hash, now)})`;

/** Lands only while the entry `?2` replaces is in this event, not a removal, and replaced by nothing yet. */
const replaceable = (table: string) =>
  `EXISTS (SELECT 1 FROM ${table} WHERE code = ?1 AND id = ?2 AND removed = 0) ` +
  `AND NOT EXISTS (SELECT 1 FROM ${table} WHERE code = ?1 AND replaces = ?2)`;

/** What the record's SQL reads off a kind, whatever it is sent as. */
type Shape = Pick<RecordKind<RecordInput, unknown>, 'table' | 'person' | 'verdict' | 'staffKey' | 'entry'>;

const columnsOf = ({ person, verdict }: Shape) =>
  `player_id, player_name, round, ${person}_id, ${person}_name, ${verdict}, notes`;

const entriesSql = ({ table, person, verdict }: Shape) =>
  `SELECT d.id, d.player_id, d.player_name, d.round, d.${person}_id AS person_id, ` +
  `d.${person}_name AS person_name, d.${verdict} AS verdict, d.notes, d.recorded_at, d.replaces, d.removed, ` +
  `(SELECT ${displayNameSql('c')} FROM users c WHERE c.id = d.${person}_id) AS person_account, ` +
  `(SELECT ${displayNameSql('r')} FROM users r WHERE r.id = d.recorded_by) AS recorder ` +
  `FROM ${table} d WHERE d.code = ?1 AND (?2 IS NULL OR d.player_id = ?2) ORDER BY d.recorded_at, d.id`;

/** The record and the event's staff accounts, and whether the write ahead of them landed. */
interface Read {
  written: boolean;
  entries: RecordRow[];
  staff: StaffAccount[];
}

/**
 * The entries (every one, or `player`'s) and the event's staff accounts, in
 * one batch: after `write`, when there is one, so they read as it left them.
 */
async function readRecord(kind: Shape, access: Access, player: string | null, write?: D1Statement): Promise<Read> {
  const { db, row } = access;
  const reads = [db.prepare(entriesSql(kind)).bind(row.code, player), staffAccountsQuery(db, row.code)];
  const results = await db.batch(write ? [write, ...reads] : reads);
  const [entries, staff] = results.slice(write ? 1 : 0).map(result => result.results ?? []);
  return {
    written: !write || rowsChanged(results[0]) === 1,
    entries: (entries ?? []) as RecordRow[],
    staff: (staff ?? []) as StaffAccount[]
  };
}

const answerRecord = (kind: Shape, read: Read) =>
  privateJson({ entries: read.entries.map(kind.entry), [kind.staffKey]: read.staff });

/** Why the entry does not fit the event as it was read, or null: the player, or the round. */
function misfit(tournament: Tournament, input: RecordInput): string | null {
  if (!tournament.players.some(player => player.id === input.playerId)) {
    return msg('That player is not on this event');
  }
  const latest = latestRoundOf(tournament, input.playerId);
  if (latest === 0) {
    return msg('No round is paired for that player yet');
  }
  return input.round > latest
    ? msgf('Round {round} is the latest round paired for that player', { round: latest })
    : null;
}

/**
 * A new entry: a first one, or (with `replaces`) an edit of one, which lands
 * as `replaceable` says, and only while a staff member it names by account is
 * on the event's staff.
 */
function append<Input extends RecordInput>(
  kind: RecordKind<Input, unknown>,
  access: StaffAccess,
  input: Input
): D1Statement {
  const named = kind.personOf(input);
  return access.db
    .prepare(
      `INSERT INTO ${kind.table} (code, replaces, id, ${columnsOf(kind)}, recorded_by, recorded_at) ` +
        'SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 ' +
        // A SELECT that feeds an upsert needs a WHERE, or SQLite reads its ON CONFLICT as a join's.
        `WHERE ${eventStands(access, '?13', '?14', `(?7 IS NULL OR ${onStaff('?7')})`)} ` +
        `AND (?2 IS NULL OR (${replaceable(kind.table)})) ON CONFLICT DO NOTHING`
    )
    .bind(
      access.row.code,
      input.replaces,
      crypto.randomUUID(),
      input.playerId,
      playerName(access.row.tournament, input.playerId),
      input.round,
      'id' in named ? named.id : null,
      'name' in named ? named.name : '',
      kind.verdictOf(input),
      input.notes,
      access.user?.id ?? null,
      Date.now(),
      ...askerValues(askerOf(access))
    );
}

/** A removal of the entry `id`: a copy of it marked removed, so the record reads whole on its own. */
function strike(kind: Shape, access: StaffAccess, id: string): D1Statement {
  const columns = columnsOf(kind);
  return access.db
    .prepare(
      `INSERT INTO ${kind.table} (code, replaces, id, ${columns}, recorded_by, recorded_at, removed) ` +
        `SELECT code, id, ?3, ${columns}, ?4, ?5, 1 FROM ${kind.table} ` +
        `WHERE code = ?1 AND id = ?2 AND ${eventStands(access, '?6', '?7')} AND ${replaceable(kind.table)} ` +
        'ON CONFLICT DO NOTHING'
    )
    .bind(
      access.row.code,
      id,
      crypto.randomUUID(),
      access.user?.id ?? null,
      Date.now(),
      ...askerValues(askerOf(access))
    );
}

/**
 * Why an entry that did not land did not: the event is gone or the asker off
 * its staff, the staff member it names is not on it, or the record changed.
 */
function missedAppend<Input extends RecordInput>(
  kind: RecordKind<Input, unknown>,
  access: StaffAccess,
  input: Input,
  read: Read
) {
  const named = kind.personOf(input);
  const listed = !('id' in named) || read.staff.some(staff => staff.id === named.id);
  return answerMiss(access, () => (listed ? jsonError(kind.words.changed, 409) : jsonError(kind.words.notStaff, 400)));
}

/** The three routes of one kind of record. */
export function recordRoutes<Input extends RecordInput, Entry>(kind: RecordKind<Input, Entry>) {
  return {
    async onRequestGet(context: Context<'code'>): Promise<Response> {
      const access = await openForStaffRead(context);
      if (access instanceof Response) {
        return access;
      }
      const player = new URL(context.request.url).searchParams.get('player') || null;
      return answerRecord(kind, await readRecord(kind, access, player));
    },

    async onRequestPost(context: Context<'code'>): Promise<Response> {
      const access = await openForStaff(context);
      if (access instanceof Response) {
        return access;
      }
      const input = kind.read((await readJsonObject(context.request, 4096)) ?? {});
      if (typeof input === 'string') {
        return jsonError(input, 400);
      }
      const problem = misfit(access.row.tournament, input);
      if (problem) {
        return jsonError(problem, 400);
      }
      const read = await readRecord(kind, access, null, append(kind, access, input));
      return read.written ? answerRecord(kind, read) : missedAppend(kind, access, input, read);
    },

    async onRequestDelete(context: Context<'code'>): Promise<Response> {
      const access = await openForStaff(context);
      if (access instanceof Response) {
        return access;
      }
      const id = new URL(context.request.url).searchParams.get('id') ?? '';
      const read = await readRecord(kind, access, null, strike(kind, access, id));
      if (read.written) {
        return answerRecord(kind, read);
      }
      const held = read.entries.some(entry => entry.id === id);
      return answerMiss(access, () => (held ? jsonError(kind.words.changed, 409) : jsonError(kind.words.missing, 404)));
    }
  };
}

/** An entry's staff member as staff read it: the account's name now, else the name typed in; null once deleted. */
export const personOfRow = (row: RecordRow) => ({
  id: row.person_id,
  name: row.person_account ?? (row.person_name || null)
});
