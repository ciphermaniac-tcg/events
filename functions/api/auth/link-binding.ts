/**
 * POST /api/auth/link-binding { challenge } — the binding of a link the
 * native app is about to start in the system browser to the session asking
 * (lib/auth/appTicket.ts). A page of the site in the app's webview asks, so
 * the post must come from this site and be signed in; the binding is an
 * HMAC of the challenge keyed by the session's hash, which stays here.
 */

import { readJsonObject } from '../../lib/api/body.js';
import { jsonError, jsonResponse, PRIVATE } from '../../lib/api/responses.js';
import { isChallenge, linkBinding } from '../../lib/auth/appTicket.js';
import type { Context } from '../../lib/auth/env.js';
import { sessionHash, signedIn } from '../../lib/auth/session.js';

export async function onRequestPost(context: Context): Promise<Response> {
  const opened = await signedIn(context);
  if (opened instanceof Response) {
    return opened;
  }
  const challenge = (await readJsonObject(context.request, 256))?.challenge;
  const session = await sessionHash(context.request);
  if (!isChallenge(challenge) || !session) {
    return jsonError('The app sent no challenge', 400);
  }
  return jsonResponse({ binding: await linkBinding(session, challenge) }, PRIVATE);
}
