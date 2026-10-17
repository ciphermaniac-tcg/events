import assert from 'node:assert/strict';
import test from 'node:test';
import { similarlyNamed } from '../../shared/tournament/identify';

const players = [
  { firstName: 'Avery', lastName: 'Chen' },
  { firstName: 'Alex', lastName: 'Kim' },
  { firstName: 'Alexa', lastName: 'Kim' },
  { firstName: 'José', lastName: 'Peña' }
];

test('a name finds its player exactly, by case or accent, or a single slip away', () => {
  assert.deepEqual(similarlyNamed(players, { firstName: 'avery', lastName: 'chen ' }), [players[0]]);
  assert.deepEqual(similarlyNamed(players, { firstName: 'Avry', lastName: 'Chen' }), [players[0]]);
  assert.deepEqual(similarlyNamed(players, { firstName: 'Jose', lastName: 'Pena' }), [players[3]]);
  assert.deepEqual(similarlyNamed(players, { firstName: 'Alex', lastName: 'Kim' }), [players[1], players[2]]);
  assert.deepEqual(similarlyNamed(players, { firstName: 'Avy', lastName: 'Chan' }), []);
});
