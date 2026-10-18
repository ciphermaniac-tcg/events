/**
 * The checks every tournament route starts with: is the database bound, is
 * the code real, who is asking, and may they do this.
 */

import {
  decksEnabled,
  decksVisible,
  isSanctioned,
  type Manage,
  publicDecks,
  publicDivisions,
  publicPending,
  publicTournament,
  type PublishedView,
  type Role,
  type TournamentView,
  type Viewer
} from '../../../shared/tournament/view.js';
import { birthYear } from '../../../shared/tournament/divisions.js';
import { birthYearFits, fullNameKey } from '../../../shared/tournament/identify.js';
import { lookupPlayers } from '../../../shared/tournament/lookup.js';
import type { Player } from '../../../shared/tournament/types.js';
import { publicReports } from '../../../shared/tournament/reports.js';
import { publicRequests } from '../../../shared/tournament/requests.js';
import { jsonError, jsonResponse, noContent } from '../api/responses.js';
import { type Context, param, sameOrigin } from '../auth/env.js';
import type { User } from '../auth/session.js';
import { type Guard, rowsChanged } from '../d1.js';
import type { D1Like, D1Statement } from '../types.js';
import { type Asker, askerStands } from './roles.js';
import { shownDecks } from './decks.js';
import {
  type Change,
  isCode,
  mutate,
  type Mutation,
  NOT_STAFF,
  type Opened,
  type OpenOptions,
  openTournament,
  readAgain,
  SIGN_IN,
  type TournamentRow
} from './store.js';
import { msg } from '../../../shared/i18n.js';

export const PRIVATE = { cacheControl: 'no-store', cors: false } as const;

/** A .tdf's worth of JSON with room to spare; a regional is well under a megabyte. */
export const MAX_TOURNAMENT_BYTES = 3 * 1024 * 1024;

export type Access = Opened & { db: D1Like };

/** The tournament and who is asking; a Response when either cannot be had. */
export async function open(context: Context<'code'>, options: OpenOptions = {}): Promise<Access | Response> {
  const db = context.env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Tournaments are not available', 503);
  }
  const code = codeOf(context);
  const opened = isCode(code) ? await openTournament(db, code, context.request, options) : null;
  return opened ? { db, ...opened } : jsonError('No such tournament', 404);
}

/** The event code a route names, as codes are stored. */
export const codeOf = (context: Context<'code'>): string => param(context.params.code).toUpperCase();

/**
 * What a poll names: the event, and the version the asker already holds
 * (`?since=`). Null when it names no version or no event, and the whole
 * answer is due.
 */
export function pollOf(context: Context<'code'>): { db: D1Like; code: string; since: number } | null {
  const since = Number(new URL(context.request.url).searchParams.get('since'));
  const db = context.env.TOURNAMENT_DB;
  const code = codeOf(context);
  return since && db && isCode(code) ? { db, code, since } : null;
}

/** An event opened by one of its staff, with the hash of the session they asked with. */
export type StaffAccess = Access & { role: Role; hash: string };

/** The access as staff's, or why the asker may not act as the event's staff. */
function staffOnly(access: Access): StaffAccess | Response {
  const { role, hash } = access;
  if (!access.user || !hash) {
    return jsonError(SIGN_IN, 401);
  }
  return role ? { ...access, role, hash } : jsonError(NOT_STAFF, 403);
}

/** As `open`, for what only staff may read. */
export async function openForStaffRead(context: Context<'code'>): Promise<StaffAccess | Response> {
  const access = await open(context);
  return access instanceof Response ? access : staffOnly(access);
}

/** As `open`, for a change only staff may make. */
export async function openForStaff(context: Context<'code'>): Promise<StaffAccess | Response> {
  return sameOrigin(context.request) ? openForStaffRead(context) : jsonError('Forbidden', 403);
}

/** As `openForStaff`, for what only the organizer may do; `refusal` tells anyone else so. */
export async function openForOwner(
  context: Context<'code'>,
  refusal = msg('Only the organizer can do that')
): Promise<StaffAccess | Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  return access.role === 'owner' ? access : jsonError(refusal, 403);
}

/** Who asks, as a staff change checks them again where it lands (see roles.ts). */
export const askerOf = (access: StaffAccess): Asker => ({ hash: access.hash, role: access.role });

/**
 * What a staff write that changed nothing answers: the event is gone, or the
 * asker may no longer write (only as organizer, with `ownerRefusal`, when only
 * the organizer may), or else what `otherwise` says.
 */
export async function answerMiss(
  access: StaffAccess,
  otherwise: () => Response | Promise<Response>,
  ownerRefusal?: string
): Promise<Response> {
  const again = await readAgain(access.db, access.row.code, askerOf(access));
  if ('error' in again) {
    return jsonError(again.error, again.status);
  }
  return ownerRefusal && again.asker?.role !== 'owner' ? jsonError(ownerRefusal, 403) : otherwise();
}

/**
 * Writes any of the event's staff may make beside the event, in one
 * transaction, each built on the guard that the asker is still on its staff
 * in whatever role: all of them land or none. Answers 204 when any landed,
 * or when the asker is still on staff and there was simply nothing to
 * change; otherwise why the asker may no longer write.
 */
export async function staffWrites(access: StaffAccess, writes: (guard: Guard) => D1Statement[]): Promise<Response> {
  const guard = askerStands(access.row.code, { hash: access.hash, role: 'staff' });
  const results = await access.db.batch(writes(guard));
  return results.some(result => rowsChanged(result) > 0) ? noContent() : answerMiss(access, noContent);
}

/**
 * Changes the event for its staff asker, trying again from a fresh read as
 * `mutate` does: each try lands only while the asker still holds the role
 * `change` is judged with, read again with the event after a miss.
 */
export const changeEvent = (access: StaffAccess, change: Change): Promise<Mutation> =>
  mutate(access.db, access.row, change, askerOf(access));

/** What anyone may read about the event: what is published to R2, and the base of every API view. */
export function publicViewOf(row: TournamentRow): PublishedView {
  return {
    code: row.code,
    mode: row.mode,
    version: row.version,
    updatedAt: row.updatedAt,
    tournament: publicTournament(row.tournament, row.keys, !isSanctioned(row)),
    pending: publicPending(row.pending, row.keys),
    reports: publicReports(row.reports, row.keys),
    requests: publicRequests(row.requests, row.keys),
    divisions: publicDivisions(row.tournament, row.keys, Date.now()),
    decks: decksVisible(row.settings) ? publicDecks(shownDecks(row), row.keys) : {},
    settings: row.settings
  };
}

const NOT_PLAYING = { me: null, via: null } as const;

type Identity = Pick<Viewer, 'me' | 'via' | 'claim' | 'suggest'>;

/** The account's name as a player's would read, for matching one to the other; null without a last name. */
const accountName = (user: User) =>
  user.lastName ? { firstName: user.firstName ?? '', lastName: user.lastName } : null;

/** Whether the account's name is the player's, case and accents aside. */
function sameName(user: User, player: Pick<Player, 'firstName' | 'lastName'>): boolean {
  const name = accountName(user);
  return name !== null && fullNameKey(name) === fullNameKey(player);
}

/**
 * At a sanctioned event, the player whose POP ID the account holds. Its
 * POP ID, name and birth year all agreeing with the event's list, or the
 * account having proved it is them already (its reporter row, `claimed`),
 * the account is them. A POP ID is no proof on its own, as any account may
 * save one, so anything less is nobody until the player says who they are.
 */
function byPopId(row: TournamentRow, user: User | null, claimed: string | null): Identity {
  const popId = user?.popId ?? '';
  const player = row.tournament.players.find(candidate => candidate.id === popId);
  const key = player && row.keys[popId];
  if (!user || !key) {
    return NOT_PLAYING;
  }
  const year = birthYear(user.birthDate ?? '');
  const claim = { popId, ...(year === null ? {} : { birthYear: String(year) }) };
  const agrees = birthYearFits(player.birthDate, claim.birthYear) && sameName(user, player);
  return agrees || claimed === popId ? { me: key, via: 'pop', claim } : NOT_PLAYING;
}

/**
 * At an unsanctioned event, the one player whose name is near the account's
 * (see lookupPlayers), for the page to ask about. When it is the account's
 * name exactly, saying so claims them; a near miss only looks up their
 * table, since claiming takes the name as the event has it.
 */
function byName(row: TournamentRow, user: User | null): Identity {
  const name = user && accountName(user);
  const found = name?.firstName ? lookupPlayers(row.tournament.players, name) : [];
  const player = found.length === 1 ? found[0] : undefined;
  const key = player && row.keys[player.id];
  if (!name || !player || !key) {
    return NOT_PLAYING;
  }
  const exact = fullNameKey(name) === fullNameKey(player);
  return { ...NOT_PLAYING, suggest: { key, ...(exact ? { claim: name } : {}) } };
}

/**
 * Which player the viewer is, how the page knows, and what the player says
 * to report: at a sanctioned event the one whose POP ID the account holds,
 * at an unsanctioned one the one its Claim names, by their full name. There
 * an account that is no player yet may be offered the one it looks to be.
 */
function identityOf(access: Access): Identity {
  const { row, user, claimed } = access;
  if (isSanctioned(row)) {
    return byPopId(row, user, claimed);
  }
  const player = row.tournament.players.find(candidate => candidate.id === claimed);
  const key = player && row.keys[player.id];
  return key
    ? { me: key, via: 'claim', claim: { lastName: player.lastName, firstName: player.firstName } }
    : byName(row, user);
}

/** What the event's public page reads from the API, shaped for the viewer: staff see decks before the public does. */
export function viewOf(access: Access): TournamentView {
  const { row, user, role } = access;
  const decks = role && decksEnabled(row.settings) ? publicDecks(shownDecks(row), row.keys) : undefined;
  return {
    ...publicViewOf(row),
    ...(decks ? { decks } : {}),
    viewer: { role, ...identityOf(access), signedIn: user !== null }
  };
}

/** Staff get the whole document, pending results and invite token included. */
export function manageView(access: Pick<StaffAccess, 'row' | 'role'>): Manage {
  const { row, role } = access;
  return {
    lastImportAt: row.lastImportAt ?? null,
    code: row.code,
    mode: row.mode,
    version: row.version,
    updatedAt: row.updatedAt,
    tournament: row.tournament,
    pending: row.pending,
    reports: row.reports,
    requests: row.requests,
    settings: row.settings,
    decks: shownDecks(row),
    checkins: row.checkins,
    pairedThrough: row.pairedThrough ?? {},
    role,
    staffToken: role === 'owner' ? row.staffToken : null,
    store: row.storeId
  };
}

/** Event data is shared by link, not for search engines to list. */
export function privateJson(body: unknown, status = 200): Response {
  return jsonResponse(body, { ...PRIVATE, status, headers: { 'X-Robots-Tag': 'noindex' } });
}
