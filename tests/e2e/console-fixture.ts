/**
 * What the browser tests of an event's console build alike: the event, made
 * with the same shared commands the functions apply, and the organizer the
 * console is signed in as.
 */

import { applyCommand, type Command } from '../../shared/tournament/commands';
import { seededRandom } from '../../shared/tournament/random';
import type { Tournament } from '../../shared/tournament/types';

/** Apply each command in turn, each on the same clock and season and a freshly seeded random stream. */
export function runCommands(tournament: Tournament, ...commands: Command[]): Tournament {
  let current = tournament;
  for (const command of commands) {
    const ctx = { now: 0, localTime: '09/29/2026 10:00:00', season: 2027, random: seededRandom(3) };
    const result = applyCommand(current, command, ctx);
    if (!result.ok) {
      throw new Error(`${command.type}: ${result.error}`);
    }
    current = result.tournament;
  }
  return current;
}

/** The `/api/me` answer for the signed-in organizer, with any account fields a test needs besides. */
export function organizerMe(extra: Record<string, unknown> = {}) {
  const user = { id: 'u1', name: 'Organizer', avatar: null, popId: null, firstName: null, lastName: null };
  const account = { ...user, birthDate: null, role: 'community', stores: [], handle: 'organizer', ...extra };
  return { user: { ...account, providers: ['dev'] }, providers: ['dev'] };
}
