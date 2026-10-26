/**
 * Username and password sign-in through Clerk. Clerk checks the password; the
 * sign-in page hands over Clerk's short-lived session token, which is checked
 * here against the instance's public key. Then Clerk's Backend API says
 * whether that session is still live, whether the token was made since the
 * password last changed, and which email the account has verified, if any;
 * the session is spent here and ended at Clerk, so its token is good once. Nothing of Clerk's session is kept: the account
 * and its session are ours, as with Google or Discord. A password change ends
 * every session of ours made before it (`endSessionsBeforePassword`).
 */

import { frontendApi } from '../../../shared/accounts/clerk.js';
import type { D1Like } from '../types.js';
import type { AuthEnv, Profile } from './oauth.js';
import { SESSION_SECONDS } from './session.js';

/** Seconds of clock difference allowed either side of a token's window. */
const SKEW_SECONDS = 5;

type Json = Record<string, unknown>;

/** Bytes of base64 or base64url text; throws when it is neither. */
export function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeJson(part: string): Json | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64Bytes(part)));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

const keys = new Map<string, CryptoKey>();

/** The PEM public key as a verifying key, imported once per isolate. Literal `\n`s from a pasted secret are dropped. */
async function publicKey(pem: string): Promise<CryptoKey> {
  const cached = keys.get(pem);
  if (cached) {
    return cached;
  }
  const body = pem.replace(/-----[^-]+-----|\\n|\s/gu, '');
  const key = await crypto.subtle.importKey(
    'spki',
    base64Bytes(body),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  keys.set(pem, key);
  return key;
}

async function signatureHolds(pem: string, signed: string, signature: string): Promise<boolean> {
  try {
    const key = await publicKey(pem);
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64Bytes(signature),
      new TextEncoder().encode(signed)
    );
  } catch {
    return false;
  }
}

export interface TokenCheck {
  publicKeyPem: string;
  /** The Frontend API origin (shared/accounts/clerk.ts). */
  issuer: string;
  /** This site's origin, which the token must have been made for. */
  origin: string;
  /** Seconds since the epoch. */
  now: number;
}

function current(claims: Json, now: number): boolean {
  const { exp, nbf } = claims;
  return typeof exp === 'number' && typeof nbf === 'number' && exp + SKEW_SECONDS > now && nbf - SKEW_SECONDS <= now;
}

function madeForUs(claims: Json, check: TokenCheck): boolean {
  return claims.iss === check.issuer && claims.azp === check.origin;
}

/** A session with tasks left to do (`sts: 'pending'`) is not signed in yet. */
function settled(claims: Json): boolean {
  return claims.sts === undefined || claims.sts === 'active';
}

function claimsHold(claims: Json, check: TokenCheck): boolean {
  return current(claims, check.now) && madeForUs(claims, check) && settled(claims);
}

/** What a token that holds up stands for: the Clerk user and session, and when it was made (seconds). */
export interface TokenSession {
  subject: string;
  sessionId: string;
  issuedAt: number;
}

const idOf = (value: unknown, prefix: string) =>
  typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]+$`, 'u').test(value) ? value : null;

function tokenSession(claims: Json): TokenSession | null {
  const subject = idOf(claims.sub, 'user');
  const sessionId = idOf(claims.sid, 'sess');
  const { iat } = claims;
  return subject && sessionId && typeof iat === 'number' ? { subject, sessionId, issuedAt: iat } : null;
}

/**
 * The Clerk user and session a session token stands for, or null when
 * anything about it is off: not RS256 (so `none` and an HMAC keyed with the
 * public key both fail), a bad signature, outside its window, from another
 * instance, made for another site, a session not yet complete, or no session
 * or time of making named.
 */
export async function verifiedSession(token: string, check: TokenCheck): Promise<TokenSession | null> {
  const [header = '', payload = '', signature = '', ...rest] = token.split('.');
  if (rest.length > 0 || decodeJson(header)?.alg !== 'RS256') {
    return null;
  }
  if (!(await signatureHolds(check.publicKeyPem, `${header}.${payload}`, signature))) {
    return null;
  }
  const claims = decodeJson(payload);
  return claims && claimsHold(claims, check) ? tokenSession(claims) : null;
}

/**
 * The account's primary email as Clerk holds it, and whether its owner proved
 * it by the code Clerk emailed. An address an admin set, or one carried over
 * from a social sign-in, does not count: a verified email joins the account
 * that already holds it. `recoverable` is looser: Clerk can send a password
 * reset to any verified address, so one an admin set lets its user sign in.
 */
export function primaryEmail(user: Json): { email: string | null; verified: boolean; recoverable: boolean } {
  const addresses = Array.isArray(user.email_addresses) ? (user.email_addresses as Json[]) : [];
  const primary = addresses.find(address => address.id === user.primary_email_address_id);
  const email = typeof primary?.email_address === 'string' ? primary.email_address : null;
  const verification = primary?.verification as Json | null | undefined;
  const recoverable = email !== null && verification?.status === 'verified';
  return { email, verified: recoverable && verification.strategy === 'email_code', recoverable };
}

export interface ClerkKeys {
  publishableKey: string;
  issuer: string;
  publicKeyPem: string;
  secretKey: string;
}

/** The instance's keys, or null unless all three are set and the publishable key names a Frontend API. */
export function clerkKeys(env: AuthEnv): ClerkKeys | null {
  const { CLERK_PUBLISHABLE_KEY: publishableKey, CLERK_JWT_KEY: publicKeyPem, CLERK_SECRET_KEY: secretKey } = env;
  const issuer = frontendApi(publishableKey ?? '');
  return publishableKey && issuer && publicKeyPem && secretKey
    ? { publishableKey, issuer, publicKeyPem, secretKey }
    : null;
}

/** Whether Clerk will no longer sign this user in. */
const shutOut = (user: Json) => user.banned === true || user.locked === true;

/**
 * When the user's password last changed, in milliseconds, or null when Clerk
 * doesn't say. Clerk's timestamps are milliseconds; one small enough to be
 * seconds is read as seconds.
 */
export function passwordChangedAt(user: Json): number | null {
  const at = user.password_last_updated_at;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) {
    return null;
  }
  return at < 1e12 ? at * 1000 : at;
}

/** When Clerk's session began (ms): the time its sign-in was proven, or 0 when Clerk doesn't say. */
const sessionBegan = (live: Json) =>
  typeof live.created_at === 'number' && Number.isFinite(live.created_at) ? live.created_at : 0;

/** Whether a sign-in proven at `authAt` (ms) is from since the password last changed. */
const provenSincePassword = (authAt: number, changedAt: number | null) => changedAt === null || authAt >= changedAt;

/** A Backend API read or action; throws unless Clerk answers. */
async function backend(clerk: ClerkKeys, path: string, method = 'GET'): Promise<Json> {
  const response = await fetch(`https://api.clerk.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${clerk.secretKey}` }
  });
  if (!response.ok) {
    throw new Error(`Clerk ${method} ${path.split('/')[0]} failed: ${response.status}`);
  }
  return (await response.json()) as Json;
}

/** How long a spent Clerk session is remembered: far past any token of it, which lasts a minute. */
const SPENT_KEPT_MS = 24 * 60 * 60 * 1000;

/**
 * Spends a Clerk session: true for the one exchange that records it first,
 * false for any other, however close together they come, as the table holds
 * each session once. Sessions spent over a day ago are forgotten as it goes.
 */
export async function spendClerkSession(db: D1Like, sessionId: string, now = Date.now()): Promise<boolean> {
  const [, spent] = await db.batch([
    db.prepare('DELETE FROM clerk_sessions_used WHERE used_at < ?').bind(now - SPENT_KEPT_MS),
    db
      .prepare('INSERT INTO clerk_sessions_used (session_id, used_at) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .bind(sessionId, now)
  ]);
  return spent?.meta?.changes === 1;
}

/** Whether Clerk's session is live (not revoked, ended or signed out) and the token's user's own. */
const liveFor = (session: TokenSession, live: Json) => live.status === 'active' && live.user_id === session.subject;

/** Whether the user may still sign in: not banned or locked, and the session begun since the password last changed. */
const userStands = (authAt: number, user: Json) =>
  !shutOut(user) && provenSincePassword(authAt, passwordChangedAt(user));

export interface ClerkAnswer {
  profile: Profile;
  /** Whether the user has an email a forgotten password can be reset by. */
  recoverable: boolean;
}

/**
 * The profile a Clerk session token stands for; null when the token does not
 * hold up, its session was spent already (`spendClerkSession`), or no longer
 * stands (`liveFor`, `userStands`). A token is good once: its session is
 * spent here before Clerk is asked anything, and ended at Clerk before any
 * account is signed in. Only a verified email is kept. Throws when Clerk
 * can't be read, or its session can't be ended, so no one is signed in.
 */
export async function clerkProfile(
  env: AuthEnv,
  db: D1Like,
  origin: string,
  token: string
): Promise<ClerkAnswer | null> {
  const clerk = clerkKeys(env);
  const session = clerk && (await verifiedSession(token, { ...clerk, origin, now: Math.floor(Date.now() / 1000) }));
  if (!clerk || !session || !(await spendClerkSession(db, session.sessionId))) {
    return null;
  }
  const [live, user] = await Promise.all([
    backend(clerk, `sessions/${session.sessionId}`),
    backend(clerk, `users/${session.subject}`)
  ]);
  // Clerk's word on the password ends our sessions from before it, whatever comes of this token.
  const changedAt = passwordChangedAt(user);
  if (changedAt !== null) {
    await endSessionsBeforePassword(db, session.subject, changedAt);
  }
  if (!liveFor(session, live)) {
    return null;
  }
  await backend(clerk, `sessions/${session.sessionId}/revoke`, 'POST');
  const authAt = sessionBegan(live);
  return userStands(authAt, user) ? answerFor(session.subject, user, authAt) : null;
}

function answerFor(subject: string, user: Json, authAt: number): ClerkAnswer {
  const { email, verified, recoverable } = primaryEmail(user);
  const profile: Profile = {
    provider: 'clerk',
    subject,
    name: '',
    email: verified ? email : null,
    emailVerified: verified,
    avatar: null,
    authAt
  };
  return { profile, recoverable };
}

/**
 * Records that this Clerk user's password changed at `changedAt` (ms), and
 * ends every session of ours, of the account they sign in to, whose sign-in
 * was proven before the latest change known: whoever knew the old password is
 * signed out, wherever. The cutoff only moves forward, whichever report comes
 * first, and stays for sessions made later (`createSession` refuses one
 * proven before it). A session's proof is its `auth_at`, or for one made
 * before that was kept, when it was made, `SESSION_SECONDS` before it
 * expires. Running it again changes nothing, so a webhook sent twice is
 * harmless. One batch, so the two land together.
 */
export function endSessionsBeforePassword(db: D1Like, subject: string, changedAt: number) {
  return db.batch([
    db
      .prepare(
        'INSERT INTO clerk_password_cutoffs (subject, changed_at) VALUES (?1, ?2) ' +
          'ON CONFLICT (subject) DO UPDATE SET changed_at = MAX(changed_at, excluded.changed_at)'
      )
      .bind(subject, changedAt),
    db
      .prepare(
        "DELETE FROM sessions WHERE user_id = (SELECT user_id FROM identities WHERE provider = 'clerk' AND subject = ?1) " +
          'AND COALESCE(auth_at, expires_at - ?2) < (SELECT changed_at FROM clerk_password_cutoffs WHERE subject = ?1)'
      )
      .bind(subject, SESSION_SECONDS * 1000)
  ]);
}

/**
 * Deletes the Clerk users of deleted accounts, each queued in the batch that
 * deleted its account so none is forgotten when Clerk can't be reached; one
 * that fails stays for the next sweep. A Clerk user signed in with again
 * since, and so a new account's, leaves the queue untouched. A few a sweep,
 * under the Workers limit on subrequests.
 */
export async function purgeClerkDeletions(db: D1Like, env: AuthEnv): Promise<void> {
  if (!clerkKeys(env)) {
    return;
  }
  const [, queued] = await db.batch([
    db.prepare(
      "DELETE FROM clerk_deletions WHERE subject IN (SELECT subject FROM identities WHERE provider = 'clerk')"
    ),
    db.prepare('SELECT subject FROM clerk_deletions ORDER BY subject LIMIT 20')
  ]);
  const subjects = ((queued?.results ?? []) as { subject: string }[]).map(row => row.subject);
  const settled = await Promise.allSettled(subjects.map(subject => deleteClerkUser(env, subject)));
  const deleted = subjects.filter((_, i) => settled[i]?.status === 'fulfilled');
  for (const failed of settled.filter(result => result.status === 'rejected')) {
    console.error('Clerk user of a deleted account will be retried', failed.reason);
  }
  if (deleted.length > 0) {
    await db
      .prepare('DELETE FROM clerk_deletions WHERE subject IN (SELECT value FROM json_each(?) AS ids)')
      .bind(JSON.stringify(deleted))
      .run()
      .catch((err: unknown) => console.error('Clerk user of a deleted account will be retried', err));
  }
}

/**
 * Deletes the Clerk user an account signed in with, so its username and
 * password are gone with the account. A user Clerk no longer has counts as
 * deleted. Throws when Clerk can't be reached or refuses.
 */
async function deleteClerkUser(env: AuthEnv, subject: string): Promise<void> {
  const clerk = clerkKeys(env);
  if (!clerk) {
    throw new Error('Clerk is not configured');
  }
  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(subject)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${clerk.secretKey}` }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Clerk user delete failed: ${response.status}`);
  }
}
