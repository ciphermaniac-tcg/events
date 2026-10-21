/**
 * The players a TOM event knows only from site registrations until its file
 * comes in: what check-in lists and what deleting the event counts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import type { Decklist, Manage } from '../../src/lib/tournament/api.ts';
import { registrantsSource, siteRegistrants } from '../../src/pages/tournaments/siteRegistrants.ts';
import { commandRunner, freshContext } from '../__utils__/commands.ts';

const run = commandRunner(freshContext(3, '10/10/2026 10:00:00'));
const add = (id: string, firstName: string): Command => ({
  type: 'addPlayer',
  player: { firstName, lastName: 'Test', id, birthDate: '01/01/1990' }
});
const listed = run(emptyTournament({ name: 'Cup' }), add('1001', 'Ada'), add('1002', 'Ben'));
const list = (popId: string, firstName: string) =>
  ({ popId, firstName, lastName: 'Test', birthDate: '01/01/1990' }) as Decklist;
const manage = (mode: 'tom' | 'swiss', tournament = listed) => ({ code: 'CUP1', mode, tournament }) as Manage;

test('registrations are read at a TOM event before round 1 only', () => {
  assert.equal(registrantsSource(manage('tom')), 'CUP1');
  assert.equal(registrantsSource(manage('swiss')), null, 'the site lists them itself');
  const paired = run(listed, add('1003', 'Cy'), { type: 'pairRound', pod: 'masters' });
  assert.equal(registrantsSource(manage('tom', paired)), null, 'once round 1 is in, TOM’s file is the list');
});

test('a registration counts once, and not again once the file lists its player', () => {
  const found = siteRegistrants(manage('tom'), [list('1002', 'Ben'), list('2001', 'Di'), list('2002', 'Eve')]);
  assert.deepEqual(
    found.map(player => [player.id, player.firstName, player.droppedAfter]),
    [
      ['2001', 'Di', null],
      ['2002', 'Eve', null]
    ]
  );
  assert.deepEqual(siteRegistrants(manage('tom', emptyTournament({ name: 'Cup' })), []), []);
});
