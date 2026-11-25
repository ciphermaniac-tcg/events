/**
 * What became of each result the site sent to TOM, until TOM's saved file
 * settles it.
 *
 * A result TOM took is not sent again until a save of TOM's shows it, and
 * one whose fate is unknown ('uncertain'), or that TOM's file shows
 * differently once saved ('contradicted': a judge may have corrected it in
 * TOM), goes again only when someone sends that one on purpose. The app never
 * types over a different result TOM already holds, so a correction made on
 * the site after TOM took a result is refused there and stays for the .tdf
 * write or a fix in TOM.
 *
 * Kept per event in localStorage, so a reload does not forget what was sent.
 */

import type { SubmitEntry, SubmitResult } from '../../../shared/native/tomCommands';
import { agreedOutcome, type PlayerReport } from '../../../shared/tournament/reports';
import { sameMatch } from '../../../shared/tournament/rounds';
import { type MatchSlip, resultEntry } from '../../../shared/tournament/slipCodes';
import type { Outcome, PodCategory } from '../../../shared/tournament/types';
import type { PendingResult } from '../../../shared/tournament/view';

export interface Delivery {
  /** The result sent. */
  sent: Outcome;
  /** The match's result in TOM's file when it was sent. */
  before: Outcome;
  state: 'accepted' | 'uncertain' | 'contradicted';
}

/** By pod code, round, table and seats, so a re-paired table is a new match. */
export type Deliveries = Record<string, Delivery>;

/** A result ready to send, with what TOM's file held for its match. */
export interface Item {
  entry: SubmitEntry;
  /** Its match's key in Deliveries. */
  key: string;
  sent: Outcome;
  before: Outcome;
}

interface Result {
  pod: PodCategory;
  round: number;
  table: number;
  p1: string;
  p2: string | null;
  outcome: Outcome;
}

/** A result sent again only on its own. */
export type Held = Item & { state: 'uncertain' | 'contradicted' };

const keyOf = (match: { pod: number; round: number; table: number; p1: string; p2: string | null }) =>
  `${match.pod}:${match.round}:${match.table}:${match.p1}:${match.p2}`;

/**
 * What TOM's saved file says of each delivery: one it shows as sent, or
 * whose match is no longer in a current round, is done; one TOM took that
 * the file now shows otherwise is contradicted.
 */
export function settled(deliveries: Deliveries, slips: readonly MatchSlip[]): Deliveries {
  const left: Deliveries = {};
  for (const [key, delivery] of Object.entries(deliveries)) {
    const slip = slips.find(s => keyOf(s) === key);
    if (slip && slip.outcome !== delivery.sent) {
      const changed = delivery.state === 'accepted' && slip.outcome !== delivery.before;
      left[key] = changed ? { ...delivery, state: 'contradicted' } : delivery;
    }
  }
  return left;
}

/**
 * The pending results to send: fresh ones go with the next send; held ones
 * (uncertain or contradicted) only one at a time, on purpose. One TOM took
 * and has not saved yet, or that TOM's file already shows, is neither.
 */
export function plan(
  slips: readonly MatchSlip[],
  pending: readonly Result[],
  deliveries: Deliveries
): { fresh: Item[]; held: Held[] } {
  const fresh: Item[] = [];
  const held: Held[] = [];
  for (const result of pending) {
    const entry = resultEntry(slips, result);
    const key = entry && keyOf({ ...entry, p1: result.p1, p2: result.p2 });
    const slip = key && slips.find(s => keyOf(s) === key);
    if (!key || !slip || slip.outcome === result.outcome) {
      continue;
    }
    const item = { entry, key, sent: result.outcome, before: slip.outcome };
    const delivery = deliveries[key];
    if (delivery?.sent !== result.outcome) {
      fresh.push(item);
    } else if (delivery.state !== 'accepted') {
      held.push({ ...item, state: delivery.state });
    }
  }
  return { fresh, held };
}

/**
 * Deliveries after a send. TOM taking an item, or its fate being unknown,
 * is recorded; refused or unsent items are free to go again, except one
 * already held for that result, which stays held. Without results (the call
 * itself failed), every item's fate is unknown.
 */
export function recorded(
  deliveries: Deliveries,
  items: readonly Item[],
  results?: readonly SubmitResult[]
): Deliveries {
  const next = { ...deliveries };
  items.forEach((item, i) => {
    const result = results ? results[i]?.result : 'uncertain';
    if (result === 'accepted' || result === 'uncertain') {
      next[item.key] = { sent: item.sent, before: item.before, state: result };
    } else if (next[item.key]?.sent !== item.sent) {
      delete next[item.key];
    }
  });
  return next;
}

/**
 * What players' reports give TOM in the desktop app, by match: the report
 * staff accepted, or else the result two agreeing reports from two devices
 * give it where the event lets them settle a match (agreedOutcome). A match
 * goes only while it has a report: the server drops a match's reports once
 * it has a result, from TOM's save or otherwise, or is re-paired.
 */
export function reportedResults(
  reports: readonly PlayerReport[],
  settles: boolean,
  accepted: Record<string, PendingResult>
): PendingResult[] {
  const byMatch = new Map<string, PendingResult>();
  for (const report of reports) {
    const { pod, round, table, p1, p2, at } = report;
    const key = `${pod}:${round}:${table}`;
    const taken = accepted[key];
    const outcome = settles && agreedOutcome(reports.filter(other => sameMatch(other, report)));
    const result = taken && sameMatch(taken, report) ? taken : outcome && { pod, round, table, p1, p2, outcome, at };
    if (result) {
      byMatch.set(key, result);
    }
  }
  return [...byMatch.values()];
}

/** Per event; `kind` keeps another record of the event's beside the deliveries, such as NativeTom's marks. */
const storeKey = (event: string, kind = 'sent') => `cm-tom-${kind}:${event}`;

export function recallDeliveries<T = Deliveries>(event: string, kind?: string): T | Record<string, never> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storeKey(event, kind)) ?? '{}');
    return value && typeof value === 'object' ? (value as T) : {};
  } catch {
    return {};
  }
}

export function rememberDeliveries<T = Deliveries>(event: string, deliveries: T, kind?: string) {
  try {
    localStorage.setItem(storeKey(event, kind), JSON.stringify(deliveries));
  } catch {
    // Storage refused: what was sent is remembered until the page closes.
  }
}
