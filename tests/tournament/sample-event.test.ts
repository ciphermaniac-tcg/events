/**
 * The /host home page's sample event: the engine's pairings, results drawn
 * at random, and standings that only move when a result moves them.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { seededRandom } from '../../shared/tournament/random.ts';
import {
  playSampleEvent,
  reportOrder,
  SAMPLE_DECKS,
  SAMPLE_PLAYERS,
  sampleStandings,
  type SampleTable
} from '../../src/lib/tournament/sampleEvent.ts';

test('the sample seats sixteen different players', () => {
  assert.equal(SAMPLE_PLAYERS.length, 16);
  assert.equal(new Set(SAMPLE_PLAYERS).size, 16);
});

test('every round seats everyone once, and nobody meets an opponent twice', () => {
  const rounds = playSampleEvent(SAMPLE_PLAYERS, 5, seededRandom(1));
  assert.equal(rounds.length, 5);
  const met = new Set<string>();
  for (const tables of rounds) {
    assert.equal(tables.length, 8);
    const seated = tables.flatMap(t => [t.p1, t.p2]);
    assert.deepEqual([...seated].sort(), [...SAMPLE_PLAYERS].sort());
    for (const { p1, p2, winner } of tables) {
      const key = [p1, p2].sort().join('|');
      assert.ok(!met.has(key), `${key} met twice`);
      met.add(key);
      assert.ok(winner === null || winner === p1 || winner === p2);
    }
  }
});

test('the same seed plays the same event', () => {
  assert.deepEqual(
    playSampleEvent(SAMPLE_PLAYERS, 5, seededRandom(9)),
    playSampleEvent(SAMPLE_PLAYERS, 5, seededRandom(9))
  );
});

test('later rounds pair players on the points they have', () => {
  const [first, second] = playSampleEvent(SAMPLE_PLAYERS, 2, seededRandom(3)) as [SampleTable[], SampleTable[]];
  const leaders = new Set(first.map(t => t.winner).filter(name => name !== null));
  // Table one in round two is two round-one winners.
  const top = second[0] as SampleTable;
  assert.ok(leaders.has(top.p1) && leaders.has(top.p2 as string));
});

test('an odd field gives the bye a win, and to a different player each round', () => {
  const field = SAMPLE_PLAYERS.slice(0, 5);
  const rounds = playSampleEvent(field, 3, seededRandom(4));
  const byes = rounds.map(tables => tables.at(-1) as SampleTable);
  for (const bye of byes) {
    assert.equal(bye.p2, null);
    assert.equal(bye.winner, bye.p1);
  }
  assert.equal(new Set(byes.map(b => b.p1)).size, 3);
});

test('standings count wins, losses and ties, most points first', () => {
  const players = ['A', 'B', 'C', 'D'];
  const tables: SampleTable[] = [
    { p1: 'A', p2: 'B', winner: 'B' },
    { p1: 'C', p2: 'D', winner: null },
    { p1: 'B', p2: 'C', winner: 'B' }
  ];
  assert.deepEqual(sampleStandings(players, tables), [
    { name: 'B', points: 6, wins: 2, losses: 0, ties: 0 },
    { name: 'C', points: 1, wins: 0, losses: 1, ties: 1 },
    { name: 'D', points: 1, wins: 0, losses: 0, ties: 1 },
    { name: 'A', points: 0, wins: 0, losses: 1, ties: 0 }
  ]);
});

test('players level on points keep their seats', () => {
  const players = ['D', 'C', 'B', 'A'];
  assert.deepEqual(
    sampleStandings(players, []).map(s => s.name),
    players
  );
  assert.deepEqual(
    sampleStandings(players, [{ p1: 'A', p2: 'B', winner: 'A' }]).map(s => s.name),
    ['A', 'D', 'C', 'B']
  );
});

test('every sample player has a deck with at least one sprite', () => {
  for (const name of SAMPLE_PLAYERS) {
    const deck = SAMPLE_DECKS[name];
    assert.ok(deck, `${name} has no deck`);
    assert.ok(deck.icons.length > 0 && deck.icons.length <= 2, `${name}'s deck draws ${deck.icons.length} sprites`);
  }
});

test('results come in with the bye first, ties last, and every table once', () => {
  const tables: SampleTable[] = [
    { p1: 'A', p2: 'B', winner: null },
    { p1: 'C', p2: 'D', winner: 'C' },
    { p1: 'E', p2: 'F', winner: 'F' },
    { p1: 'G', p2: 'H', winner: null },
    { p1: 'I', p2: 'J', winner: 'J' },
    { p1: 'K', p2: null, winner: 'K' }
  ];
  for (let seed = 1; seed <= 20; seed += 1) {
    const order = reportOrder(tables, seededRandom(seed));
    assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4, 5]);
    assert.equal(order[0], 5, 'the bye comes in first');
    assert.deepEqual(new Set(order.slice(-2)), new Set([0, 3]), 'the ties come in last');
  }
});

test('the decided tables do not always come in top down', () => {
  const tables = playSampleEvent(SAMPLE_PLAYERS, 1, seededRandom(2))[0] as SampleTable[];
  const orders = new Set(Array.from({ length: 10 }, (_, seed) => reportOrder(tables, seededRandom(seed + 1)).join()));
  assert.ok(orders.size > 1);
  assert.ok([...orders].some(order => order !== tables.map((_, i) => i).join()));
});
