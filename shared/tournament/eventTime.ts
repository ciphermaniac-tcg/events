/**
 * An event's times as its organizer sets them: a wall-clock time
 * (YYYY-MM-DDTHH:mm, as a datetime-local input gives it) read in the event's
 * own IANA time zone. Viewers anywhere see the same instant, in the event's
 * time and, where it reads differently, their own. An event made before it
 * had a zone shows its times as written.
 */

import { isWallClock } from './timeZone.js';

/** The wall-clock time `at` reads in `zone`, as the instant that wall clock would be in UTC. */
function wallClock(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far `zone`'s clock runs ahead of UTC at `at`. */
const offsetAt = (at: number, zone: string) => wallClock(at, zone) - at;

/**
 * The instant `local` names in `zone`. Across a daylight-saving change the
 * clock reads some times twice and skips others: a repeated time is its
 * first occurrence, and a skipped one moves forward by the gap (02:30 on the
 * night Chicago springs forward is 03:30 CDT), as JavaScript's Temporal
 * reads them by default.
 */
export function zonedInstant(local: string, zone: string): number {
  const wall = Date.parse(`${local}:00Z`);
  // A day either side lies past any change near `local`: the offsets in force before and after it.
  const before = wall - offsetAt(wall - DAY_MS, zone);
  const after = wall - offsetAt(wall + DAY_MS, zone);
  const fits = [before, after].filter(at => wallClock(at, zone) === wall);
  return fits.length > 0 ? Math.min(...fits) : before;
}

const SHOWN: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
};

const shown = (at: number, timeZone: string, named: boolean) =>
  new Intl.DateTimeFormat(undefined, { ...SHOWN, timeZone, ...(named ? { timeZoneName: 'short' } : {}) }).format(at);

/**
 * `local` in the event's zone, and in `viewer`'s when its clock reads
 * differently then; without an event zone, the time as written.
 */
export function eventTimes(
  local: string,
  zone: string,
  viewer = Intl.DateTimeFormat().resolvedOptions().timeZone
): { event: string; yours: string | null } {
  // A value stored before times were checked shows as written rather than as a wrong or failing date.
  if (!isWallClock(local)) {
    return { event: local, yours: null };
  }
  if (!zone) {
    return { event: shown(Date.parse(`${local}:00Z`), 'UTC', false), yours: null };
  }
  const at = zonedInstant(local, zone);
  return {
    event: shown(at, zone, true),
    yours: wallClock(at, viewer) === wallClock(at, zone) ? null : shown(at, viewer, true)
  };
}
