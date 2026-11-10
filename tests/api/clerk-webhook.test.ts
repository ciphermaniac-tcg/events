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
import type { Profile } from '../../functions/lib/auth/oauth.ts';
import { createSession, proofOf, SESSION_SECONDS, StaleSignIn, upsertUser } from '../../functions/lib/auth/session.ts';
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

const clerkProof = { clerkSubject: 'user_pat', authAt: Date.now() };

/* eslint-disable camelcase -- Clerk's field names */
test('a Clerk ban, lock, or deletion ends every session and refuses one made after it', async () => {
  for (const event of [
    { type: 'user.updated', data: { id: 'user_pat', banned: true } },
    { type: 'user.updated', data: { id: 'user_pat', locked: true } },
    { type: 'user.deleted', data: { id: 'user_pat' } }
  ]) {
    raw().exec('DELETE FROM sessions');
    raw().exec('DELETE FROM clerk_revocations');
    await createSession(env.TOURNAMENT_DB!, 'pat', clerkProof);
    await createSession(env.TOURNAMENT_DB!, 'sam');
    assert.equal((await deliver({ body: event })).status, 204, event.type);
    assert.equal(sessionsOf('pat'), 0, `${event.type} ends the shut-out account`);
    assert.equal(sessionsOf('sam'), 1, 'another account is untouched');
    // A sign-in Clerk had already validated, or a pending age check, reaches createSession after the webhook.
    await assert.rejects(createSession(env.TOURNAMENT_DB!, 'pat', clerkProof), StaleSignIn, event.type);
    assert.equal(sessionsOf('pat'), 0, 'no session is made after the shut-out is recorded');
  }
  raw().exec('DELETE FROM clerk_revocations');
  const bannedAt = Date.now();
  await deliver({ body: { type: 'user.updated', data: { id: 'user_pat', banned: true, updated_at: bannedAt } } });
  await deliver({
    body: { type: 'user.updated', data: { id: 'user_pat', banned: false, locked: false, updated_at: bannedAt + 1_000 } }
  });
  await createSession(env.TOURNAMENT_DB!, 'pat', clerkProof);
  assert.equal(sessionsOf('pat'), 1, 'a user Clerk allows again may sign in');
});
/* eslint-enable camelcase -- Clerk's field names */

/** A Google sign-in with `email` verified, which reaches the account holding that email. */
async function googleSignIn(email: string): Promise<string> {
  const profile: Profile = {
    provider: 'google',
    subject: `g-${email}`,
    name: 'Someone',
    email,
    emailVerified: true,
    avatar: null
  };
  const id = await upsertUser(env.TOURNAMENT_DB!, profile);
  return createSession(env.TOURNAMENT_DB!, id, proofOf(profile));
}

test('a Clerk shut-out refuses a Google sign-in that reaches the same account by email', async () => {
  raw().exec("UPDATE users SET email = id || '@example.com'");
  assert.equal((await deliver({ body: { type: 'user.updated', data: { id: 'user_pat', banned: true } } })).status, 204);
  await assert.rejects(googleSignIn('pat@example.com'), StaleSignIn);
  assert.equal(sessionsOf('pat'), 0, 'no session for the shut-out account');
  await googleSignIn('sam@example.com');
  assert.equal(sessionsOf('sam'), 1, 'another account signs in with Google as before');
  await googleSignIn('sam@example.com');
  assert.equal(sessionsOf('sam'), 2, 'and again, once its Google identity is linked');

  // A password changed after the proof refuses it, whichever provider proved it.
  raw().exec('DELETE FROM clerk_revocations');
  await deliver({ body: passwordChanged('user_pat', Date.now()) });
  const before = { clerkSubject: null, authAt: Date.now() - 60_000 };
  await assert.rejects(createSession(env.TOURNAMENT_DB!, 'pat', before), StaleSignIn);
  await googleSignIn('pat@example.com');
  assert.equal(sessionsOf('pat'), 1, 'a sign-in proven after the change is let in');
});

test('an older allow cannot clear a newer shut-out, and a deletion stays terminal', async () => {
  const bannedAt = Date.now();
  await deliver({ body: { type: 'user.updated', data: { id: 'user_pat', banned: true }, timestamp: bannedAt } });
  await deliver({
    body: { type: 'user.updated', data: { id: 'user_pat', banned: false, locked: false }, timestamp: bannedAt - 1_000 }
  });
  await assert.rejects(createSession(env.TOURNAMENT_DB!, 'pat', clerkProof), StaleSignIn, 'an older allow');
  await deliver({
    body: { type: 'user.updated', data: { id: 'user_pat', banned: false, locked: false }, timestamp: bannedAt + 1_000 }
  });
  await createSession(env.TOURNAMENT_DB!, 'pat', clerkProof);
  assert.equal(sessionsOf('pat'), 1, 'a newer allow lets the account sign in again');

  // Retried older deliveries must not undo the newer allow, nor sign anyone out.
  await deliver({ body: { type: 'user.updated', data: { id: 'user_pat', banned: true }, timestamp: bannedAt } });
  await deliver({ body: { type: 'user.deleted', data: { id: 'user_pat' }, timestamp: bannedAt - 1_000 } });
  assert.equal(sessionsOf('pat'), 1, 'an older ban or deletion leaves the session alone');
  await createSession(env.TOURNAMENT_DB!, 'pat', clerkProof);
  assert.equal(sessionsOf('pat'), 2, 'and the account can still sign in');

  // A revocation and an allow at the same millisecond: the revocation wins, as it fails closed.
  raw().exec('DELETE FROM sessions');
  raw().exec('DELETE FROM clerk_revocations');
  const tieAt = Date.now() + 2_000;
  await deliver({ body: { type: 'user.updated', data: { id: 'user_pat', banned: true }, timestamp: tieAt } });
  await deliver({
    body: { type: 'user.updated', data: { id: 'user_pat', banned: false, locked: false }, timestamp: tieAt }
  });
  await assert.rejects(createSession(env.TOURNAMENT_DB!, 'pat', clerkProof), StaleSignIn, 'a tie stays revoked');
  await deliver({
    body: { type: 'user.updated', data: { id: 'user_pat', banned: false, locked: false }, timestamp: tieAt + 1 }
  });
  await createSession(env.TOURNAMENT_DB!, 'pat', clerkProof);
  assert.equal(sessionsOf('pat'), 1, 'a later allow clears it');

  raw().exec('DELETE FROM sessions');
  const deletedAt = Date.now() + 5_000;
  await deliver({ body: { type: 'user.deleted', data: { id: 'user_pat' }, timestamp: deletedAt } });
  await deliver({
    body: {
      type: 'user.updated',
      data: { id: 'user_pat', banned: false, locked: false },
      timestamp: deletedAt + 1_000
    }
  });
  await deliver({ body: { type: 'user.created', data: { id: 'user_pat' }, timestamp: deletedAt + 2_000 } });
  await assert.rejects(createSession(env.TOURNAMENT_DB!, 'pat', clerkProof), StaleSignIn, 'a deletion is terminal');
  assert.equal(sessionsOf('pat'), 0);
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
