/**
 * What registering on the site does to the event beyond the list itself
 * (see functions/api/tournaments/[code]/decklists.ts): who is registered and
 * whether the event has room, and keeping the event's player list and its
 * check-in in step with a registration as it is renamed, switched between a
 * pasted and a paper list, or withdrawn.
 */

import { withMark } from '../../../shared/tournament/checkins.js';
import type { Command } from '../../../shared/tournament/commands.js';
import { birthYearFits, decklistPlayer } from '../../../shared/tournament/identify.js';
import type { Player } from '../../../shared/tournament/types.js';
import { type DeckMode, isSanctioned } from '../../../shared/tournament/view.js';
import { msg } from '../../../shared/i18n.js';
import { jsonResponse } from '../api/responses.js';
import type { D1Like } from '../types.js';
import { withDeck } from './decks.js';
import { commandChanges } from './results.js';
import type { Changes, TournamentRow } from './store.js';

export const FULL = msg('This event is full.');

/** The refusal of a newcomer to a full event; its body says `full`, so a page tells it apart in any language. */
export const fullRefusal = (): Response =>
  jsonResponse({ error: FULL, status: 403, full: true }, { status: 403, cacheControl: 'no-store', cors: false });

/** Who is registered: everyone still on the event's list, and at a TOM event anyone with a list in who is not on it yet. */
export async function registeredCount(db: D1Like, row: TournamentRow): Promise<number> {
  const listed = row.tournament.players.filter(player => player.droppedAfter === null);
  if (row.mode !== 'tom') {
    return listed.length;
  }
  const { results } = await db.prepare('SELECT pop_id FROM decklists WHERE code = ?').bind(row.code).all<{
    pop_id: string;
  }>();
  const ids = new Set(row.tournament.players.map(player => player.id));
  return listed.length + results.filter(list => !ids.has(list.pop_id)).length;
}

/** Whether a newcomer would go past the event's cap. Staff may add past it; a registration may not. */
export async function isFull(db: D1Like, row: TournamentRow): Promise<boolean> {
  return row.settings.playerCap > 0 && (await registeredCount(db, row)) >= row.settings.playerCap;
}

/** Whether the event's own list is at its cap, as a Swiss event's write judges it. */
export const rosterFull = (row: TournamentRow): boolean =>
  row.settings.playerCap > 0 &&
  row.tournament.players.filter(player => player.droppedAfter === null).length >= row.settings.playerCap;

interface Who {
  popId: string;
  firstName: string;
  lastName: string;
}

/** The player on the event's list a registration is, by its Player ID or, unsanctioned, its name. */
export function rosterPlayer(row: TournamentRow, who: Who): Player | undefined {
  const id = decklistPlayer(row.tournament, who, isSanctioned(row));
  return id === undefined ? undefined : row.tournament.players.find(player => player.id === id);
}

/** The birth year proves the Player ID: the one the event's list has for it, or the one its list was sent with. */
export function provesId(row: TournamentRow, popId: string, year: string, listed: string | null): boolean {
  const player = row.tournament.players.find(candidate => candidate.id === popId);
  if (player) {
    return birthYearFits(player.birthDate, year);
  }
  return listed !== null && birthYearFits(listed, year);
}

/** What a registration's save asks of the event: the player's name as they now give it, and how they hand in their list. */
export interface Kept {
  /** Their name as the registration had it, when an unsanctioned rename moved it from there. */
  was?: Who;
  now: Who;
  mode: DeckMode;
  /** What the pasted list reads as; null for a paper one, or one no rule fits. */
  archetype: string | null;
  localTime: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const combine = (left: Changes | string, right: Changes): Changes | string =>
  typeof left === 'string' ? left : { ...left, ...right };

function renaming(row: TournamentRow, player: Player, now: Who): Command | null {
  const same = player.firstName === now.firstName && player.lastName === now.lastName;
  // TOM keeps its own list, and a finished event's stands as it ended.
  return same || row.mode !== 'swiss' || row.settings.finished
    ? null
    : {
        type: 'editPlayer',
        id: player.id,
        firstName: now.firstName,
        lastName: now.lastName,
        birthDate: player.birthDate
      };
}

/**
 * The changes that keep the event in step with a saved registration: the
 * player list takes a new name (an event the site runs; TOM keeps its own),
 * and check-in asks for a paper list from whoever chose to hand one in.
 */
/** The ID check-in and archetypes keep a registration under: its player's on the event's list, else its Player ID. */
const keptId = (row: TournamentRow, player: Player | undefined, who: Who): string | null =>
  player?.id ?? (isSanctioned(row) ? who.popId : null);

export function keptChanges(row: TournamentRow, kept: Kept, localTime: unknown): Changes | string {
  const player = rosterPlayer(row, kept.was ?? kept.now);
  const id = keptId(row, player, kept.now);
  const checkins = id === null ? row.checkins : withMark(row.checkins, id, 'paper', kept.mode === 'paper');
  const inferredDecks = id === null ? row.inferredDecks : withDeck(row.inferredDecks, id, kept.archetype);
  const changes: Changes = {
    ...(same(checkins, row.checkins) ? {} : { checkins }),
    ...(same(inferredDecks, row.inferredDecks) ? {} : { inferredDecks })
  };
  const command = player ? renaming(row, player, kept.now) : null;
  return command ? combine(commandChanges(row, command, localTime), changes) : changes;
}

/**
 * The changes a withdrawal makes to the event: the player leaves its list (an
 * event the site runs, before round 1), and their check-in goes.
 */
export function withdrawnChanges(row: TournamentRow, who: Who, localTime: unknown): Changes | string {
  const player = rosterPlayer(row, who);
  const id = keptId(row, player, who);
  const { [id ?? '']: _gone, ...checkins } = row.checkins;
  const { [id ?? '']: _read, ...inferredDecks } = row.inferredDecks;
  const changes: Changes = {
    ...(id !== null && id in row.checkins ? { checkins } : {}),
    ...(id !== null && id in row.inferredDecks ? { inferredDecks } : {})
  };
  if (!player || row.mode !== 'swiss') {
    return changes;
  }
  return combine(commandChanges(row, { type: 'removePlayer', id: player.id }, localTime), changes);
}
