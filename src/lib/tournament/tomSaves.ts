/**
 * When TOM saves its file, as the console linked to it sees it.
 *
 * TOM autosaves on a fixed beat, five minutes unless the organizer changed
 * it, and saves again in between when it is told to. Its autosave clock keeps
 * its own time, so a save in between splits one gap in two while the gaps
 * around it stay the beat. Splitting only ever makes gaps shorter, and a
 * burst of saves while results go in makes many short ones, so the beat is the
 * longest gap that keeps coming round. Until one has come round twice, the
 * console does not know it.
 */

const MINUTE_MS = 60_000;
/** Enough saves to see the beat through a few saves in between. */
const KEPT = 12;

/** The saves to remember after one at `at`: the newest few, oldest first. */
export function withSave(saves: readonly number[], at: number): number[] {
  return saves.at(-1) === at ? [...saves] : [...saves, at].slice(-KEPT);
}

/** How often each gap between saves came round, in whole minutes; a gap under half a minute is no beat. */
function gapCounts(saves: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [i, at] of saves.entries()) {
    const minutes = i === 0 ? 0 : Math.round((at - (saves[i - 1] ?? at)) / MINUTE_MS);
    if (minutes >= 1) {
      counts.set(minutes, (counts.get(minutes) ?? 0) + 1);
    }
  }
  return counts;
}

/** TOM's autosave beat in whole minutes: the longest gap that has come round twice, or null before one has. */
export function autosaveMinutes(saves: readonly number[]): number | null {
  const recurring = [...gapCounts(saves)].filter(([, count]) => count >= 2).map(([minutes]) => minutes);
  return recurring.length > 0 ? Math.max(...recurring) : null;
}

/** Whether TOM has gone two beats without saving, which a TOM still open never does. */
export function savesLate(now: number, last: number, minutes: number | null): boolean {
  return minutes !== null && now - last > 2 * minutes * MINUTE_MS;
}

/** Whole minutes since `at`, never below zero. */
export const minutesSince = (now: number, at: number): number => Math.max(0, Math.floor((now - at) / MINUTE_MS));
