/**
 * What the big screen shows, by where the event stands: everyone registered
 * before round 1, a round's tables once it is paired, the clock above them
 * once it starts, the results for the room to check once every table has
 * one, and the standings once the Swiss rounds are played, so the room sees
 * who made the top cut before it is paired, and again once the event ends.
 */

import type { PendingResult } from '../../../shared/tournament/view';
import { latestRound } from '../../../shared/tournament/rounds';
import type { Pod, Round } from '../../../shared/tournament/types';
import { podProgress } from './present';

export type ScreenPhase = 'roster' | 'paired' | 'clock' | 'results' | 'standings';

/** A round's clock has started once it has a start time, even if it was stopped since. */
const clockStarted = (round: Round): boolean => round.startTime !== '' || round.clockStartedAt != null;

/** Whether a pod has played every Swiss round its plan calls for (`planned`), and nothing after them. */
const swissPlayed = (pod: Pod, planned: (pod: Pod) => number): boolean => {
  const round = latestRound(pod);
  return round?.kind === 'swiss' && round.number >= planned(pod);
};

/**
 * The phase for the pods on the screen, each at its latest round. `planned`
 * is how many Swiss rounds a pod plays (see plannedRounds).
 */
export function screenPhase(
  pods: readonly Pod[],
  pending: readonly PendingResult[],
  finished: boolean,
  planned: (pod: Pod) => number
): ScreenPhase {
  const progress = pods.map(pod => podProgress(pod, pending)).filter(p => p.round !== undefined);
  if (!progress.length) {
    return 'roster';
  }
  if (finished) {
    return 'standings';
  }
  if (progress.every(p => p.tables > 0 && p.open === 0)) {
    return pods.some(pod => swissPlayed(pod, planned)) ? 'standings' : 'results';
  }
  return progress.some(p => clockStarted(p.round as Round)) ? 'clock' : 'paired';
}
