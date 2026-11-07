/**
 * When a player's decklist may still be sent or replaced. Every list locks as
 * round 1 pairs (see decklistsLocked), except a late entrant's: theirs stays
 * open through the round they joined in, as TOM records it, so they and staff
 * can hand one in. The server enforces it; pages use it to show the form.
 */

import { latestRound } from './rounds.js';
import type { Player, Tournament } from './types.js';
import { decklistsLocked, type TournamentSettings } from './view.js';

/**
 * Whether a late entrant is still in the round they joined in: their Swiss
 * pod has paired no round since (TOM's late-entry round), and no top cut has
 * paired out of it.
 */
function inJoiningRound(tournament: Tournament, player: Player): boolean {
  const joined = player.late ? player.lateData?.round : undefined;
  const pod = tournament.pods.find(candidate => !candidate.cutOf && candidate.playerIds.includes(player.id));
  if (joined === undefined || pod === undefined || player.droppedAfter !== null) {
    return false;
  }
  const cutPaired = tournament.pods.some(candidate => candidate.cutOf === pod.category && candidate.rounds.length > 0);
  return !cutPaired && (latestRound(pod)?.number ?? -1) === joined;
}

/**
 * Whether the player's list may be sent or replaced now: by anyone before
 * round 1 is paired, and for a late entrant until the next round pairs after
 * they entered. Players need submission open; staff, only lists taken at all.
 * A null player is someone not on the event, who registers before round 1 only.
 */
export function decklistOpenFor(
  event: { settings: Pick<TournamentSettings, 'decklists' | 'finished'>; tournament: Tournament },
  playerId: string | null,
  actor: 'player' | 'staff' = 'player'
): boolean {
  const taking = actor === 'staff' ? event.settings.decklists !== 'off' : event.settings.decklists === 'open';
  if (!taking || !decklistsLocked(event)) {
    return taking;
  }
  const player = event.tournament.players.find(candidate => candidate.id === playerId);
  return !event.settings.finished && player !== undefined && inJoiningRound(event.tournament, player);
}

/** Whether any late entrant may still send their list, so the page keeps its form after round 1. */
export function lateListsOpen(event: {
  settings: Pick<TournamentSettings, 'decklists' | 'finished'>;
  tournament: Tournament;
}): boolean {
  return decklistsLocked(event) && event.tournament.players.some(player => decklistOpenFor(event, player.id));
}
