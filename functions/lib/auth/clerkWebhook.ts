/**
 * Clerk's webhook, which says when a user changes (`user.updated`), such as
 * their password, or is deleted. A password changed ends every session of
 * ours made before it, whether or not the browser that changed it ever came
 * back to sign in (lib/auth/clerk.ts). A ban, lock, or deletion records the
 * shut-out subject and ends every session; no session is made while it
 * stands, so a sign-in already in flight cannot outlast it. Clerk sends
 * through Svix, which signs each delivery and sends it again, for days, until
 * it is answered with a 2xx; so anything that fails here answers otherwise,
 * and the change is applied again later.
 */

import { base64Bytes, endSessionsBeforePassword, passwordChangedAt, shutOut } from './clerk.js';
import type { D1Like } from '../types.js';

/** Seconds a delivery's timestamp may be from now, either way, as Svix's own libraries allow. */
const TOLERANCE_SECONDS = 5 * 60;

interface Delivery {
  id: string | null;
  timestamp: string | null;
  /** Svix's `svix-signature`: space-separated `v1,<base64>` entries, one per secret in use. */
  signatures: string | null;
  body: string;
}

const keys = new Map<string, Promise<CryptoKey>>();

/** The webhook's secret as a verifying key, imported once per isolate. */
function hmacKey(secret: string): Promise<CryptoKey> {
  const raw = () => base64Bytes(secret.replace(/^whsec_/u, ''));
  const key =
    keys.get(secret) ?? crypto.subtle.importKey('raw', raw(), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  keys.set(secret, key);
  return key;
}

function recent(timestamp: string, now: number): boolean {
  const sent = Number(timestamp);
  return Number.isInteger(sent) && Math.abs(now - sent) <= TOLERANCE_SECONDS;
}

/** The signatures a delivery carries, as bytes; one that isn't base64 is dropped. */
function signaturesOf(header: string): Uint8Array<ArrayBuffer>[] {
  return header.split(' ').flatMap(entry => {
    const [version, signature] = entry.split(',');
    try {
      return version === 'v1' && signature ? [base64Bytes(signature)] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Whether Clerk sent this delivery: signed with the webhook's secret over
 * its id, timestamp and body, and sent within the last few minutes, so an
 * old one can't be replayed. The comparison is the platform's own HMAC check.
 */
export async function signedByClerk(secret: string, delivery: Delivery, now: number): Promise<boolean> {
  const { id, timestamp, signatures, body } = delivery;
  if (!id || !timestamp || !signatures || !recent(timestamp, now)) {
    return false;
  }
  try {
    const key = await hmacKey(secret);
    const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
    const checks = signaturesOf(signatures).map(signature => crypto.subtle.verify('HMAC', key, signature, signed));
    return (await Promise.all(checks)).some(Boolean);
  } catch {
    return false;
  }
}

type Json = Record<string, unknown>;

type Event = { type: string; data: Json; timestamp: number | null };

/** An event read out of a delivery's body, or null when it isn't one. */
function eventOf(body: string): Event | null {
  try {
    const event = JSON.parse(body) as { type?: unknown; data?: unknown; timestamp?: unknown };
    return typeof event.type === 'string' && typeof event.data === 'object' && event.data !== null
      ? {
          type: event.type,
          data: event.data as Json,
          timestamp: typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) ? event.timestamp : null
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * When Clerk says this delivery happened, in ms. The event's own timestamp is
 * its occurrence time, and a deletion has no `updated_at`; the object's
 * timestamps are the fallback, and the moment it arrived when neither exists.
 */
function eventTime(event: Event, now: number): number {
  const at = event.timestamp ?? event.data.updated_at ?? event.data.created_at;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) {
    return now;
  }
  return at < 1e12 ? at * 1000 : at;
}

/** A delivery that says this user may no longer use the site; a deletion is terminal. */
const shutOutEvent = (event: Event) =>
  event.type === 'user.deleted' || (event.type === 'user.updated' && shutOut(event.data));

/** A delivery that says Clerk allows this user again, explicitly. */
const allowsEvent = (event: Event) =>
  event.type === 'user.created' ||
  (event.type === 'user.updated' && event.data.banned === false && event.data.locked === false);

/**
 * Records a revocation only when it is at least as new as the latest allow,
 * and ends the account's sessions only when the record stands after the
 * upsert, in one batch: a sign-in still in flight either makes its session
 * before this lands (and this deletes it) or checks the record after (and
 * makes none). A retried older ban neither reinstates the revocation nor
 * signs anyone out.
 */
const revoke = (db: D1Like, subject: string, at: number, terminal: boolean) =>
  db.batch([
    db
      .prepare(
        'INSERT INTO clerk_revocations (subject, revoked_at, allowed_at, terminal) VALUES (?1, ?2, 0, ?3) ' +
          'ON CONFLICT (subject) DO UPDATE SET ' +
          'revoked_at = CASE WHEN excluded.revoked_at >= allowed_at ' +
          'THEN MAX(revoked_at, excluded.revoked_at) ELSE revoked_at END, ' +
          'terminal = CASE WHEN excluded.revoked_at >= allowed_at ' +
          'THEN MAX(terminal, excluded.terminal) ELSE terminal END'
      )
      .bind(subject, at, terminal ? 1 : 0),
    db
      .prepare(
        "DELETE FROM sessions WHERE user_id = (SELECT user_id FROM identities WHERE provider = 'clerk' AND subject = ?1) " +
          'AND EXISTS (SELECT 1 FROM clerk_revocations WHERE subject = ?1 ' +
          'AND (terminal = 1 OR (revoked_at > 0 AND revoked_at >= allowed_at)))'
      )
      .bind(subject)
  ]);

/** A newer allow is remembered; an older one leaves a later revocation standing. */
const allow = (db: D1Like, subject: string, at: number) =>
  db
    .prepare(
      'INSERT INTO clerk_revocations (subject, revoked_at, allowed_at, terminal) VALUES (?1, 0, ?2, 0) ' +
        'ON CONFLICT (subject) DO UPDATE SET allowed_at = MAX(allowed_at, excluded.allowed_at)'
    )
    .bind(subject, at)
    .run();

/**
 * Applies one event. A user whose password has changed has every session of
 * ours made before it ended; one Clerk has banned, locked, or deleted has
 * every session end, so a shut-out user cannot keep using one. Every other
 * event, and a user who never had a password, changes nothing. Throws when
 * the database does, so Svix tries again.
 */
export async function applyClerkEvent(db: D1Like, body: string): Promise<void> {
  const event = eventOf(body);
  const subject = typeof event?.data.id === 'string' ? event.data.id : null;
  if (!event || !subject) {
    return;
  }
  if (shutOutEvent(event)) {
    await revoke(db, subject, eventTime(event, Date.now()), event.type === 'user.deleted');
  } else if (allowsEvent(event)) {
    await allow(db, subject, eventTime(event, Date.now()));
  }
  const changedAt = event.type === 'user.updated' ? passwordChangedAt(event.data) : null;
  if (changedAt !== null) {
    await endSessionsBeforePassword(db, subject, changedAt);
  }
}
