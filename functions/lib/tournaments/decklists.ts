/**
 * Registrations' lists as the decklists table keeps them (see
 * functions/api/tournaments/[code]/decklists.ts): whose each one is, who owns
 * it (the device token it was sent with, or the account that is its player),
 * the birth year that proves a Player ID, and what a player's details find.
 */

import { decklistOpenFor, enteredLate } from '../../../shared/tournament/lateLists.js';
import { parseDecklist } from '../../../shared/tournament/decklist.js';
import { decklistMatcher, fullNameKey, nameKey, similarlyNamed } from '../../../shared/tournament/identify.js';
import type { PlayerProfile } from '../../../shared/tournament/profile.js';
import { type Decklist, type DeckMode, isSanctioned, type MyRegistration } from '../../../shared/tournament/view.js';
import { msg } from '../../../shared/i18n.js';
import { jsonError } from '../api/responses.js';
import { sha256 } from '../auth/session.js';
import { type Access, publicViewOf } from './access.js';
import { admitTry, LOCKED_OUT } from './attempts.js';
import { provesId, rosterPlayer } from './registrations.js';
import type { TournamentRow } from './store.js';

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
type Stored = Omit<Decklist, 'problems' | 'registered' | 'fromList' | 'late' | 'editable'>;

export const deckMode = (value: unknown): DeckMode | null => (value === 'paper' || value === 'digital' ? value : null);

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
export function presenter(row: TournamentRow) {
  const match = decklistMatcher(row.tournament, isSanctioned(row));
  const players = new Map(row.tournament.players.map(player => [player.id, player]));
  return (list: Stored): Decklist => {
    const player = players.get(match(list) ?? '');
    return {
      ...list,
      // A minor's cards are deleted once the event ends (see store.ts), leaving nothing to check.
      problems: list.deck ? parseDecklist(list.deck).problems : [],
      registered: player !== undefined,
      fromList: player?.fromList === true,
      late: enteredLate(row.tournament, player?.id ?? null),
      editable: decklistOpenFor(row, player?.id ?? null)
    };
  };
}

/** Every list the event holds, as its staff read them. */
export async function everyList(access: Access): Promise<Decklist[]> {
  const { results } = await access.db
    .prepare('SELECT * FROM decklists WHERE code = ? ORDER BY last_name, first_name')
    .bind(access.row.code)
    .all<DecklistRow>();
  const present = presenter(access.row);
  return results.map(row => present(fromRow(row)));
}

/** Who a list belongs to: the Player ID at a sanctioned event, the full name at an unsanctioned one. */
export function identityKey(profile: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>, sanctioned: boolean) {
  return sanctioned ? `pop:${profile.popId.trim()}` : `name:${fullNameKey(profile)}`;
}

export type Details = Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>;

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

export function matchingAccount(access: Access, details: Details): ListAccount | null {
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

/** No account: a write names none, and no list's account matches it. */
export const NO_ACCOUNT: ListAccount = { id: '', sql: 'NULL', values: [] };

/** Whether the asker owns the list: the token their device holds, or the account that is its player. */
async function owns(row: DecklistRow, token: string, account: string | null): Promise<boolean> {
  if (account !== null && row.account === account) {
    return true;
  }
  return row.owner_token !== null && token !== '' && row.owner_token === (await sha256(token));
}

export const listUnder = (access: Access, key: string) =>
  access.db
    .prepare('SELECT * FROM decklists WHERE code = ? AND user_id = ?')
    .bind(access.row.code, key)
    .first<DecklistRow>();

const tokenOf = (request: Request) => new URL(request.url).searchParams.get('token') ?? '';

/** The asker's own list without details: the latest sent with the device token they hold. */
async function tokenList(access: Access, request: Request): Promise<DecklistRow | null> {
  const token = tokenOf(request);
  return token
    ? access.db
        .prepare('SELECT * FROM decklists WHERE code = ? AND owner_token = ? ORDER BY submitted_at DESC LIMIT 1')
        .bind(access.row.code, await sha256(token))
        .first<DecklistRow>()
    : null;
}

/**
 * The list under the asker's details when it is their own, by the device
 * token they hold or the account that is its player. Nothing else reads a
 * list back without the birth year: a profile anyone can edit to someone
 * else's details must not show that person's list.
 */
async function ownList(
  access: Access,
  request: Request,
  details: Details,
  listed: DecklistRow | null
): Promise<DecklistRow | null> {
  const account = matchingAccount(access, details)?.id ?? null;
  return listed && (await owns(listed, tokenOf(request), account)) ? listed : null;
}

export const WRONG_YEAR = msg('That birth year doesn’t match this Player ID.');

/**
 * A Player ID's birth year, judged as one try against it (see
 * lib/tournaments/attempts.ts): true when it proves the ID, or the refusal.
 */
export async function proveYear(access: Access, popId: string, year: string, listed: DecklistRow | null) {
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
    const mine = await ownList(access, request, details, listed);
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
  // Names as the event publishes them: a near miss must not show a surname the public page shortens.
  const shown = new Map(publicViewOf(access.row).tournament.players.map(player => [player.id, player]));
  const matches = similarlyNamed(access.row.tournament.players, details).flatMap(player => {
    const visible = shown.get(access.row.keys[player.id] ?? player.id);
    return visible
      ? [
          {
            firstName: visible.firstName,
            lastName: visible.lastName,
            sameName: fullNameKey(player) === fullNameKey(details),
            sameSurname: nameKey(player.lastName) === nameKey(details.lastName)
          }
        ]
      : [];
  });
  const listed = await listUnder(access, identityKey(details, false));
  const mine = await ownList(access, request, details, listed);
  return {
    known: listed !== null || rosterPlayer(access.row, details) !== undefined,
    matches,
    mine: mine && presenter(access.row)(fromRow(mine))
  };
}

/**
 * What a player's details find (see byPlayerId and byName), or with none
 * given, the list sent with the device token they hold.
 */
export async function playerAnswer(
  access: Access,
  request: Request,
  details: Details | null
): Promise<MyRegistration | Response> {
  if (!details) {
    const mine = await tokenList(access, request);
    return { known: mine !== null, mine: mine && presenter(access.row)(fromRow(mine)) };
  }
  return isSanctioned(access.row) ? byPlayerId(access, request, details) : byName(access, request, details);
}
