/**
 * POST /api/auth/reset — asks for a password reset code (lib/auth/passwordReset.ts).
 * The body is `{ identifier }`, a username or email. Every request this site
 * makes answers alike, 202 and a `cm_reset` cookie, whether the username or
 * email names anyone, and before Clerk is asked: a code is emailed after the
 * answer, only to an account with a verified email.
 */

import { jsonResponse } from '../../../lib/api/responses.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { rateLimitAddress } from '../../../lib/api/rateLimiter.js';
import { cookie } from '../../../lib/auth/cookies.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { reserve, RESET_COOKIE, RESET_SECONDS, resetSetup, startReset } from '../../../lib/auth/passwordReset.js';
import { sha256 } from '../../../lib/auth/session.js';
import { msg } from '../../../../shared/i18n.js';

const problem = (status: number, code: string, error: string) =>
  jsonResponse({ error, code }, { status, cacheControl: 'no-store', cors: false });

/** A username or email as typed, or null when it can be neither. */
function identifierOf(body: Record<string, unknown> | null): string | null {
  const value = typeof body?.identifier === 'string' ? body.identifier.trim() : '';
  return value.length > 0 && value.length <= 254 ? value : null;
}

export async function onRequestPost({ request, env, waitUntil }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  const setup = resetSetup(env);
  if (!db || !setup) {
    return problem(503, 'reset_unavailable', msg('Password reset is currently not available.'));
  }
  if (!sameOrigin(request)) {
    return problem(403, 'forbidden', 'Forbidden');
  }
  // Per address, kept in D1 by its hash: the same everywhere the site runs, and saying nothing of any account.
  if (!(await reserve(db, 'address', await sha256(rateLimitAddress(request))))) {
    return problem(429, 'too_many_requests', msg("You've hit our rate limits for resets. Please try again later."));
  }
  const identifier = identifierOf(await readJsonObject(request, 1024));
  if (!identifier) {
    return problem(400, 'form_param_missing', msg('Enter a username or email'));
  }
  const { token, work } = await startReset(db, setup, identifier);
  if (waitUntil) {
    waitUntil(work);
  } else {
    await work;
  }
  return jsonResponse(
    { sent: true },
    {
      status: 202,
      cacheControl: 'no-store',
      cors: false,
      headers: { 'Set-Cookie': cookie(request, RESET_COOKIE, token, RESET_SECONDS) }
    }
  );
}
