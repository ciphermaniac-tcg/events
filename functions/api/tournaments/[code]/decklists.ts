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

import { isAdmin } from '../../../../shared/accounts/roles.js';
import { MAX_DECKLIST_CHARS } from '../../../../shared/tournament/decklist.js';
import { yearOnlyBirthDate } from '../../../../shared/tournament/divisions.js';
import { isPopId, readProfile } from '../../../../shared/tournament/profile.js';
import { decklistsOpen, type DeckMode, isSanctioned } from '../../../../shared/tournament/view.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { createRateLimiter, rateLimitAddress } from '../../../lib/api/rateLimiter.js';
import { jsonError } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { type Access, codeOf, open, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { deckMode, type Details, everyList, playerAnswer } from '../../../lib/tournaments/decklists.js';
import { notTaking, register, type Submission, unlock, withdraw } from '../../../lib/tournaments/listWrites.js';
import { msg } from '../../../../shared/i18n.js';

/** The longest name a lookup takes, matching what a stored roster may hold (shared/tournament/validate.ts). */
const MAX_LOOKUP_NAME = 200;

/**
 * The details a player gave in a query string, when they say whose
 * registration it is, or the refusal for names too long to be any player's.
 */
function detailsFrom(request: Request, sanctioned: boolean): Details | Response | null {
  const query = new URL(request.url).searchParams;
  const details = {
    popId: query.get('popId') ?? '',
    firstName: query.get('firstName') ?? '',
    lastName: query.get('lastName') ?? ''
  };
  if (details.firstName.length > MAX_LOOKUP_NAME || details.lastName.length > MAX_LOOKUP_NAME) {
    return jsonError(msg('Check the player’s name'), 400);
  }
  const complete = sanctioned ? isPopId(details.popId) : Boolean(details.firstName && details.lastName);
  return complete ? details : null;
}

/**
 * Sanctioned Player ID lookups share a room-sized allowance per event and
 * address, signed in or not: an account costs nothing to make.
 */
const profileLookupLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 300 });

/**
 * Name lookups at an unsanctioned event say who is named like the asker, so
 * every asker spends from them, signed in or not. A venue's players share
 * one address and look themselves up as they register, so the allowance per
 * event and address matches the report and event pages' own.
 */
const nameLookupLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 1200 });

/** The allowance a player's lookup spends from, if any. */
function lookupAllowance(access: Access, request: Request) {
  const query = new URL(request.url).searchParams;
  if (!isSanctioned(access.row)) {
    return query.get('firstName') && query.get('lastName') ? nameLookupLimiter : null;
  }
  return isPopId(query.get('popId') ?? '') ? profileLookupLimiter : null;
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await open(context, { claim: true });
  if (access instanceof Response) {
    return access;
  }
  if (access.role || (access.user && isAdmin(access.user.role))) {
    return privateJson({ decklists: await everyList(access), mine: null });
  }
  const allowance = lookupAllowance(access, context.request);
  if (allowance && !allowance.allows(`${access.row.code}:${rateLimitAddress(context.request)}`)) {
    return jsonError(msg('Too many requests from here. Try again shortly.'), 429);
  }
  const details = detailsFrom(context.request, isSanctioned(access.row));
  if (details instanceof Response) {
    return details;
  }
  const answer = await playerAnswer(access, context.request, details);
  return answer instanceof Response ? answer : privateJson({ decklists: [], ...answer });
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
  // A player names no archetype: their list's cards do (see register in lib/tournaments/listWrites.ts).
  return {
    profile,
    ...list,
    archetype: null,
    was: readWas(value.was, sanctioned),
    wasYear: sanctioned && typeof value.wasYear === 'string' && /^\d{4}$/.test(value.wasYear) ? value.wasYear : null,
    held: value.token,
    localTime: value.localTime
  };
}

/**
 * A whole field can send its lists from one venue's Wi-Fi, so the limit is
 * counted per event and sized for a room: 150 submissions per address per
 * event per ten minutes, with a looser cap across every event so one address
 * cannot flood many.
 */
const eventLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 150 });
const addressLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 400 });

function limited(context: Context<'code'>): boolean {
  const address = rateLimitAddress(context.request);
  const code = codeOf(context);
  return !(addressLimiter.allows(address) && eventLimiter.allows(`${code}:${address}`));
}

/** The request's event, when it may be written to by a player now, or why not. */
async function openForPlayer(context: Context<'code'>): Promise<Access | Response> {
  if (limited(context)) {
    return jsonError('Too many submissions. Try again later.', 429);
  }
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  return open(context, { claim: true });
}

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForPlayer(context);
  if (access instanceof Response) {
    return access;
  }
  const read = await readSubmission(context.request, isSanctioned(access.row));
  if (typeof read === 'string') {
    return decklistsOpen(access.row) ? jsonError(read, 400) : notTaking(access.row);
  }
  return register(context, access, read);
}

export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  const access = await openForPlayer(context);
  if (access instanceof Response) {
    return access;
  }
  // A late entrant's window is for sending a list, not for leaving the event: withdrawing ends with round 1.
  if (!decklistsOpen(access.row)) {
    return notTaking(access.row);
  }
  const details = detailsFrom(context.request, isSanctioned(access.row));
  if (details instanceof Response) {
    return details;
  }
  if (!details) {
    return jsonError('Say whose registration to withdraw', 400);
  }
  return withdraw(context, access, details);
}

/** Staff unlock a list, so the next submission under its details takes it over from whichever device sent it. */
export async function onRequestPatch(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const details = detailsFrom(context.request, isSanctioned(access.row));
  if (details instanceof Response) {
    return details;
  }
  if (!details) {
    return jsonError('Say whose list to unlock', 400);
  }
  return unlock(access, details);
}
