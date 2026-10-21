/**
 * The players registered on the site that a TOM event's file does not list
 * yet: before round 1 staff check them in here and enter them in TOM, and
 * deleting the event counts them.
 */

import { hasStarted } from '../../../shared/tournament/rounds';
import type { Player } from '../../../shared/tournament/types';
import type { Decklist, Manage } from '../../lib/tournament/api';

/** The event's code while its site registrations are worth reading, at a TOM event before round 1; null otherwise. */
export const registrantsSource = (manage: Manage) =>
  manage.mode === 'tom' && !hasStarted(manage.tournament) ? manage.code : null;

/** Everyone of `lists` the event's file does not list yet, as players. */
export function siteRegistrants(manage: Pick<Manage, 'tournament'>, lists: readonly Decklist[]): Player[] {
  const known = new Set(manage.tournament.players.map(player => player.id));
  return lists
    .filter(list => !known.has(list.popId))
    .map(list => ({
      id: list.popId,
      firstName: list.firstName,
      lastName: list.lastName,
      birthDate: list.birthDate,
      droppedAfter: null,
      created: '',
      modified: ''
    }));
}
