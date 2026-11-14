/**
 * Writing a registration's list (see functions/api/tournaments/[code]/decklists.ts):
 * when a write may land, as judged in the write itself, and the writes that
 * store, rename, withdraw or unlock a list, with what each does to the event.
 */

import { archetypeOfList } from '../../../shared/tournament/archetypes.js';
import { decklistOpenFor, enteredLate } from '../../../shared/tournament/lateLists.js';
import { fullNameKey } from '../../../shared/tournament/identify.js';
import { mayBeMinor, mayBeUnder13 } from '../../../shared/accounts/age.js';
import { birthYear } from '../../../shared/tournament/divisions.js';
import type { PlayerProfile } from '../../../shared/tournament/profile.js';
import {
  decklistsLocked,
  decklistsOpen,
  type DeckMode,
  decksEnabled,
  isSanctioned,
  type Registration
} from '../../../shared/tournament/view.js';
import { msg } from '../../../shared/i18n.js';
import { jsonError, noContent } from '../api/responses.js';
import type { Context } from '../auth/env.js';
import { sha256 } from '../auth/session.js';
import { rowsChanged } from '../d1.js';
import { type Access, privateJson, type StaffAccess, staffWrites } from './access.js';
import { archetypeRules } from './archetypeRules.js';
import { admitTry, clearFailures, forgive, LOCKED_OUT } from './attempts.js';
import {
  type Details,
  identityKey,
  listUnder,
  matchingAccount,
  NO_ACCOUNT,
  presenter,
  proveYear,
  WRONG_YEAR
} from './decklists.js';
import { publishAfter } from './publish.js';
import {
  addition,
  FULL,
  fullRefusal,
  isFull,
  type Kept,
  keptChanges,
  provesId,
  rosterPlayer,
  withdrawnChanges
} from './registrations.js';
import { loadTournament, mutate, pairedRounds, type TournamentRow } from './store.js';

/**
 * When a write may land: before round 1 (no round paired), or in a late
 * entrant's window (see decklistOpenFor), with as many rounds paired as when
 * the request read the event.
 */
interface ListWindow {
  late: boolean;
  paired: number;
}

const BEFORE_ROUND_1: ListWindow = { late: false, paired: 0 };

/** The window the player's write lands in, judged against the event as read; the caller has checked it is open. */
function windowFor(row: TournamentRow): ListWindow {
  return decklistsLocked(row)
    ? { late: true, paired: row.tournament.pods.reduce((sum, pod) => sum + pod.rounds.length, 0) }
    : BEFORE_ROUND_1;
}

/**
 * A write's guard that the event still takes lists as the write lands:
 * decklists open or closed (an event stored before decklists could be turned
 * off keeps its switch, see storedSettings) and no round paired since the request
 * read the event (none at all outside a late entrant's window, which also
 * closes as the event ends). Lists turned off or a round paired meanwhile
 * refuses the write all the same.
 */
const STILL_TAKING =
  'EXISTS (SELECT 1 FROM tournaments WHERE code = ? AND ' +
  "coalesce(json_extract(settings, '$.decklists'), " +
  "CASE WHEN json_type(settings, '$.decklistsOpen') IS NOT NULL THEN 'closed' END) IN ('open', 'closed') " +
  "AND (? = 0 OR coalesce(json_extract(settings, '$.finished'), 0) = 0) " +
  `AND (? = 1 OR json_extract(state, '$.startedAt') IS NULL) AND (${pairedRounds('state')}) = ?)`;

/** STILL_TAKING's values after the event's code. */
const windowValues = (window: ListWindow) => [window.late ? 1 : 0, window.late ? 1 : 0, window.paired];

export interface Submission {
  profile: PlayerProfile;
  mode: DeckMode;
  /** The pasted list; '' for a paper one. */
  deck: string;
  archetype: string | null;
  /** At an unsanctioned event, the names the registration had, when this renames it. */
  was: Details | null;
  /**
   * At a sanctioned event, the birth year the registration had when this save
   * corrects it: the year that proves the Player ID, while the event's list
   * takes the new one (see keptChanges). Null when the year is not changed.
   */
  wasYear: string | null;
  /** The token the device holds for an earlier list under these details, if any. */
  held: unknown;
  localTime: unknown;
}

/** A player under 13 registers with staff (see shared/accounts/age.ts): paper is no way round it online. */
const UNDER_13 = msg('Players under 13 register with staff at the event.');
/** A list from a player who may be under 18, once the event is over: its cards were deleted as it ended (store.ts). */
const OVER_FOR_MINORS = msg('This event is over.');

/** What follows a submission the guard let in, once its store has run: whether it landed. */
interface Admitted {
  stored: (landed: boolean) => Promise<void>;
}

const NOTHING_COUNTED: Admitted = { stored: async () => undefined };

/**
 * The wrong-year guard for a submission at a sanctioned event (see
 * lib/tournaments/attempts.ts), or the refusal. Each try is let in or refused
 * by one statement, so lists landing at once are taken one at a time. A
 * Player ID on the event's list is judged against its birth date there (none
 * on it fits nothing, until staff add one). One that is not can only be
 * judged by the store, against a list kept under it, so the try counts before
 * the store runs and is forgiven when the list lands.
 */
async function guardSubmission(
  access: Access,
  profile: PlayerProfile,
  wasYear: string | null
): Promise<Admitted | Response> {
  const { db, row } = access;
  if (!isSanctioned(row)) {
    return NOTHING_COUNTED;
  }
  const now = Date.now();
  // Asked before any try counts: a year under 13 is refused whatever the event's list says.
  const year = birthYear(profile.birthDate);
  if (mayBeUnder13(year, new Date(now))) {
    return jsonError(UNDER_13, 403);
  }
  if (row.settings.finished && mayBeMinor(year, new Date(now))) {
    return jsonError(OVER_FOR_MINORS, 403);
  }
  const listed = row.tournament.players.some(candidate => candidate.id === profile.popId);
  // A correction proves the Player ID with the year it corrects.
  const right = listed && provesId(row, profile.popId, wasYear ?? String(year ?? ''), null);
  if (!(await admitTry({ db, code: row.code, popId: profile.popId, right, now }))) {
    return jsonError(LOCKED_OUT, 429);
  }
  if (listed) {
    return right ? NOTHING_COUNTED : jsonError(WRONG_YEAR, 403);
  }
  return {
    stored: async landed => {
      if (landed) {
        await forgive(db, row.code, profile.popId, now);
      }
    }
  };
}

/**
 * Saves a signed-in submitter's details to their account, so pages that know
 * them can find them. Only an account that already holds the list's Player ID
 * takes them: a POP ID carries an account's history and who it is at events,
 * and a list sent for a friend from your own phone must not give your account
 * theirs. The account page saves a POP ID, where one account holds each. An
 * unsanctioned event asked only for the name, so the Player ID and birth year
 * already there stay. It only runs after the list upsert changes a row, in the
 * same batch.
 */
function saveToAccount(access: Access, userId: string, profile: PlayerProfile) {
  const sanctioned = isSanctioned(access.row);
  const guard = sanctioned ? 'pop_id = ?' : "(pop_id IS NULL OR pop_id = '' OR (first_name = ? AND last_name = ?))";
  const values = sanctioned ? [profile.popId] : [profile.firstName, profile.lastName];
  return access.db
    .prepare(`UPDATE users SET first_name = ?, last_name = ? WHERE id = ? AND ${guard} AND changes() > 0`)
    .bind(profile.firstName, profile.lastName, userId, ...values);
}

/**
 * Who may replace a list already kept under the details. At a sanctioned
 * event, a submission whose birth year is proved: by the guard, against the
 * event's list for a player on it, or here, against the year the list was
 * sent with. At an unsanctioned one, a list nobody holds, under
 * the birth year it was sent with; the device that holds the token; or the
 * account the list belongs to.
 */
const REPLACES =
  'WHERE ? = 1 ' +
  "OR (? = 1 AND decklists.birth_date != '' AND substr(decklists.birth_date, -4) = substr(excluded.birth_date, -4)) " +
  "OR (decklists.owner_token IS NULL AND (decklists.birth_date = '' " +
  'OR substr(decklists.birth_date, -4) = substr(excluded.birth_date, -4))) OR decklists.owner_token = ? ' +
  'OR (decklists.account IS NOT NULL AND decklists.account = excluded.account)';

/**
 * Stores the list under its identity with the new token's hash: a first list,
 * one staff unlocked, or a replacement its sender may make (see REPLACES). A
 * list sent by the account that is its player is that account's; the device
 * that holds the token keeps the account its list had. False when the list
 * there is not the sender's to replace, which stays as it was.
 */
async function store(
  access: Access,
  submission: Submission,
  write: { tokenHash: string; now: number; window: ListWindow }
): Promise<boolean> {
  const { tokenHash, now, window } = write;
  const { profile, deck } = submission;
  const sanctioned = isSanctioned(access.row);
  // The guard proved the birth year against the event's own list for a player on it.
  const proved = sanctioned && rosterPlayer(access.row, profile) !== undefined;
  const key = identityKey(profile, sanctioned);
  const held = typeof submission.held === 'string' && submission.held ? await sha256(submission.held) : '';
  const account = matchingAccount(access, profile) ?? NO_ACCOUNT;
  // A list from a player who may be under 18 lands only while the event is not over, as it stands when the write does.
  const minor = mayBeMinor(birthYear(profile.birthDate), new Date(now)) ? 1 : 0;
  const insert = access.db
    .prepare(
      `INSERT INTO decklists (code, user_id, pop_id, first_name, last_name, birth_date, deck, deck_mode, archetype, submitted_at, owner_token, account) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${account.sql} ` +
        `WHERE (? = 0 OR NOT EXISTS (SELECT 1 FROM tournaments WHERE code = ? AND coalesce(json_extract(settings, '$.finished'), 0) = 1)) ` +
        `AND ${STILL_TAKING} ` +
        `ON CONFLICT (code, user_id) DO UPDATE SET ` +
        `pop_id = excluded.pop_id, first_name = excluded.first_name, last_name = excluded.last_name, ` +
        `birth_date = excluded.birth_date, deck = excluded.deck, deck_mode = excluded.deck_mode, ` +
        `archetype = excluded.archetype, submitted_at = excluded.submitted_at, owner_token = excluded.owner_token, ` +
        `account = CASE WHEN excluded.account IS NOT NULL THEN excluded.account ` +
        `WHEN decklists.owner_token = ? THEN decklists.account ELSE NULL END ${REPLACES}`
    )
    .bind(
      access.row.code,
      key,
      profile.popId,
      profile.firstName,
      profile.lastName,
      profile.birthDate,
      deck,
      submission.mode,
      submission.archetype,
      now,
      tokenHash,
      ...account.values,
      minor,
      access.row.code,
      access.row.code,
      ...windowValues(window),
      held,
      proved ? 1 : 0,
      sanctioned ? 1 : 0,
      held
    );
  const named = access.user ? [saveToAccount(access, access.user.id, profile)] : [];
  const [stored] = await access.db.batch([insert, ...named]);
  // The upsert changes no row when the list there is not the sender's, so its count is the answer.
  return rowsChanged(stored) > 0;
}

/**
 * Moves an unsanctioned registration to the names it is renamed to, when its
 * sender owns it there (the device's token or the account) and nobody holds
 * the new names. Whether it moved; the store then saves the rest.
 */
async function rename(
  access: Access,
  submission: Pick<Submission, 'profile' | 'held'> & { was: Details },
  window: ListWindow
): Promise<boolean> {
  const { was, profile, held } = submission;
  const token = typeof held === 'string' && held ? await sha256(held) : '';
  const account = matchingAccount(access, was) ?? NO_ACCOUNT;
  const moved = await access.db
    .prepare(
      'UPDATE decklists SET user_id = ?, first_name = ?, last_name = ? WHERE code = ? AND user_id = ? ' +
        `AND (owner_token = ? OR account = ${account.sql}) AND ${STILL_TAKING} ` +
        'AND NOT EXISTS (SELECT 1 FROM decklists AS taken WHERE taken.code = ? AND taken.user_id = ?)'
    )
    .bind(
      identityKey(profile, false),
      profile.firstName,
      profile.lastName,
      access.row.code,
      identityKey(was, false),
      token,
      ...account.values,
      access.row.code,
      ...windowValues(window),
      access.row.code,
      identityKey(profile, false)
    )
    .run();
  return rowsChanged(moved) === 1;
}

/**
 * Registers the submitter (see addition) and keeps the event in step with
 * their saved list (see keptChanges: a rename, a paper list for check-in, the
 * list's archetype), in one write judged against the event as it stands when
 * written: a second submission may have added them meanwhile, or filled the
 * last place. When the keeping is refused (a rename to a name staff gave
 * someone else, say), a player added stays added, and the refusal is what
 * the player is told: their list is saved, but the event still shows them as
 * it did.
 */
async function enter(context: Context<'code'>, access: Access, submission: Submission, kept: Kept) {
  let registration: Registration = 'not-added';
  let refusal: string | null = null;
  const outcome = await mutate(access.db, access.row, current => {
    const entered = addition(current, submission);
    if (entered.registration === 'full') {
      return FULL;
    }
    const { added } = entered;
    ({ registration } = entered);
    const keeping = keptChanges(
      added?.tournament ? { ...current, tournament: added.tournament } : current,
      kept,
      kept.localTime
    );
    refusal = typeof keeping === 'string' ? keeping : null;
    return typeof keeping === 'string' ? (added ?? keeping) : { ...added, ...keeping };
  });
  if ('error' in outcome) {
    return outcome.error === FULL ? 'full' : outcome.error;
  }
  if (outcome.row.version !== access.row.version) {
    await publishAfter(context, outcome.row);
  }
  return refusal ?? { registration, row: outcome.row };
}

/**
 * Why a list cannot be sent or withdrawn now: the event takes none, or the
 * player's list locked (as round 1 paired, or for a late entrant the round
 * after they joined).
 */
function notTakingText(row: TournamentRow, playerId: string | null = null): string {
  return row.settings.decklists === 'off' ? msg('This event does not take decklists') : lockedText(row, playerId);
}

const lockedText = (row: TournamentRow, playerId: string | null): string =>
  enteredLate(row.tournament, playerId) ? LOCKED_AFTER_JOINING : LOCKED_AFTER_ROUND_1;

export const notTaking = (row: TournamentRow, playerId: string | null = null): Response =>
  jsonError(notTakingText(row, playerId), 403);

const LOCKED_AFTER_ROUND_1 = msg('Decklists are locked once round 1 is paired');
const LOCKED_AFTER_JOINING = msg('Decklists are locked once the round after you joined is paired');

/** A token the device made for itself, when it sent one that looks like one. */
const deviceToken = (held: unknown) => (typeof held === 'string' && /^[\w-]{16,100}$/.test(held) ? held : null);

/** The roster player a submission is for, or null for someone not on the event. */
const submitter = (row: TournamentRow, submission: Submission) =>
  rosterPlayer(row, submission.was ?? submission.profile)?.id ?? null;

/** Whether the submission is someone new to the event: not on its list, and with no list in under their details. */
async function isNewcomer(access: Access, submission: Submission): Promise<boolean> {
  const named = submission.was ?? submission.profile;
  if (rosterPlayer(access.row, named) !== undefined) {
    return false;
  }
  return (await listUnder(access, identityKey(named, isSanctioned(access.row)))) === null;
}

/** Why the submission cannot go ahead before its list is stored, or null: the event is full, or a rename is not theirs. */
async function beforeStore(access: Access, submission: Submission, window: ListWindow): Promise<Response | null> {
  if ((await isNewcomer(access, submission)) && (await isFull(access.db, access.row))) {
    return fullRefusal();
  }
  const { was, profile } = submission;
  if (was && fullNameKey(was) !== fullNameKey(profile) && !(await rename(access, { ...submission, was }, window))) {
    return refusedWrite(access, submitter(access.row, submission));
  }
  return null;
}

/** Takes back a list that landed for a registration the event then had no room for. */
const unstore = (access: Access, profile: PlayerProfile) =>
  access.db
    .prepare('DELETE FROM decklists WHERE code = ? AND user_id = ?')
    .bind(access.row.code, identityKey(profile, isSanctioned(access.row)))
    .run();

/** Stores a submission the guards let in, and registers its player: the answer, or the refusal. */
async function submit(
  context: Context<'code'>,
  access: Access,
  submission: Submission,
  window: ListWindow
): Promise<Response> {
  const now = Date.now();
  // The device's own token stays its token, so a retry after a lost answer still owns the list.
  const token = deviceToken(submission.held) ?? crypto.randomUUID();
  if (!(await store(access, submission, { tokenHash: await sha256(token), now, window }))) {
    return refusedWrite(access, submitter(access.row, submission));
  }
  const { profile, deck, mode, archetype, was, wasYear, localTime } = submission;
  const kept = await enter(context, access, submission, {
    ...(was ? { was } : {}),
    ...(wasYear ? { year: true } : {}),
    now: profile,
    mode,
    archetype,
    localTime
  });
  if (kept === 'full') {
    await unstore(access, profile);
    return fullRefusal();
  }
  if (typeof kept === 'string') {
    return jsonError(kept, 409);
  }
  return privateJson({
    decklist: presenter(kept.row)({ ...profile, deck, mode, archetype, submittedAt: now, locked: true }),
    registration: kept.registration,
    token
  });
}

/**
 * Registers a submission the route read, while its player may still send a
 * list: the wrong-year guard, the checks before the store, then the store and
 * the event's registration (see submit). The answer, or the refusal.
 */
export async function register(context: Context<'code'>, access: Access, read: Submission): Promise<Response> {
  const sender = submitter(access.row, read);
  if (!decklistOpenFor(access.row, sender)) {
    return notTaking(access.row, sender);
  }
  const window = windowFor(access.row);
  const guard = await guardSubmission(access, read.profile, read.wasYear);
  if (guard instanceof Response) {
    return guard;
  }
  const refused = await beforeStore(access, read, window);
  if (refused) {
    await guard.stored(false);
    return refused;
  }
  // The list's archetype is read from its cards (see shared/tournament/archetypes.ts); with archetypes off, none is kept.
  const archetype =
    decksEnabled(access.row.settings) && read.mode === 'digital'
      ? archetypeOfList(read.deck, await archetypeRules())
      : null;
  const submission = { ...read, archetype };
  const answer = await submit(context, access, submission, window);
  await guard.stored(answer.ok);
  return answer;
}

/**
 * Withdraws the list under the details, while the event still takes lists:
 * at a sanctioned event once its birth year proved the Player ID, whatever
 * device sent it; at an unsanctioned one only the list the device's token or
 * the account owns, checked in the delete itself, so a list replaced
 * meanwhile is not the one withdrawn. Whether the asker may withdraw: true,
 * or the refusal.
 */
async function dropList(access: Access, request: Request, details: Details): Promise<true | Response> {
  const { db, row } = access;
  const sanctioned = isSanctioned(row);
  const key = identityKey(details, sanctioned);
  const query = new URL(request.url).searchParams;
  if (sanctioned) {
    const listed = await listUnder(access, key);
    const proved = await proveYear(access, details.popId, query.get('birthYear') ?? '', listed);
    if (proved !== true || !listed) {
      return proved;
    }
  }
  const held = query.get('token') ?? '';
  const account = matchingAccount(access, details) ?? NO_ACCOUNT;
  const ownership = sanctioned ? '' : `AND (owner_token = ? OR account = ${account.sql}) `;
  const values = sanctioned ? [] : [held ? await sha256(held) : '', ...account.values];
  const deleted = await db
    .prepare(`DELETE FROM decklists WHERE code = ? AND user_id = ? ${ownership}AND ${STILL_TAKING}`)
    .bind(row.code, key, ...values, row.code, ...windowValues(BEFORE_ROUND_1))
    .run();
  return rowsChanged(deleted) === 1 ? true : refusedWrite(access);
}

/** Withdraws the registration under the details (see dropList), and its player from the event: 204, or the refusal. */
export async function withdraw(context: Context<'code'>, access: Access, details: Details): Promise<Response> {
  const allowed = await dropList(access, context.request, details);
  if (allowed !== true) {
    return allowed;
  }
  const outcome = await mutate(access.db, access.row, current =>
    decklistsOpen(current) ? withdrawnChanges(current, details, null) : notTakingText(current)
  );
  if ('error' in outcome) {
    return jsonError(outcome.error, 403);
  }
  if (outcome.row.version !== access.row.version) {
    await publishAfter(context, outcome.row);
  }
  return noContent();
}

const LOCKED = msg('This list was sent from another device. Send it from that device, or ask staff to reset it.');

/** Why a write to a list did not land: the event stopped taking lists meanwhile, or the list is not the sender's. */
async function refusedWrite(access: Access, playerId: string | null = null): Promise<Response> {
  const now = await loadTournament(access.db, access.row.code);
  if (now && !decklistOpenFor(now, playerId)) {
    return notTaking(now, playerId);
  }
  return isSanctioned(access.row) ? jsonError(WRONG_YEAR, 403) : jsonError(LOCKED, 409);
}

/** Staff unlock the list under the details, from its device and its account alike: 204, or the refusal. */
export async function unlock(access: StaffAccess, details: Details): Promise<Response> {
  const { db, row } = access;
  if (!decklistOpenFor(row, rosterPlayer(row, details)?.id ?? null)) {
    return notTaking(row);
  }
  return staffWrites(access, guard => [
    db
      .prepare(
        `UPDATE decklists SET owner_token = NULL, account = NULL WHERE code = ? AND user_id = ? AND ${guard.sql}`
      )
      .bind(row.code, identityKey(details, isSanctioned(row)), ...guard.values),
    // Staff vouch for the player, so their Player ID's wrong birth years are forgiven too.
    ...(isSanctioned(row) ? [clearFailures(db, row.code, details.popId, guard)] : [])
  ]);
}
