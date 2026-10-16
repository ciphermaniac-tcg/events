/**
 * Staff records: what staff write down about a player during an event, in
 * the round it happened. Deck checks (deckChecks.ts) and penalty notes
 * (penaltyNotes.ts) are the two kinds. Each entry names the player, the
 * round, a staff member (a staff account or a name typed in), a verdict and
 * notes; the site acts on none of them.
 *
 * A record is append-only. An entry is never changed: an edit is a new entry
 * that replaces the one before it, and a removal is a new entry that replaces
 * it with nothing, so every version stays with who wrote it and when. An
 * entry is replaced at most once, so two staff correcting the same entry at
 * once cannot both land.
 */

import type { Tournament } from './types.js';
import { msg, msgf } from '../i18n.js';

/** What every entry in a record carries, whatever its kind. */
export interface RecordedEntry {
  id: string;
  recordedAt: number;
  /** The entry this one edits or removes; null for a first entry. */
  replaces: string | null;
  /** This entry removes the one it replaces. */
  removed: boolean;
}

/** An entry as it stands: its latest version, with the ones it replaced, newest first. */
export type Standing<T extends RecordedEntry> = T & { earlier: T[] };

/** A staff member named on an entry: a staff account, or a name typed in. */
export type StaffMember = { id: string } | { name: string };

/** Who may be named on an entry: the event's staff accounts. */
export interface StaffAccount {
  id: string;
  name: string;
}

export const STAFF_NAME_LIMIT = 60;

export const recordText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** The staff member a body names by account (`idKey`) or typed name (`nameKey`); null for neither, or a name too long. */
export function readStaffMember(value: Record<string, unknown>, idKey: string, nameKey: string): StaffMember | null {
  const id = recordText(value[idKey]);
  if (id) {
    return { id };
  }
  const name = recordText(value[nameKey]);
  return name && name.length <= STAFF_NAME_LIMIT ? { name } : null;
}

/** A field check: the problem a body has when `ok` says no. */
export type RecordCheck = [problem: string, ok: (value: Record<string, unknown>) => boolean];

/** The checks every kind of entry shares: whose, which round, its notes' length, and what it edits. */
export function commonChecks(words: { player: string; edit: string }, notesLimit: number): RecordCheck[] {
  return [
    [words.player, value => recordText(value.playerId) !== ''],
    [msg('Say which round'), value => Number.isInteger(value.round) && (value.round as number) >= 1],
    [
      msgf('Keep the notes under {limit} characters', { limit: notesLimit }),
      value => value.notes === undefined || (typeof value.notes === 'string' && value.notes.length <= notesLimit)
    ],
    [words.edit, value => value.replaces === undefined || value.replaces === null || recordText(value.replaces) !== '']
  ];
}

/** The first problem a body has, in the order `checks` lists them, or null. */
export const firstProblem = (checks: readonly RecordCheck[], value: Record<string, unknown>): string | null =>
  checks.find(([, ok]) => !ok(value))?.[0] ?? null;

/**
 * The entries as they stand, out of every entry in the record: each chain of
 * edits read to its latest entry, with the entries it replaced under it.
 * Removed entries are left out. Newest first.
 */
export function standingEntries<T extends RecordedEntry>(entries: readonly T[]): Standing<T>[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const replaced = new Set(entries.map(entry => entry.replaces).filter(id => id !== null));
  const earlierOf = (entry: T): T[] => {
    const before = entry.replaces === null ? undefined : byId.get(entry.replaces);
    return before ? [before, ...earlierOf(before)] : [];
  };
  return entries
    .filter(entry => !replaced.has(entry.id) && !entry.removed)
    .map(entry => ({ ...entry, earlier: earlierOf(entry) }))
    .sort((a, b) => b.recordedAt - a.recordedAt);
}

/** The latest round a player's division has paired, the last an entry about them may name; 0 before any. */
export function latestRoundOf(tournament: Tournament, playerId: string): number {
  return Math.max(
    0,
    ...tournament.pods
      .filter(pod => pod.playerIds.includes(playerId))
      .flatMap(pod => pod.rounds.map(round => round.number))
  );
}
