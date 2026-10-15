/**
 * Resetting a forgotten password through our own endpoints
 * (functions/api/auth/reset, lib/auth/passwordReset.ts), against stand-ins
 * for Clerk's Backend API and Cloudflare's Email Sending. What must hold:
 * asking answers alike for an unknown name, an account with no email and one
 * with, and before Clerk is asked; a code goes only to an account's own
 * verified email, a few an hour; a wrong code, and any code for a request
 * that named no one, answer alike, five tries at most; a code that holds sets
 * the password at Clerk, signing out its sessions and ending ours from
 * before it, once.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, mock, test } from 'node:test';

import * as start from '../../functions/api/auth/reset/index.ts';
import * as complete from '../../functions/api/auth/reset/complete.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { randomCode } from '../../functions/lib/auth/passwordReset.ts';
import { createSession } from '../../functions/lib/auth/session.ts';
import { ORIGIN } from '../__utils__/apiCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw as DatabaseSync;
const sessionsOf = (user: string) =>
  (raw().prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?').get(user) as { n: number }).n;

beforeEach(() => {
  env = {
    TOURNAMENT_DB: sqliteD1('tournaments.sql'),
    CLERK_PUBLISHABLE_KEY: `pk_test_${btoa('clerk.cm.test$')}`,
    CLERK_SECRET_KEY: 'sk_test_secret',
    CLERK_JWT_KEY: 'pem',
    EMAIL_SENDING_ACCOUNT_ID: 'acct',
    EMAIL_SENDING_TOKEN: 'mail-token',
    RESET_EMAIL_FROM: 'codes@events.test'
  };
  raw().exec(
    "INSERT INTO users (id, handle, birth_date, age_checked_at, created_at) VALUES ('pat', 'pat', '02/27/1980', 1, 1);" +
      "INSERT INTO identities (provider, subject, user_id) VALUES ('clerk', 'user_pat', 'pat')"
  );
});

/* eslint-disable camelcase -- Clerk's field names */
interface ClerkUser {
  id: string;
  username: string;
  email: string | null;
  verified?: boolean;
}

const PAT: ClerkUser = { id: 'user_pat', username: 'pat_plays', email: 'pat@example.com', verified: true };
const NO_EMAIL: ClerkUser = { id: 'user_quiet', username: 'quiet', email: null };

const clerkJson = (user: ClerkUser, passwordAt: number | null = null) => ({
  id: user.id,
  username: user.username,
  primary_email_address_id: user.email ? 'idn_1' : null,
  email_addresses: user.email
    ? [
        {
          id: 'idn_1',
          email_address: user.email,
          verification: { status: user.verified ? 'verified' : 'unverified', strategy: 'email_code' }
        }
      ]
    : [],
  password_last_updated_at: passwordAt
});

interface World {
  users: ClerkUser[];
  /** What Clerk answers a new password with, instead of taking it. */
  refusePassword?: string;
  mailFails?: boolean;
  /** Holds Clerk's answer to who a name is until it settles. */
  gate?: Promise<void>;
  /** Holds Clerk's answer to a new password until it settles. */
  passwordGate?: Promise<void>;
}

interface Seen {
  mail: { to: string; from: string; text: string }[];
  passwords: { subject: string; body: Record<string, unknown> }[];
  asked: string[];
}

/** Clerk and Email Sending answering as `world` says while `body` runs; what they were sent. */
async function services<T>(world: World, body: (seen: Seen) => Promise<T>): Promise<{ result: T; seen: Seen }> {
  const seen: Seen = { mail: [], passwords: [], asked: [] };
  const fetch = mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const target = new URL(String(url));
    seen.asked.push(`${init?.method ?? 'GET'} ${target.host}${target.pathname}`);
    if (target.host === 'api.cloudflare.com') {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer mail-token');
      seen.mail.push(JSON.parse(String(init?.body)) as Seen['mail'][number]);
      return Response.json({ success: !world.mailFails }, { status: world.mailFails ? 500 : 200 });
    }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer sk_test_secret');
    if (init?.method === 'PATCH') {
      await world.passwordGate;
      const subject = decodeURIComponent(target.pathname.split('/')[3] ?? '');
      seen.passwords.push({ subject, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (world.refusePassword) {
        return Response.json({ errors: [{ code: world.refusePassword }] }, { status: 422 });
      }
      const user = world.users.find(each => each.id === subject) as ClerkUser;
      return Response.json(clerkJson(user, Date.now()));
    }
    await world.gate;
    const wanted = target.searchParams.get('username') ?? target.searchParams.get('email_address');
    const found = world.users.filter(user => user.username === wanted || user.email === wanted);
    return Response.json(found.map(user => clerkJson(user)));
  });
  try {
    return { result: await body(seen), seen };
  } finally {
    fetch.mock.restore();
  }
}
/* eslint-enable camelcase */

function call(
  handler: { onRequestPost: (context: never) => Promise<Response> },
  path: string,
  body: unknown,
  cookie = ''
) {
  const headers = new Headers({ 'content-type': 'application/json', origin: ORIGIN });
  if (cookie) {
    headers.set('cookie', cookie);
  }
  return handler.onRequestPost({
    request: new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    env,
    params: {}
  } as never);
}

const ask = (identifier: string) => call(start, '/api/auth/reset', { identifier });
const finish = (cookie: string, code: string, password = 'a brand new passphrase') =>
  call(complete, '/api/auth/reset/complete', { code, password }, cookie);
const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const codeIn = (seen: Seen) => /\b(\d{6})\b/u.exec(seen.mail.at(-1)?.text ?? '')?.[1] ?? '';

/** An answer as the page sees it: status, body, and the cookie's settings without its value. */
async function shown(response: Response) {
  const setCookie = (response.headers.get('set-cookie') ?? '').replace(/^cm_reset=[^;]*/u, 'cm_reset=…');
  return { status: response.status, body: await response.text(), setCookie };
}

test('asking answers alike for an unknown name, an account with no email, and one with', async () => {
  const world = { users: [PAT, NO_EMAIL] };
  const { result, seen } = await services(world, async () =>
    Promise.all(['nobody_at_all', 'quiet', 'pat_plays', 'pat@example.com'].map(async name => shown(await ask(name))))
  );
  for (const each of result) {
    assert.deepEqual(each, result[0]);
  }
  assert.equal(result[0]?.status, 202);
  assert.match(result[0]?.setCookie ?? '', /HttpOnly/u);
  assert.deepEqual(
    seen.mail.map(mail => mail.to),
    ['pat@example.com', 'pat@example.com'],
    'a code goes only to an account’s own verified email, by its username or its email'
  );
  assert.equal(seen.mail[0]?.from, 'codes@events.test');
});

test('the answer does not wait on Clerk or the email: they run after it', async () => {
  const pending: Promise<unknown>[] = [];
  let open = () => undefined as void;
  const gate = new Promise<void>(resolve => {
    open = resolve;
  });
  const { result, seen } = await services({ users: [PAT], gate }, async sofar => {
    const response = await start.onRequestPost({
      request: new Request(`${ORIGIN}/api/auth/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ identifier: 'pat_plays' })
      }),
      env,
      params: {},
      waitUntil: (work: Promise<unknown>) => pending.push(work)
    } as never);
    const mailedBefore = sofar.mail.length;
    open();
    await Promise.all(pending);
    return { status: response.status, mailedBefore };
  });
  assert.deepEqual(result, { status: 202, mailedBefore: 0 }, 'answered while Clerk had yet to say who it is');
  assert.equal(seen.mail.length, 1);
});

test('the code and a new password set it at Clerk, sign its sessions out, and end ours from before it', async () => {
  await createSession(env.TOURNAMENT_DB!, 'pat', { clerkSubject: 'user_pat', authAt: Date.now() - 60_000 });
  const { result, seen } = await services({ users: [PAT] }, async () => {
    const asked = await ask('pat_plays');
    return { cookie: cookieOf(asked) };
  });
  const code = codeIn(seen);
  assert.match(code, /^\d{6}$/u);
  const { result: done, seen: after } = await services({ users: [PAT] }, async () => finish(result.cookie, code));
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { ok: true });
  assert.match(done.headers.get('set-cookie') ?? '', /cm_reset=;/u);
  assert.deepEqual(after.passwords, [
    // eslint-disable-next-line camelcase -- Clerk's field name
    { subject: 'user_pat', body: { password: 'a brand new passphrase', sign_out_of_other_sessions: true } }
  ]);
  assert.equal(sessionsOf('pat'), 0, 'sessions from before the change end');
  const cutoff = raw().prepare("SELECT changed_at FROM clerk_password_cutoffs WHERE subject = 'user_pat'").get();
  assert.ok(cutoff, 'and the cutoff stays for any made on an older sign-in');
  const { result: again } = await services({ users: [PAT] }, async () => finish(result.cookie, code));
  assert.equal(again.status, 410, 'a code sets the password once');
});

test('a wrong code, and any code for a request that named no one, answer alike, five tries at most', async () => {
  const { result } = await services({ users: [PAT, NO_EMAIL] }, async () =>
    Promise.all(['pat_plays', 'nobody_at_all', 'quiet'].map(async name => cookieOf(await ask(name))))
  );
  const answers = await services({ users: [PAT, NO_EMAIL] }, async () =>
    Promise.all(result.map(async cookie => shown(await finish(cookie, '000000'))))
  );
  for (const each of answers.result) {
    assert.deepEqual(each, { ...answers.result[0], setCookie: '' });
  }
  assert.equal(answers.result[0]?.status, 400);
  assert.match(answers.result[0]?.body ?? '', /form_code_incorrect/u);
  assert.deepEqual(answers.seen.passwords, [], 'Clerk is never asked to set it');
  const tries = await services({ users: [PAT] }, async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await finish(result[0] ?? '', '000000')).status);
    }
    return statuses;
  });
  assert.deepEqual(tries.result, [400, 400, 400, 400, 410], 'the fifth wrong try was the last');
});

test('one code submitted twice at once sets the password once', async () => {
  const { result, seen } = await services({ users: [PAT] }, async () => cookieOf(await ask('pat_plays')));
  const code = codeIn(seen);
  let open = () => undefined as void;
  const passwordGate = new Promise<void>(resolve => {
    open = resolve;
  });
  const { result: both, seen: after } = await services({ users: [PAT], passwordGate }, async () => {
    const racing = [finish(result, code), finish(result, code, 'another new passphrase')];
    // One claims the code and waits on Clerk; the other is answered meanwhile, having checked it too.
    await Promise.race(racing);
    open();
    return Promise.all(racing.map(async each => (await each).status));
  });
  assert.deepEqual(both.sort(), [200, 409]);
  assert.equal(after.passwords.length, 1, 'Clerk was asked to set it once');
});

test('once a code sets the password, every other code sent for the account stops holding', async () => {
  const first = await services({ users: [PAT] }, async () => cookieOf(await ask('pat_plays')));
  const second = await services({ users: [PAT] }, async () => cookieOf(await ask('pat@example.com')));
  const { result: done } = await services({ users: [PAT] }, async () => finish(second.result, codeIn(second.seen)));
  assert.equal(done.status, 200);
  const { result: older, seen } = await services({ users: [PAT] }, async () =>
    finish(first.result, codeIn(first.seen), 'yet another passphrase')
  );
  assert.equal(older.status, 410);
  assert.deepEqual(seen.passwords, []);
  assert.equal((raw().prepare('SELECT count(*) AS n FROM password_resets').get() as { n: number }).n, 0);
});

test('a code whose password Clerk could not set is not left claimed', async () => {
  const { result, seen } = await services({ users: [PAT] }, async () => cookieOf(await ask('pat_plays')));
  const code = codeIn(seen);
  await services({ users: [PAT], refusePassword: 'form_password_length_too_short' }, async () =>
    finish(result, code, 'short')
  );
  const { result: next } = await services({ users: [PAT] }, async () => finish(result, code));
  assert.equal(next.status, 200, 'claimed and let go, the code holds for another password');
});

test('a code for a request that named no one is hashed as one for a real account is', async () => {
  const { result } = await services({ users: [PAT, NO_EMAIL] }, async () =>
    Promise.all(['pat_plays', 'nobody_at_all', 'quiet'].map(async name => cookieOf(await ask(name))))
  );
  const hashed = async (cookie: string) => {
    const digest = mock.method(crypto.subtle, 'digest');
    try {
      await finish(cookie, '000000');
      return digest.mock.callCount();
    } finally {
      digest.mock.restore();
    }
  };
  const counts: number[] = [];
  for (const cookie of result) {
    counts.push(await hashed(cookie));
  }
  raw().exec('UPDATE password_resets SET expires_at = 1');
  counts.push(await hashed(result[0] ?? ''));
  assert.ok((counts[0] ?? 0) >= 2, 'the token and the code');
  assert.deepEqual(
    counts,
    Array.from({ length: 4 }, () => counts[0]),
    'real, unknown, without email, run out'
  );
});

test('a request runs out after fifteen minutes', async () => {
  const { result, seen } = await services({ users: [PAT] }, async () => cookieOf(await ask('pat_plays')));
  raw().exec('UPDATE password_resets SET expires_at = 1');
  const { result: late } = await services({ users: [PAT] }, async () => finish(result, codeIn(seen)));
  assert.equal(late.status, 410);
  assert.match(await late.text(), /verification_expired/u);
});

test('Clerk refusing the new password says why, and the code still holds for another', async () => {
  const { result, seen } = await services({ users: [PAT] }, async () => cookieOf(await ask('pat_plays')));
  const code = codeIn(seen);
  const { result: refused } = await services({ users: [PAT], refusePassword: 'form_password_pwned' }, async () =>
    finish(result, code, 'password1')
  );
  assert.equal(refused.status, 422);
  assert.match(await refused.text(), /form_password_pwned/u);
  const { result: taken } = await services({ users: [PAT] }, async () => finish(result, code));
  assert.equal(taken.status, 200);
});

test('a few codes an hour per account, however many ask at once: more answer alike and send nothing', async () => {
  const { result, seen } = await services({ users: [PAT] }, async () =>
    Promise.all(Array.from({ length: 5 }, async () => shown(await ask('pat_plays'))))
  );
  assert.equal(seen.mail.length, 3);
  for (const each of result) {
    assert.deepEqual(each, result[0]);
  }
});

test('an account’s codes count their whole hour, though the requests they came with are gone', async () => {
  const sent = await services({ users: [PAT] }, async () => {
    for (let i = 0; i < 3; i += 1) {
      await ask('pat_plays');
    }
  });
  assert.equal(sent.seen.mail.length, 3);
  // Run out, or ended by a reset: the requests go, the hour's count stays.
  raw().exec('DELETE FROM password_resets');
  const later = await services({ users: [PAT] }, async () => ask('pat_plays'));
  assert.equal(later.seen.mail.length, 0);
  raw().exec(`UPDATE reset_reservations SET at = ${Date.now() - 61 * 60 * 1000}`);
  const nextHour = await services({ users: [PAT] }, async () => ask('pat_plays'));
  assert.equal(nextHour.seen.mail.length, 1, 'an hour on, the account may be sent another');
});

test('an email that fails to send answers alike; a request with no cookie, or another site’s, is refused', async () => {
  const { result } = await services({ users: [PAT], mailFails: true }, async () => shown(await ask('pat_plays')));
  assert.equal(result.status, 202);
  assert.equal((await finish('', '123456')).status, 410);
  const foreign = await start.onRequestPost({
    request: new Request(`${ORIGIN}/api/auth/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
      body: JSON.stringify({ identifier: 'pat_plays' })
    }),
    env,
    params: {}
  } as never);
  assert.equal(foreign.status, 403);
  assert.equal((await ask('')).status, 400);
});

/** A request to start a reset from `address`, as Cloudflare names it. */
const askFrom = (address: string, identifier: string) =>
  start.onRequestPost({
    request: new Request(`${ORIGIN}/api/auth/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'CF-Connecting-IP': address },
      body: JSON.stringify({ identifier })
    }),
    env,
    params: {}
  } as never);

test('too many requests from one address are refused, whatever they name, at once or not, in D1 by its hash', async () => {
  const { result } = await services({ users: [PAT] }, async () =>
    Promise.all(Array.from({ length: 12 }, async (_, i) => (await askFrom('203.0.113.9', `someone_${i}`)).status))
  );
  assert.deepEqual(
    result.filter(status => status === 202).length,
    10,
    'ten of twelve at once, held where every isolate reads'
  );
  assert.equal(result.filter(status => status === 429).length, 2);
  const keys = raw().prepare("SELECT DISTINCT key FROM reset_reservations WHERE scope = 'address'").all() as {
    key: string;
  }[];
  assert.equal(keys.length, 1);
  assert.match(keys[0]?.key ?? '', /^[0-9a-f]{64}$/u, 'the address is kept only as a hash');
  const { result: elsewhere } = await services({ users: [PAT] }, async () => askFrom('198.51.100.7', 'someone'));
  assert.equal(elsewhere.status, 202, 'another address has its own');
  raw().exec(`UPDATE reset_reservations SET at = ${Date.now() - 16 * 60 * 1000}`);
  const { result: later } = await services({ users: [PAT] }, async () => askFrom('203.0.113.9', 'someone'));
  assert.equal(later.status, 202, 'fifteen minutes on, the address may ask again');
});

test('without Clerk or Email Sending set up there is no reset', async () => {
  env = { ...env, EMAIL_SENDING_TOKEN: undefined };
  assert.equal((await ask('pat_plays')).status, 503);
  assert.equal((await finish('cm_reset=x', '123456')).status, 503);
});

test('a code is six digits, each value as likely', () => {
  const codes = Array.from({ length: 200 }, () => randomCode());
  assert.ok(codes.every(code => /^\d{6}$/u.test(code)));
  assert.ok(new Set(codes).size > 190);
});
