/**
 * Clerk's webhook (functions/api/auth/clerk-webhook.ts,
 * lib/auth/clerkWebhook.ts): only a delivery Clerk signed, and sent within
 * the last few minutes, is read; a password changed ends every session of
 * ours made before it, though the browser that changed it never signed in
 * again; and anything that fails answers so Svix sends it again.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, test } from 'node:test';

import * as webhook from '../../functions/api/auth/clerk-webhook.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { createSession, SESSION_SECONDS } from '../../functions/lib/auth/session.ts';
import { signedByClerk } from '../../functions/lib/auth/clerkWebhook.ts';
import { ORIGIN } from '../__utils__/apiCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

const KEY = new TextEncoder().encode('a webhook signing secret, 32 b!');
const SECRET = `whsec_${Buffer.from(KEY).toString('base64')}`;

let env: TournamentEnv;
const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw as DatabaseSync;
const sessionsOf = (user: string) =>
  (raw().prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?').get(user) as { n: number }).n;

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), CLERK_WEBHOOK_SECRET: SECRET };
  raw().exec(
    'INSERT INTO users (id, handle, birth_date, age_checked_at, created_at) VALUES ' +
      "('pat', 'pat', '02/27/1980', 1, 1), ('sam', 'sam', '02/27/1980', 1, 1)"
  );
  raw().exec(
    "INSERT INTO identities (provider, subject, user_id) VALUES ('clerk', 'user_pat', 'pat'), ('clerk', 'user_sam', 'sam')"
  );
});

async function signature(id: string, timestamp: string, body: string, key = KEY): Promise<string> {
  const hmac = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${Buffer.from(signed).toString('base64')}`;
}

interface Send {
  body: unknown;
  signatures?: string;
  timestamp?: number;
  id?: string;
}

/* eslint-disable camelcase -- Clerk's field names */
const passwordChanged = (subject: string, at: number | null) => ({
  type: 'user.updated',
  data: { id: subject, password_last_updated_at: at }
});
/* eslint-enable camelcase */

async function deliver({ body, signatures, timestamp = Math.floor(Date.now() / 1000), id = 'msg_1' }: Send) {
  const text = JSON.stringify(body);
  const headers = new Headers({
    'content-type': 'application/json',
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': signatures ?? (await signature(id, String(timestamp), text))
  });
  return webhook.onRequestPost({
    request: new Request(`${ORIGIN}/api/auth/clerk-webhook`, { method: 'POST', headers, body: text }),
    env,
    params: {}
  } as never);
}

/** A session of `user` made `ago` milliseconds back. */
function sessionMadeAgo(user: string, ago: number, hash: string) {
  raw()
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hash, user, Date.now() - ago + SESSION_SECONDS * 1000);
}

test('a password changed with no sign-in after it still ends the sessions made before it', async () => {
  // The page that reset the password closed, or its sign-in failed: Clerk's word is enough.
  await createSession(env.TOURNAMENT_DB!, 'pat');
  sessionMadeAgo('pat', 60_000, 'older');
  await createSession(env.TOURNAMENT_DB!, 'sam');
  const changedAt = Date.now() + 1;
  const answer = await deliver({ body: passwordChanged('user_pat', changedAt) });
  assert.equal(answer.status, 204);
  assert.equal(sessionsOf('pat'), 0);
  assert.equal(sessionsOf('sam'), 1, 'another account is untouched');

  sessionMadeAgo('pat', -5_000, 'since');
  assert.equal((await deliver({ body: passwordChanged('user_pat', changedAt), id: 'msg_1' })).status, 204);
  assert.equal(sessionsOf('pat'), 1, 'sent again, it ends nothing made since');
});

test('Clerk’s timestamps in seconds read as seconds, and an event with no password change ends nothing', async () => {
  sessionMadeAgo('pat', 60_000, 'older');
  sessionMadeAgo('pat', 0, 'now');
  await deliver({ body: passwordChanged('user_pat', Math.floor(Date.now() / 1000) - 30) });
  assert.equal(sessionsOf('pat'), 1, 'only the one made before');
  for (const body of [
    passwordChanged('user_pat', null),
    { ...passwordChanged('user_pat', Date.now() + 1), type: 'user.created' },
    { type: 'session.ended', data: { id: 'sess_1' } },
    'not an event'
  ]) {
    assert.equal((await deliver({ body })).status, 204);
  }
  assert.equal(sessionsOf('pat'), 1);
});

test('a delivery not signed with the secret, signed over other words, or sent long ago is refused unread', async () => {
  await createSession(env.TOURNAMENT_DB!, 'pat');
  const body = passwordChanged('user_pat', Date.now() + 1);
  const text = JSON.stringify(body);
  const now = Math.floor(Date.now() / 1000);
  const otherKey = new TextEncoder().encode('somebody else’s secret, 32 bytes');
  const refused = {
    'another secret': { body, signatures: await signature('msg_1', String(now), text, otherKey) },
    'another body': { body, signatures: await signature('msg_1', String(now), '{}') },
    'no v1 signature': { body, signatures: 'v2,abc' },
    'not base64': { body, signatures: 'v1,!!!' },
    'ten minutes old': { body, timestamp: now - 600 },
    'ten minutes ahead': { body, timestamp: now + 600 }
  };
  for (const [why, send] of Object.entries(refused)) {
    assert.equal((await deliver(send)).status, 401, why);
  }
  assert.equal(sessionsOf('pat'), 1);
  const rotated = `v1,${'A'.repeat(43)}= ${await signature('msg_1', String(now), text)}`;
  assert.equal(
    (await deliver({ body, signatures: rotated, timestamp: now })).status,
    204,
    'any one of the signatures may hold'
  );
  assert.equal(sessionsOf('pat'), 0);
});

test('a delivery missing its headers is refused', async () => {
  const at = String(Math.floor(Date.now() / 1000));
  assert.equal(
    await signedByClerk(SECRET, { id: null, timestamp: at, signatures: 'v1,x', body: '' }, Number(at)),
    false
  );
  assert.equal(await signedByClerk(SECRET, { id: 'm', timestamp: 'soon', signatures: 'v1,x', body: '' }, 0), false);
  assert.equal(
    await signedByClerk('whsec_!!!', { id: 'm', timestamp: at, signatures: 'v1,x', body: '' }, Number(at)),
    false
  );
});

test('without its secret or database, or when the write fails, it answers so Svix sends it again', async () => {
  await createSession(env.TOURNAMENT_DB!, 'pat');
  const body = passwordChanged('user_pat', Date.now() + 1);
  env = { ...env, CLERK_WEBHOOK_SECRET: undefined };
  assert.equal((await deliver({ body })).status, 503);
  env = { ...env, CLERK_WEBHOOK_SECRET: SECRET };
  const failing = {
    prepare: () => ({ bind: () => ({}) }),
    batch: async () => {
      throw new Error('D1 is down');
    }
  };
  const working = env.TOURNAMENT_DB;
  env = { ...env, TOURNAMENT_DB: failing as never };
  assert.equal((await deliver({ body })).status, 500);
  env = { ...env, TOURNAMENT_DB: working };
  assert.equal(sessionsOf('pat'), 1, 'nothing applied yet');
  assert.equal((await deliver({ body })).status, 204, 'sent again once the database is back, it applies');
  assert.equal(sessionsOf('pat'), 0);
});
