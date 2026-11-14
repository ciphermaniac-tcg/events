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
 */

import { categoryCode } from './tdf.js';
import type { Outcome, Pod, PodCategory, Round, Tournament } from './types.js';

/** The outcome digit TOM reads; 0 (back to pending) is left out on purpose. */
const OUTCOME_DIGITS = { p1: '1', p2: '2', tie: '3', 'double-loss': '6' } as const;

export type SlipOutcome = keyof typeof OUTCOME_DIGITS;

export const isSlipOutcome = (outcome: Outcome): outcome is SlipOutcome => Object.hasOwn(OUTCOME_DIGITS, outcome);

export interface MatchSlip {
  category: PodCategory;
  round: number;
  table: number;
  p1: string;
  p2: string;
  /** The result the file holds now. */
  outcome: Outcome;
  /** Every digit before the outcome. */
  prefix: string;
  /** A top-cut match, where TOM takes a tie or double loss and records nothing. */
  elimination: boolean;
}

/** Weights 1, 2, 1, 2... from the left, products summed whole, then what brings the sum to a multiple of ten. */
export function checkDigit(digits: string): number {
  const sum = [...digits].reduce((total, digit, i) => total + (i % 2 === 0 ? 1 : 2) * Number(digit), 0);
  return (10 - (sum % 10)) % 10;
}

/** The code for one outcome of a slip, or null where TOM would record nothing. */
export function slipCode(slip: MatchSlip, outcome: SlipOutcome): string | null {
  if (slip.elimination && (outcome === 'tie' || outcome === 'double-loss')) {
    return null;
  }
  const data = slip.prefix + OUTCOME_DIGITS[outcome];
  return `${data}${checkDigit(data)}`;
}

const MAX_CODE = 2_147_483_647;
const ACCEPTED_OUTCOME_DIGITS = new Set(['0', ...Object.values(OUTCOME_DIGITS)]);

/**
 * Whether TOM would take a code typed by hand: digits only, five to ten of
 * them within TOM's integer range, an outcome digit it knows, and a check
 * digit that matches. TOM overwrites a result without asking, so a mistyped
 * code is refused here rather than sent.
 */
export function isSlipCode(code: string): boolean {
  if (!/^\d{5,10}$/.test(code) || Number(code) > MAX_CODE) {
    return false;
  }
  const data = code.slice(0, -1);
  return ACCEPTED_OUTCOME_DIGITS.has(data.slice(-1)) && checkDigit(data) === Number(code.slice(-1));
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
  const lead = categoryCode(pod.category);
  return round.matches.flatMap(({ table, p1, p2, outcome }) => {
    const flight = flighted ? flightOf.get(p1) : '';
    if (table <= 0 || p2 === null || flight === undefined) {
      return [];
    }
    const prefix = `${lead}${flight}${round.number}${String(table).padStart(width, '0')}`;
    return [{ category: pod.category, round: round.number, table, p1, p2, outcome, prefix, elimination }];
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
 * The code that enters a result for a match, found by pod, round, table and
 * both seats so a result for a match since re-paired finds none. Null when
 * the match has no slip or TOM would record nothing for the outcome.
 */
export function resultCode(
  slips: readonly MatchSlip[],
  result: { pod: PodCategory; round: number; table: number; p1: string; p2: string | null; outcome: Outcome }
): string | null {
  const slip = slips.find(
    s =>
      s.category === result.pod &&
      s.round === result.round &&
      s.table === result.table &&
      s.p1 === result.p1 &&
      s.p2 === result.p2
  );
  return slip && isSlipOutcome(result.outcome) ? slipCode(slip, result.outcome) : null;
}
