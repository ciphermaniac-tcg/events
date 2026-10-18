/**
 * The home page's sample event, as pure data: the mark a seat shows, the
 * record a player reads, and the timeline the rounds play out on. The page
 * (pages/tournaments/sampleRun) applies each step on a timer, so this module
 * can be tested without a browser.
 */

import { recordLabel } from '../../../shared/tournament/standings';
import type { SampleStanding, SampleTable } from './sampleEvent';

/** A seat's mark once its table is in: W, L or T; '' before. */
export function markOf(table: SampleTable, name: string | null, done: boolean): string {
  if (!done) {
    return '';
  }
  if (table.winner === null) {
    return 'T';
  }
  return table.winner === name ? 'W' : 'L';
}

/** "3-1-0", as standings write it. */
export const recordOf = (line: SampleStanding | undefined): string =>
  recordLabel(line ?? { wins: 0, losses: 0, ties: 0 });

/** What the page does at a moment of the timeline. */
export type SampleStep =
  | { at: number; kind: 'round'; round: number }
  | { at: number; kind: 'landed'; landed: number }
  | { at: number; kind: 'finished' }
  | { at: number; kind: 'restart' };

export interface SampleTiming {
  /** Milliseconds between results landing. */
  beat: number;
  /** A beat to read a finished round before the next is paired. */
  read: number;
  /** How long the final standings rest before a new event starts. */
  rest: number;
}

/**
 * The steps that play `rounds` out from the start of round one: each later
 * round opens after the one before has read through, its results land a beat
 * apart, and the event ends and restarts after the rest.
 */
export function scheduleRounds(rounds: readonly (readonly SampleTable[])[], timing: SampleTiming): SampleStep[] {
  const steps: SampleStep[] = [];
  let at = 0;
  rounds.forEach((tables, index) => {
    if (index > 0) {
      steps.push({ at, kind: 'round', round: index + 1 });
    }
    tables.forEach((_, i) => steps.push({ at: at + (i + 1) * timing.beat, kind: 'landed', landed: i + 1 }));
    at += (tables.length + 1) * timing.beat + timing.read;
  });
  const end = at - timing.read;
  steps.push({ at: end, kind: 'finished' }, { at: end + timing.rest, kind: 'restart' });
  return steps;
}
