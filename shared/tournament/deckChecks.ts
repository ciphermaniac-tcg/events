/**
 * Deck checks: staff check a player's deck against the list on file during
 * a round, and write down the round, who checked, whether it passed, and
 * what they found. The site applies no penalty for a failed check; it keeps
 * the record the organizer applies one from. A deck check is a staff record
 * (staffRecords.ts): append-only, an edit or removal a new entry.
 */

import {
  commonChecks,
  firstProblem,
  readStaffMember,
  type RecordCheck,
  recordText,
  STAFF_NAME_LIMIT,
  type StaffAccount,
  type StaffMember,
  type Standing,
  standingEntries
} from './staffRecords.js';

export type DeckCheckResult = 'pass' | 'fail';

export const DECK_CHECK_LIMITS = { notes: 1000, checkerName: STAFF_NAME_LIMIT } as const;

/** One entry in the record, as staff read it. */
export interface DeckCheckEntry {
  id: string;
  /** The player's ID in the event's document, and their name when it was written. */
  playerId: string;
  playerName: string;
  round: number;
  /** Who checked the deck: a staff account, or a name typed in. A null name is an account since deleted. */
  checker: { id: string | null; name: string | null };
  result: DeckCheckResult;
  notes: string;
  /** The account that wrote the entry down, by name; null once it is deleted. */
  recordedBy: string | null;
  recordedAt: number;
  /** The entry this one edits or removes; null for a first entry. */
  replaces: string | null;
  /** This entry removes the one it replaces. */
  removed: boolean;
}

/** A check as it stands: its latest entry, with the ones it replaced, newest first. */
export type DeckCheck = Standing<DeckCheckEntry>;

/** Who may be named as a deck's checker: the event's staff accounts. */
export type DeckChecker = StaffAccount;

/** What staff send to record a check, or to edit one (`replaces`). */
export interface DeckCheckInput {
  playerId: string;
  round: number;
  checker: StaffMember;
  result: DeckCheckResult;
  notes: string;
  replaces: string | null;
}

const RESULTS: readonly DeckCheckResult[] = ['pass', 'fail'];

const readChecker = (value: Record<string, unknown>) => readStaffMember(value, 'checkerId', 'checkerName');

const [whose, round, notes, edit] = commonChecks(
  { player: 'Say whose deck was checked', edit: 'Not a deck check to edit' },
  DECK_CHECK_LIMITS.notes
);

/** The fields that each refuse alone, in the order the form shows them. */
const CHECKS: RecordCheck[] = [
  whose,
  round,
  ['Say who checked the deck', value => readChecker(value) !== null],
  ['Say whether it passed', value => RESULTS.includes(value.result as DeckCheckResult)],
  notes,
  edit
];

/** A check out of a request body, or why it is not one. Whether the player, round and checker fit the event is the server's to say. */
export function readDeckCheck(value: Record<string, unknown>): DeckCheckInput | string {
  return (
    firstProblem(CHECKS, value) ?? {
      playerId: recordText(value.playerId),
      round: value.round as number,
      checker: readChecker(value) as StaffMember,
      result: value.result as DeckCheckResult,
      notes: recordText(value.notes),
      replaces: recordText(value.replaces) || null
    }
  );
}

/** The checks as they stand, newest first (see standingEntries). */
export const standingChecks = (entries: readonly DeckCheckEntry[]): DeckCheck[] => standingEntries(entries);
