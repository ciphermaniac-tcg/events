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
import { publicReports } from '../../../shared/tournament/reports.js';
import { publicRequests } from '../../../shared/tournament/requests.js';
import { jsonError, jsonResponse } from '../api/responses.js';
import { type Context, param, sameOrigin } from '../auth/env.js';
import type { D1Like } from '../types.js';
import type { Asker } from './roles.js';
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
  refusal = 'Only the organizer can do that'
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
    decks: decksVisible(row.settings) ? publicDecks(row.decks, row.keys) : {},
    settings: row.settings
  };
}

const NOT_PLAYING = { me: null, via: null } as const;

/**
 * Which player the viewer is, how the page knows, and what the player says
 * to report: at a sanctioned event the one whose POP ID the account holds,
 * at an unsanctioned one the one its Claim names, by their full name.
 */
function identityOf(access: Access): Pick<Viewer, 'me' | 'via' | 'claim'> {
  const { row, user, claimed } = access;
  if (isSanctioned(row)) {
    const popId = user?.popId ?? '';
    const listed = row.tournament.players.some(player => player.id === popId);
    const year = birthYear(user?.birthDate ?? '');
    const claim = { popId, ...(year === null ? {} : { birthYear: String(year) }) };
    return listed ? { me: row.keys[popId] ?? null, via: 'pop', claim } : NOT_PLAYING;
  }
  const player = row.tournament.players.find(candidate => candidate.id === claimed);
  const key = player && row.keys[player.id];
  return key
    ? { me: key, via: 'claim', claim: { lastName: player.lastName, firstName: player.firstName } }
    : NOT_PLAYING;
}

/** What the event's public page reads from the API, shaped for the viewer: staff see decks before the public does. */
export function viewOf(access: Access): TournamentView {
  const { row, user, role } = access;
  const decks = role && decksEnabled(row.settings) ? publicDecks(row.decks, row.keys) : undefined;
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
    decks: row.decks,
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
