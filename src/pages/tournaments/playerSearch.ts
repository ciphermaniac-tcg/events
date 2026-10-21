/**
 * Finding a player in a long list, as a judge does at a table: by name, by
 * Player ID, or by the table number they sit at this round. Lists sorted by
 * last name show the name the same way, "Last, First", so the order reads,
 * but a name is found however it is typed: "Ana Lopez", "Lopez, Ana" or "lop".
 */

import { type Player, type Tournament } from '../../../shared/tournament/types';
import { seatOf } from '../../lib/tournament/present';

/** A player's name as a list sorted by last name shows it. */
export const sortName = (player: Pick<Player, 'firstName' | 'lastName'>) => `${player.lastName}, ${player.firstName}`;

/** By last name, then first. */
export const byLastName = (a: Player, b: Player) =>
  a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);

/**
 * What a typed number finds: the players at that table this round, then
 * those whose Player ID starts with it. Anything else is left to the name
 * search (undefined).
 */
export function byNumber(tournament: Tournament, players: readonly Player[], query: string): Player[] | undefined {
  const q = query.trim();
  if (!/^\d+$/.test(q)) {
    return undefined;
  }
  const seated = players.filter(player => seatOf(tournament, player.id) === Number(q));
  return [...seated, ...players.filter(player => player.id.startsWith(q) && !seated.includes(player))];
}

/** Whether every word typed is somewhere in the player's name, in any order. */
function named(player: Player, words: readonly string[]): boolean {
  const name = `${player.firstName} ${player.lastName}`.toLowerCase();
  return words.every(word => name.includes(word));
}

/** What a query finds: a number as byNumber reads it, anything else every player whose name holds each word typed. */
export function findPlayers(tournament: Tournament, players: readonly Player[], query: string): Player[] {
  const words = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  return byNumber(tournament, players, query) ?? players.filter(player => named(player, words));
}
