/**
 * Which players the console's roster shows: a search on the name or Player
 * ID, and before round 1 only those not checked in.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyTournament } from '../../shared/tournament/create.ts';
import type { Player } from '../../shared/tournament/types.ts';
import { inRoster, isRosterFilter } from '../../src/pages/tournaments/rosterFilter.ts';

const player = (id: string, firstName: string, droppedAfter: number | null = null): Player => ({
  id,
  firstName,
  lastName: 'Test',
  birthDate: '',
  droppedAfter,
  created: '',
  modified: ''
});

const ada = player('101', 'Ada');
const ben = player('202', 'Ben');
const gone = player('303', 'Cy', 0);
const late = { ...player('404', 'Di'), late: true };
const event = {
  mode: 'swiss' as const,
  settings: { entryFee: 10 },
  tournament: emptyTournament({ name: 'Night' }),
  checkins: { '101': { paid: true as const } }
};

test('the search matches a name or a Player ID', () => {
  assert.equal(inRoster(event, ada, 'all', 'ada'), true);
  assert.equal(inRoster(event, ada, 'all', '10'), true);
  assert.equal(inRoster(event, ada, 'all', 'ben'), false);
  assert.equal(inRoster(event, ada, 'all', '  '), true);
});

test('not checked in leaves out who has paid and who has dropped', () => {
  assert.deepEqual(
    [ada, ben, gone].filter(p => inRoster(event, p, 'unchecked', '')).map(p => p.id),
    ['202']
  );
  assert.equal(inRoster(event, ben, 'unchecked', 'ada'), false);
});

test('a status keeps only its players: still in, dropped, or late', () => {
  const ids = (filter: Parameters<typeof inRoster>[2]) =>
    [ada, gone, late].filter(p => inRoster(event, p, filter, '')).map(p => p.id);
  assert.deepEqual(ids('active'), ['101', '404']);
  assert.deepEqual(ids('dropped'), ['303']);
  assert.deepEqual(ids('late'), ['404']);
  assert.deepEqual(ids('all'), ['101', '303', '404']);
});

test('only a known filter is taken from the address', () => {
  assert.equal(isRosterFilter('unchecked'), true);
  assert.equal(isRosterFilter('nobody'), false);
  assert.equal(isRosterFilter(undefined), false);
});
