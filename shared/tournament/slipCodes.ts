/**
 * The result codes TOM prints on its match slips, computed from a .tdf it
 * saved, so a result can go into TOM through its Speed Match Slip Entry form
 * rather than into the file.
 *
 * A code is the pod's category code, the flight when the pod's current round
 * is Swiss and has more than one, the round number, the table zero-padded to
 * the width of the round's highest table, the outcome, and a check digit.
 * This follows the tom-tdf harness's SlipCodes.java, which reproduced every
 * code TOM printed from the saved file alone.
 *
 * TOM accepts a code for table 0 and pins it on the first bye or forced loss
 * there, and its own reader then refuses the file, so a match without a table
 * or a second seat has no slip here. Only a pod's current round has slips:
 * TOM rejects any other round.
 *
 * What goes to TOM is an entry (see SubmitEntry): the code with its parts,
 * so the app can check the code against the event's layout. A code typed by
 * hand becomes an entry only when it reads as exactly one slip of the event.
 */

import type { SubmitEntry } from '../native/tomCommands.js';
import { categoryCode } from './tdf.js';
import type { Outcome, Pod, PodCategory, Round, Tournament } from './types.js';

/** The outcome digit TOM reads. Pending (0) and double loss (6) are left out: neither is sent. */
const OUTCOME_DIGITS = { p1: 1, p2: 2, tie: 3 } as const;

export type SlipOutcome = keyof typeof OUTCOME_DIGITS;

const SLIP_OUTCOMES = Object.keys(OUTCOME_DIGITS) as SlipOutcome[];

const isSlipOutcome = (outcome: Outcome): outcome is SlipOutcome => Object.hasOwn(OUTCOME_DIGITS, outcome);

export interface MatchSlip {
  category: PodCategory;
  /** TOM's category code for the pod. */
  pod: number;
  /** The flight digit, null where the code has none. */
  flight: number | null;
  round: number;
  table: number;
  /** How many digits TOM prints the table in: the round's highest table's. */
  width: number;
  p1: string;
  p2: string;
  /** The result the file holds now. */
  outcome: Outcome;
  /** A top-cut match, where TOM takes a tie and records nothing. */
  elimination: boolean;
}

/** Weights 1, 2, 1, 2... from the left, products summed whole, then what brings the sum to a multiple of ten. */
export function checkDigit(digits: string): number {
  const sum = [...digits].reduce((total, digit, i) => total + (i % 2 === 0 ? 1 : 2) * Number(digit), 0);
  return (10 - (sum % 10)) % 10;
}

/** The digits before the table: pod, flight when the code has one, round. */
const lead = (slip: MatchSlip) => `${slip.pod}${slip.flight ?? ''}${slip.round}`;

/** The entry for one outcome of a slip, its code as TOM prints it; null where TOM would record nothing. */
export function slipEntry(slip: MatchSlip, outcome: SlipOutcome): SubmitEntry | null {
  if (slip.elimination && outcome === 'tie') {
    return null;
  }
  const digit = OUTCOME_DIGITS[outcome];
  const data = `${lead(slip)}${String(slip.table).padStart(slip.width, '0')}${digit}`;
  const { pod, flight, round, table } = slip;
  return { pod, flight, round, table, outcome: digit, code: `${data}${checkDigit(data)}` };
}

function tableWidth(highest: number): number {
  if (highest > 99) {
    return 3;
  }
  return highest > 9 ? 2 : 1;
}

/** Each player's flight, as the pod's subgroups list them; a player listed twice takes the later one. */
function flightsOf(pod: Pod): Map<string, number> {
  return new Map((pod.flights ?? []).flatMap(flight => flight.playerIds.map(id => [id, flight.number] as const)));
}

function roundSlips(pod: Pod, round: Round): MatchSlip[] {
  const elimination = round.kind === 'elimination';
  const flightOf = flightsOf(pod);
  const flighted = !elimination && new Set(flightOf.values()).size > 1;
  const width = tableWidth(Math.max(0, ...round.matches.map(match => match.table)));
  const code = Number(categoryCode(pod.category));
  return round.matches.flatMap(({ table, p1, p2, outcome }) => {
    const flight = flighted ? flightOf.get(p1) : null;
    if (table <= 0 || p2 === null || flight === undefined) {
      return [];
    }
    const { category } = pod;
    return [{ category, pod: code, flight, round: round.number, table, width, p1, p2, outcome, elimination }];
  });
}

/** The slips of every pod's current round, the last one in the file. */
export function matchSlips(tournament: Tournament): MatchSlip[] {
  return tournament.pods.flatMap(pod => {
    const round = pod.rounds.at(-1);
    return round ? roundSlips(pod, round) : [];
  });
}

/**
 * The entry that enters a result for a match, found by pod, round, table and
 * both seats so a result for a match since re-paired finds none. Null when
 * the match has no slip or TOM would record nothing for the outcome.
 */
export function resultEntry(
  slips: readonly MatchSlip[],
  result: { pod: PodCategory; round: number; table: number; p1: string; p2: string | null; outcome: Outcome }
): SubmitEntry | null {
  const slip = slips.find(
    s =>
      s.category === result.pod &&
      s.round === result.round &&
      s.table === result.table &&
      s.p1 === result.p1 &&
      s.p2 === result.p2
  );
  return slip && isSlipOutcome(result.outcome) ? slipEntry(slip, result.outcome) : null;
}

const MAX_CODE = 2_147_483_647;

/** Whether TOM would read a code at all: five to ten digits within its integer range, with a matching check digit. */
const wellFormed = (code: string): boolean =>
  /^\d{5,10}$/.test(code) && Number(code) <= MAX_CODE && checkDigit(code.slice(0, -1)) === Number(code.slice(-1));

/** Whether a code reads as this slip with this outcome, its table padded or not, as TOM reads it. */
function readsAs(slip: MatchSlip, outcome: SlipOutcome, code: string): boolean {
  const start = lead(slip);
  const table = code.slice(start.length, -2);
  return (
    code.startsWith(start) &&
    code.at(-2) === String(OUTCOME_DIGITS[outcome]) &&
    /^\d{1,3}$/.test(table) &&
    Number(table) === slip.table
  );
}

/**
 * A code typed by hand, as the entry it stands for among the event's slips.
 * TOM overwrites a result without asking, so a code that is malformed,
 * matches no slip, or reads as more than one is refused with null.
 */
export function parseSlipCode(slips: readonly MatchSlip[], typed: string): SubmitEntry | null {
  const code = typed.trim();
  if (!wellFormed(code)) {
    return null;
  }
  const reads = slips.flatMap(slip =>
    SLIP_OUTCOMES.filter(outcome => readsAs(slip, outcome, code)).flatMap(outcome => slipEntry(slip, outcome) ?? [])
  );
  return reads.length === 1 ? reads[0]! : null;
}
