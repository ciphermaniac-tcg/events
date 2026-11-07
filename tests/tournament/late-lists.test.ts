/**
 * A late entrant's list: open from when they join until the next round
 * pairs after it (see decklistOpenFor), and shut for everyone else once
 * round 1 is paired.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { decklistOpenFor, lateListsOpen } from '../../shared/tournament/lateLists.ts';
import { DEFAULT_SETTINGS, type TournamentSettings } from '../../shared/tournament/view.ts';
import { commandRunner, freshContext, pendingResults } from '../__utils__/commands.ts';

const run = commandRunner(freshContext(7, '10/10/2026 12:00:00'));

const add = (id: string): Command => ({
  type: 'addPlayer',
  player: { firstName: 'Player', lastName: id, id, birthDate: '02/27/1990' }
});

const pair: Command = { type: 'pairRound', pod: 'masters' };

const masters = (t: Tournament) => t.pods.find(pod => pod.category === 'masters' && !pod.cutOf)!;

/** Every open match of the current round won by the first seat. */
const finishRound = (t: Tournament) => run(t, ...pendingResults(masters(t)));

const OPEN: TournamentSettings = { ...DEFAULT_SETTINGS, decklists: 'open' };

const event = (tournament: Tournament, settings: Partial<TournamentSettings> = {}) => ({
  settings: { ...OPEN, ...settings },
  tournament
});

/** Four starters in round 2, with Lena entered late during it. */
function lateInRound2() {
  const start = run(emptyTournament({ name: 'Cup' }), add('1'), add('2'), add('3'), add('4'), pair);
  return run(finishRound(start), pair, add('lena'));
}

test('before round 1 anyone may send a list, someone not yet on the event too', () => {
  const t = run(emptyTournament({ name: 'Cup' }), add('1'));
  assert.equal(decklistOpenFor(event(t), '1'), true);
  assert.equal(decklistOpenFor(event(t), null), true);
  assert.equal(lateListsOpen(event(t)), false, 'nothing is late before round 1');
});

test('a starter’s list locks when round 1 pairs', () => {
  const t = lateInRound2();
  assert.equal(decklistOpenFor(event(t), '1'), false);
  assert.equal(decklistOpenFor(event(t), '1', 'staff'), false);
  assert.equal(decklistOpenFor(event(t), null), false, 'nobody new registers by list after round 1');
});

test('a late entrant may send their list until the next round pairs', () => {
  const t = lateInRound2();
  const lena = t.players.find(player => player.id === 'lena')!;
  assert.deepEqual([lena.late, lena.lateData?.round], [true, 2], 'TOM records the round they joined in');
  assert.equal(decklistOpenFor(event(t), 'lena'), true);
  assert.equal(lateListsOpen(event(t)), true);

  const reported = finishRound(t);
  assert.equal(decklistOpenFor(event(reported), 'lena'), true, 'their round’s results do not close it');
  const next = run(reported, pair);
  assert.equal(decklistOpenFor(event(next), 'lena'), false, 'round 3 pairing locks it');
  assert.equal(lateListsOpen(event(next)), false);
});

test('a late entrant in the final round keeps their window until the top cut pairs or the event ends', () => {
  const round3 = run(finishRound(lateInRound2()), pair, add('max'));
  assert.equal(decklistOpenFor(event(round3), 'max'), true);
  const reported = finishRound(round3);
  assert.equal(decklistOpenFor(event(reported), 'max'), true);
  assert.equal(decklistOpenFor(event(reported, { finished: true }), 'max'), false, 'an ended event takes no list');
  const cut = run(reported, { type: 'startTopCut', pod: 'masters', size: 4 });
  assert.equal(decklistOpenFor(event(cut), 'max'), false, 'the top cut pairing locks it');
});

test('staff manage a late entrant’s list while submission is closed; players do not, and nobody while lists are off', () => {
  const t = lateInRound2();
  const closed = event(t, { decklists: 'closed' });
  assert.equal(decklistOpenFor(closed, 'lena'), false);
  assert.equal(decklistOpenFor(closed, 'lena', 'staff'), true);
  assert.equal(decklistOpenFor(event(t, { decklists: 'off' }), 'lena', 'staff'), false);
  assert.equal(decklistOpenFor(event(finishRound(t)), 'lena', 'staff'), true);
  assert.equal(decklistOpenFor(event(run(finishRound(t), pair)), 'lena', 'staff'), false);
});

test('a late entrant who dropped, or one not marked late, is locked like everyone else', () => {
  const t = lateInRound2();
  assert.equal(decklistOpenFor(event(run(t, { type: 'dropPlayer', id: 'lena' })), 'lena'), false);
  const unmarked = {
    ...t,
    players: t.players.map(player => (player.id === 'lena' ? { ...player, late: false } : player))
  };
  assert.equal(decklistOpenFor(event(unmarked), 'lena'), false);
});
