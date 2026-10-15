import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type DeckCheckEntry, readDeckCheck, standingChecks } from '../../shared/tournament/deckChecks.ts';

const entry = (id: string, at: number, change: Partial<DeckCheckEntry> = {}): DeckCheckEntry => ({
  id,
  playerId: 'p1',
  playerName: 'Nia Okafor',
  round: 1,
  checker: { id: 'u1', name: 'Dana Kim' },
  result: 'pass',
  notes: '',
  recordedBy: 'Dana Kim',
  recordedAt: at,
  replaces: null,
  removed: false,
  ...change
});

test('a deck check reads from a body, by checker account or typed name', () => {
  const body = { playerId: ' p1 ', round: 2, checkerId: 'u1', result: 'fail', notes: ' Four Iono ' };
  assert.deepEqual(readDeckCheck(body), {
    playerId: 'p1',
    round: 2,
    checker: { id: 'u1' },
    result: 'fail',
    notes: 'Four Iono',
    replaces: null
  });
  const typed = readDeckCheck({ ...body, checkerId: '', checkerName: 'Sam', replaces: 'e1' });
  assert.deepEqual(typeof typed === 'string' ? typed : [typed.checker, typed.replaces], [{ name: 'Sam' }, 'e1']);
});

test('a deck check missing a field says which', () => {
  const body = { playerId: 'p1', round: 1, checkerId: 'u1', result: 'pass' };
  assert.equal(readDeckCheck({ ...body, playerId: '' }), 'Say whose deck was checked');
  assert.equal(readDeckCheck({ ...body, round: 1.5 }), 'Say which round');
  assert.equal(readDeckCheck({ ...body, checkerId: undefined }), 'Say who checked the deck');
  assert.equal(
    readDeckCheck({ ...body, checkerId: undefined, checkerName: 'x'.repeat(61) }),
    'Say who checked the deck'
  );
  assert.equal(readDeckCheck({ ...body, result: 'PASS' }), 'Say whether it passed');
  assert.equal(readDeckCheck({ ...body, notes: 7 }), 'Keep the notes under 1000 characters');
  assert.equal(readDeckCheck({ ...body, replaces: 4 }), 'Not a deck check to edit');
});

test('checks stand at their latest entry, with what they replaced, and removed ones drop out', () => {
  const entries = [
    entry('a', 1),
    entry('b', 2, { playerId: 'p2' }),
    entry('a2', 3, { replaces: 'a', result: 'fail' }),
    entry('a3', 4, { replaces: 'a2', notes: 'Recounted' }),
    entry('b2', 5, { playerId: 'p2', replaces: 'b', removed: true })
  ];
  const standing = standingChecks(entries);
  assert.deepEqual(
    standing.map(check => [check.id, check.notes, check.earlier.map(earlier => earlier.id)]),
    [['a3', 'Recounted', ['a2', 'a']]]
  );
});

test('standing checks come newest first', () => {
  const standing = standingChecks([entry('old', 1), entry('new', 9), entry('mid', 5)]);
  assert.deepEqual(
    standing.map(check => check.id),
    ['new', 'mid', 'old']
  );
});
