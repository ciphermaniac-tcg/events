/**
 * Results on their way from the console. A result sent shows in its row as
 * sent, not as entered, until the server answers (see manageState). One the
 * server did not take stays in its row as not saved, for staff to retry or
 * discard, instead of the row quietly reading Open again. The panel outlives
 * a switch to another division or round, and a re-pair can seat someone else
 * at a table, so each is kept by its match: the round, the table and both
 * players. A result kept for a pairing that has changed shows on no row.
 *
 * Results for one match go to the server one at a time, in the order they
 * were entered, so a later one always lands after an earlier one; one
 * overtaken before its turn is not sent at all.
 *
 * A failed send may still have landed (the answer, not the request, was
 * lost), and the room may have moved on since, so a retry first reads the
 * event again and sends nothing when the result already stands or the
 * table's pairing has changed (see reconcileResult).
 */

import { createSignal } from 'solid-js';
import { latestRound } from '../../../shared/tournament/rounds';
import type { Match, Outcome, Pod, PodCategory, Round } from '../../../shared/tournament/types';
import { t } from '../../lib/i18n';
import type { Manage } from '../../lib/tournament/api';
import { shownOutcome } from '../../lib/tournament/present';
import type { ManageState } from './manageState';

/** A result staff entered for a match: which round's table, and the outcome. */
export interface EnteredResult {
  pod: PodCategory;
  round: number;
  table: number;
  p1: string;
  p2: string | null;
  outcome: Outcome;
}

/**
 * What a retry finds when it reads the event again: the result already
 * stands (`saved`), the table is no longer paired as it was (`changed`), or
 * it is still to send (`send`).
 */
export type Reconciled = 'saved' | 'changed' | 'send';

export function reconcileResult(manage: Pick<Manage, 'tournament' | 'pending'>, entered: EnteredResult): Reconciled {
  const pod = manage.tournament.pods.find(p => p.category === entered.pod);
  const round = latestRound(pod);
  const match =
    round?.number === entered.round
      ? round.matches.find(m => m.table === entered.table && m.p1 === entered.p1 && m.p2 === entered.p2)
      : undefined;
  if (!pod || !round || !match) {
    return 'changed';
  }
  return shownOutcome(match, pod, round, manage.pending).outcome === entered.outcome ? 'saved' : 'send';
}

export interface ResultEntry {
  /** The result sent for the match and not answered yet. */
  sentFor: (round: Round, match: Match) => Outcome | undefined;
  /** The result the server did not take for the match, until it is retried or discarded. */
  failedFor: (round: Round, match: Match) => Outcome | undefined;
  send: (round: Round, match: Match, outcome: Outcome) => void;
  retry: (round: Round, match: Match) => Promise<void>;
  discard: (round: Round, match: Match) => void;
}

type Results<T> = ReadonlyMap<string, T>;

const without = <T>(results: Results<T>, key: string): Results<T> =>
  new Map([...results].filter(([held]) => held !== key));

const keyOf = (entered: Omit<EnteredResult, 'outcome'>) =>
  `${entered.pod}|${entered.round}|${entered.table}|${entered.p1}|${entered.p2 ?? ''}`;

export function createResultEntry(state: () => ManageState, pod: () => Pod): ResultEntry {
  const [sent, setSent] = createSignal<Results<Outcome>>(new Map());
  /** Each failed result with the match it was entered for, which a retry sends it for again. */
  const [failed, setFailed] = createSignal<Results<EnteredResult>>(new Map());
  const entered = (round: Round, match: Match, outcome: Outcome): EnteredResult => {
    const { table, p1, p2 } = match;
    return { pod: pod().category, round: round.number, table, p1, p2, outcome };
  };
  const matchKey = (round: Round, match: Match) => keyOf(entered(round, match, 'pending'));
  const hold = (key: string, outcome: Outcome) => setSent(results => new Map(results).set(key, outcome));
  const fail = (result: EnteredResult) => setFailed(results => new Map(results).set(keyOf(result), result));
  /**
   * The latest send or retry for each match. An answer to an earlier one, as a
   * result entered and then cleared before the first answer came back, is
   * left alone: it no longer says what the row should show.
   */
  const tickets = new Map<string, number>();
  let issued = 0;
  const ticket = (key: string) => {
    issued += 1;
    tickets.set(key, issued);
    return issued;
  };
  const latest = (key: string, mine: number) => tickets.get(key) === mine;
  /** Each match's sends, one after another: the last one queued, for the next to wait on. */
  const queues = new Map<string, Promise<unknown>>();

  /** Sends the result once every earlier send for its match has been answered, unless a newer one came first. */
  function sendEntered(result: EnteredResult) {
    const key = keyOf(result);
    const mine = ticket(key);
    const { pod: category, ...command } = result;
    setFailed(results => without(results, key));
    hold(key, result.outcome);
    const turn = (queues.get(key) ?? Promise.resolve()).then(async () => {
      if (!latest(key, mine)) {
        return;
      }
      const ok = await state().send({ type: 'reportResult', pod: category, ...command });
      if (!ok && latest(key, mine)) {
        fail(result);
      }
      if (latest(key, mine)) {
        setSent(results => without(results, key));
      }
    });
    queues.set(key, turn);
  }

  /** What a retry does once it has read the event (see reconcileResult); null when the read failed. */
  function afterRead(result: EnteredResult, found: Reconciled | null) {
    if (found === 'send') {
      sendEntered(result);
    } else if (found === 'changed') {
      state().fail(t('Table {table} has changed since; enter its result again.', { table: result.table }));
    } else if (found === 'saved') {
      state().clearError();
    } else {
      fail(result);
    }
  }

  /** Reads the event again, then sends the failed result, for the match it was entered for, only if it is still to send. */
  async function retry(round: Round, match: Match) {
    const key = matchKey(round, match);
    const result = failed().get(key);
    if (!result) {
      return;
    }
    const mine = ticket(key);
    setFailed(results => without(results, key));
    hold(key, result.outcome);
    const read = await state().load();
    // Something newer was entered for the match while the event was read: that stands.
    if (!latest(key, mine)) {
      return;
    }
    setSent(results => without(results, key));
    const manage = state().data();
    afterRead(result, read && manage ? reconcileResult(manage, result) : null);
  }

  return {
    sentFor: (round, match) => sent().get(matchKey(round, match)),
    failedFor: (round, match) => failed().get(matchKey(round, match))?.outcome,
    send: (round, match, outcome) => sendEntered(entered(round, match, outcome)),
    retry,
    discard: (round, match) => setFailed(results => without(results, matchKey(round, match)))
  };
}
