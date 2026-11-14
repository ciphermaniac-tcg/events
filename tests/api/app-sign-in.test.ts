/**
 * The native app's sign-in through the system browser
 * (functions/lib/auth/appTicket.ts): the browser's callback starts no session
 * of its own but hands the app a ticket, which the app's webview redeems once,
 * within its minute, with the verifier its challenge came from.
 */

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import * as callback from '../../functions/api/auth/callback/[provider].ts';
import * as login from '../../functions/api/auth/login/[provider].ts';
import * as redeem from '../../functions/api/auth/redeem.ts';
import { sha256 } from '../../functions/lib/auth/session.ts';
import { apiSuite, ORIGIN, request } from '../__utils__/apiCalls.ts';
import type { sqliteD1 } from '../__utils__/sqliteD1.ts';

const { env, signIn, userOf } = apiSuite();
const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;
const count = () => (raw().prepare('SELECT count(*) AS n FROM app_sign_in_tickets').get() as { n: number }).n;
const cookieOf = (response: Response, name: string) =>
  (response.headers.getSetCookie().find(value => value.startsWith(`${name}=`)) ?? '').split(';')[0] ?? '';

const VERIFIER = 'a-verifier-only-the-app-holds';

function withGoogle() {
  env.GOOGLE_CLIENT_ID = 'id';
  env.GOOGLE_CLIENT_SECRET = 'secret';
}

function startLogin(query: string, cookie?: string) {
  withGoogle();
  return login.onRequestGet({
    request: request(`/api/auth/login/google?${query}`, { cookie }),
    env,
    params: { provider: 'google' }
  } as never);
}

/** Google answering for `sub` as the browser comes back with the state cookie `started` set. */
async function googleCallback(started: string, sub = 'g-1'): Promise<Response> {
  withGoogle();
  const fetch = mock.method(
    globalThis,
    'fetch',
    async (url: string | URL) =>
      String(url).includes('token')
        ? Response.json({ access_token: 'token' }) // eslint-disable-line camelcase
        : Response.json({ sub, email: `${sub}@example.com`, email_verified: true }) // eslint-disable-line camelcase
  );
  try {
    const state = started.split(' ')[0] ?? '';
    return await callback.onRequestGet({
      request: request(`/api/auth/callback/google?code=c&state=${state}`, {
        cookie: `cm_oauth=${encodeURIComponent(started)}`
      }),
      env,
      params: { provider: 'google' }
    } as never);
  } finally {
    fetch.mock.restore();
  }
}

/** The ticket in the page that hands the sign-in to the app. */
async function ticketOf(page: Response): Promise<string> {
  const ticket = /ciphermaniac-events:\/\/auth\?ticket=([\w-]+)/.exec(await page.text())?.[1];
  assert.ok(ticket, 'the page links to the app with a ticket');
  return ticket;
}

/** A ticket for Google's `sub`, as the app's sign-in started with `query` leaves it. */
async function appTicket(query = 'next=%2Fhost', sub = 'g-1'): Promise<string> {
  const challenge = await sha256(VERIFIER);
  const started = await startLogin(`app=1&challenge=${challenge}&${query}`);
  const state = decodeURIComponent(cookieOf(started, 'cm_oauth').slice('cm_oauth='.length));
  return ticketOf(await googleCallback(state, sub));
}

/** The app's post of `fields` from a page of the site; another site's when `origin` says so. */
function redeemWith(fields: Record<string, string>, cookie?: string, origin = ORIGIN) {
  const headers = new Headers({ Origin: origin });
  if (cookie) {
    headers.set('cookie', cookie);
  }
  return redeem.onRequestPost({
    request: new Request(`${ORIGIN}/api/auth/redeem`, { method: 'POST', headers, body: new URLSearchParams(fields) }),
    env,
    params: {}
  } as never);
}

/** An adult account Google's `sub` already signs in to. */
function knownAccount(sub = 'g-1') {
  raw().exec(
    "INSERT INTO users (id, handle, birth_date, age_checked_at, created_at) VALUES ('known', 'known', '02/27/1980', 1, 1);" +
      `INSERT INTO identities (provider, subject, user_id) VALUES ('google', '${sub}', 'known')`
  );
}

test("the app's login carries its challenge through Google, and asks for one", async () => {
  const challenge = await sha256(VERIFIER);
  const started = await startLogin(`app=1&challenge=${challenge}&next=%2Fhost`);
  assert.equal(started.status, 302);
  assert.match(started.headers.get('location') ?? '', /^https:\/\/accounts\.google\.com\//);
  assert.match(decodeURIComponent(cookieOf(started, 'cm_oauth')), new RegExp(` /host login ${challenge}$`));
  assert.equal((await startLogin('app=1&next=%2Fhost')).status, 400);
  assert.equal((await startLogin('app=1&challenge=not-a-hash')).status, 400);
});

test("a link from the app starts without the browser's session; the browser's own still needs one", async () => {
  const challenge = await sha256(VERIFIER);
  assert.equal((await startLogin(`app=1&challenge=${challenge}&link=1`)).status, 302);
  assert.equal((await startLogin('link=1')).status, 401);
});

test("the app's callback hands over a hashed ticket and no session of the browser's", async () => {
  const challenge = await sha256(VERIFIER);
  const page = await googleCallback(`state /host login ${challenge}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(cookieOf(page, 'cm_session'), '', 'the browser stays signed out');
  assert.equal(cookieOf(page, 'cm_oauth'), 'cm_oauth=', 'the state is cleared');
  const ticket = await ticketOf(page);
  const row = raw().prepare('SELECT ticket_hash AS hash, challenge FROM app_sign_in_tickets').get() as {
    hash: string;
    challenge: string;
  };
  assert.deepEqual({ ...row }, { hash: await sha256(ticket), challenge });
});

test('the right verifier signs the webview in where it started, once', async () => {
  knownAccount();
  const ticket = await appTicket();
  const signedIn = await redeemWith({ ticket, verifier: VERIFIER });
  assert.equal(signedIn.status, 302);
  assert.equal(signedIn.headers.get('location'), '/host');
  assert.equal((await userOf(cookieOf(signedIn, 'cm_session'))).handle, 'known');
  assert.equal(count(), 0, 'the ticket is gone');
  const replay = await redeemWith({ ticket, verifier: VERIFIER });
  assert.equal(replay.headers.get('location'), '/settings?signin=failed');
  assert.equal(cookieOf(replay, 'cm_session'), '');
});

test('a wrong verifier is refused and uses the ticket up', async () => {
  knownAccount();
  const ticket = await appTicket();
  const wrong = await redeemWith({ ticket, verifier: 'someone-elses' });
  assert.equal(wrong.headers.get('location'), '/settings?signin=failed');
  assert.equal(cookieOf(wrong, 'cm_session'), '');
  const after = await redeemWith({ ticket, verifier: VERIFIER });
  assert.equal(after.headers.get('location'), '/settings?signin=failed');
});

test('a ticket past its minute is refused', async () => {
  knownAccount();
  const ticket = await appTicket();
  raw().exec('UPDATE app_sign_in_tickets SET expires_at = expires_at - 61000');
  const late = await redeemWith({ ticket, verifier: VERIFIER });
  assert.equal(late.headers.get('location'), '/settings?signin=failed');
  assert.equal(cookieOf(late, 'cm_session'), '');
});

test("another site's post is refused without using the ticket, which the app's then redeems", async () => {
  const ticket = await appTicket('next=%2Fsettings&link=1', 'g-other');
  const cookie = await signIn('Victim');
  const forged = await redeemWith({ ticket, verifier: VERIFIER }, cookie, 'https://evil.example');
  assert.equal(forged.headers.get('location'), '/settings?signin=failed');
  assert.deepEqual((await userOf(cookie)).providers, ['dev'], 'nothing linked');
  assert.equal(count(), 1, 'the ticket is still there');
  const own = await redeemWith({ ticket, verifier: VERIFIER }, cookie);
  assert.equal(own.headers.get('location'), '/settings');
});

test('a redeem missing its ticket or verifier is refused', async () => {
  assert.equal((await redeemWith({ verifier: VERIFIER })).headers.get('location'), '/settings?signin=failed');
  assert.equal((await redeemWith({ ticket: 'abc' })).headers.get('location'), '/settings?signin=failed');
  delete env.TOURNAMENT_DB;
  assert.equal((await redeemWith({ ticket: 'abc', verifier: VERIFIER })).status, 503);
});

test("a new sign-up from the app waits for its age check in the app's webview", async () => {
  const ticket = await appTicket();
  const waiting = await redeemWith({ ticket, verifier: VERIFIER });
  assert.equal(waiting.headers.get('location'), '/welcome');
  assert.ok(cookieOf(waiting, 'cm_signup'));
});

test("a link from the app adds Google to the webview's account", async () => {
  const cookie = await signIn('Linker');
  const ticket = await appTicket('next=%2Fsettings&link=1', 'g-link');
  const linked = await redeemWith({ ticket, verifier: VERIFIER }, cookie);
  assert.equal(linked.headers.get('location'), '/settings');
  assert.deepEqual((await userOf(cookie)).providers, ['dev', 'google']);
});
