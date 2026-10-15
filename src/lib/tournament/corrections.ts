/**
 * What a result correction would change, for the console to show before it
 * is applied (see shared/tournament/corrections.ts). The preview corrects the
 * event with the same function the server applies, and reads the standings
 * the Standings tab shows, so what it shows is what the correction does.
 */

import {
  correctedTournament,
  type CorrectionRequest,
  type NextMatch,
  nextMatches
} from '../../../shared/tournament/corrections';
import { divisionLookup } from '../../../shared/tournament/divisions';
import type { Standing } from '../../../shared/tournament/standings';
import type { Division, Pod, Tournament } from '../../../shared/tournament/types';
import { type DivisionStandings, podStandings } from './present';

/** A player whose standing moves: their row before and after. */
export interface StandingChange {
  before: Standing;
  after: Standing;
}

export interface DivisionChanges {
  division: Division | null;
  changes: StandingChange[];
}

const moved = (before: Standing, after: Standing) =>
  before.place !== after.place ||
  before.points !== after.points ||
  before.owp !== after.owp ||
  before.oowp !== after.oowp ||
  before.record.wins !== after.record.wins ||
  before.record.losses !== after.record.losses ||
  before.record.ties !== after.record.ties;

/** Each division's players whose standing differs between the two, in their new order. */
export function standingChanges(before: DivisionStandings[], after: DivisionStandings[]): DivisionChanges[] {
  return after.flatMap(group => {
    const was = new Map((before.find(b => b.division === group.division)?.rows ?? []).map(row => [row.playerId, row]));
    const changes = group.rows.flatMap(row => {
      const earlier = was.get(row.playerId);
      return earlier && moved(earlier, row) ? [{ before: earlier, after: row }] : [];
    });
    return changes.length ? [{ division: group.division, changes }] : [];
  });
}

export interface CorrectionPreview {
  standings: DivisionChanges[];
  /** The next round's matches with a corrected player in them, read against the corrected record. */
  next: NextMatch[];
}

type Correction = Pick<CorrectionRequest, 'pod' | 'round' | 'table' | 'p1' | 'p2' | 'outcome'>;

/** What correcting the match to `correction.outcome` would change. */
export function correctionPreview(t: Tournament, pod: Pod, correction: Correction): CorrectionPreview {
  const corrected = correctedTournament(t, correction, '');
  const correctedPod = corrected.pods.find(p => p.category === pod.category) ?? pod;
  const divisionOf = divisionLookup(t);
  return {
    standings: standingChanges(podStandings(t, pod, divisionOf), podStandings(corrected, correctedPod, divisionOf)),
    next: nextMatches(corrected, correction)
  };
}
