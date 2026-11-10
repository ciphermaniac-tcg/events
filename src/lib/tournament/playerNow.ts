/**
 * Where a player is in the event right now, for staff walking over (see
 * StaffSheet): at a table against someone, on a bye, marked for a missed
 * round, out of the event, or not in the round at all.
 */

import { isBye } from '../../../shared/tournament/standings';
import type { Pod, Round, Tournament } from '../../../shared/tournament/types';
import { currentMatchOf, seatMark } from './present';

export type PlayerNow =
  | { kind: 'table'; pod: Pod; round: Round; table: number; opponent: string; mark: string }
  | { kind: 'bye' | 'missed'; pod: Pod; round: Round }
  | { kind: 'out'; after: number; disqualified: boolean }
  | { kind: 'none' };

export function playerNow(tournament: Tournament, playerId: string): PlayerNow {
  const at = currentMatchOf(tournament, playerId);
  if (at) {
    const { pod, round, match } = at;
    const seat = match.p1 === playerId ? 1 : 2;
    const opponent = seat === 1 ? match.p2 : match.p1;
    if (opponent) {
      return { kind: 'table', pod, round, table: match.table, opponent, mark: seatMark(match.outcome, seat) };
    }
    return { kind: isBye(match.outcome) ? 'bye' : 'missed', pod, round };
  }
  const player = tournament.players.find(p => p.id === playerId);
  return player && player.droppedAfter !== null
    ? { kind: 'out', after: player.droppedAfter, disqualified: player.disqualified === true }
    : { kind: 'none' };
}
