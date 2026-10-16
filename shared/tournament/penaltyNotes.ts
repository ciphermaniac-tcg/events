/**
 * Penalty notes: staff write down a penalty a judge gave a player in a round,
 * who gave it, and why. A note is a record and nothing more: it issues no
 * penalty and changes no result, drop or standing, which staff apply
 * themselves. A penalty note is a staff record (staffRecords.ts), the same
 * shape as a deck check: append-only, an edit or removal a new entry.
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
import { msg } from '../i18n.js';

/** The Pokémon TCG penalties, least to most severe (Play! Pokémon Penalty Guidelines, section 3). */
export const PENALTIES = [
  'caution',
  'warning',
  'double-prize',
  'quadruple-prize',
  'game-loss',
  'match-loss',
  'disqualification'
] as const;

export type Penalty = (typeof PENALTIES)[number];

export const PENALTY_LABELS: Record<Penalty, string> = {
  caution: msg('Caution'),
  warning: msg('Warning'),
  'double-prize': msg('Double Prize Card'),
  'quadruple-prize': msg('Quadruple Prize Card'),
  'game-loss': msg('Game Loss'),
  'match-loss': msg('Match Loss'),
  disqualification: msg('Disqualification')
};

/** Penalties that end a game, a match or the player's event, which staff then apply to the results themselves. */
export const DECIDING_PENALTIES: ReadonlySet<Penalty> = new Set(['game-loss', 'match-loss', 'disqualification']);

export const PENALTY_NOTE_LIMITS = { notes: 1000, judgeName: STAFF_NAME_LIMIT } as const;

/** One entry in the record, as staff read it. */
export interface PenaltyNoteEntry {
  id: string;
  /** The player's ID in the event's document, and their name when it was written. */
  playerId: string;
  playerName: string;
  round: number;
  /** Who gave the penalty: a staff account, or a name typed in. A null name is an account since deleted. */
  judge: { id: string | null; name: string | null };
  penalty: Penalty;
  notes: string;
  /** The account that wrote the entry down, by name; null once it is deleted. */
  recordedBy: string | null;
  recordedAt: number;
  /** The entry this one edits or removes; null for a first entry. */
  replaces: string | null;
  /** This entry removes the one it replaces. */
  removed: boolean;
}

/** A note as it stands: its latest entry, with the ones it replaced, newest first. */
export type PenaltyNote = Standing<PenaltyNoteEntry>;

/** Who may be named as a note's judge: the event's staff accounts. */
export type PenaltyJudge = StaffAccount;

/** What staff send to record a note, or to edit one (`replaces`). */
export interface PenaltyNoteInput {
  playerId: string;
  round: number;
  judge: StaffMember;
  penalty: Penalty;
  notes: string;
  replaces: string | null;
}

export const isPenalty = (value: unknown): value is Penalty => PENALTIES.includes(value as Penalty);

const readJudge = (value: Record<string, unknown>) => readStaffMember(value, 'judgeId', 'judgeName');

const [whose, round, notes, edit] = commonChecks(
  { player: msg('Say whose penalty it is'), edit: msg('Not a penalty note to edit') },
  PENALTY_NOTE_LIMITS.notes
);

/** The fields that each refuse alone, in the order the form shows them. */
const CHECKS: RecordCheck[] = [
  whose,
  round,
  [msg('Choose a penalty'), value => isPenalty(value.penalty)],
  [msg('Say which judge gave it'), value => readJudge(value) !== null],
  notes,
  edit
];

/** A note out of a request body, or why it is not one. Whether the player, round and judge fit the event is the server's to say. */
export function readPenaltyNote(value: Record<string, unknown>): PenaltyNoteInput | string {
  return (
    firstProblem(CHECKS, value) ?? {
      playerId: recordText(value.playerId),
      round: value.round as number,
      judge: readJudge(value) as StaffMember,
      penalty: value.penalty as Penalty,
      notes: recordText(value.notes),
      replaces: recordText(value.replaces) || null
    }
  );
}

/** The notes as they stand, newest first (see standingEntries). */
export const standingNotes = (entries: readonly PenaltyNoteEntry[]): PenaltyNote[] => standingEntries(entries);
