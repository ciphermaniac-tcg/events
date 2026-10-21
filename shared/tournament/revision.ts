/**
 * Which copy of a TOM event the site holds, as a short fingerprint of the
 * stored document. The browser following the .tdf sends the revision its last
 * sync left, and the server takes the file only if that is still what it
 * holds: a second browser with an older copy of the file cannot overwrite
 * rounds the first one synced. The console computes the same value from the
 * document it loaded, since JSON read back and written again is unchanged.
 *
 * Round clocks are left out: the site runs them, not TOM (see tomClock.ts), so
 * starting one changes nothing a file sync is checked against.
 */

import { withoutClocks } from './tomClock.js';
import type { Tournament } from './types.js';

export async function revisionOf(tournament: Tournament): Promise<string> {
  const text = JSON.stringify(withoutClocks(tournament));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 12)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The event as JSON with its keys in order and its clocks aside: the server stores a file's fields in an order of its own. */
const canonical = (tournament: Tournament) =>
  JSON.stringify(withoutClocks(tournament), (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value
  );

/** Whether two copies hold the same event, whatever order their fields were written in. */
export const sameEvent = (a: Tournament, b: Tournament): boolean => canonical(a) === canonical(b);
