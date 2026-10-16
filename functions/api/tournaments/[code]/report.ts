/**
 * POST /api/tournaments/:code/report — lookup:true returns surname candidates without claiming a seat.
 * Reporting identity still takes exact normalized names, or a Player ID and birth year at sanctioned events.
 * Current identity claims are unverified: all filed results need staff acceptance.
 * { expect } names the public key the page chose: a claim that resolves to anyone else is refused before
 * any seat or account write, so a fuzzy lookup's pick cannot become another player's seat.
 * With { request }, the reporting device asks staff to drop the player or come over (requests.ts).
 * A claim another device holds is refused, so one device is the player at a time.
 * GET returns retained filing evidence to staff; DELETE releases a reporting seat.
 */

import { mayBeUnder13, UNDER_13 } from '../../../../shared/accounts/age.js';
import { birthYear } from '../../../../shared/tournament/divisions.js';
import { lookupPlayers } from '../../../../shared/tournament/lookup.js';
import { findPlayer, type PlayerClaim } from '../../../../shared/tournament/identify.js';
import {
  fileReport,
  PLAYER_RESULTS,
  playerReport,
  type PlayerResult,
  reportableMatch,
  type ShownMatch,
  stillShown
} from '../../../../shared/tournament/reports.js';
import { isRequestKind, TOO_SOON } from '../../../../shared/tournament/requests.js';
import type { PodCategory } from '../../../../shared/tournament/types.js';
import { applyPending, isSanctioned, type TournamentSettings } from '../../../../shared/tournament/view.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { createRateLimiter, rateLimitAddress } from '../../../lib/api/rateLimiter.js';
import { jsonError, noContent } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { type Access, open, openForStaff, privateJson, publicViewOf } from '../../../lib/tournaments/access.js';
import { publishAfter } from '../../../lib/tournaments/publish.js';
import {
  type Asker,
  type Claim,
  claimReporter,
  type Elsewhere,
  releaseReporter
} from '../../../lib/tournaments/reporters.js';
import { reportEvidence } from '../../../lib/tournaments/reportHistory.js';
import { playerRequestChanges } from '../../../lib/tournaments/requests.js';
import { admitTry, clearFailures, LOCKED_OUT } from '../../../lib/tournaments/attempts.js';
import { type Changes, mutate, type TournamentRow } from '../../../lib/tournaments/store.js';
import { msg } from '../../../../shared/i18n.js';

type Body = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 60) : undefined);

function claimOf(body: Body): PlayerClaim {
  return {
    popId: text(body.popId),
    birthYear: text(body.birthYear),
    lastName: text(body.lastName),
    firstName: text(body.firstName)
  };
}

const NOT_REPORTER = msg('Someone else is already reporting for this player. Ask staff if that’s wrong.');

/** The match the player's page showed them, when it said: pod, round and table. */
function shownOf(value: unknown): ShownMatch | undefined {
  const shown = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
  const { pod, round, table } = shown;
  return typeof pod === 'string' && typeof round === 'number' && typeof table === 'number'
    ? { pod: pod as PodCategory, round, table }
    : undefined;
}

interface Filing {
  claim: PlayerClaim;
  result: PlayerResult;
  shown: ShownMatch | undefined;
  device: string;
  account: string | null;
  claimedAt: number;
}

/** The player's report of their open match, or why they cannot report. */
function readReport(row: TournamentRow, filing: Filing) {
  const found = findPlayer(row.tournament, isSanctioned(row), filing.claim);
  if (!found.ok) {
    return found.error;
  }
  const open = reportableMatch(applyPending(row.tournament, row.pending), found.id);
  if (typeof open === 'string') {
    return open;
  }
  return stillShown(open, filing.shown)
    ? playerReport(open, found.id, filing.result, { at: Date.now(), device: filing.device })
    : msg('Your pairing has changed; check your table');
}

/** Why players cannot report here, or null when they can. */
function closedToReports(settings: TournamentSettings): string | null {
  if (!settings.playerReporting) {
    return msg('Results at this event are reported to staff');
  }
  return settings.finished ? msg('This event is over') : null;
}

/** A report waiting for staff, rechecked against the event on each mutation attempt. */
function reportChanges(row: TournamentRow, filing: Filing): Changes | string {
  const closed = closedToReports(row.settings);
  if (closed) {
    return closed;
  }
  const report = readReport(row, filing);
  const reports = typeof report === 'string' ? report : fileReport(row.reports, report);
  return typeof reports === 'string' || typeof report === 'string'
    ? String(reports)
    : {
        reports,
        reportEvidence: { report, account: filing.account, claimedAt: filing.claimedAt }
      };
}

/**
 * A room of players shares the venue's address, and each says who they are,
 * reports and asks again a few times a round, most of it in the minutes a
 * round ends; this stops a script, not a busy event. It matches the event
 * page's own limit.
 */
const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 1200 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

/** The event, when this request may ask of it; the refusal when it may not. */
async function reachable(context: Context<'code'>): Promise<Access | Response> {
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  if (!rateLimiter.check(rateLimitAddress(context.request)).allowed) {
    return jsonError('Too many reports from here. Try again shortly.', 429);
  }
  return open(context);
}

/** Who the request asks as: its device's token and ID, and who is signed in (see accountFor). */
const askerOf = (access: Access, body: Body): Asker => ({
  held: body.reportToken,
  device: body.device,
  user: access.user
});

/** The asker's standing for player `id`, or the answer that refuses them: linked elsewhere, or no standing to be had. */
async function standingIn(access: Access, body: Body, id: string): Promise<Claim | Response> {
  const standing = await claimReporter(access.db, access.row, id, askerOf(access, body));
  if ('elsewhere' in standing) {
    return linkedElsewhere(access.row, standing);
  }
  return 'error' in standing ? jsonError(standing.error, standing.status) : standing;
}

/** The refusal for an account that is already another player here, naming that player by their public key. */
const linkedElsewhere = (row: TournamentRow, standing: Elsewhere) =>
  privateJson({ error: 'You’re linked to another player here', linkedKey: row.keys[standing.elsewhere] ?? null }, 409);

/**
 * What the answer says of the asker: the token when its device just claimed
 * the player, whether it reports, and whether the player is its account's.
 */
const standingOf = (claim: Claim) => ({
  reporter: claim.reporter,
  linked: claim.linked,
  ...(claim.token ? { reportToken: claim.token } : {})
});

/** Files the report, from the device that reports for the player, and publishes what it changed. */
async function report(context: Context<'code'>, access: Access, body: Body, who: { claim: PlayerClaim; id: string }) {
  const result = body.result as PlayerResult;
  if (!PLAYER_RESULTS.includes(result)) {
    return jsonError('Not a result', 400);
  }
  const { db, row } = access;
  const standing = await standingIn(access, body, who.id);
  if (standing instanceof Response) {
    return standing;
  }
  if (!standing.reporter) {
    return jsonError(NOT_REPORTER, 403);
  }
  const filing = {
    claim: who.claim,
    result,
    shown: shownOf(body.match),
    device: standing.device ?? '',
    account: standing.account,
    claimedAt: standing.claimedAt
  };
  const outcome = await mutate(db, row, r => reportChanges(r, filing));
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishAfter(context, outcome.row);
  return privateJson({
    key: outcome.row.keys[who.id] ?? null,
    view: publicViewOf(outcome.row),
    ...standingOf(standing)
  });
}

/**
 * The player asks staff for something ({ request: 'drop' or 'staff' }) or
 * cancels an open request ({ cancel: true }), from the device that
 * reports for them, so nobody else can ask on their behalf.
 */
async function ask(context: Context<'code'>, access: Access, body: Body, id: string) {
  const kind = body.request;
  if (!isRequestKind(kind)) {
    return jsonError('Not a request', 400);
  }
  const standing = await standingIn(access, body, id);
  if (standing instanceof Response) {
    return standing;
  }
  if (!standing.reporter) {
    return jsonError(NOT_REPORTER, 403);
  }
  const request = { id: crypto.randomUUID(), player: id, kind, cancel: body.cancel === true, at: Date.now() };
  const outcome = await mutate(access.db, access.row, row => playerRequestChanges(row, request));
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.error === TOO_SOON ? 429 : outcome.status);
  }
  // Asking again for what already stands writes nothing, so there is nothing new to publish.
  if (outcome.row.version !== access.row.version) {
    await publishAfter(context, outcome.row);
  }
  return privateJson({ key: outcome.row.keys[id] ?? null, view: publicViewOf(outcome.row), ...standingOf(standing) });
}

const CLAIMED = msg('Another device already claimed this player. Ask staff if that’s wrong.');

/**
 * Exact reporting identity and seat ownership, independent of fuzzy table
 * lookup. One device is the player at a time: another that says it is them
 * is refused, short of being the account the player is, until staff release
 * the player. It can still look up their table.
 */
async function identify(access: Access, body: Body, id: string) {
  const standing = await standingIn(access, body, id);
  if (standing instanceof Response) {
    return standing;
  }
  if (!standing.reporter) {
    return jsonError(CLAIMED, 409);
  }
  const { row } = access;
  return privateJson({ key: row.keys[id] ?? null, view: publicViewOf(row), ...standingOf(standing) });
}

/** Staff let another device claim a player ({ player }, their Player ID or the event's own ID for them). */
export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const player = new URL(context.request.url).searchParams.get('player') ?? '';
  if (!access.row.tournament.players.some(p => p.id === player)) {
    return jsonError('No such player', 404);
  }
  await releaseReporter(access.db, access.row.code, player);
  // Staff vouch for the player, so their Player ID's wrong birth years are forgiven too.
  await clearFailures(access.db, access.row.code, player);
  return noContent();
}

/** At a sanctioned event, the Player ID asked about when it is on the event's list: the one a wrong year counts against. */
function listedPopId(row: TournamentRow, claim: PlayerClaim): string | null {
  const popId = claim.popId?.trim() ?? '';
  return isSanctioned(row) && row.tournament.players.some(player => player.id === popId) ? popId : null;
}

const NOT_EXPECTED = msg('That isn’t the player this page chose');

/**
 * The player the claim names, or the refusal: no such player, or a Player ID
 * refused for too many wrong birth years (see lib/tournaments/attempts.ts),
 * which a wrong year here counts toward.
 */
async function checkedClaim(access: Access, claim: PlayerClaim, expect: unknown): Promise<{ id: string } | Response> {
  const { db, row } = access;
  const found = findPlayer(row.tournament, isSanctioned(row), claim);
  if (found.ok && under13(row, found.id)) {
    return jsonError(UNDER_13, 403);
  }
  // Judged first, then let in or refused by one statement, so tries landing at once are taken one at a time.
  const popId = listedPopId(row, claim);
  if (popId && !(await admitTry({ db, code: row.code, popId, right: found.ok, now: Date.now() }))) {
    return jsonError(LOCKED_OUT, 429);
  }
  if (!found.ok) {
    return privateJson({ error: found.error, ambiguous: found.ambiguous === true }, 404);
  }
  if (expect !== undefined && row.keys[found.id] !== expect) {
    return jsonError(NOT_EXPECTED, 404);
  }
  return found;
}

/** Whether the event's list says the player may be under 13, who hands the site nothing (shared/accounts/age.ts). */
function under13(row: TournamentRow, id: string): boolean {
  const player = row.tournament.players.find(candidate => candidate.id === id);
  return isSanctioned(row) && mayBeUnder13(birthYear(player?.birthDate ?? ''), new Date());
}

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  const access = await reachable(context);
  if (access instanceof Response) {
    return access;
  }
  const body: Body = (await readJsonObject(context.request, 1024)) ?? {};
  const refusal = body.result === undefined ? null : closedToReports(access.row.settings);
  if (refusal) {
    return jsonError(refusal, 403);
  }
  if (body.lookup === true) {
    return lookup(access, body);
  }
  const claim = claimOf(body);
  const found = await checkedClaim(access, claim, body.expect);
  if (found instanceof Response) {
    return found;
  }
  if (body.request !== undefined) {
    return ask(context, access, body, found.id);
  }
  return body.result === undefined
    ? identify(access, body, found.id)
    : report(context, access, body, { claim, id: found.id });
}

/** Staff retain the original claims and filed reports for later review, even after a result is accepted. */
export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  return access instanceof Response
    ? access
    : privateJson({ history: await reportEvidence(access.db, access.row.code) });
}

/** Read-only table lookup: no seat, token, account link, or identity-attempt side effects. */
function lookup(access: Access, body: Body): Response {
  if (body.result !== undefined) {
    return jsonError('Confirm your reporting identity first', 400);
  }
  const { row } = access;
  const view = publicViewOf(row);
  // Names as the event publishes them: a near miss must not reveal a surname the public page shortens.
  const published = new Map(view.tournament.players.map(player => [player.id, player]));
  const candidates = lookupPlayers(row.tournament.players, {
    lastName: text(body.lastName) ?? '',
    firstName: text(body.firstName)
  }).map(player => {
    const key = row.keys[player.id] ?? '';
    const shown = published.get(key);
    return { key, firstName: shown?.firstName ?? '', lastName: shown?.lastName ?? '' };
  });
  return privateJson({ candidates, view });
}
