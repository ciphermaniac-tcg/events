/**
 * Which players the console's roster shows: everyone, or before round 1 only
 * those not checked in, narrowed by a search on the name or Player ID.
 */

import { type CheckIns, notCheckedIn } from '../../../shared/tournament/checkins';
import { type Player, playerName } from '../../../shared/tournament/types';

const ROSTER_FILTERS = ['all', 'unchecked'] as const;
export type RosterFilter = (typeof ROSTER_FILTERS)[number];

export const isRosterFilter = (value: unknown): value is RosterFilter => ROSTER_FILTERS.includes(value as RosterFilter);

type Event = Parameters<typeof notCheckedIn>[0] & { checkins?: CheckIns };

const STATUS: Record<RosterFilter, (event: Event, player: Player) => boolean> = {
  all: () => true,
  unchecked: (event, player) => notCheckedIn(event, [player], event.checkins ?? {}).length > 0
};

/** Whether the roster shows the player for `filter` and the search `query`. */
export function inRoster(event: Event, player: Player, filter: RosterFilter, query: string): boolean {
  const q = query.trim().toLowerCase();
  const found = !q || playerName(player).toLowerCase().includes(q) || player.id.includes(q);
  return found && STATUS[filter](event, player);
}
