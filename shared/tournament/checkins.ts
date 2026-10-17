/**
 * Staff check-in before round 1: whether each player paid the entry fee, is
 * entered in TOM, and handed in the paper decklist they said they would
 * bring. Only what the event asks for is checked: a fee when it has one, TOM
 * when TOM runs it, a paper list when the player chose to hand one in.
 *
 * At an event the site pairs, round 1 waits on every player still in. A TOM
 * event pairs in TOM, so the console can only count who is left and warn.
 */

import type { Player } from './types.js';
import { msg, msgf } from '../i18n.js';

/** What staff checked for a player, keyed in CheckIns by the player's ID. */
export interface CheckIn {
  paid?: true;
  tom?: true;
  /** The paper list is in staff's hands. */
  list?: true;
  /** The player chose to hand in a paper list, so `list` is asked of them. */
  paper?: true;
}

export type CheckIns = Record<string, CheckIn>;

/** What staff tick: `paper` is the player's choice, not a check. */
export type CheckMark = 'paid' | 'tom' | 'list';

export const CHECK_MARKS: readonly CheckMark[] = ['paid', 'tom', 'list'];

/** What of an event says which checks it asks: who pairs it (TOM or the site), and its fee. */
type Event = { mode: 'swiss' | 'tom'; settings: { entryFee: number } };

/** The checks the event asks of a player whose own check-in reads `held`. */
export function marksFor(event: Event, held: CheckIn | undefined): CheckMark[] {
  return CHECK_MARKS.filter(mark => {
    if (mark === 'paid') {
      return event.settings.entryFee > 0;
    }
    return mark === 'tom' ? event.mode === 'tom' : held?.paper === true;
  });
}

/** The checks still open for a player. */
export function openMarks(event: Event, held: CheckIn | undefined): CheckMark[] {
  return marksFor(event, held).filter(mark => held?.[mark] !== true);
}

/** The players still in whom some check is open for, in roster order. */
export function notCheckedIn(event: Event, players: readonly Player[], checkins: CheckIns): Player[] {
  return players.filter(player => player.droppedAfter === null && openMarks(event, checkins[player.id]).length > 0);
}

/** A player's check-in with one mark set or cleared; an empty one goes from the map. */
export function withMark(checkins: CheckIns, id: string, mark: keyof CheckIn, on: boolean): CheckIns {
  const { [mark]: _old, ...rest } = checkins[id] ?? {};
  const next: CheckIn = on ? { ...rest, [mark]: true } : rest;
  const { [id]: _was, ...others } = checkins;
  return Object.keys(next).length > 0 ? { ...others, [id]: next } : others;
}

/** Why round 1 cannot be paired yet at an event the site pairs, or null when everyone still in is checked in. */
export function checkInError(event: Event, players: readonly Player[], checkins: CheckIns): string | null {
  const open = notCheckedIn(event, players, checkins).length;
  if (open === 0) {
    return null;
  }
  return open === 1 ? msg('1 player isn’t checked in.') : msgf('{n} players aren’t checked in.', { n: open });
}
