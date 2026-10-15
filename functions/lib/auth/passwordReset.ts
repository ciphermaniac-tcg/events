/**
 * Resetting a forgotten password, on our side of Clerk, so the answer to who
 * asked never says whether there is an account. Asking (`startReset`) always
 * answers alike and right away; only then is Clerk asked who the username or
 * email names, and a code emailed when it is a user with a verified email and
 * has codes to spare this hour (`reserve`). The code, with a new
 * password (`completeReset`), sets the password through Clerk's Backend API,
 * signing out Clerk's sessions and ending ours from before it. The page then
 * signs in with the new password as any sign-in does (api/auth/clerk.ts).
 *
 * A request is a row under the hash of a token kept in an HttpOnly cookie,
 * with the Clerk user and the hash of its code once one is sent; a request
 * for no one keeps neither, so no code given to it holds. Each lasts
 * `RESET_SECONDS` and takes `MAX_TRIES` codes.
 */

import type { D1Like } from '../types.js';
import { type ClerkKeys, clerkKeys, endSessionsBeforePassword, passwordChangedAt, primaryEmail } from './clerk.js';
import type { AuthEnv } from './oauth.js';
import { randomToken, sha256 } from './session.js';

/** The cookie that holds a reset request's token. */
export const RESET_COOKIE = 'cm_reset';
export const RESET_SECONDS = 15 * 60;
const MAX_TRIES = 5;
/** How long a redemption holds its account's requests while Clerk sets the password; one left by a request that died lapses. */
const CLAIM_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * How many requests each may make in its window: an address (its hash) asking
 * at all, and an account being sent a code.
 */
const LIMITS = {
  address: { max: 10, windowMs: 15 * 60 * 1000 },
  account: { max: 3, windowMs: HOUR_MS }
} as const;
/** Reservations are kept this long: the longest window, so each counts for the whole of its own. */
const KEPT_MS = Math.max(...Object.values(LIMITS).map(limit => limit.windowMs));

/**
 * Reserves one use under `scope` for `key`: true while fewer than its limit
 * were reserved in its window. Counting and reserving are one statement, so
 * requests at once can't all slip under the limit, and a reservation stays
 * its whole window, whatever becomes of the request it was for.
 */
export async function reserve(db: D1Like, scope: keyof typeof LIMITS, key: string, now = Date.now()): Promise<boolean> {
  const { max, windowMs } = LIMITS[scope];
  const [, reserved] = await db.batch([
    db.prepare('DELETE FROM reset_reservations WHERE at <= ?').bind(now - KEPT_MS),
    db
      .prepare(
        'INSERT INTO reset_reservations (scope, key, at) SELECT ?1, ?2, ?3 ' +
          'WHERE (SELECT count(*) FROM reset_reservations WHERE scope = ?1 AND key = ?2 AND at > ?4) < ?5'
      )
      .bind(scope, key, now, now - windowMs, max)
  ]);
  return reserved?.meta?.changes === 1;
}

type Json = Record<string, unknown>;

/** Where codes are sent from: Cloudflare's Email Sending, with its account, a token that may send, and the sender. */
interface Mail {
  accountId: string;
  token: string;
  from: string;
}

export interface Reset {
  clerk: ClerkKeys;
  mail: Mail;
}

/** Clerk and the mail it needs, or null unless all are set. */
export function resetSetup(env: AuthEnv): Reset | null {
  const clerk = clerkKeys(env);
  const { EMAIL_SENDING_ACCOUNT_ID: accountId, EMAIL_SENDING_TOKEN: token, RESET_EMAIL_FROM: from } = env;
  return clerk && accountId && token && from ? { clerk, mail: { accountId, token, from } } : null;
}

/** Six random digits, each value as likely as any other. */
export function randomCode(): string {
  const limit = 4_294_000_000; // The largest multiple of a million a 32-bit draw reaches.
  for (;;) {
    const [draw = limit] = crypto.getRandomValues(new Uint32Array(1));
    if (draw < limit) {
      return String(draw % 1_000_000).padStart(6, '0');
    }
  }
}

const codeHash = (tokenHash: string, code: string) => sha256(`${tokenHash}:${code}`);

/**
 * Starts a request: its row, and the token for the cookie. `work` is what
 * remains, the asking and sending, which the answer does not wait on.
 */
export async function startReset(
  db: D1Like,
  setup: Reset,
  identifier: string,
  now = Date.now()
): Promise<{ token: string; work: Promise<void> }> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  await db.batch([
    db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').bind(now),
    db
      .prepare('INSERT INTO password_resets (token_hash, attempts, created_at, expires_at) VALUES (?, 0, ?, ?)')
      .bind(tokenHash, now, now + RESET_SECONDS * 1000)
  ]);
  const work = sendIfAccount(db, setup, { identifier, tokenHash, now }).catch((error: unknown) =>
    console.error('Password reset code not sent', error instanceof Error ? error.message : 'Unknown error')
  );
  return { token, work };
}

/** A Backend API call; throws unless Clerk answers 2xx. */
async function backend(clerk: ClerkKeys, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`https://api.clerk.com/v1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${clerk.secretKey}`, 'Content-Type': 'application/json' }
  });
  if (!response.ok && response.status !== 422 && response.status !== 400) {
    throw new Error(`Clerk ${init.method ?? 'GET'} ${path.split(/[/?]/u)[0]} failed: ${response.status}`);
  }
  return response;
}

/** The Clerk user a username or email names exactly, or null for none or more than one. */
async function userNamed(clerk: ClerkKeys, identifier: string): Promise<Json | null> {
  const field = identifier.includes('@') ? 'email_address' : 'username';
  const response = await backend(clerk, `users?${new URLSearchParams({ [field]: identifier }).toString()}`);
  const users = response.ok ? ((await response.json()) as Json[]) : [];
  return Array.isArray(users) && users.length === 1 ? (users[0] ?? null) : null;
}

/** Where a code can go: the user's verified primary email, unless Clerk has shut them out. */
function codeAddress(user: Json): string | null {
  const { email, recoverable } = primaryEmail(user);
  return user.banned === true || user.locked === true || !recoverable ? null : email;
}

interface Asked {
  identifier: string;
  tokenHash: string;
  now: number;
}

/** Sends a code for the request when the username or email names someone a code can go to. */
async function sendIfAccount(db: D1Like, setup: Reset, { identifier, tokenHash, now }: Asked) {
  const user = await userNamed(setup.clerk, identifier);
  const subject = typeof user?.id === 'string' ? user.id : null;
  const to = user && codeAddress(user);
  if (!subject || !to || !(await reserve(db, 'account', subject, now))) {
    return;
  }
  const code = randomCode();
  await db
    .prepare('UPDATE password_resets SET subject = ?, code_hash = ? WHERE token_hash = ?')
    .bind(subject, await codeHash(tokenHash, code), tokenHash)
    .run();
  await sendCode(setup.mail, to, code);
}

/** Emails the code through Cloudflare's Email Sending; throws unless it is taken. */
async function sendCode(mail: Mail, to: string, code: string): Promise<void> {
  // Placeholder copy until it is written.
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${mail.accountId}/email/sending/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mail.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      from: mail.from,
      subject: 'Your Ciphermaniac Events code',
      text: `Your password reset code is ${code} and expires in 15 minutes.\n\nIf you aren't trying to reset your password, ignore this email.`
    })
  });
  const answer = (await response.json().catch(() => null)) as { success?: boolean } | null;
  if (!response.ok || answer?.success !== true) {
    throw new Error(`Email Sending refused: ${response.status}`);
  }
}

/** How a code and new password came out: the error code the page reads as words, or done. */
export type ResetOutcome = { ok: true } | { ok: false; status: number; code: string };

const refused = (status: number, code: string): ResetOutcome => ({ ok: false, status, code });

/**
 * Takes one try of the request: its Clerk user and code, or null when it
 * has run out of time or tries. Counting the try and reading the request are
 * one statement, so tries at once each count.
 */
async function takeTry(db: D1Like, tokenHash: string, now: number) {
  return db
    .prepare(
      'UPDATE password_resets SET attempts = attempts + 1 WHERE token_hash = ? AND expires_at > ? AND attempts < ? ' +
        'RETURNING subject, code_hash'
    )
    .bind(tokenHash, now, MAX_TRIES)
    .first<{ subject: string | null; code_hash: string | null }>();
}

/**
 * Claims the request for setting its account's password: true for the one
 * submission that claims it first. No other submission of this request, or
 * of any other request for the account, can claim one while a claim stands,
 * as the check and the claim are one statement.
 */
async function claim(db: D1Like, tokenHash: string, subject: string, now: number): Promise<boolean> {
  const [claimed] = await db.batch([
    db
      .prepare(
        'UPDATE password_resets SET claimed_at = ?1 WHERE token_hash = ?2 AND NOT EXISTS ' +
          '(SELECT 1 FROM password_resets WHERE subject = ?3 AND claimed_at > ?1 - ?4)'
      )
      .bind(now, tokenHash, subject, CLAIM_MS)
  ]);
  return claimed?.meta?.changes === 1;
}

/** Lets a claim go when Clerk did not set the password, so the code can be tried with another. */
const release = (db: D1Like, tokenHash: string) =>
  db.prepare('UPDATE password_resets SET claimed_at = NULL WHERE token_hash = ?').bind(tokenHash).run();

/** Sets the password at Clerk, signing its sessions out; the refusal's code when Clerk won't take it. */
async function setPassword(clerk: ClerkKeys, subject: string, password: string): Promise<Json | string> {
  const response = await backend(clerk, `users/${encodeURIComponent(subject)}`, {
    method: 'PATCH',
    // eslint-disable-next-line camelcase -- Clerk's field name
    body: JSON.stringify({ password, sign_out_of_other_sessions: true })
  });
  const body = (await response.json().catch(() => null)) as Json | null;
  if (response.ok && body) {
    return body;
  }
  const errors = body?.errors as { code?: string }[] | undefined;
  return errors?.[0]?.code ?? 'form_password_invalid';
}

/**
 * The code and new password for the request under `token`. A code that
 * holds claims the request (`claim`), so one submission sets the password,
 * however many come at once; then every request for the account ends, so no
 * other code sent before it still holds, and every session of ours from
 * before the change ends, as Clerk times it. Every request for no one, and
 * every wrong code, answers alike.
 */
export async function completeReset(
  db: D1Like,
  setup: Reset,
  submitted: { token: string; code: string; password: string },
  now = Date.now()
): Promise<ResetOutcome> {
  const tokenHash = await sha256(submitted.token);
  // The code's digest comes first, so a request for no one, or one run out, does the same work as any other.
  const digest = await codeHash(tokenHash, submitted.code);
  const held = await takeTry(db, tokenHash, now);
  if (!held) {
    return refused(410, 'verification_expired');
  }
  if (!held.subject || held.code_hash !== digest) {
    return refused(400, 'form_code_incorrect');
  }
  if (!(await claim(db, tokenHash, held.subject, now))) {
    return refused(409, 'reset_in_progress');
  }
  const user = await setPassword(setup.clerk, held.subject, submitted.password).catch(async (error: unknown) => {
    await release(db, tokenHash);
    throw error;
  });
  if (typeof user === 'string') {
    await release(db, tokenHash);
    return refused(422, user);
  }
  await db.prepare('DELETE FROM password_resets WHERE subject = ?').bind(held.subject).run();
  await endSessionsBeforePassword(db, held.subject, passwordChangedAt(user) ?? now);
  return { ok: true };
}
