import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupNameFits, lookupPlayers } from '../../shared/tournament/lookup.ts';

const NEAR = [
  ['Parker', 'Perker'],
  ['Peter', 'Piter'],
  ['Parker', 'Pakrer'],
  ['Parker', 'Parke'],
  ['Parker', 'Parkker'],
  ['Peña', 'PENA'],
  ['José', 'jose'],
  ['  Parker ', 'PARKER'],
  ['Li', 'LI'],
  ['Nguyễn', 'Nguyen'],
  ['Smith', 'Smiht'],
  ['Smith', 'Smit'],
  ['Müller', 'Muller']
];
const FAR = [
  ['', 'Parker'],
  [' ', ' '],
  ['Li', 'Lu'],
  ['Lee', 'Le'],
  ['Ng', 'N'],
  ['Ann', 'Ana'],
  ['Parker', 'Merker'],
  ['Parker', 'Peeker'],
  ['Parker', 'Park'],
  ['Smith', 'Smythe'],
  ['Parker', 'Parkerson'],
  ['Anderson', 'Andrews'],
  ['Smith', 'Jones'],
  ['Peter', 'Patricia']
];
for (const [label, pairs, expected] of [
  ['near miss', NEAR, true],
  ['false positive', FAR, false]
] as const) {
  for (const [a, b] of pairs) {
    test(`${label}: ${a} / ${b}`, () => {
      assert.equal(lookupNameFits(a!, b!), expected);
      assert.equal(lookupNameFits(b!, a!), expected, 'symmetric');
    });
  }
}

test('Peter Parker matches Piter Perker, without guessing between plausible surnames', () => {
  const players = [
    { id: '1', firstName: 'Peter', lastName: 'Parker' },
    { id: '2', firstName: 'Patricia', lastName: 'Parker' },
    { id: '3', firstName: 'Peter', lastName: 'Barker' }
  ];
  assert.deepEqual(lookupPlayers(players, { lastName: 'Perker', firstName: 'Piter' }), [players[0]]);
  assert.deepEqual(
    lookupPlayers(players, { lastName: 'Parker' }),
    players,
    'even exact matches do not hide plausible rivals'
  );
  assert.deepEqual(lookupPlayers(players, { lastName: 'Perker' }), players.slice(0, 2));
});
