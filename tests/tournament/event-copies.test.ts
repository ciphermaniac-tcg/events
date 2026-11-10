/**
 * The copy of an event a device keeps for a load with no signal: the
 * public's copy only, never an older one over a newer, three events at most,
 * each dropped a day after it finishes.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyTournament } from '../../shared/tournament/create.ts';
import { DAY_MS } from '../../shared/tournament/limits.ts';
import { DEFAULT_SETTINGS, type TournamentView } from '../../shared/tournament/view.ts';
import { keepEventCopy, readEventCopy } from '../../src/lib/tournament/eventCopies.ts';

const view = (code: string, version: number, extra: Partial<TournamentView> = {}): TournamentView => ({
  code,
  mode: 'swiss',
  version,
  updatedAt: 0,
  tournament: emptyTournament({ name: code }),
  pending: [],
  reports: [],
  divisions: {},
  decks: {},
  settings: DEFAULT_SETTINGS,
  viewer: { role: null, me: 'k1', via: 'pop', signedIn: true },
  ...extra
});

test('keeps the public copy without who was viewing, and never an older one over a newer', () => {
  keepEventCopy(view('AAAAAA', 5), 1000);
  const kept = readEventCopy('AAAAAA', 2000);
  assert.equal(kept?.view.version, 5);
  assert.equal(kept?.savedAt, 1000);
  assert.deepEqual(kept?.view.viewer, { role: null, me: null, via: null, signedIn: false });
  keepEventCopy(view('AAAAAA', 4), 3000);
  assert.equal(readEventCopy('AAAAAA', 4000)?.view.version, 5, 'an older copy stays out');
  keepEventCopy(view('AAAAAA', 6), 5000);
  assert.equal(readEventCopy('AAAAAA', 6000)?.view.version, 6);
});

test('a staff copy is never kept: it holds what the public does not see', () => {
  keepEventCopy(view('BBBBBB', 1, { viewer: { role: 'staff', me: null, via: null, signedIn: true } }), 0);
  assert.equal(readEventCopy('BBBBBB', 0), null);
});

test('keeps three events at most, and drops one a day after it finishes', () => {
  for (const [i, code] of ['CCCCC1', 'CCCCC2', 'CCCCC3', 'CCCCC4'].entries()) {
    keepEventCopy(view(code, 1), i);
  }
  assert.equal(readEventCopy('CCCCC1', 10), null, 'the oldest goes');
  assert.equal(readEventCopy('CCCCC4', 10)?.view.code, 'CCCCC4');
  keepEventCopy(view('DDDDDD', 1, { settings: { ...DEFAULT_SETTINGS, finished: true } }), 0);
  assert.ok(readEventCopy('DDDDDD', DAY_MS));
  assert.equal(readEventCopy('DDDDDD', DAY_MS + 1), null);
  assert.equal(readEventCopy('DDDDDD', 0), null, 'and stays dropped');
});
