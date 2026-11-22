/**
 * What became of each result the site sent to TOM, until TOM's saved file
 * settles it.
 *
 * TOM overwrites a result without asking, and the app sends whatever it is
 * given. So a result TOM took is not sent again until a save of TOM's shows
 * it, and one whose fate is unknown ('uncertain'), or that TOM's file shows
 * differently once saved ('contradicted': a judge may have corrected it in
 * TOM), goes again only when someone sends that one on purpose. A result
 * changed on the site since it was sent is a new result and goes as usual.
 *
 * Kept per event in localStorage, so a reload does not forget what was sent.
 */

import type { SubmitEntry, SubmitResult } from '../../../shared/native/tomCommands';
import { type MatchSlip, resultEntry } from '../../../shared/tournament/slipCodes';
import type { Outcome, PodCategory } from '../../../shared/tournament/types';

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

const storeKey = (event: string) => `cm-tom-sent:${event}`;

export function recallDeliveries(event: string): Deliveries {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storeKey(event)) ?? '{}');
    return value && typeof value === 'object' ? (value as Deliveries) : {};
  } catch {
    return {};
  }
}

export function rememberDeliveries(event: string, deliveries: Deliveries) {
  try {
    localStorage.setItem(storeKey(event), JSON.stringify(deliveries));
  } catch {
    // Storage refused: what was sent is remembered until the page closes.
  }
}
