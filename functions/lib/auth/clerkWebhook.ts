/**
 * Clerk's webhook, which says when a user changes (`user.updated`), such as
 * their password. A password changed ends every session of ours made before
 * it, whether or not the browser that changed it ever came back to sign in
 * (lib/auth/clerk.ts). Clerk sends through Svix, which signs each delivery
 * and sends it again, for days, until it is answered with a 2xx; so anything
 * that fails here answers otherwise, and the change is applied again later.
 */

import { base64Bytes, endSessionsBeforePassword, passwordChangedAt } from './clerk.js';
import type { D1Like } from '../types.js';

/** Seconds a delivery's timestamp may be from now, either way, as Svix's own libraries allow. */
const TOLERANCE_SECONDS = 5 * 60;

export interface Delivery {
  id: string | null;
  timestamp: string | null;
  /** Svix's `svix-signature`: space-separated `v1,<base64>` entries, one per secret in use. */
  signatures: string | null;
  body: string;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    base64Bytes(secret.replace(/^whsec_/u, '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
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

/** An event read out of a delivery's body, or null when it isn't one. */
function eventOf(body: string): { type: string; data: Json } | null {
  try {
    const event = JSON.parse(body) as { type?: unknown; data?: unknown };
    return typeof event.type === 'string' && typeof event.data === 'object' && event.data !== null
      ? { type: event.type, data: event.data as Json }
      : null;
  } catch {
    return null;
  }
}

/**
 * Applies one event. A user whose password has changed has every session of
 * ours made before it ended; every other event, and a user who never had a
 * password, changes nothing. Throws when the database does, so Svix tries
 * again.
 */
export async function applyClerkEvent(db: D1Like, body: string): Promise<void> {
  const event = eventOf(body);
  const subject = event?.type === 'user.updated' ? event.data.id : null;
  const changedAt = event ? passwordChangedAt(event.data) : null;
  if (typeof subject === 'string' && changedAt !== null) {
    await endSessionsBeforePassword(db, subject, changedAt);
  }
}
