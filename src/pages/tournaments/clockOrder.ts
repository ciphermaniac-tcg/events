/**
 * Which clocks the big screen shows while divisions play. Each division runs
 * its own latest round, so a division waiting to start or done reporting says
 * so rather than lending the screen an idle clock. The lead is the running
 * clock with the least time left: the one the room is most likely to ask about.
 */

import type { PendingResult } from '../../../shared/tournament/view';
import { latestRound, secondsLeft } from '../../../shared/tournament/rounds';
import type { Pod, Round } from '../../../shared/tournament/types';
import { podLabel, podProgress, roundLabel } from '../../lib/tournament/present';

export type ClockState = 'running' | 'paused' | 'waiting' | 'done';

export interface DivisionClock {
  round: Round;
  state: ClockState;
  /** "Masters · Round 3", or the cut stage in a cut. */
  label: string;
  /** Seconds left, for ordering only. */
  left: number;
}

function clockState(pod: Pod, round: Round, pending: readonly PendingResult[]): ClockState {
  const progress = podProgress(pod, pending);
  if (progress.tables > 0 && progress.open === 0) {
    return 'done';
  }
  if (round.clockStartedAt != null) {
    return 'running';
  }
  return round.startTime === '' ? 'waiting' : 'paused';
}

const RANK: Record<ClockState, number> = { running: 0, paused: 1, waiting: 2, done: 3 };

/** One clock per division at its latest round, the lead first; the rest keep the screen's division order. */
export function divisionClocks(pods: readonly Pod[], pending: readonly PendingResult[], now: number): DivisionClock[] {
  const clocks = pods.flatMap(pod => {
    const round = latestRound(pod);
    return round
      ? [
          {
            round,
            state: clockState(pod, round, pending),
            label: `${podLabel(pod)} · ${roundLabel(round, pod)}`,
            left: secondsLeft(round, now)
          }
        ]
      : [];
  });
  const lead = clocks.reduce<DivisionClock | undefined>(
    (best, clock) =>
      !best || RANK[clock.state] < RANK[best.state] || (clock.state === best.state && clock.left < best.left)
        ? clock
        : best,
    undefined
  );
  return lead ? [lead, ...clocks.filter(clock => clock !== lead)] : [];
}
