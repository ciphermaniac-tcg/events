/**
 * Where a clock stands, read the same way by every clock the site draws: the
 * console's, a player's table, the public page's status line, the big screen,
 * a stream overlay and a table's extra time. Each surface puts its own words
 * to the phase; none of them reads a state from the clock's colour or sign.
 */

import { secondsLeft } from '../../../shared/tournament/rounds';
import type { Round } from '../../../shared/tournament/types';

/**
 * running: counting down the round's time. extended: counting down a table's
 * extra time once the round's is out. paused: stopped by staff. over: no
 * time left, extra time included. stale: the page has not heard from the
 * event for a while, so the clock stops where it was when the page fell behind.
 * done: the table or round has its result, and the clock has nothing to count.
 */
export type ClockPhase = 'running' | 'extended' | 'paused' | 'over' | 'stale' | 'done';

export interface ClockState {
  phase: ClockPhase;
  /** Seconds left with any extra time, below zero once over; as of the moment the page fell behind while stale. */
  left: number;
  /** `left` as m:ss, without a sign. */
  time: string;
}

export interface ClockInput {
  round: Round;
  now: number;
  /** A table's extra time, in seconds. */
  extraSeconds?: number;
  /** The table, or the whole round, has its result. */
  done?: boolean;
  /** When the page fell behind the event, while what it has is stale; null or absent while fresh. */
  staleSince?: number | null;
}

/** m:ss for a number of seconds, without a sign. */
export function clockTime(seconds: number): string {
  const abs = Math.abs(seconds);
  return `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

function phaseOf(input: ClockInput, roundLeft: number, left: number): ClockPhase {
  if (input.done) {
    return 'done';
  }
  if (input.staleSince != null) {
    return 'stale';
  }
  if (left <= 0) {
    return 'over';
  }
  if (input.round.clockStartedAt == null) {
    return 'paused';
  }
  return roundLeft <= 0 ? 'extended' : 'running';
}

/** The clock's state, or null for a round whose clock has never started. */
export function clockState(input: ClockInput): ClockState | null {
  const { round } = input;
  if (round.clockStartedAt == null && !round.startTime && !input.done) {
    return null;
  }
  const at = input.staleSince != null ? Math.min(input.now, input.staleSince) : input.now;
  const roundLeft = secondsLeft(round, at);
  const left = roundLeft + (input.extraSeconds ?? 0);
  return { phase: phaseOf(input, roundLeft, left), left, time: clockTime(left) };
}
