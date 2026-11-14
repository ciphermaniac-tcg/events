/**
 * GET /api/auth/login/:provider?next=/path — starts sign-in.
 *
 * Google and Discord redirect to the provider with a fresh `state`, which is
 * also set in a ten-minute cookie alongside where to return afterwards. The
 * dev provider (local only, see lib/auth/oauth.ts) signs in straight away as
 * `?name=`, born on `?birth=` (YYYY-MM-DD; a grown-up's date when absent, and
 * refused when it is too young for an account), or with `?gate=1` waits at the age check as
 * a provider's new sign-up does.
 *
 * With `app=1&challenge=&attempt=` the native app has opened this in the
 * system browser (lib/auth/appTicket.ts): both ride along in the state
 * cookie. A link from the app also needs `binding=`, its binding to the
 * app's session, as the browser holds no session of the app's; the redeem
 * checks it.
 */

import { birthYearOfDate, oldEnoughForAccount } from '../../../../shared/accounts/age.js';
import { birthDateOfYear } from '../../../../shared/tournament/divisions.js';
import {
  cookie,
  OAUTH_COOKIE,
  redirectWithCookies,
  safeNext,
  SESSION_COOKIE,
  SIGNUP_COOKIE
} from '../../../lib/auth/cookies.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { type AppStart, readAppStart } from '../../../lib/auth/appTicket.js';
import { authorizeUrl, devLoginEnabled, devProfile, isRedirectProvider } from '../../../lib/auth/oauth.js';
import { createSession, currentUser, randomToken, SESSION_SECONDS, upsertUser } from '../../../lib/auth/session.js';
import { holdSignup, SIGNUP_SECONDS } from '../../../lib/auth/signup.js';
import { jsonError } from '../../../lib/api/responses.js';

const STATE_SECONDS = 10 * 60;

/** A dev account's birth date when the sign-in names none: a grown-up's. */
const DEV_BIRTH = '1990-01-01';

async function devSignIn({ request, env }: Context<'provider'>, next: string): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!devLoginEnabled(env) || !db) {
    return jsonError('Not found', 404);
  }
  const query = new URL(request.url).searchParams;
  const profile = devProfile(query.get('name') ?? '');
  if (query.get('gate') === '1') {
    const token = await holdSignup(db, profile, next);
    return redirectWithCookies('/welcome', [cookie(request, SIGNUP_COOKIE, token, SIGNUP_SECONDS)]);
  }
  const birth = query.get('birth') ?? DEV_BIRTH;
  const now = new Date();
  const year = birthYearOfDate(birth, now);
  if (year === null || !oldEnoughForAccount(birth, now)) {
    return jsonError('Accounts are for people 16 and older', 403);
  }
  const userId = await upsertUser(db, profile, birthDateOfYear(year));
  const token = await createSession(db, userId);
  return redirectWithCookies(next, [cookie(request, SESSION_COOKIE, token, SESSION_SECONDS)]);
}

/** The app's start; null for a browser's own sign-in, and undefined when the app sent none to use. */
function appStart(query: URLSearchParams): AppStart | null | undefined {
  if (query.get('app') !== '1') {
    return null;
  }
  return readAppStart(query.get('challenge'), query.get('attempt'), query.get('binding')) ?? undefined;
}

/** What the state cookie keeps of the app's start: its challenge and attempt, and a link's binding. */
function appFields(app: AppStart | null, linking: boolean): string[] {
  if (!app) {
    return [];
  }
  return linking && app.binding ? [app.challenge, app.attempt, app.binding] : [app.challenge, app.attempt];
}

/**
 * Whether a link may start here: the browser's own needs its session; the
 * app's needs its binding to the app's session, which the redeem checks.
 */
async function mayLink({ env, request }: Context<'provider'>, app: AppStart | null): Promise<boolean> {
  if (app) {
    return app.binding !== null;
  }
  return env.TOURNAMENT_DB !== undefined && (await currentUser(env.TOURNAMENT_DB, request)) !== null;
}

export async function onRequestGet(context: Context<'provider'>): Promise<Response> {
  const provider = param(context.params.provider);
  const query = new URL(context.request.url).searchParams;
  const next = safeNext(query.get('next'));
  if (!isRedirectProvider(provider)) {
    return jsonError('Unknown sign-in provider', 404);
  }
  if (provider === 'dev') {
    return devSignIn(context, next);
  }
  const app = appStart(query);
  if (app === undefined) {
    return jsonError('The app sent no challenge', 400);
  }
  const linking = query.get('link') === '1';
  if (linking && !(await mayLink(context, app))) {
    return jsonError('Sign in first', 401);
  }
  const state = randomToken(16);
  const url = authorizeUrl(context.env, context.request, provider, state);
  if (!url) {
    return jsonError(`${provider} sign-in is not configured`, 503);
  }
  const started = [state, next, linking ? 'link' : 'login', ...appFields(app, linking)].join(' ');
  return redirectWithCookies(url, [cookie(context.request, OAUTH_COOKIE, started, STATE_SECONDS)]);
}
