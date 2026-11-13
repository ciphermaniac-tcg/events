/**
 * Which players the console's roster shows: the search Penalties uses, on a
 * name typed either way round, a table or a Player ID, and a status.
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

const ids = (players: readonly Player[]) => players.map(p => p.id);

test('the search matches a name typed either way round, or a Player ID', () => {
  assert.deepEqual(ids(inRoster(event, [ada, ben], 'all', 'ada')), ['101']);
  assert.deepEqual(ids(inRoster(event, [ada, ben], 'all', 'Test, Ada')), ['101'], 'as the roster shows the name');
  assert.deepEqual(ids(inRoster(event, [ada, ben], 'all', 'ada test')), ['101']);
  assert.deepEqual(ids(inRoster(event, [ada, ben], 'all', '10')), ['101']);
  assert.deepEqual(ids(inRoster(event, [ada, ben], 'all', '  ')), ['101', '202']);
});

test('not checked in leaves out who has paid and who has dropped', () => {
  assert.deepEqual(ids(inRoster(event, [ada, ben, gone], 'unchecked', '')), ['202']);
  assert.deepEqual(ids(inRoster(event, [ben], 'unchecked', 'ada')), []);
});

test('a status keeps only its players: still in, dropped, or late', () => {
  const shown = (filter: Parameters<typeof inRoster>[2]) => ids(inRoster(event, [ada, gone, late], filter, ''));
  assert.deepEqual(shown('active'), ['101', '404']);
  assert.deepEqual(shown('dropped'), ['303']);
  assert.deepEqual(shown('late'), ['404']);
  assert.deepEqual(shown('all'), ['101', '303', '404']);
});

test('a missed-round loss marks a late arrival too', () => {
  const seated = {
    ...event,
    tournament: {
      ...event.tournament,
      players: [ada, ben],
      pods: [
        {
          category: 'masters' as const,
          playerIds: ['101', '202'],
          rounds: [
            {
              number: 1,
              kind: 'swiss' as const,
              status: 'started' as const,
              timeLeft: 1800,
              pairTime: '',
              startTime: '10:00',
              matches: [{ table: 1, p1: '202', p2: null, outcome: 'loss' as const, timestamp: '' }]
            }
          ],
          cut: 0,
          playoff3rd4th: false,
          startingTable: 1
        }
      ]
    }
  };
  assert.deepEqual(ids(inRoster(seated, [ada, ben], 'late', '')), ['202']);
});

test('only a known filter is taken from the address', () => {
  assert.equal(isRosterFilter('unchecked'), true);
  assert.equal(isRosterFilter('nobody'), false);
  assert.equal(isRosterFilter(undefined), false);
});
