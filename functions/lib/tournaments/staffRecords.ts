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
import { askerValues, asksStill } from './roles.js';
import { latestRoundOf, type StaffAccount, type StaffMember } from '../../../shared/tournament/staffRecords.js';
import type { Tournament } from '../../../shared/tournament/types.js';

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

export async function staffAccounts(access: Access): Promise<StaffAccount[]> {
  const { results } = await access.db.prepare(STAFF_SQL).bind(access.row.code).all<StaffAccount>();
  return results;
}

function playerName(tournament: Tournament, playerId: string): string {
  const player = tournament.players.find(candidate => candidate.id === playerId);
  return player ? `${player.firstName} ${player.lastName}` : '';
}

/**
 * Lands only while the event is there and the asker still on its staff: one
 * deleted, or an asker taken off it, between the request's read and its write
 * leaves no entry behind it. `hash` and `now` bind the asker (see roles.ts).
 */
const eventStands = (access: StaffAccess, hash: string, now: string) =>
  `EXISTS (SELECT 1 FROM tournaments WHERE code = ?1 AND ${asksStill(askerOf(access), hash, now)})`;

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

async function record(kind: Shape, access: Access, player: string | null): Promise<Response> {
  const [entries, staff] = await Promise.all([
    access.db.prepare(entriesSql(kind)).bind(access.row.code, player).all<RecordRow>(),
    staffAccounts(access)
  ]);
  return privateJson({ entries: entries.results.map(kind.entry), [kind.staffKey]: staff });
}

/** Why the entry does not fit the event as it stands, or null: the player, the round, the staff member. */
async function misfit<Input extends RecordInput>(
  kind: RecordKind<Input, unknown>,
  access: StaffAccess,
  input: Input
): Promise<string | null> {
  const { tournament } = access.row;
  if (!tournament.players.some(player => player.id === input.playerId)) {
    return 'That player is not on this event';
  }
  const latest = latestRoundOf(tournament, input.playerId);
  if (latest === 0) {
    return 'No round is paired for that player yet';
  }
  if (input.round > latest) {
    return `Round ${latest} is the latest round paired for that player`;
  }
  const named = kind.personOf(input);
  if ('id' in named) {
    return (await staffAccounts(access)).some(staff => staff.id === named.id) ? null : kind.words.notStaff;
  }
  return null;
}

/** A new entry: a first one, or (with `replaces`) an edit of one, which lands as `replaceable` says. */
async function append<Input extends RecordInput>(
  kind: RecordKind<Input, unknown>,
  access: StaffAccess,
  input: Input
): Promise<boolean> {
  const named = kind.personOf(input);
  const written = await access.db
    .prepare(
      `INSERT INTO ${kind.table} (code, replaces, id, ${columnsOf(kind)}, recorded_by, recorded_at) ` +
        'SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 ' +
        // A SELECT that feeds an upsert needs a WHERE, or SQLite reads its ON CONFLICT as a join's.
        `WHERE ${eventStands(access, '?13', '?14')} AND (?2 IS NULL OR (${replaceable(kind.table)})) ` +
        'ON CONFLICT DO NOTHING'
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
    )
    .run();
  return rowsChanged(written) === 1;
}

/** A removal of the entry `id`: a copy of it marked removed, so the record reads whole on its own. */
async function strike(kind: Shape, access: StaffAccess, id: string): Promise<boolean> {
  const columns = columnsOf(kind);
  const written = await access.db
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
    )
    .run();
  return rowsChanged(written) === 1;
}

async function exists(kind: Shape, access: StaffAccess, id: string): Promise<boolean> {
  const found = await access.db
    .prepare(`SELECT 1 AS yes FROM ${kind.table} WHERE code = ? AND id = ?`)
    .bind(access.row.code, id)
    .first<{ yes: number }>();
  return found !== null;
}

/** The three routes of one kind of record. */
export function recordRoutes<Input extends RecordInput, Entry>(kind: RecordKind<Input, Entry>) {
  return {
    async onRequestGet(context: Context<'code'>): Promise<Response> {
      const access = await openForStaffRead(context);
      if (access instanceof Response) {
        return access;
      }
      return record(kind, access, new URL(context.request.url).searchParams.get('player') || null);
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
      const problem = await misfit(kind, access, input);
      if (problem) {
        return jsonError(problem, 400);
      }
      if (await append(kind, access, input)) {
        return record(kind, access, null);
      }
      return answerMiss(access, () => jsonError(kind.words.changed, 409));
    },

    async onRequestDelete(context: Context<'code'>): Promise<Response> {
      const access = await openForStaff(context);
      if (access instanceof Response) {
        return access;
      }
      const id = new URL(context.request.url).searchParams.get('id') ?? '';
      if (await strike(kind, access, id)) {
        return record(kind, access, null);
      }
      return answerMiss(access, async () =>
        (await exists(kind, access, id)) ? jsonError(kind.words.changed, 409) : jsonError(kind.words.missing, 404)
      );
    }
  };
}

/** An entry's staff member as staff read it: the account's name now, else the name typed in; null once deleted. */
export const personOfRow = (row: RecordRow) => ({
  id: row.person_id,
  name: row.person_account ?? (row.person_name || null)
});
