/**
 * Sign-in for the native app, where Google refuses the app's webview. The
 * app opens the system browser at /api/auth/login/google with `app=1` and the
 * SHA-256 (hex) of a random verifier only it holds. The browser signs in as
 * usual, but its callback starts no session there: the provider's answer is
 * kept here under a ticket for a minute and the browser hands the ticket to
 * the app by its link (ciphermaniac-events://auth). The app then posts the
 * ticket and the verifier to /api/auth/redeem from a page of the site in its
 * own webview, which finishes the sign-in into the app's cookies.
 *
 * A ticket is random and stored hashed, works once, and only with the
 * verifier whose hash it was minted for: another app that catches the link
 * holds the ticket but not the verifier.
 */

import type { D1Like } from '../types.js';
import type { Profile } from './oauth.js';
import { randomToken, sameDigest, sha256 } from './session.js';

export const TICKET_SECONDS = 60;

/** Where the browser hands the ticket to the app. */
export const APP_RETURN = 'ciphermaniac-events://auth';

/** What the app's sign-in started with, kept until it is redeemed. */
export interface AppSignIn {
  profile: Profile;
  next: string;
  linking: boolean;
}

/**
 * What the app starts a sign-in with: the challenge, the hex SHA-256 of its
 * verifier, and a random attempt id the link back names, so the app spends
 * only the verifier of the attempt a link belongs to.
 */
export interface AppStart {
  challenge: string;
  attempt: string;
}

const isHex = (value: string | null | undefined, length: number): value is string =>
  typeof value === 'string' && value.length === length && /^[0-9a-f]+$/.test(value);

/** The app's start as it sends it, or null when either part is missing or malformed. */
export function readAppStart(
  challenge: string | null | undefined,
  attempt: string | null | undefined
): AppStart | null {
  return isHex(challenge, 64) && isHex(attempt, 32) ? { challenge, attempt } : null;
}

/** Deletes every ticket that ran out. Each mint, each redeem and the idle sweep run it. */
export const sweepTickets = (db: D1Like, now: number) =>
  db.prepare('DELETE FROM app_sign_in_tickets WHERE expires_at <= ?').bind(now);

/** Keeps the sign-in for the app and returns its ticket. */
export async function mintTicket(db: D1Like, signIn: AppSignIn, challenge: string, now = Date.now()): Promise<string> {
  const ticket = randomToken();
  await db.batch([
    sweepTickets(db, now),
    db
      .prepare(
        'INSERT INTO app_sign_in_tickets (ticket_hash, challenge, profile, next, linking, expires_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(
        await sha256(ticket),
        challenge,
        JSON.stringify(signIn.profile),
        signIn.next,
        signIn.linking ? 1 : 0,
        now + TICKET_SECONDS * 1000
      )
  ]);
  return ticket;
}

interface TicketRow {
  challenge: string;
  profile: string;
  next: string;
  linking: number;
}

function readSignIn(row: TicketRow): AppSignIn | null {
  try {
    const profile = JSON.parse(row.profile) as Partial<Profile>;
    return typeof profile.provider === 'string' && typeof profile.subject === 'string'
      ? { profile: profile as Profile, next: row.next, linking: row.linking === 1 }
      : null;
  } catch {
    return null;
  }
}

/**
 * Takes the ticket out, once, whatever the verifier: a wrong one uses it up
 * too, so a caught ticket cannot be tried twice. Null when there is none, it
 * ran out, or the verifier is not the one it was minted for.
 */
export async function redeemTicket(
  db: D1Like,
  ticket: string,
  verifier: string,
  now = Date.now()
): Promise<AppSignIn | null> {
  const [taken] = await db.batch([
    db
      .prepare(
        'DELETE FROM app_sign_in_tickets WHERE ticket_hash = ? AND expires_at > ? ' +
          'RETURNING challenge, profile, next, linking'
      )
      .bind(await sha256(ticket), now),
    sweepTickets(db, now)
  ]);
  const row = (taken?.results as TicketRow[] | undefined)?.[0];
  return row && sameDigest(row.challenge, await sha256(verifier)) ? readSignIn(row) : null;
}

/**
 * The browser's last page: it opens the app with the ticket, and keeps a
 * button for when the browser waits for a tap before leaving for an app.
 */
export function returnToApp(ticket: string, attempt: string, cookies: readonly string[]): Response {
  // A ticket is URL-safe base64 (randomToken) and an attempt hex, so neither needs escaping in the markup.
  const link = `${APP_RETURN}?ticket=${ticket}&attempt=${attempt}`;
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta http-equiv="refresh" content="0;url=${link}"><title>Finish signing in</title>` +
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:24rem;margin:4rem auto;padding:0 1rem;' +
    'color:#1d1d1f;background:#fff}a{display:inline-block;margin-top:1rem;padding:.75rem 1.25rem;' +
    'border-radius:.5rem;background:#1d1d1f;color:#fff;text-decoration:none}</style></head>' +
    '<body><p>Open Ciphermaniac Events to finish signing in.</p>' +
    `<a href="${link}">Open Ciphermaniac Events</a></body></html>`;
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer'
  });
  for (const value of cookies) {
    headers.append('Set-Cookie', value);
  }
  return new Response(body, { status: 200, headers });
}
