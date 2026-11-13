import assert from 'node:assert/strict';
import test from 'node:test';
import { marksFor, notCheckedIn, openMarks, standing, withMark } from '../../shared/tournament/checkins';
import type { Player } from '../../shared/tournament/types';

const listed = (...ids: string[]) => ({ players: ids.map(id => ({ id })) });
const swiss = (entryFee: number, ...ids: string[]) => ({
  mode: 'swiss' as const,
  settings: { entryFee },
  tournament: listed(...ids)
});
const tom = (entryFee: number, ...ids: string[]) => ({
  mode: 'tom' as const,
  settings: { entryFee },
  tournament: listed(...ids)
});

test('an event asks only the checks that apply to it and to the player', () => {
  assert.deepEqual(marksFor(swiss(0), undefined), []);
  assert.deepEqual(marksFor(swiss(10), undefined), ['paid']);
  assert.deepEqual(marksFor(tom(0), undefined), ['tom']);
  assert.deepEqual(marksFor(tom(10), { paper: true }), ['paid', 'tom', 'list']);
  assert.deepEqual(openMarks(tom(10), { paper: true, paid: true, list: true }), ['tom']);
});

const player = (id: string, droppedAfter: number | null = null): Player => ({
  id,
  firstName: 'A',
  lastName: id,
  birthDate: '',
  droppedAfter,
  created: '',
  modified: ''
});

test('a dropped player is not waited on', () => {
  const players = [player('1'), player('2', 0), player('3')];
  assert.deepEqual(
    notCheckedIn(swiss(5), players, { '1': { paid: true } }).map(p => p.id),
    ['3']
  );
});

test('a mark sets and clears, and an empty check-in leaves the map', () => {
  const set = withMark({}, '1', 'paid', true);
  assert.deepEqual(set, { '1': { paid: true } });
  assert.deepEqual(withMark(set, '1', 'list', true), { '1': { paid: true, list: true } });
  assert.deepEqual(withMark(set, '1', 'paid', false), {});
});

test('anyone TOM’s file lists is in TOM, whatever staff stored', () => {
  const event = tom(0, '1');
  assert.deepEqual(standing(event, {}, '1'), { tom: true });
  assert.deepEqual(
    standing(event, {}, '2'),
    undefined,
    'a site registrant not in the file yet is still staff’s to tick'
  );
  assert.deepEqual(standing(swiss(0, '1'), {}, '1'), undefined);
  assert.deepEqual(
    notCheckedIn(event, [player('1'), player('2')], {}).map(p => p.id),
    ['2']
  );
});
