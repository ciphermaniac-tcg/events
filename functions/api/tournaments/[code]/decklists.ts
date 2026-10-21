/**
 * Registering for an event from its page, with the decklist that goes with
 * it. Players need no account: they say who they are the way the rest of the
 * player side does (Player ID, name and birth year at a sanctioned event;
 * first and last name at an unsanctioned one), and that identity keys the
 * registration. A player hands in their list either pasted here or on paper
 * to staff at the event (see DeckMode).
 *
 * At a sanctioned event the Player ID finds the registration and its birth
 * year proves it, so a player changes theirs from any device: the year is not
 * on pairings, and wrong tries count against the Player ID as the report
 * route's do (see lib/tournaments/attempts.ts). A name is no secret, so at an
 * unsanctioned event the list belongs to the device that sent it: the token
 * it was given is the only way to read, replace, rename or withdraw it. Staff
 * can unlock a list for a player who changed devices, and the next submission
 * under those details takes it over. A signed-in account that is the list's
 * player (by its POP ID, or by its Claim at an unsanctioned event) owns its
 * list as well, from any of its devices.
 *
 * GET — staff see every list. A player's details (query popId, or firstName
 * and lastName) answer whether anyone is registered under them, and at an
 * unsanctioned event who is named like them; a Player ID with its birthYear
 * answers with whose registration it is and its list, as does the device
 * token or the account that owns one.
 * PUT — registers or changes a registration while submission is open:
 * { profile, mode, deck, was?, token?, localTime? }. A paper registration
 * sends no deck. `was` renames an unsanctioned registration from the names
 * it had. A registrant who is not on the event's player list is added to it
 * (a Swiss event still open, with room under its cap), marked as added from a
 * list; the answer says whether they were added, matched or not added, and
 * carries the device's token. A player under 13 is refused (see
 * shared/accounts/age.ts). A signed-in submitter's name refreshes their
 * account's when the list is under the account's own Player ID; a list never
 * sets an account's Player ID or birth year.
 * DELETE — withdraws the registration under the details in the query
 * (popId and birthYear, or the names and the token), while submission is
 * open: the list goes, and so does the player from an event the site runs.
 * PATCH — staff unlock the list under the details in the query, from its
 * device and its account alike.
 */

import { archetypeOfList } from '../../../../shared/tournament/archetypes.js';
import { MAX_DECKLIST_CHARS, parseDecklist } from '../../../../shared/tournament/decklist.js';
import { decklistMatcher, fullNameKey, similarlyNamed } from '../../../../shared/tournament/identify.js';
import { mayBeMinor, mayBeUnder13 } from '../../../../shared/accounts/age.js';
import { birthYear, yearOnlyBirthDate } from '../../../../shared/tournament/divisions.js';
import { isPopId, type PlayerProfile, readProfile } from '../../../../shared/tournament/profile.js';
import {
  type Decklist,
  decklistsLocked,
  decklistsOpen,
  type DeckMode,
  decksEnabled,
  isSanctioned,
  type MyRegistration,
  type Registration
} from '../../../../shared/tournament/view.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { createRateLimiter, rateLimitAddress } from '../../../lib/api/rateLimiter.js';
import { jsonError, noContent } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { sha256 } from '../../../lib/auth/session.js';
import { rowsChanged } from '../../../lib/d1.js';
import { type Access, codeOf, open, openForStaff, privateJson, staffWrites } from '../../../lib/tournaments/access.js';
import { archetypeRules } from '../../../lib/tournaments/archetypeRules.js';
import { admitTry, clearFailures, forgive, LOCKED_OUT } from '../../../lib/tournaments/attempts.js';
import { publishAfter } from '../../../lib/tournaments/publish.js';
import {
  FULL,
  fullRefusal,
  isFull,
  type Kept,
  keptChanges,
  provesId,
  rosterFull,
  rosterPlayer,
  withdrawnChanges
} from '../../../lib/tournaments/registrations.js';
import { commandChanges } from '../../../lib/tournaments/results.js';
import { loadTournament, mutate, pairedRounds, type TournamentRow } from '../../../lib/tournaments/store.js';
import { msg } from '../../../../shared/i18n.js';

interface DecklistRow {
  /** The submitter's identity key (see identityKey). */
  user_id: string;
  pop_id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  deck: string;
  archetype: string | null;
  submitted_at: number;
  owner_token: string | null;
  /** The account the list belongs to, when one that is its player sent it. */
  account: string | null;
  deck_mode: string;
}

/** A list as stored, before it is checked against the roster (see presenter). */
type Stored = Omit<Decklist, 'problems' | 'registered' | 'fromList'>;

const deckMode = (value: unknown): DeckMode | null => (value === 'paper' || value === 'digital' ? value : null);

function fromRow(row: DecklistRow): Stored {
  return {
    popId: row.pop_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    deck: row.deck,
    mode: deckMode(row.deck_mode) ?? 'digital',
    archetype: row.archetype,
    submittedAt: row.submitted_at,
    locked: row.owner_token !== null
  };
}

/**
 * Lists as the pages show them, each with its problems and where its player
 * stands on the event's list. The roster is indexed once for however many
 * lists there are: staff read the whole event's at a time.
 */
function presenter(row: TournamentRow) {
  const match = decklistMatcher(row.tournament, isSanctioned(row));
  const players = new Map(row.tournament.players.map(player => [player.id, player]));
  return (list: Stored): Decklist => {
    const player = players.get(match(list) ?? '');
    return {
      ...list,
      // A minor's cards are deleted once the event ends (see store.ts), leaving nothing to check.
      problems: list.deck ? parseDecklist(list.deck).problems : [],
      registered: player !== undefined,
      fromList: player?.fromList === true
    };
  };
}

/** Who a list belongs to: the Player ID at a sanctioned event, the full name at an unsanctioned one. */
export function identityKey(profile: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>, sanctioned: boolean) {
  return sanctioned ? `pop:${profile.popId.trim()}` : `name:${fullNameKey(profile)}`;
}

type Details = Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>;

/** The details a player gave in a query string, when they say whose registration it is. */
function detailsFrom(request: Request, sanctioned: boolean): Details | null {
  const query = new URL(request.url).searchParams;
  const details = {
    popId: query.get('popId') ?? '',
    firstName: query.get('firstName') ?? '',
    lastName: query.get('lastName') ?? ''
  };
  const complete = sanctioned ? isPopId(details.popId) : Boolean(details.firstName && details.lastName);
  return complete ? details : null;
}

/**
 * The signed-in account, when it is the player the details name, so the list
 * may be the account's: by the POP ID it holds at a sanctioned event; at an
 * unsanctioned one, by its Claim here, on a player with the list's name. A
 * list sent before any Claim is a device's only. A write names the account
 * by `sql` (bound to `values`), which reads as its ID only while it is still
 * that player when the write lands: the POP ID or the Claim read may be gone.
 */
interface ListAccount {
  id: string;
  sql: string;
  values: unknown[];
}

function matchingAccount(access: Access, details: Details): ListAccount | null {
  const { user, row, claimed } = access;
  if (!user) {
    return null;
  }
  if (isSanctioned(row)) {
    return user.popId === details.popId
      ? { id: user.id, sql: '(SELECT id FROM users WHERE id = ? AND pop_id = ?)', values: [user.id, user.popId] }
      : null;
  }
  const player = row.tournament.players.find(candidate => candidate.id === claimed);
  return player && fullNameKey(player) === fullNameKey(details)
    ? {
        id: user.id,
        sql: '(SELECT user_id FROM report_devices WHERE code = ? AND player_id = ? AND user_id = ?)',
        values: [row.code, player.id, user.id]
      }
    : null;
}

/**
 * A write's guard that the event (bound as its code) still takes lists as the
 * write lands: submission open (an event stored before decklists could be
 * turned off keeps its open switch, see storedSettings) and no round paired
 * (see decklistsLocked). A close or a round 1 since the request read the
 * event refuses the write all the same.
 */
const STILL_TAKING =
  'EXISTS (SELECT 1 FROM tournaments WHERE code = ? AND ' +
  "coalesce(json_extract(settings, '$.decklists'), " +
  "CASE WHEN json_extract(settings, '$.decklistsOpen') THEN 'open' END) = 'open' " +
  `AND json_extract(state, '$.startedAt') IS NULL AND (${pairedRounds('state')}) = 0)`;

/** No account: a write names none, and no list's account matches it. */
const NO_ACCOUNT: ListAccount = { id: '', sql: 'NULL', values: [] };

/** Whether the asker owns the list: the token their device holds, or the account that is its player. */
async function owns(row: DecklistRow, token: string, account: string | null): Promise<boolean> {
  if (account !== null && row.account === account) {
    return true;
  }
  return row.owner_token !== null && token !== '' && row.owner_token === (await sha256(token));
}

const listUnder = (access: Access, key: string) =>
  access.db
    .prepare('SELECT * FROM decklists WHERE code = ? AND user_id = ?')
    .bind(access.row.code, key)
    .first<DecklistRow>();

/**
 * The asker's own list, by the details and the device token they hold, or
 * the account that is its player. Nothing else reads a list back without the
 * birth year: a profile anyone can edit to someone else's details must not
 * show that person's list.
 */
async function ownList(access: Access, request: Request): Promise<DecklistRow | null> {
  const details = detailsFrom(request, isSanctioned(access.row));
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const account = details && matchingAccount(access, details)?.id;
  if (!details) {
    return token
      ? access.db
          .prepare('SELECT * FROM decklists WHERE code = ? AND owner_token = ? ORDER BY submitted_at DESC LIMIT 1')
          .bind(access.row.code, await sha256(token))
          .first<DecklistRow>()
      : null;
  }
  if (!(token || account)) {
    return null;
  }
  const row = await listUnder(access, identityKey(details, isSanctioned(access.row)));
  return row && (await owns(row, token, account ?? null)) ? row : null;
}

const WRONG_YEAR = msg('That birth year doesn’t match this Player ID.');

/**
 * A Player ID's birth year, judged as one try against it (see
 * lib/tournaments/attempts.ts): true when it proves the ID, or the refusal.
 */
async function proveYear(access: Access, popId: string, year: string, listed: DecklistRow | null) {
  const { db, row } = access;
  const right = provesId(row, popId, year, listed?.birth_date ?? null);
  if (!(await admitTry({ db, code: row.code, popId, right, now: Date.now() }))) {
    return jsonError(LOCKED_OUT, 429);
  }
  return right ? true : jsonError(WRONG_YEAR, 403);
}

/** What a Player ID finds: whether anyone is registered under it, and with its birth year, whose registration it is. */
async function byPlayerId(access: Access, request: Request, details: Details): Promise<MyRegistration | Response> {
  const year = new URL(request.url).searchParams.get('birthYear') ?? '';
  const listed = await listUnder(access, identityKey(details, true));
  const player = rosterPlayer(access.row, details);
  const known = player !== undefined || listed !== null;
  if (!known || !year) {
    const mine = await ownList(access, request);
    return { known, mine: mine && presenter(access.row)(fromRow(mine)) };
  }
  const proved = await proveYear(access, details.popId, year, listed);
  if (proved !== true) {
    return proved;
  }
  const named = player ?? (listed ? { firstName: listed.first_name, lastName: listed.last_name } : null);
  return {
    known,
    player: named && { firstName: named.firstName, lastName: named.lastName },
    mine: listed && presenter(access.row)(fromRow(listed))
  };
}

/** What names find at an unsanctioned event: the players named like them, and the asker's own list. */
async function byName(access: Access, request: Request, details: Details): Promise<MyRegistration> {
  const matches = similarlyNamed(access.row.tournament.players, details).map(({ firstName, lastName }) => ({
    firstName,
    lastName
  }));
  const listed = await listUnder(access, identityKey(details, false));
  const mine = await ownList(access, request);
  return {
    known: listed !== null || rosterPlayer(access.row, details) !== undefined,
    matches,
    mine: mine && presenter(access.row)(fromRow(mine))
  };
}

async function playerAnswer(access: Access, request: Request): Promise<MyRegistration | Response> {
  const details = detailsFrom(request, isSanctioned(access.row));
  if (!details) {
    const mine = await ownList(access, request);
    return { known: mine !== null, mine: mine && presenter(access.row)(fromRow(mine)) };
  }
  return isSanctioned(access.row) ? byPlayerId(access, request, details) : byName(access, request, details);
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await open(context, { claim: true });
  if (access instanceof Response) {
    return access;
  }
  if (access.role) {
    const { results } = await access.db
      .prepare('SELECT * FROM decklists WHERE code = ? ORDER BY last_name, first_name')
      .bind(access.row.code)
      .all<DecklistRow>();
    const present = presenter(access.row);
    return privateJson({ decklists: results.map(row => present(fromRow(row))), mine: null });
  }
  const answer = await playerAnswer(access, context.request);
  return answer instanceof Response ? answer : privateJson({ decklists: [], ...answer });
}

interface Submission {
  profile: PlayerProfile;
  mode: DeckMode;
  /** The pasted list; '' for a paper one. */
  deck: string;
  archetype: string | null;
  /** At an unsanctioned event, the names the registration had, when this renames it. */
  was: Details | null;
  /** The token the device holds for an earlier list under these details, if any. */
  held: unknown;
  localTime: unknown;
}

/** A player under 13 registers with staff (see shared/accounts/age.ts): paper is no way round it online. */
const UNDER_13 = msg('Players under 13 register with staff at the event.');
const LOCKED = msg('This list was sent from another device. Send it from that device, or ask staff to reset it.');
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
async function guardSubmission(access: Access, profile: PlayerProfile): Promise<Admitted | Response> {
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
  const right = listed && provesId(row, profile.popId, String(year ?? ''), null);
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

/** The names an unsanctioned rename moves a registration from, when the body gives them. */
function readWas(value: unknown, sanctioned: boolean): Details | null {
  if (sanctioned || typeof value !== 'object' || value === null) {
    return null;
  }
  const { firstName, lastName } = value as Record<string, unknown>;
  return typeof firstName === 'string' && typeof lastName === 'string' && firstName.trim() && lastName.trim()
    ? { popId: '', firstName: firstName.trim(), lastName: lastName.trim() }
    : null;
}

/** The list as the body gives it: pasted, or none for a paper one. */
function readDeck(value: Record<string, unknown>): { mode: DeckMode; deck: string } | null {
  const mode = deckMode(value.mode ?? 'digital');
  const deck = typeof value.deck === 'string' ? value.deck.trim() : '';
  if (mode === 'paper') {
    return { mode, deck: '' };
  }
  return mode && deck && deck.length <= MAX_DECKLIST_CHARS ? { mode, deck } : null;
}

/** The submission in a request body, or why it is not one. */
async function readSubmission(request: Request, sanctioned: boolean): Promise<Submission | string> {
  const value = (await readJsonObject(request, MAX_DECKLIST_CHARS * 4 + 1024)) ?? {};
  const read = readProfile(value.profile, sanctioned);
  const profile = read && { ...read, birthDate: yearOnlyBirthDate(read.birthDate) };
  const list = readDeck(value);
  if (!profile) {
    return sanctioned ? msg('Fill in your Player ID, name and birth year') : msg('Fill in your name');
  }
  if (!list) {
    return msg('Paste a decklist');
  }
  // A player names no archetype: their list's cards do (see onRequestPut).
  return {
    profile,
    ...list,
    archetype: null,
    was: readWas(value.was, sanctioned),
    held: value.token,
    localTime: value.localTime
  };
}

/**
 * Saves a signed-in submitter's details to their account, so pages that know
 * them can find them. Only an account that already holds the list's Player ID
 * takes them: a POP ID carries an account's history and who it is at events,
 * and a list sent for a friend from your own phone must not give your account
 * theirs. The account page saves a POP ID, where one account holds each. An
 * unsanctioned event asked only for the name, so the Player ID and birth year
 * already there stay.
 */
function saveToAccount(access: Access, userId: string, profile: PlayerProfile) {
  const { db } = access;
  return isSanctioned(access.row)
    ? db
        .prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ? AND pop_id = ?')
        .bind(profile.firstName, profile.lastName, userId, profile.popId)
    : db
        .prepare(
          'UPDATE users SET first_name = ?, last_name = ? ' +
            "WHERE id = ? AND (pop_id IS NULL OR pop_id = '' OR (first_name = ? AND last_name = ?))"
        )
        .bind(profile.firstName, profile.lastName, userId, profile.firstName, profile.lastName);
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
async function store(access: Access, submission: Submission, tokenHash: string, now: number): Promise<boolean> {
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
      held,
      proved ? 1 : 0,
      sanctioned ? 1 : 0,
      held
    );
  // The upsert changes no row when the list there is not the sender's, so its count is the answer.
  if (rowsChanged(await insert.run()) === 0) {
    return false;
  }
  if (access.user) {
    await saveToAccount(access, access.user.id, profile).run();
  }
  return true;
}

/**
 * Moves an unsanctioned registration to the names it is renamed to, when its
 * sender owns it there (the device's token or the account) and nobody holds
 * the new names. Whether it moved; the store then saves the rest.
 */
async function rename(access: Access, was: Details, profile: PlayerProfile, held: unknown): Promise<boolean> {
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
      access.row.code,
      identityKey(profile, false)
    )
    .run();
  return rowsChanged(moved) === 1;
}

const ALREADY_IN = msg('Already on the player list');

/**
 * Puts a submitter who is not on the player list onto it: a Swiss event the
 * organizer has not closed takes them as staff would add them, marked as
 * added from their list, while it has room under its cap. A TOM event's
 * roster is TOM's, and a closed event takes nobody new.
 */
async function register(
  context: Context<'code'>,
  access: Access,
  submission: Submission
): Promise<{ registration: Registration | 'full'; row: TournamentRow }> {
  const { row } = access;
  // A rename finds them under the names they had: the list's rename to the new ones is the keeping's (see keep).
  if (rosterPlayer(row, submission.was ?? submission.profile) !== undefined) {
    return { registration: 'matched', row };
  }
  if (row.mode !== 'swiss' || row.settings.finished) {
    return { registration: 'not-added', row };
  }
  const { profile } = submission;
  const player = {
    firstName: profile.firstName,
    lastName: profile.lastName,
    ...(isSanctioned(row) ? { id: profile.popId, birthDate: profile.birthDate } : {}),
    fromList: true
  };
  // Checked again against the event as it is when written: a second submission
  // may have added them meanwhile, filled the last place, or the organizer closed the event.
  const outcome = await mutate(access.db, row, current => {
    if (rosterPlayer(current, profile) !== undefined) {
      return ALREADY_IN;
    }
    if (rosterFull(current)) {
      return FULL;
    }
    return current.settings.finished
      ? msg('The event is closed')
      : commandChanges(current, { type: 'addPlayer', player }, submission.localTime);
  });
  if ('error' in outcome) {
    const registration = outcome.error === ALREADY_IN ? 'matched' : outcome.error === FULL ? 'full' : 'not-added';
    return { registration, row };
  }
  await publishAfter(context, outcome.row);
  return { registration: 'added', row: outcome.row };
}

/**
 * Keeps the event in step with a saved registration (see keptChanges): a
 * rename, a paper list for check-in, the list's archetype. The event, or why
 * the event's list would not take the change (a rename to a name staff gave
 * someone else, say), which the player is told: their list is saved, but
 * the event still shows them as it did.
 */
async function keep(context: Context<'code'>, access: Access, row: TournamentRow, kept: Kept) {
  const outcome = await mutate(access.db, row, current => keptChanges(current, kept, kept.localTime));
  if ('error' in outcome) {
    return outcome.error;
  }
  if (outcome.row.version !== row.version) {
    await publishAfter(context, outcome.row);
  }
  return outcome.row;
}

/**
 * A whole field can send its lists from one venue's Wi-Fi, so the limit is
 * counted per event and sized for a room: 150 submissions per address per
 * event per ten minutes, with a looser cap across every event so one address
 * cannot flood many.
 */
const eventLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 150 });
const addressLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 400 });

/** Why a list cannot be sent or withdrawn now: the event takes none, round 1 is paired, or submission is closed. */
function notTakingText(row: TournamentRow): string {
  if (row.settings.decklists === 'off') {
    return msg('This event does not take decklists');
  }
  return decklistsLocked(row) ? LOCKED_AFTER_ROUND_1 : msg('Decklist submission is closed');
}

const notTaking = (row: TournamentRow): Response => jsonError(notTakingText(row), 403);

const LOCKED_AFTER_ROUND_1 = msg('Decklists are locked once round 1 is paired');

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  eventLimiter.reset();
  addressLimiter.reset();
}

function limited(context: Context<'code'>): boolean {
  const address = rateLimitAddress(context.request);
  const code = codeOf(context);
  return !(addressLimiter.check(address).allowed && eventLimiter.check(`${code}:${address}`).allowed);
}

/** A token the device made for itself, when it sent one that looks like one. */
const deviceToken = (held: unknown) => (typeof held === 'string' && /^[\w-]{16,100}$/.test(held) ? held : null);

/** The request's event, when it may be written to by a player now, or why not. */
async function openForPlayer(context: Context<'code'>): Promise<Access | Response> {
  if (limited(context)) {
    return jsonError('Too many submissions. Try again later.', 429);
  }
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const access = await open(context, { claim: true });
  if (access instanceof Response) {
    return access;
  }
  return decklistsOpen(access.row) ? access : notTaking(access.row);
}

/** Whether the submission is someone new to the event: not on its list, and with no list in under their details. */
async function isNewcomer(access: Access, submission: Submission): Promise<boolean> {
  const named = submission.was ?? submission.profile;
  if (rosterPlayer(access.row, named) !== undefined) {
    return false;
  }
  return (await listUnder(access, identityKey(named, isSanctioned(access.row)))) === null;
}

/** Why the submission cannot go ahead before its list is stored, or null: the event is full, or a rename is not theirs. */
async function beforeStore(access: Access, submission: Submission): Promise<Response | null> {
  if ((await isNewcomer(access, submission)) && (await isFull(access.db, access.row))) {
    return fullRefusal();
  }
  const { was, profile } = submission;
  if (was && fullNameKey(was) !== fullNameKey(profile) && !(await rename(access, was, profile, submission.held))) {
    return refusedWrite(access);
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
async function submit(context: Context<'code'>, access: Access, submission: Submission): Promise<Response> {
  const now = Date.now();
  // The device's own token stays its token, so a retry after a lost answer still owns the list.
  const token = deviceToken(submission.held) ?? crypto.randomUUID();
  if (!(await store(access, submission, await sha256(token), now))) {
    return refusedWrite(access);
  }
  const { registration, row } = await register(context, access, submission);
  if (registration === 'full') {
    await unstore(access, submission.profile);
    return fullRefusal();
  }
  const { profile, deck, mode, archetype, was, localTime } = submission;
  const kept = await keep(context, access, row, { ...(was ? { was } : {}), now: profile, mode, archetype, localTime });
  if (typeof kept === 'string') {
    return jsonError(kept, 409);
  }
  return privateJson({
    decklist: presenter(kept)({ ...profile, deck, mode, archetype, submittedAt: now, locked: true }),
    registration,
    token
  });
}

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForPlayer(context);
  if (access instanceof Response) {
    return access;
  }
  const read = await readSubmission(context.request, isSanctioned(access.row));
  if (typeof read === 'string') {
    return jsonError(read, 400);
  }
  const guard = await guardSubmission(access, read.profile);
  if (guard instanceof Response) {
    return guard;
  }
  const refused = await beforeStore(access, read);
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
  const answer = await submit(context, access, submission);
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
  const key = identityKey(details, isSanctioned(row));
  const query = new URL(request.url).searchParams;
  if (isSanctioned(row)) {
    const listed = await listUnder(access, key);
    const proved = await proveYear(access, details.popId, query.get('birthYear') ?? '', listed);
    if (proved !== true || !listed) {
      return proved;
    }
    const deleted = await db
      .prepare(`DELETE FROM decklists WHERE code = ? AND user_id = ? AND ${STILL_TAKING}`)
      .bind(row.code, key, row.code)
      .run();
    return rowsChanged(deleted) === 1 ? true : refusedWrite(access);
  }
  const held = query.get('token') ?? '';
  const account = matchingAccount(access, details) ?? NO_ACCOUNT;
  const deleted = await db
    .prepare(
      'DELETE FROM decklists WHERE code = ? AND user_id = ? ' +
        `AND (owner_token = ? OR account = ${account.sql}) AND ${STILL_TAKING}`
    )
    .bind(row.code, key, held ? await sha256(held) : '', ...account.values, row.code)
    .run();
  return rowsChanged(deleted) === 1 ? true : refusedWrite(access);
}

export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  const access = await openForPlayer(context);
  if (access instanceof Response) {
    return access;
  }
  const details = detailsFrom(context.request, isSanctioned(access.row));
  if (!details) {
    return jsonError('Say whose registration to withdraw', 400);
  }
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

/** Why a write to a list did not land: the event stopped taking lists meanwhile, or the list is not the sender's. */
async function refusedWrite(access: Access): Promise<Response> {
  const now = await loadTournament(access.db, access.row.code);
  if (now && !decklistsOpen(now)) {
    return notTaking(now);
  }
  return isSanctioned(access.row) ? jsonError(WRONG_YEAR, 403) : jsonError(LOCKED, 409);
}

/** Staff unlock a list, so the next submission under its details takes it over from whichever device sent it. */
export async function onRequestPatch(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const details = detailsFrom(context.request, isSanctioned(access.row));
  if (!details) {
    return jsonError('Say whose list to unlock', 400);
  }
  const { db, row } = access;
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
