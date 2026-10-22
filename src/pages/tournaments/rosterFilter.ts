/**
 * Which players the console's roster shows: everyone, or those of one status
 * (still in, dropped, late, or before round 1 not checked in), narrowed by a
 * search on the name or Player ID. Site registrants a TOM event has not taken
 * in yet go through the same filter, so a search never leaves them standing.
 */

import { type CheckIns, notCheckedIn } from '../../../shared/tournament/checkins';
import { joinedLate, playerPod } from '../../../shared/tournament/rounds';
import { type Player, playerName, type Tournament } from '../../../shared/tournament/types';

const ROSTER_FILTERS = ['all', 'active', 'dropped', 'late', 'unchecked'] as const;
export type RosterFilter = (typeof ROSTER_FILTERS)[number];

export const isRosterFilter = (value: unknown): value is RosterFilter => ROSTER_FILTERS.includes(value as RosterFilter);

type Event = Parameters<typeof notCheckedIn>[0] & { tournament: Tournament; checkins?: CheckIns };

const STATUS: Record<RosterFilter, (event: Event, player: Player) => boolean> = {
  all: () => true,
  active: (_, player) => player.droppedAfter === null,
  dropped: (_, player) => player.droppedAfter !== null,
  late: (event, player) => player.late === true || joinedLate(playerPod(event.tournament, player.id), player.id),
  unchecked: (event, player) => notCheckedIn(event, [player], event.checkins ?? {}).length > 0
};

/** Whether the roster shows the player for `filter` and the search `query`. */
export function inRoster(event: Event, player: Player, filter: RosterFilter, query: string): boolean {
  const q = query.trim().toLowerCase();
  const found = !q || playerName(player).toLowerCase().includes(q) || player.id.includes(q);
  return found && STATUS[filter](event, player);
}
