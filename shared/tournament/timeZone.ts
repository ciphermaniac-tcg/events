/**
 * Time zone names and wall-clock times, as an event's settings hold them
 * (see eventTime.ts for reading its times). Apart from the zone math so the
 * settings checks do not carry it to every page.
 */

const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Whether `value` is a wall-clock time as a datetime-local input gives it,
 * YYYY-MM-DDTHH:mm, naming a day its month has, an hour under 24 and a
 * minute under 60: shape alone would let 2026-02-30 roll into March.
 */
export function isWallClock(value: unknown): value is string {
  const match = typeof value === 'string' ? WALL_CLOCK_RE.exec(value) : null;
  if (!match) {
    return false;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const realDay = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return realDay && hour < 24 && minute < 60;
}

/** Whether `zone` names a time zone this runtime knows. */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone || zone.length > 64) {
    return false;
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
}
