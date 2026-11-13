/**
 * What every roster row reads of the event: the pod a player is in, their
 * round marks and whether they joined late. The roster draws a row per player,
 * so each is worked out once for the pod, not once for every row reading it.
 */

import { playerPod } from '../../../shared/tournament/rounds';
import type { Match, Pod, Tournament } from '../../../shared/tournament/types';
import { seatMark } from '../../lib/tournament/present';

export interface RosterFacts {
  pod: Pod;
  /** A mark per round played, padded to the pod's rounds (see matchHistory). */
  marks: string[];
  /** Whether they joined after a round was paired (see joinedLate). */
  joinedLate: boolean;
}

type Row = Omit<RosterFacts, 'pod'>;

const byPod = new WeakMap<Pod, Map<string, Row>>();

/** Sets a seat's mark on its player's row, and hands the row back for a bye or late check. */
function markSeat(rows: Map<string, Row>, index: number, match: Match, seat: 1 | 2) {
  const row = rows.get(seat === 1 ? match.p1 : (match.p2 as string));
  if (row) {
    row.marks[index] = seatMark(match.outcome, seat);
  }
  return row;
}

/** One pod's players and their marks, worked out on first use and kept for the pod's tournament copy. */
function factsOfPod(pod: Pod): Map<string, Row> {
  const kept = byPod.get(pod);
  if (kept) {
    return kept;
  }
  const rows = new Map<string, Row>();
  for (const id of pod.playerIds) {
    rows.set(id, { marks: pod.rounds.map(() => ''), joinedLate: false });
  }
  for (const [index, round] of pod.rounds.entries()) {
    for (const match of round.matches) {
      const first = markSeat(rows, index, match, 1);
      if (match.p2 !== null) {
        markSeat(rows, index, match, 2);
      } else if (first && match.outcome === 'loss') {
        first.joinedLate = true;
      }
    }
  }
  byPod.set(pod, rows);
  return rows;
}

/** Every player's roster facts, on the pod the console lists them in (see playerPod). */
export function rosterFacts(tournament: Tournament): Map<string, RosterFacts> {
  const facts = new Map<string, RosterFacts>();
  for (const player of tournament.players) {
    const pod = playerPod(tournament, player.id);
    const row = pod ? factsOfPod(pod).get(player.id) : undefined;
    if (pod && row) {
      facts.set(player.id, { pod, ...row });
    }
  }
  return facts;
}
