/**
 * GET /api/tournaments/:code — the event's public page data: pairings,
 * standings and who the viewer is in it. `?since=<version>` answers 204 when
 * nothing has changed, which is what the page polls with. A room of players
 * shares one address, so the limit is generous: it is there to make walking
 * the code space for events slow, not to slow a venue.
 * DELETE /api/tournaments/:code — the owner removes the event.
 */

import { createRateLimiter, rateLimitAddress } from '../../../lib/api/rateLimiter.js';
import { coalescedRead } from '../../../../shared/coalesce.js';
import { type JsonRepresentation, jsonRepresentation, revalidatedJson } from '../../../lib/api/revalidation.js';
import { jsonError, noContent } from '../../../lib/api/responses.js';
import { readCookie, SESSION_COOKIE } from '../../../lib/auth/cookies.js';
import type { Context } from '../../../lib/auth/env.js';
import { askerOf, codeOf, open, openForOwner, pollOf, viewOf } from '../../../lib/tournaments/access.js';
import { unpublishView } from '../../../lib/tournaments/publish.js';
import { deleteTournament, loadVersion } from '../../../lib/tournaments/store.js';
import { msg } from '../../../../shared/i18n.js';

/** A refusal as data: a Response belongs to the request that made it, so a shared read cannot hand one on. */
interface Refusal {
  status: number;
  headers: [string, string][];
  body: string;
}

const readVersion = coalescedRead<number | null>();
const readView = coalescedRead<JsonRepresentation | Refusal>();

async function unchanged(context: Context<'code'>): Promise<boolean> {
  if (context.request.headers.has('If-None-Match')) {
    return false;
  }
  const poll = pollOf(context);
  return poll !== null && (await readVersion(poll.db, poll.code, () => loadVersion(poll.db, poll.code))) === poll.since;
}

async function representationOf(context: Context<'code'>): Promise<JsonRepresentation | Refusal> {
  const access = await open(context, { claim: true });
  if (access instanceof Response) {
    return { status: access.status, headers: [...access.headers], body: await access.text() };
  }
  return jsonRepresentation(viewOf(access));
}

const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 1200 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  // An unchanged answer needs a real code and its current version, so it walks nothing: a venue's polls go free.
  if (await unchanged(context)) {
    return noContent();
  }
  if (!rateLimiter.check(rateLimitAddress(context.request)).allowed) {
    return jsonError('Too many requests from here. Try again shortly.', 429);
  }
  const db = context.env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Tournaments are not available', 503);
  }
  const key = JSON.stringify([codeOf(context), readCookie(context.request, SESSION_COOKIE)]);
  const view = await readView(db, key, () => representationOf(context));
  return 'status' in view
    ? new Response(view.body, { status: view.status, headers: view.headers })
    : revalidatedJson(context.request, view);
}

export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  const refusal = msg('Only the organizer can delete the event');
  const access = await openForOwner(context, refusal);
  if (access instanceof Response) {
    return access;
  }
  const refused = await deleteTournament(access.db, access.row, askerOf(access), refusal);
  if (refused) {
    return jsonError(refused.error, refused.status);
  }
  await unpublishView(context.env.EVENTS_DATA, access.row.code);
  return noContent();
}
