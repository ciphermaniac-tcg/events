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
import { DEFAULT_SETTINGS, publicTournament, type TournamentSettings } from '../../shared/tournament/view.ts';
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

test('a late entrant’s list is taken while lists are closed too, and not while they are off', () => {
  const t = lateInRound2();
  assert.equal(decklistOpenFor(event(t, { decklists: 'closed' }), 'lena'), true);
  assert.equal(decklistOpenFor(event(t, { decklists: 'off' }), 'lena'), false);
  assert.equal(decklistOpenFor(event(finishRound(t)), 'lena'), true);
  assert.equal(decklistOpenFor(event(run(finishRound(t), pair)), 'lena'), false);
});

test('a late entrant who dropped, or a starter, is locked like everyone else', () => {
  const t = lateInRound2();
  assert.equal(decklistOpenFor(event(run(t, { type: 'dropPlayer', id: 'lena' })), 'lena'), false);
  assert.equal(decklistOpenFor(event(t), '2'), false);
});

/** Lena as TOM sends a latecomer entered without the Late box: no late flag or round, and maybe no starter flag. */
const unmarked = (t: Tournament, starter: false | undefined): Tournament => ({
  ...t,
  players: t.players.map(player => {
    if (player.id !== 'lena') {
      return player;
    }
    const { late: _late, lateData: _lateData, starter: _starter, ...rest } = player;
    return starter === undefined ? rest : { ...rest, starter };
  })
});

test('a latecomer entered without the Late box gets the window through the first round they are paired in', () => {
  for (const starter of [false, undefined] as const) {
    const t = unmarked(lateInRound2(), starter);
    assert.equal(decklistOpenFor(event(t), 'lena'), true, `waiting for a first pairing (starter ${starter})`);
    const round3 = run(finishRound(t), pair);
    assert.equal(decklistOpenFor(event(round3), 'lena'), true, 'round 3 is the first they are paired in');
    const reported = finishRound(round3);
    const cut = run(reported, { type: 'startTopCut', pod: 'masters', size: 4 });
    assert.equal(decklistOpenFor(event(cut), 'lena'), false, 'the next pairing locks it');
  }
});

test('a starter TOM marked as one stays locked after a no-show loss in round 1', () => {
  const t = lateInRound2();
  const starter = {
    ...t,
    players: t.players.map(p =>
      p.id === 'lena' ? { ...unmarked(t, false).players.find(q => q.id === 'lena')!, starter: true } : p
    )
  };
  assert.equal(decklistOpenFor(event(run(finishRound(starter), pair)), 'lena'), false);
});

test("the public view opens an unmarked latecomer's window when the server does, before any missed-round loss", () => {
  const t = unmarked(lateInRound2(), false);
  const noLoss: Tournament = {
    ...t,
    pods: t.pods.map(pod => ({
      ...pod,
      rounds: pod.rounds.map(round => ({
        ...round,
        matches: round.matches.filter(m => !(m.p1 === 'lena' && m.p2 === null))
      }))
    }))
  };
  const keys = Object.fromEntries(noLoss.players.map(p => [p.id, `k-${p.id}`]));
  assert.equal(decklistOpenFor(event(noLoss), 'lena'), true);
  assert.equal(decklistOpenFor(event(publicTournament(noLoss, keys)), 'k-lena'), true);
});
