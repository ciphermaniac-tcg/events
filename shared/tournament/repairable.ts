/**
 * Whether a correction may also pair the next round again (see
 * functions/api/tournaments/[code]/corrections.ts). Pairing again deletes the
 * round, so it is only for one not yet in play: the round after the corrected
 * one is its pod's latest and Swiss, its clock has never started, and nothing
 * is entered in it. No result, time extension, player report or result
 * waiting for staff would be lost.
 */

import { latestRound, type MatchKey } from './rounds.js';
import type { PodCategory, Tournament } from './types.js';

export function repairableRound(
  t: Tournament,
  entered: { reports: readonly MatchKey[]; pending: readonly MatchKey[] },
  pod: PodCategory,
  round: number
): boolean {
  const next = latestRound(t.pods.find(p => p.category === pod));
  const inNext = (key: MatchKey) => key.pod === pod && key.round === round + 1;
  return (
    next?.number === round + 1 &&
    next.kind === 'swiss' &&
    next.startTime === '' &&
    next.matches.every(m => m.p2 === null || (m.outcome === 'pending' && !m.timeExtension)) &&
    ![...entered.reports, ...entered.pending].some(inNext)
  );
}
