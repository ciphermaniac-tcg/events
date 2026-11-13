/**
 * Which players the console's roster shows: everyone, or those of one status
 * (still in, dropped, late, or before round 1 not checked in), narrowed by
 * the same search Penalties uses (see findPlayers): a name typed either way
 * round, a table number or a Player ID. Site registrants a TOM event has not
 * taken in yet go through the same filter, so a search never leaves them
 * standing.
 */

import { type CheckIns, notCheckedIn } from '../../../shared/tournament/checkins';
import { type Player, type Pod, type Tournament } from '../../../shared/tournament/types';
import { findPlayers } from './playerSearch';

const ROSTER_FILTERS = ['all', 'active', 'dropped', 'late', 'unchecked'] as const;
export type RosterFilter = (typeof ROSTER_FILTERS)[number];

export const isRosterFilter = (value: unknown): value is RosterFilter => ROSTER_FILTERS.includes(value as RosterFilter);

type Event = Parameters<typeof notCheckedIn>[0] & { tournament: Tournament; checkins?: CheckIns };

const STATUS: Record<Exclude<RosterFilter, 'late'>, (event: Event, player: Player) => boolean> = {
  all: () => true,
  active: (_, player) => player.droppedAfter === null,
  dropped: (_, player) => player.droppedAfter !== null,
  unchecked: (event, player) => notCheckedIn(event, [player], event.checkins ?? {}).length > 0
};

/** The IDs a missed-round loss marks as late, gathered from every pod's rounds in one pass. */
function lateJoiners(tournament: Tournament): Set<string> {
  const missed = (pod: Pod) =>
    pod.rounds.flatMap(round =>
      round.matches.flatMap(match =>
        match.p2 === null && match.outcome === 'loss' && pod.playerIds.includes(match.p1) ? [match.p1] : []
      )
    );
  return new Set(tournament.pods.flatMap(missed));
}

/** The players of `players` the roster shows for `filter` and the search `query`. */
export function inRoster(event: Event, players: readonly Player[], filter: RosterFilter, query: string): Player[] {
  const found = query.trim() ? findPlayers(event.tournament, players, query) : players;
  if (filter === 'late') {
    // Asking each player's own pod costs every round of it, for every player: one pass covers the roster.
    const late = lateJoiners(event.tournament);
    return found.filter(player => player.late === true || late.has(player.id));
  }
  return found.filter(player => STATUS[filter](event, player));
}
