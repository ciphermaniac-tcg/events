/**
 * POST /api/auth/redeem — the native app's webview finishing a sign-in that
 * ran in the system browser (lib/auth/appTicket.ts). The app posts the
 * ticket and its verifier as a form from a page of this site. The ticket
 * works once, within its minute, and only with the verifier its challenge
 * came from, and a link only from the session that asked for it; then the
 * sign-in ends as any other does, into this webview's cookies: a session,
 * the age check, or a link to its account.
 *
 * The post must carry this site's Origin. A ticket and verifier are both
 * known to whoever started the sign-in, so another site posting its own
 * would sign the visitor into its account, or link its identity to the
 * visitor's; it is sent where any failed sign-in goes, having used nothing.
 */

import { redeemTicket } from '../../lib/auth/appTicket.js';
import { redirectWithCookies } from '../../lib/auth/cookies.js';
import type { Context } from '../../lib/auth/env.js';
import { finishSignIn } from '../../lib/auth/finish.js';
import { sessionHash } from '../../lib/auth/session.js';
import { jsonError } from '../../lib/api/responses.js';

const failed = () => redirectWithCookies('/settings?signin=failed', []);

async function readForm(request: Request): Promise<{ ticket: string; verifier: string }> {
  const form = await request.formData().catch(() => new FormData());
  const value = (name: string) => {
    const entry = form.get(name);
    return typeof entry === 'string' ? entry : '';
  };
  return { ticket: value('ticket'), verifier: value('verifier') };
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Sign-in is not available', 503);
  }
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    console.warn('App sign-in refused: Origin is not this site');
    return failed();
  }
  const { ticket, verifier } = await readForm(request);
  const session = await sessionHash(request);
  const signIn = ticket && verifier ? await redeemTicket(db, { ticket, verifier, session }) : null;
  return signIn ? finishSignIn(db, request, signIn.profile, signIn) : failed();
}
