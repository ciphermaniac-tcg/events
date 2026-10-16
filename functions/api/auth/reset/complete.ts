/**
 * POST /api/auth/reset/complete — the code from a reset email and the new
 * password (lib/auth/passwordReset.ts), for the request in the `cm_reset`
 * cookie. Body `{ code, password }`. Answers `{ ok: true }` once the password
 * is set, after which the page signs in with it; otherwise `{ error, code }`
 * with the code the page reads as words. A wrong code, and any code for a
 * request that named no one, answer alike.
 */

import { jsonResponse } from '../../../lib/api/responses.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { clearCookie, readCookie } from '../../../lib/auth/cookies.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { completeReset, RESET_COOKIE, resetSetup } from '../../../lib/auth/passwordReset.js';
import { msg } from '../../../../shared/i18n.js';

const answer = (status: number, body: unknown, headers?: Record<string, string>) =>
  jsonResponse(body, { status, cacheControl: 'no-store', cors: false, headers });

const text = (body: Record<string, unknown> | null, key: string) => (typeof body?.[key] === 'string' ? body[key] : '');

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  const setup = resetSetup(env);
  if (!db || !setup) {
    return answer(503, { error: msg('Password reset is currently not available.'), code: 'reset_unavailable' });
  }
  if (!sameOrigin(request)) {
    return answer(403, { error: 'Forbidden', code: 'forbidden' });
  }
  const body = await readJsonObject(request, 1024);
  const token = readCookie(request, RESET_COOKIE) ?? '';
  const submitted = { token, code: text(body, 'code').trim(), password: text(body, 'password') };
  const outcome = token ? await completeReset(db, setup, submitted) : null;
  if (outcome?.ok) {
    return answer(200, { ok: true }, { 'Set-Cookie': clearCookie(request, RESET_COOKIE) });
  }
  return answer(outcome?.status ?? 410, {
    error: msg('Password not reset'),
    code: outcome?.code ?? 'verification_expired'
  });
}
