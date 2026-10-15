/**
 * Username and password sign-in through Clerk (functions/lib/auth/clerk.ts,
 * functions/api/auth/clerk.ts): only a token Clerk signed, still current, from
 * this instance and made for this site stands for anyone; only a user with an
 * email proven by Clerk's code signs in, an account made before email was
 * asked for included; only from a session still live at Clerk, made since the
 * password last changed, which ends our sessions from before it; it ends as a
 * provider's callback does; and an account
 * with no email may not apply to organize.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, mock, test } from 'node:test';

import * as ageCheck from '../../functions/api/auth/age.ts';
import * as clerkSignIn from '../../functions/api/auth/clerk.ts';
import * as callback from '../../functions/api/auth/callback/[provider].ts';
import * as login from '../../functions/api/auth/login/[provider].ts';
import * as applications from '../../functions/api/applications/index.ts';
import * as mine from '../../functions/api/applications/mine.ts';
import * as me from '../../functions/api/me.ts';
import { primaryEmail, spendClerkSession, verifiedSession } from '../../functions/lib/auth/clerk.ts';
import { applyClerkEvent } from '../../functions/lib/auth/clerkWebhook.ts';
import { frontendApi } from '../../shared/accounts/clerk.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler, ORIGIN, request } from '../__utils__/apiCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

const ISSUER = 'https://clerk.cm.test';
const PUBLISHABLE = `pk_test_${btoa('clerk.cm.test$')}`;
const NOW = Math.floor(Date.now() / 1000);
const ADULT = new Date().getUTCFullYear() - 30;

const base64Url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
const part = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

const pair = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify']
)) as CryptoKeyPair;
const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
const PEM = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(spki).toString('base64')}\n-----END PUBLIC KEY-----\n`;

let sessions = 0;
/**
 * A session token's claims for `sub`, from a Clerk session of its own: `sess_`,
 * the rest of the user ID, `X` and a count, as each sign-in makes a session.
 */
const claimsFor = (sub: string) => ({
  sub,
  sid: `${sub.replace(/^user_/u, 'sess_')}X${(sessions += 1)}`,
  iss: ISSUER,
  azp: ORIGIN,
  exp: NOW + 60,
  nbf: NOW - 5,
  iat: NOW
});
const verifiedSubject = async (token: string, against: typeof check) =>
  (await verifiedSession(token, against))?.subject ?? null;

async function sign(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' }) {
  const signed = `${part(header)}.${part(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed));
  return `${signed}.${base64Url(signature)}`;
}

const check = { publicKeyPem: PEM, issuer: ISSUER, origin: ORIGIN, now: NOW };

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);

beforeEach(() => {
  env = {
    TOURNAMENT_DB: sqliteD1('tournaments.sql'),
    DEV_LOGIN: 'true',
    CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
    CLERK_SECRET_KEY: 'sk_test_secret',
    CLERK_JWT_KEY: PEM
  };
  applications._resetRateLimitStore();
});

const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw as DatabaseSync;
const count = (table: string) => (raw().prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const cookieOf = (response: Response, name: string) =>
  (response.headers.getSetCookie().find(value => value.startsWith(`${name}=`)) ?? '').split(';')[0] ?? '';

interface ClerkUser {
  email?: string;
  verified?: boolean;
  /** How Clerk verified the email: by its emailed code unless set. */
  strategy?: string;
  status?: number;
  banned?: boolean;
  locked?: boolean;
  /** The token's session at Clerk: active unless set. */
  session?: string;
  /** What Clerk answers when asked to end the session: 200 unless set. */
  revokeStatus?: number;
  /** When the token's Clerk session began (ms): a second ago unless set. */
  sessionBegan?: number;
  /** Runs while Clerk is ending the session, as a request that pauses there would. */
  duringRevoke?: () => Promise<void>;
  /** When the password last changed, in milliseconds. */
  passwordChangedAt?: number;
}

/* eslint-disable camelcase -- Clerk's field names */
/** Clerk's answer for a session read: the session ID names its user, as `claimsFor` makes it. */
function sessionAnswer(user: ClerkUser, path: string) {
  const id = path.split('/')[3] ?? '';
  const owner = id.replace(/^sess_/u, 'user_').replace(/X\d+$/u, '');
  return Response.json({
    id,
    user_id: owner,
    status: user.session ?? 'active',
    created_at: user.sessionBegan ?? Date.now() - 1000
  });
}

/** What was asked, with each session's count dropped: `sess_newX4` reads `sess_new`. */
const plainly = (asked: string[]) => asked.map(entry => entry.replace(/X\d+/u, ''));

/**
 * Clerk's Backend API answering for every user as `user` says, while `body`
 * runs; what it was asked, as `METHOD path`.
 */
async function asClerk<T>(user: ClerkUser, body: () => Promise<T>): Promise<{ result: T; asked: string[] }> {
  const asked: string[] = [];
  const fetch = mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(url));
    asked.push(`${init?.method ?? 'GET'} ${pathname}`);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer sk_test_secret');
    if (pathname.endsWith('/revoke')) {
      await user.duringRevoke?.();
      return Response.json({ status: 'revoked' }, { status: user.revokeStatus ?? 200 });
    }
    if (pathname.startsWith('/v1/sessions/')) {
      return sessionAnswer(user, pathname);
    }
    const addresses = user.email
      ? [
          {
            id: 'idn_1',
            email_address: user.email,
            verification: { status: user.verified ? 'verified' : 'unverified', strategy: user.strategy ?? 'email_code' }
          }
        ]
      : [];
    return Response.json(
      {
        id: 'user_x',
        email_addresses: addresses,
        primary_email_address_id: user.email ? 'idn_1' : null,
        banned: user.banned ?? false,
        locked: user.locked ?? false,
        password_last_updated_at: user.passwordChangedAt ?? null
      },
      { status: user.status ?? 200 }
    );
  });
  try {
    return { result: await body(), asked };
  } finally {
    fetch.mock.restore();
  }
}
/* eslint-enable camelcase */

interface Post {
  token: string;
  next?: string;
  link?: boolean;
  cookie?: string;
  origin?: string | null;
}

function post({ token, next = '/host', link = false, cookie, origin = ORIGIN }: Post): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (origin !== null) {
    headers.set('origin', origin);
  }
  if (cookie) {
    headers.set('cookie', cookie);
  }
  const body = new URLSearchParams({ token, next, ...(link ? { link: '1' } : {}) });
  return clerkSignIn.onRequestPost({
    request: new Request(`${ORIGIN}/api/auth/clerk`, { method: 'POST', headers, body }),
    env,
    params: {}
  } as never);
}

function checkAge(cookie: string) {
  return hit(
    ageCheck.onRequestPost as Handler,
    '/api/auth/age',
    {},
    {
      method: 'POST',
      cookie,
      body: { birthDate: `${ADULT}-03-01` }
    }
  );
}

const proven = (sub: string): ClerkUser => ({ email: `${sub}@example.com`, verified: true });

/** A new Clerk account through its age check: the session cookie it ends with. */
async function signUp(sub: string, user: ClerkUser = proven(sub)): Promise<string> {
  const { result: waiting } = await asClerk(user, async () => post({ token: await sign(claimsFor(sub)) }));
  assert.equal(waiting.headers.get('location'), '/welcome');
  const passed = await checkAge(cookieOf(waiting, 'cm_signup'));
  assert.equal(passed.status, 200);
  return (passed.headers.getSetCookie().find(value => value.startsWith('cm_session=')) ?? '').split(';')[0] ?? '';
}

test('a publishable key names its Frontend API; anything else names none', () => {
  assert.equal(frontendApi(PUBLISHABLE), ISSUER);
  assert.equal(frontendApi(`pk_live_${btoa('clerk.ciphermaniac.com$')}`), 'https://clerk.ciphermaniac.com');
  assert.equal(frontendApi(`pk_test_${btoa('clerk.cm.test')}`), null, 'no closing $');
  assert.equal(frontendApi(`pk_test_${btoa('evil.test/path$')}`), null, 'not a host');
  assert.equal(frontendApi('pk_test_!!!'), null);
  assert.equal(frontendApi(`sk_test_${btoa('clerk.cm.test$')}`), null);
  assert.equal(frontendApi(''), null);
});

test('a token Clerk signed, current, from this instance and made for this site stands for its user', async () => {
  assert.equal(await verifiedSubject(await sign(claimsFor('user_abc')), check), 'user_abc');
  const literalNewlines = PEM.replace(/\n/gu, '\\n');
  assert.equal(
    await verifiedSubject(await sign(claimsFor('user_abc')), { ...check, publicKeyPem: literalNewlines }),
    'user_abc',
    'a key pasted with literal \\n still reads'
  );
  assert.equal(
    await verifiedSubject(await sign({ ...claimsFor('user_abc'), exp: NOW - 2 }), check),
    'user_abc',
    'a few seconds of clock difference are allowed'
  );
});

test('a token out of its window, from elsewhere, or for another site stands for no one', async () => {
  const refused = {
    expired: { ...claimsFor('user_abc'), exp: NOW - 30 },
    'not yet valid': { ...claimsFor('user_abc'), nbf: NOW + 30 },
    'no expiry': { ...claimsFor('user_abc'), exp: undefined },
    'no not-before': { ...claimsFor('user_abc'), nbf: undefined },
    'another instance': { ...claimsFor('user_abc'), iss: 'https://clerk.other.test' },
    'another site': { ...claimsFor('user_abc'), azp: 'https://evil.test' },
    'no site': { ...claimsFor('user_abc'), azp: undefined },
    'a session not yet complete': { ...claimsFor('user_abc'), sts: 'pending' },
    'not a user': claimsFor('org_abc'),
    'a user ID with more in it': claimsFor('user_abc/../x')
  };
  for (const [why, claims] of Object.entries(refused)) {
    assert.equal(await verifiedSubject(await sign(claims), check), null, why);
  }
});

test('a token not signed by the instance’s key stands for no one', async () => {
  const good = await sign(claimsFor('user_abc'));
  const [header, , signature] = good.split('.');
  const forged = `${header}.${part(claimsFor('user_other'))}.${signature}`;
  const unsigned = `${part({ alg: 'none', typ: 'JWT' })}.${part(claimsFor('user_abc'))}.`;
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PEM),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const hmacSigned = `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claimsFor('user_abc'))}`;
  const hmac = `${hmacSigned}.${base64Url(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(hmacSigned)))}`;
  const relabelled = `${part({ alg: 'RS512', typ: 'JWT' })}.${good.split('.').slice(1).join('.')}`;
  for (const [why, token] of Object.entries({
    forged,
    unsigned,
    hmac,
    relabelled,
    'two parts': good.split('.').slice(0, 2).join('.'),
    'four parts': `${good}.x`,
    garbage: 'not a token',
    empty: ''
  })) {
    assert.equal(await verifiedSubject(token, check), null, why);
  }
  assert.equal(await verifiedSubject(good, { ...check, publicKeyPem: 'not a key' }), null, 'a bad key fails closed');
});

test('only the primary email, and only proven by an emailed code, is the account’s; any verified one resets a password', () => {
  /* eslint-disable camelcase -- Clerk's field names */
  const address = (id: string, email: string, status: string, strategy = 'email_code') => ({
    id,
    email_address: email,
    verification: { status, strategy }
  });
  assert.deepEqual(
    primaryEmail({
      primary_email_address_id: 'b',
      email_addresses: [address('a', 'a@example.com', 'verified'), address('b', 'b@example.com', 'verified')]
    }),
    { email: 'b@example.com', verified: true, recoverable: true }
  );
  assert.deepEqual(
    primaryEmail({ primary_email_address_id: 'a', email_addresses: [address('a', 'a@example.com', 'unverified')] }),
    { email: 'a@example.com', verified: false, recoverable: false }
  );
  for (const strategy of ['admin', 'from_oauth_google', 'email_link']) {
    assert.deepEqual(
      primaryEmail({
        primary_email_address_id: 'a',
        email_addresses: [address('a', 'a@example.com', 'verified', strategy)]
      }),
      { email: 'a@example.com', verified: false, recoverable: true },
      strategy
    );
  }
  assert.deepEqual(primaryEmail({ primary_email_address_id: null, email_addresses: [] }), {
    email: null,
    verified: false,
    recoverable: false
  });
  assert.deepEqual(primaryEmail({}), { email: null, verified: false, recoverable: false });
  /* eslint-enable camelcase */
});

test('a sign-in from another site, or with no Origin, fails before anything is read', async () => {
  const token = await sign(claimsFor('user_abc'));
  const { result, asked } = await asClerk({}, async () => [
    await post({ token, origin: 'https://evil.test' }),
    await post({ token, origin: null })
  ]);
  assert.deepEqual(
    result.map(response => response.headers.get('location')),
    ['/settings?signin=failed', '/settings?signin=failed']
  );
  assert.deepEqual(asked, [], 'Clerk was never asked');
  assert.equal(count('pending_signups'), 0);
});

test('without all three Clerk keys, or with a key that names no instance, there is no username sign-in', async () => {
  const session = await hit(me.onRequestGet as Handler, '/api/me', {});
  assert.ok(session.json.providers.includes('clerk'));
  assert.equal(session.json.clerkKey, PUBLISHABLE);
  for (const broken of [{ CLERK_JWT_KEY: undefined }, { CLERK_PUBLISHABLE_KEY: 'pk_test_typo' }]) {
    env = { ...env, ...broken };
    assert.equal((await post({ token: await sign(claimsFor('user_abc')) })).status, 503);
    const without = await hit(me.onRequestGet as Handler, '/api/me', {});
    assert.ok(!without.json.providers.includes('clerk'));
    assert.equal(without.json.clerkKey, null);
  }
});

test('Clerk has no redirect sign-in: its login and callback routes answer for nothing', async () => {
  const started = await login.onRequestGet({
    request: request('/api/auth/login/clerk'),
    env,
    params: { provider: 'clerk' }
  } as never);
  assert.equal(started.status, 404);
  const returned = await callback.onRequestGet({
    request: request('/api/auth/callback/clerk?code=c&state=s', { cookie: 'cm_oauth=s%20%2Fhost' }),
    env,
    params: { provider: 'clerk' }
  } as never);
  assert.equal(returned.headers.get('location'), '/settings?signin=failed');
});

test('a token that does not hold up, or Clerk failing to answer, signs no one in', async () => {
  const { result: bad, asked } = await asClerk({}, () => post({ token: 'nope' }));
  assert.equal(bad.headers.get('location'), '/settings?signin=failed');
  assert.deepEqual(asked, [], 'a bad token never reaches Clerk');
  const { result: down } = await asClerk({ status: 500 }, async () =>
    post({ token: await sign(claimsFor('user_abc')) })
  );
  assert.equal(down.headers.get('location'), '/settings?signin=failed');
  assert.equal(cookieOf(down, 'cm_session'), '');
  assert.deepEqual([count('users'), count('pending_signups')], [0, 0]);
});

test('a user Clerk has banned or locked since the token was made signs no one in', async () => {
  for (const shut of [{ banned: true }, { locked: true }]) {
    const { result } = await asClerk(shut, async () => post({ token: await sign(claimsFor('user_shut')) }));
    assert.equal(result.headers.get('location'), '/settings?signin=failed');
  }
  assert.deepEqual([count('users'), count('pending_signups')], [0, 0]);
});

test('a new username sign-up waits for the age check, then is an account with a random username', async () => {
  const { result: waiting, asked } = await asClerk(proven('user_new'), async () =>
    post({ token: await sign(claimsFor('user_new')) })
  );
  assert.deepEqual(plainly(asked).sort(), [
    'GET /v1/sessions/sess_new',
    'GET /v1/users/user_new',
    'POST /v1/sessions/sess_new/revoke'
  ]);
  assert.equal(waiting.headers.get('location'), '/welcome');
  assert.equal(cookieOf(waiting, 'cm_session'), '');
  const passed = await checkAge(cookieOf(waiting, 'cm_signup'));
  assert.deepEqual(passed.json, { next: '/host' });
  const account = raw()
    .prepare(
      "SELECT u.handle, u.email FROM users u JOIN identities i ON i.user_id = u.id WHERE i.provider = 'clerk' AND i.subject = 'user_new'"
    )
    .get() as { handle: string; email: string | null };
  assert.equal(account.email, 'user_new@example.com');
  assert.ok(account.handle, 'a username of its own, not the one it signs in with');
});

/** A username account made before email was asked for: no email, here or at Clerk. */
function oldAccount(sub: string) {
  raw().exec(
    'INSERT INTO users (id, handle, email, birth_date, age_checked_at, created_at) ' +
      "VALUES ('old', 'old', NULL, '02/27/1980', 1, 1)"
  );
  raw().exec(`INSERT INTO identities (provider, subject, user_id) VALUES ('clerk', '${sub}', 'old')`);
}

test('a known username account signs straight in', async () => {
  await signUp('user_back');
  const { result } = await asClerk(proven('user_back'), async () =>
    post({ token: await sign(claimsFor('user_back')), next: '/history' })
  );
  assert.equal(result.headers.get('location'), '/history');
  assert.ok(cookieOf(result, 'cm_session'));
  assert.equal(count('users'), 1);
});

test('an account made before email was asked for is in once it proves one, which is kept', async () => {
  oldAccount('user_old');
  const { result } = await asClerk({ email: 'old@example.com', verified: true }, async () =>
    post({ token: await sign(claimsFor('user_old')), next: '/host/ABCD' })
  );
  assert.equal(result.headers.get('location'), '/host/ABCD');
  assert.ok(cookieOf(result, 'cm_session'));
  const { email } = raw().prepare("SELECT email FROM users WHERE id = 'old'").get() as { email: string | null };
  assert.equal(email, 'old@example.com');
});

test('an email an admin verified lets its user in, though the account does not keep it', async () => {
  oldAccount('user_old');
  const { result } = await asClerk({ email: 'old@example.com', verified: true, strategy: 'admin' }, async () =>
    post({ token: await sign(claimsFor('user_old')) })
  );
  assert.ok(cookieOf(result, 'cm_session'));
  const { email } = raw().prepare("SELECT email FROM users WHERE id = 'old'").get() as { email: string | null };
  assert.equal(email, null);
});

/** Whether a session cookie still signs anyone in. */
const signedIn = async (cookie: string) =>
  Boolean((await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user);

test('a password changed since our sessions were made ends them at the next sign-in, which stays', async () => {
  const before = [await signUp('user_reset')];
  const second = await asClerk(proven('user_reset'), async () => post({ token: await sign(claimsFor('user_reset')) }));
  before.push(cookieOf(second.result, 'cm_session'));
  // No reset flag from the page: the password's own change, as Clerk reports it, decides.
  const changedAt = Date.now() + 1;
  const changed = { ...proven('user_reset'), passwordChangedAt: changedAt, sessionBegan: changedAt + 5 };
  const { result } = await asClerk(changed, async () => post({ token: await sign(claimsFor('user_reset')) }));
  const kept = cookieOf(result, 'cm_session');
  assert.deepEqual(await Promise.all(before.map(signedIn)), [false, false]);
  assert.equal(await signedIn(kept), true);
  assert.equal(count('sessions'), 1);
});

test('a token from a Clerk session begun before the password changed is refused, and ends the old sessions', async () => {
  const old = await signUp('user_stolen');
  const changedAt = Date.now() + 30_000;
  const { result } = await asClerk({ ...proven('user_stolen'), passwordChangedAt: changedAt }, async () =>
    post({ token: await sign(claimsFor('user_stolen')) })
  );
  assert.equal(result.headers.get('location'), '/settings?signin=failed');
  assert.equal(cookieOf(result, 'cm_session'), '');
  assert.equal(await signedIn(old), false, 'Clerk’s word on the change ends them, whatever comes of the token');
  const { result: atTheChange } = await asClerk(
    { ...proven('user_stolen'), passwordChangedAt: changedAt, sessionBegan: changedAt },
    async () => post({ token: await sign(claimsFor('user_stolen')) })
  );
  assert.ok(cookieOf(atTheChange, 'cm_session'), 'a session begun at the change counts as after it');
});

/* eslint-disable camelcase -- Clerk's field name */
/** Clerk's webhook saying `subject`'s password changed at `at`, applied as a delivery would be. */
const webhookSays = (subject: string, at: number) =>
  applyClerkEvent(
    env.TOURNAMENT_DB!,
    JSON.stringify({ type: 'user.updated', data: { id: subject, password_last_updated_at: at } })
  );
/* eslint-enable camelcase */

test('a reset reported while a sign-in waits on Clerk refuses the session it would make, and webhooks sent again keep it so', async () => {
  const old = await signUp('user_race');
  // The sign-in read Clerk before the password changed; the webhook lands while it ends Clerk's session.
  const began = Date.now() - 5_000;
  const changedAt = Date.now();
  const { result } = await asClerk(
    { ...proven('user_race'), sessionBegan: began, duringRevoke: () => webhookSays('user_race', changedAt) },
    async () => post({ token: await sign(claimsFor('user_race')) })
  );
  assert.equal(result.headers.get('location'), '/settings?signin=failed');
  assert.equal(cookieOf(result, 'cm_session'), '');
  assert.equal(await signedIn(old), false);
  await webhookSays('user_race', changedAt);
  assert.equal(count('sessions'), 0);
});

test('a session made just before the reset is reported ends with it, by when its sign-in was proven, not made', async () => {
  await signUp('user_after');
  const began = Date.now() - 60_000;
  const { result } = await asClerk({ ...proven('user_after'), sessionBegan: began }, async () =>
    post({ token: await sign(claimsFor('user_after')) })
  );
  const late = cookieOf(result, 'cm_session');
  assert.equal(await signedIn(late), true, 'made now, on a sign-in proven a minute ago');
  await webhookSays('user_after', Date.now() - 30_000);
  assert.equal(await signedIn(late), false);
  assert.equal(count('sessions'), 1, 'the sign-up’s own session, proven since, stays');
});

test('the password cutoff only moves forward, whichever report comes first', async () => {
  await signUp('user_order');
  const newer = Date.now() + 60_000;
  await webhookSays('user_order', newer);
  await webhookSays('user_order', Date.now() - 60_000);
  const cutoff = raw().prepare("SELECT changed_at FROM clerk_password_cutoffs WHERE subject = 'user_order'").get() as {
    changed_at: number;
  };
  assert.equal(cutoff.changed_at, newer);
  const { result } = await asClerk(
    { ...proven('user_order'), passwordChangedAt: Date.now() - 60_000, sessionBegan: Date.now() },
    async () => post({ token: await sign(claimsFor('user_order')) })
  );
  assert.equal(cookieOf(result, 'cm_session'), '', 'a stale read of Clerk does not undo the newer cutoff');
});

test('a sign-up held for its age check makes no session once the password has changed since', async () => {
  const { result: waiting } = await asClerk(proven('user_held'), async () =>
    post({ token: await sign(claimsFor('user_held')) })
  );
  assert.equal(waiting.headers.get('location'), '/welcome');
  await webhookSays('user_held', Date.now() + 1);
  const checked = await checkAge(cookieOf(waiting, 'cm_signup'));
  assert.equal(checked.status, 410);
  assert.equal(count('sessions'), 0);
});

test('a token whose Clerk session is no longer live, or is another user’s, is refused', async () => {
  await signUp('user_live');
  for (const session of ['revoked', 'ended', 'removed', 'expired']) {
    const { result, asked } = await asClerk({ ...proven('user_live'), session }, async () =>
      post({ token: await sign(claimsFor('user_live')) })
    );
    assert.equal(result.headers.get('location'), '/settings?signin=failed', session);
    assert.ok(!plainly(asked).some(entry => entry.startsWith('POST')), 'a session not live has nothing to end');
  }
  const { result: borrowed } = await asClerk(proven('user_live'), async () =>
    post({ token: await sign({ ...claimsFor('user_live'), sid: 'sess_someoneelse' }) })
  );
  assert.equal(borrowed.headers.get('location'), '/settings?signin=failed');
  const { result: unnamed } = await asClerk(proven('user_live'), async () =>
    post({ token: await sign({ ...claimsFor('user_live'), sid: undefined }) })
  );
  assert.equal(unnamed.headers.get('location'), '/settings?signin=failed', 'a token naming no session');
});

test('a token is good once: posted again, even at the same moment, it makes no second session', async () => {
  await signUp('user_once');
  const before = count('sessions');
  const token = await sign(claimsFor('user_once'));
  const { result } = await asClerk(proven('user_once'), async () =>
    Promise.all([post({ token }), post({ token }), post({ token })])
  );
  const made = result.filter(response => cookieOf(response, 'cm_session'));
  assert.equal(made.length, 1, 'one of three at once');
  assert.equal(count('sessions'), before + 1);
  const { result: later, asked } = await asClerk(proven('user_once'), async () => post({ token }));
  assert.equal(later.headers.get('location'), '/settings?signin=failed');
  assert.deepEqual(asked, [], 'a spent token never reaches Clerk');
  assert.equal(count('sessions'), before + 1);
});

test('when Clerk can’t end the session, the sign-in fails rather than leave the token good', async () => {
  await signUp('user_stuck');
  const before = count('sessions');
  for (const revokeStatus of [500, 404]) {
    const { result } = await asClerk({ ...proven('user_stuck'), revokeStatus }, async () =>
      post({ token: await sign(claimsFor('user_stuck')) })
    );
    assert.equal(result.headers.get('location'), '/settings?signin=failed', String(revokeStatus));
    assert.equal(cookieOf(result, 'cm_session'), '');
  }
  assert.equal(count('sessions'), before);
});

test('spent Clerk sessions are forgotten after a day, by which no token of theirs still holds', async () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(await spendClerkSession(env.TOURNAMENT_DB!, 'sess_old', Date.now() - day - 1), true);
  assert.equal(await spendClerkSession(env.TOURNAMENT_DB!, 'sess_old', Date.now() - day - 1), false);
  assert.equal(await spendClerkSession(env.TOURNAMENT_DB!, 'sess_new'), true);
  assert.deepEqual(
    (raw().prepare('SELECT session_id FROM clerk_sessions_used').all() as { session_id: string }[]).map(
      row => row.session_id
    ),
    ['sess_new']
  );
});

test('without a verified email, new or old, no one signs in and nothing is kept', async () => {
  oldAccount('user_old');
  raw().exec(
    'INSERT INTO users (id, handle, email, birth_date, age_checked_at, created_at) ' +
      "VALUES ('held', 'held', 'pat@example.com', '02/27/1980', 1, 1)"
  );
  const users: [string, ClerkUser][] = [
    ['user_old', {}],
    ['user_old', { email: 'old@example.com', verified: false }],
    ['user_new', {}],
    ['user_claim', { email: 'pat@example.com', verified: false }]
  ];
  for (const [sub, user] of users) {
    const { result } = await asClerk(user, async () => post({ token: await sign(claimsFor(sub)) }));
    assert.equal(result.headers.get('location'), '/settings?signin=email', sub);
    assert.equal(cookieOf(result, 'cm_session'), '');
  }
  assert.deepEqual([count('users'), count('pending_signups'), count('identities')], [2, 0, 1]);
  const { email } = raw().prepare("SELECT email FROM users WHERE id = 'old'").get() as { email: string | null };
  assert.equal(email, null);
});

test('an email Clerk verified joins the account that already has it, as Google’s would', async () => {
  raw().exec(
    'INSERT INTO users (id, handle, email, birth_date, age_checked_at, created_at) ' +
      "VALUES ('held', 'held', 'pat@example.com', '02/27/1980', 1, 1)"
  );
  const { result } = await asClerk({ email: 'pat@example.com', verified: true }, async () =>
    post({ token: await sign(claimsFor('user_pat')) })
  );
  assert.ok(cookieOf(result, 'cm_session'));
  const owner = raw().prepare("SELECT user_id FROM identities WHERE provider = 'clerk'").get() as { user_id: string };
  assert.equal(owner.user_id, 'held');
});

test('linking adds the username sign-in to the signed-in account, once', async () => {
  const cookie = await signIn('Pat');
  const { result } = await asClerk(proven('user_link'), async () =>
    post({ token: await sign(claimsFor('user_link')), link: true, cookie })
  );
  assert.ok(cookieOf(result, 'cm_session'));
  const session = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie });
  assert.deepEqual(session.json.user.providers.sort(), ['clerk', 'dev']);
  const other = await signIn('Sam');
  const { result: taken } = await asClerk(proven('user_link'), async () =>
    post({ token: await sign(claimsFor('user_link')), link: true, cookie: other })
  );
  assert.equal(taken.headers.get('location'), '/settings?link=used');
});

test('an account with no email may not apply to organize', async () => {
  // A verified email another account already holds is not this one's.
  raw().exec(
    'INSERT INTO users (id, handle, email, birth_date, age_checked_at, created_at) ' +
      "VALUES ('held', 'held', 'pat@example.com', '02/27/1980', 1, 1)"
  );
  oldAccount('user_apply');
  const { result } = await asClerk({ email: 'pat@example.com', verified: true }, async () =>
    post({ token: await sign(claimsFor('user_apply')) })
  );
  const cookie = cookieOf(result, 'cm_session');
  const profile = await hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    { method: 'PUT', cookie, body: { popId: '4242', firstName: 'Pat', lastName: 'Lee', birthDate: `02/27/${ADULT}` } }
  );
  assert.equal(profile.status, 200);
  const state = await hit(mine.onRequestGet as Handler, '/api/applications/mine', {}, { cookie });
  assert.deepEqual(state.json.eligible, { profile: true, email: false }, 'the page knows before the form');
  const applied = await hit(
    applications.onRequestPost as Handler,
    '/api/applications',
    {},
    {
      method: 'POST',
      cookie,
      body: {}
    }
  );
  assert.equal(applied.status, 400);
  assert.deepEqual(applied.json, { error: 'Add an email first', email: true });
  assert.equal(count('applications'), 0);
});

test('Clerk sign-in cannot return to dot-segment network paths', async () => {
  await signUp('user_redirect');
  for (const next of ['/..//evil.test', '/x/..//evil.test', '/%2e%2e//evil.test']) {
    const { result } = await asClerk(proven('user_redirect'), async () =>
      post({ token: await sign(claimsFor('user_redirect')), next })
    );
    assert.equal(result.status, 302);
    assert.equal(result.headers.get('Location'), '/');
  }
});
