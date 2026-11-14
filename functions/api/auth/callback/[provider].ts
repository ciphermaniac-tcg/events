/**
 * GET /api/auth/callback/:provider — where Google or Discord sends the browser
 * back. The `state` must match the cookie set when sign-in started; then the
 * code is exchanged and the account found, or a provider added to the
 * signed-in one. A sign-in with no account behind it yet (or one made before
 * accounts asked a birth date) makes none here: it waits for the age check at
 * /welcome (see lib/auth/signup.ts). A sign-in the native app started in the
 * system browser ends in neither here: the browser hands the app a ticket
 * for it instead (lib/auth/appTicket.ts).
 */

import { type AppStart, mintTicket, readAppStart, returnToApp } from '../../../lib/auth/appTicket.js';
import { clearCookie, OAUTH_COOKIE, readCookie, redirectWithCookies, safeNext } from '../../../lib/auth/cookies.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { finishSignIn, type Started } from '../../../lib/auth/finish.js';
import { exchangeCode, isRedirectProvider, type Profile } from '../../../lib/auth/oauth.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { D1Like } from '../../../lib/types.js';

/** How the login started, when the callback's state matches it; `app` when the app started it. */
type StartedHere = Started & { app: AppStart | null };

/** The `next` path the login started with, when the callback's state matches it. */
function startedHere(request: Request, state: string | null): StartedHere | null {
  const [expected, next, intent, challenge, attempt, binding] = (readCookie(request, OAUTH_COOKIE) ?? '').split(' ');
  if (!state || !expected || state !== expected) {
    return null;
  }
  return { next: safeNext(next ?? null), linking: intent === 'link', app: readAppStart(challenge, attempt, binding) };
}

/** Ends the sign-in here, or for the app: a ticket the browser hands it. */
async function finish(db: D1Like, request: Request, profile: Profile, started: StartedHere): Promise<Response> {
  const { app, ...rest } = started;
  const cookies = [clearCookie(request, OAUTH_COOKIE)];
  if (!app) {
    return finishSignIn(db, request, profile, { ...rest, cookies });
  }
  const ticket = await mintTicket(db, { profile, ...rest, binding: app.binding }, app.challenge);
  return returnToApp(ticket, app.attempt, cookies);
}

export async function onRequestGet({ request, env, params }: Context<'provider'>): Promise<Response> {
  const provider = param(params.provider);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const started = startedHere(request, url.searchParams.get('state'));
  if (!env.TOURNAMENT_DB) {
    return jsonError('Sign-in is not available', 503);
  }
  if (!isRedirectProvider(provider) || provider === 'dev' || !code || !started) {
    return redirectWithCookies('/settings?signin=failed', [clearCookie(request, OAUTH_COOKIE)]);
  }
  try {
    const profile = await exchangeCode({ env, request, provider, code });
    return await finish(env.TOURNAMENT_DB, request, profile, started);
  } catch (error) {
    console.error('Sign-in failed', error instanceof Error ? error.message : 'Unknown error');
    return redirectWithCookies('/settings?signin=failed', [clearCookie(request, OAUTH_COOKIE)]);
  }
}
