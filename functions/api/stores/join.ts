/**
 * GET /api/stores/join?invite= — what an open invite link is for, before
 * anyone signs in: { store, role }, the store's name and as what it lets
 * someone in; 410 when the link was used, withdrawn or ran out.
 * POST /api/stores/join — the signed-in account joins a store through an
 * invite link a Manager made ({ token }). Each link lets one person in, as
 * the role it was made for. Answers { storeId }; 410 when the link was used,
 * withdrawn or ran out.
 */

import { readJsonObject } from '../../lib/api/body.js';
import { jsonError } from '../../lib/api/responses.js';
import type { Context } from '../../lib/auth/env.js';
import { signedIn } from '../../lib/auth/session.js';
import { acceptInvite, inviteOf } from '../../lib/stores/db.js';
import { privateJson } from '../../lib/tournaments/access.js';

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Stores are not available', 503);
  }
  const token = new URL(request.url).searchParams.get('invite') ?? '';
  const invite = token && token.length <= 64 ? await inviteOf(db, token) : null;
  return invite ? privateJson(invite) : jsonError('This invite link was used or has run out', 410);
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const opened = await signedIn({ request, env });
  if (opened instanceof Response) {
    return opened;
  }
  const { db, user } = opened;
  const token = (await readJsonObject(request, 512))?.token;
  const storeId = typeof token === 'string' && token ? await acceptInvite(db, token, user.id) : null;
  return storeId ? privateJson({ storeId }) : jsonError('This invite link was used or has run out', 410);
}
