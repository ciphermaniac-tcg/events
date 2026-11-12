/**
 * POST /api/auth/age — the age check a new sign-up waits on (see
 * lib/auth/signup.ts): { birthDate: 'YYYY-MM-DD', handle?, firstName?,
 * lastName? } with the cookie the callback set. 16 or older makes the
 * account, keeping the birth year and nothing finer, with the username and
 * name given (a username someone holds is refused, 409, before the wait is
 * used), starts a session and answers where to go ({ next }).
 * Younger makes nothing and deletes what the provider sent (403, { minor:
 * true }). A date that is no date is refused without using the wait up; a
 * wait that is gone or ran out asks for sign-in again (410).
 */

import { birthYearOfDate, oldEnoughForAccount } from '../../../shared/accounts/age.js';
import { RENAME_REFUSED } from '../../lib/accounts/handles.js';
import { handleFree, readSetup } from '../../lib/accounts/setup.js';
import { birthDateOfYear } from '../../../shared/tournament/divisions.js';
import { readJsonObject } from '../../lib/api/body.js';
import { jsonError } from '../../lib/api/responses.js';
import { clearCookie, cookie, readCookie, safeNext, SESSION_COOKIE, SIGNUP_COOKIE } from '../../lib/auth/cookies.js';
import { type Context, sameOrigin } from '../../lib/auth/env.js';
import {
  type AccountSetup,
  createSession,
  proofOf,
  SESSION_SECONDS,
  StaleSignIn,
  upsertUser
} from '../../lib/auth/session.js';
import type { D1Like } from '../../lib/types.js';
import { rejectSignup } from '../../lib/auth/rejection.js';
import { takeSignup } from '../../lib/auth/signup.js';
import { msg } from '../../../shared/i18n.js';

/** What someone too young is told; nothing about them was kept. */
export const TOO_YOUNG = msg('Ciphermaniac accounts are for people 16 and older. You can still register for events without one.');

function answer(status: number, body: unknown, cookies: readonly string[]): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const value of cookies) {
    headers.append('Set-Cookie', value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * The username and name the form gave, or why they can't be kept, answered
 * before the wait is used up so the person can change them and try again.
 */
async function askedSetup(db: D1Like, body: Record<string, unknown>, now: number): Promise<AccountSetup | Response> {
  const setup = readSetup(body);
  if (typeof setup === 'string') {
    return jsonError(setup, 400);
  }
  if (setup.handle && !(await handleFree(db, setup.handle, null, now))) {
    return jsonError(RENAME_REFUSED.taken.error, RENAME_REFUSED.taken.status);
  }
  return setup;
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const token = readCookie(request, SIGNUP_COOKIE);
  const body = (await readJsonObject(request, 512)) ?? {};
  const birthDate = typeof body.birthDate === 'string' ? body.birthDate : '';
  const now = new Date();
  const year = birthYearOfDate(birthDate, now);
  if (year === null) {
    return jsonError('Enter your birth date', 400);
  }
  const setup = await askedSetup(db, body, now.getTime());
  if (setup instanceof Response) {
    return setup;
  }
  const held = token ? await takeSignup(db, token, now.getTime()) : null;
  const cleared = clearCookie(request, SIGNUP_COOKIE);
  if (!held) {
    return answer(410, { error: msg('Please sign in again to continue.') }, [cleared]);
  }
  if (!oldEnoughForAccount(birthDate, now)) {
    await rejectSignup(db, held.profile, env.PROOFS);
    return answer(403, { error: TOO_YOUNG, minor: true }, [cleared]);
  }
  const userId = await upsertUser(db, held.profile, birthDateOfYear(year), setup);
  const session = await createSession(db, userId, proofOf(held.profile)).catch((error: unknown) => {
    if (error instanceof StaleSignIn) {
      return null;
    }
    throw error;
  });
  if (!session) {
    // The password changed while the age check waited: the sign-in it held is spent.
    return answer(410, { error: msg('Please sign in again to continue.') }, [cleared]);
  }
  return answer(200, { next: safeNext(held.next) }, [
    cleared,
    cookie(request, SESSION_COOKIE, session, SESSION_SECONDS)
  ]);
}
