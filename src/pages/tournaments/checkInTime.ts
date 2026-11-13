/**
 * Check-in beside the start, as setup and the console's Settings set them:
 * both wall-clock times (YYYY-MM-DDTHH:mm) in the event's one zone, so they
 * compare and move as written (see shared/tournament/eventTime.ts).
 */

import { isWallClock } from '../../../shared/tournament/timeZone';

/** The wall-clock time `minutes` before `local`, as a datetime-local input writes it. */
export const wallClockBefore = (local: string, minutes: number): string =>
  new Date(Date.parse(`${local}:00Z`) - minutes * 60_000).toISOString().slice(0, 16);

/** Whether check-in is set later than the start. */
export const checkInAfterStart = (checkInAt: string, startsAt: string): boolean =>
  isWallClock(checkInAt) && isWallClock(startsAt) && checkInAt > startsAt;
