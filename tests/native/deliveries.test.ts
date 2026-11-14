/** What the site holds back after sending results to TOM, until TOM's saved file settles them. */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { SubmitResult } from '../../shared/native/tomCommands';
import { matchSlips } from '../../shared/tournament/slipCodes';
import { parseTdf } from '../../shared/tournament/tdf';
import type { Outcome } from '../../shared/tournament/types';
import {
  type Deliveries,
  plan,
  recallDeliveries,
  recorded,
  rememberDeliveries,
  settled
} from '../../src/lib/native/deliveries';

const CODES: Record<Outcome, number> = {
  pending: 0,
  p1: 1,
  p2: 2,
  tie: 3,
  'double-loss': 10,
  bye: 5,
  'assigned-bye': 4,
  deleted: 9,
  loss: 8
};

/** TOM's saved file: one Masters pod, round 1, three tables, with these results. */
function slipsWith(outcomes: Outcome[]) {
  const matches = outcomes
    .map(
      (outcome, i) =>
        `<match outcome="${CODES[outcome]}"><player1 userid="a${i + 1}"/><player2 userid="b${i + 1}"/><tablenumber>${i + 1}</tablenumber></match>`
    )
    .join('');
  const ids = outcomes.flatMap((_, i) => [`a${i + 1}`, `b${i + 1}`]);
  const roster = ids.map(id => `<player userid="${id}"/>`).join('');
  return matchSlips(
    parseTdf(
      `<tournament type="3" stage="4"><data/><players/><pods><pod category="2" stage="0"><subgroups><subgroup number="1"><players>${roster}</players></subgroup></subgroups><rounds><round number="1" type="3" stage="4"><matches>${matches}</matches></round></rounds></pod></pods></tournament>`
    )
  );
}

const result = (table: number, outcome: Outcome) => ({
  pod: 'masters' as const,
  round: 1,
  table,
  p1: `a${table}`,
  p2: `b${table}`,
  outcome
});

const tables = (items: readonly { entry: { table: number } }[]) => items.map(item => item.entry.table);

const PENDING = [result(1, 'p1'), result(2, 'p2'), result(3, 'tie')];

/** A taken, B uncertain, C not sent: the batch stopped at B. */
function afterFirstSend(): Deliveries {
  const slips = slipsWith(['pending', 'pending', 'pending']);
  const { fresh } = plan(slips, PENDING, {});
  const results: SubmitResult[] = [
    { result: 'accepted', code: fresh[0]!.entry.code },
    { result: 'uncertain', code: fresh[1]!.entry.code, reason: 'Focus lost' },
    { result: 'not_ready', code: fresh[2]!.entry.code, reason: 'Not sent' }
  ];
  return recorded({}, fresh, results);
}

test('sending again after a stopped batch sends only what never went, holding the uncertain one back', () => {
  const slips = slipsWith(['pending', 'pending', 'pending']);
  assert.deepEqual(tables(plan(slips, PENDING, {}).fresh), [1, 2, 3]);
  const next = plan(slips, PENDING, settled(afterFirstSend(), slips));
  assert.deepEqual(tables(next.fresh), [3], 'not the result TOM took, nor the one it may have');
  assert.deepEqual(
    next.held.map(item => [item.entry.table, item.state]),
    [[2, 'uncertain']]
  );
});

test('a save of TOM’s settles what it took, or holds it back when the file says otherwise', () => {
  const sent = afterFirstSend();
  const confirmed = slipsWith(['p1', 'pending', 'pending']);
  assert.deepEqual(Object.keys(settled(sent, confirmed)), ['2:1:2'], 'the file shows what was sent');
  assert.deepEqual(tables(plan(confirmed, PENDING, settled(sent, confirmed)).fresh), [3], 'and TOM has it');
  const corrected = slipsWith(['p2', 'pending', 'pending']);
  const { held } = plan(corrected, PENDING, settled(sent, corrected));
  assert.deepEqual(
    held.map(item => [item.entry.table, item.state]),
    [
      [1, 'contradicted'],
      [2, 'uncertain']
    ],
    'a judge’s correction in TOM is not overwritten by the next send'
  );
  assert.deepEqual(settled(sent, []), {}, 'the round has moved on');
});

test('an uncertain result goes again only on its own, and a result changed on the site is new', () => {
  const slips = slipsWith(['pending', 'pending', 'pending']);
  const sent = afterFirstSend();
  const [uncertain] = plan(slips, PENDING, sent).held;
  const resent = recorded(sent, [uncertain!], [{ result: 'accepted', code: uncertain!.entry.code }]);
  assert.deepEqual(plan(slips, PENDING, resent).held, []);
  const changed = [result(1, 'p1'), result(2, 'tie'), result(3, 'tie')];
  assert.deepEqual(tables(plan(slips, changed, sent).fresh), [2, 3]);
});

test('a send that fails outright leaves every result in it uncertain', () => {
  const slips = slipsWith(['pending', 'pending', 'pending']);
  const { fresh } = plan(slips, PENDING, {});
  const lost = recorded({}, fresh);
  assert.deepEqual(
    Object.values(lost).map(delivery => delivery.state),
    ['uncertain', 'uncertain', 'uncertain']
  );
  assert.deepEqual(plan(slips, PENDING, lost).fresh, []);
});

const global = globalThis as { localStorage?: unknown };

afterEach(() => {
  delete global.localStorage;
});

test('what was sent is remembered per event across a reload, and storage that fails remembers nothing', () => {
  const store = new Map<string, string>();
  global.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value)
  };
  const sent = afterFirstSend();
  rememberDeliveries('ABCD', sent);
  assert.deepEqual(recallDeliveries('ABCD'), sent);
  assert.deepEqual(recallDeliveries('WXYZ'), {});
  store.set('cm-tom-sent:BAD', 'not json');
  assert.deepEqual(recallDeliveries('BAD'), {});
  store.set('cm-tom-sent:NULL', 'null');
  assert.deepEqual(recallDeliveries('NULL'), {});
  global.localStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    }
  };
  assert.deepEqual(recallDeliveries('ABCD'), {});
  assert.doesNotThrow(() => rememberDeliveries('ABCD', sent));
});
