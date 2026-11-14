/** TOM's match slip codes, computed from a .tdf as the tom-tdf harness's SlipCodes.java does. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkDigit,
  isSlipCode,
  type MatchSlip,
  matchSlips,
  resultCode,
  slipCode
} from '../../shared/tournament/slipCodes';
import { parseTdf } from '../../shared/tournament/tdf';

interface Seat {
  table: number;
  p1: string;
  p2?: string;
  outcome?: number;
}

const matchXml = ({ table, p1, p2, outcome = 0 }: Seat) =>
  p2 === undefined
    ? `<match outcome="${outcome}"><player userid="${p1}"/><tablenumber>${table}</tablenumber></match>`
    : `<match outcome="${outcome}"><player1 userid="${p1}"/><player2 userid="${p2}"/><tablenumber>${table}</tablenumber></match>`;

const roundXml = (number: number, type: number, seats: readonly Seat[]) =>
  `<round number="${number}" type="${type}" stage="4"><matches>${seats.map(matchXml).join('')}</matches></round>`;

const podXml = (category: number, flights: readonly string[][], rounds: readonly string[]) =>
  `<pod category="${category}" stage="0"><subgroups>${flights
    .map(
      (ids, i) =>
        `<subgroup number="${i + 1}"><players>${ids.map(id => `<player userid="${id}"/>`).join('')}</players></subgroup>`
    )
    .join('')}</subgroups><rounds>${rounds.join('')}</rounds></pod>`;

const tdf = (...pods: string[]) =>
  `<tournament type="3" stage="4"><data/><players/><pods>${pods.join('')}</pods></tournament>`;

/** `count` two-seat tables from `first`, seating players `${prefix}${table}a` and `${prefix}${table}b`. */
const tables = (prefix: string, count: number, first = 1): Seat[] =>
  Array.from({ length: count }, (_, i) => ({
    table: first + i,
    p1: `${prefix}${first + i}a`,
    p2: `${prefix}${first + i}b`
  }));

const seatsOf = (seats: readonly Seat[]) => seats.flatMap(s => [s.p1, ...(s.p2 ? [s.p2] : [])]);

const slipAt = (slips: readonly MatchSlip[], category: string, table: number): MatchSlip => {
  const slip = slips.find(s => s.category === category && s.table === table);
  assert.ok(slip, `a slip for ${category} table ${table}`);
  return slip;
};

const codes = (slip: MatchSlip) => [slipCode(slip, 'p1'), slipCode(slip, 'p2'), slipCode(slip, 'tie')];

test('the check digit weights digits 1, 2, 1, 2 from the left and sums the products whole', () => {
  assert.equal(checkDigit('2111'), 3);
  assert.equal(checkDigit('2119'), 7, 'a doubled 9 adds 18, not 1 + 8');
  assert.equal(checkDigit('0'), 0);
});

test('a single Masters pod prints pod, round, table, outcome and check digit', () => {
  const round = tables('m', 6);
  const slips = matchSlips(parseTdf(tdf(podXml(2, [seatsOf(round)], [roundXml(1, 3, round)]))));
  assert.equal(slips.length, 6);
  assert.deepEqual(codes(slipAt(slips, 'masters', 1)), ['21113', '21121', '21139']);
  assert.equal(slipCode(slipAt(slips, 'masters', 1), 'double-loss'), '21163');
});

test('a pod in two flights adds the first seat’s flight, and tables pad to the round’s widest', () => {
  const masters = tables('m', 40);
  const juniors = tables('j', 1);
  const slips = matchSlips(
    parseTdf(
      tdf(
        podXml(0, [seatsOf(juniors)], [roundXml(1, 3, juniors)]),
        podXml(2, [seatsOf(masters.slice(0, 20)), seatsOf(masters.slice(20))], [roundXml(1, 3, masters)])
      )
    )
  );
  assert.equal(slipCode(slipAt(slips, 'masters', 9), 'p1'), '2110914');
  assert.equal(slipCode(slipAt(slips, 'masters', 30), 'p2'), '2213023');
  assert.equal(slipCode(slipAt(slips, 'junior', 1), 'tie'), '01131');
});

test('a round past 99 tables pads every table to three digits', () => {
  const round = tables('m', 205);
  const slips = matchSlips(parseTdf(tdf(podXml(2, [seatsOf(round)], [roundXml(1, 3, round)]))));
  assert.equal(slipCode(slipAt(slips, 'masters', 1), 'p1'), '2100113');
  assert.equal(slipCode(slipAt(slips, 'masters', 205), 'p2'), '2120525');
});

test('a top-cut round has no flight digit and no tie or double loss', () => {
  const swiss = tables('m', 8);
  const cut = tables('m', 4);
  const slips = matchSlips(
    parseTdf(
      tdf(
        podXml(2, [seatsOf(swiss.slice(0, 4)), seatsOf(swiss.slice(4))], [roundXml(10, 3, swiss), roundXml(11, 1, cut)])
      )
    )
  );
  const first = slipAt(slips, 'masters', 1);
  assert.equal(first.round, 11, 'only the current round has slips');
  assert.equal(slips.length, 4);
  assert.deepEqual(codes(first), ['211112', '211121', null]);
  assert.equal(slipCode(first, 'double-loss'), null);
});

test('byes, forced losses and tables numbered 0 have no slip', () => {
  const round: Seat[] = [
    ...tables('m', 2),
    { table: 0, p1: 'bye', outcome: 5 },
    { table: 0, p1: 'late', outcome: 8 },
    { table: 0, p1: 'x', p2: 'y' }
  ];
  const slips = matchSlips(parseTdf(tdf(podXml(2, [seatsOf(round)], [roundXml(1, 3, round)]))));
  assert.deepEqual(
    slips.map(s => s.table),
    [1, 2]
  );
});

test('a flighted match whose first seat is in no flight, or a pod with no rounds, has no slip', () => {
  const round = tables('m', 3);
  const slips = matchSlips(
    parseTdf(
      tdf(podXml(1, [], []), podXml(2, [[round[0]!.p1, round[0]!.p2!], [round[1]!.p1]], [roundXml(1, 3, round)]))
    )
  );
  assert.deepEqual(
    slips.map(s => s.prefix),
    ['2111', '2212']
  );
});

test('a result finds its code by pod, round, table and both seats', () => {
  const round = tables('m', 2);
  const slips = matchSlips(parseTdf(tdf(podXml(2, [seatsOf(round)], [roundXml(1, 3, round)]))));
  const result = { pod: 'masters' as const, round: 1, table: 1, p1: 'm1a', p2: 'm1b' };
  assert.equal(resultCode(slips, { ...result, outcome: 'p2' }), '21121');
  assert.equal(resultCode(slips, { ...result, p2: 'm2b', outcome: 'p2' }), null, 're-paired since');
  assert.equal(resultCode(slips, { ...result, round: 2, outcome: 'p1' }), null, 'another round');
  assert.equal(resultCode(slips, { ...result, outcome: 'pending' }), null, 'no code sends a match back');
});

test('a typed code passes only with TOM’s length, range, outcome digit and check digit', () => {
  for (const code of ['21113', '210319', '219918', '01131', '211112', '2120525']) {
    assert.ok(isSlipCode(code), code);
  }
  for (const code of ['2111', '21114', '21143', '2111a', ' 21113', '21113555555', '9999999999']) {
    assert.ok(!isSlipCode(code), code);
  }
});
