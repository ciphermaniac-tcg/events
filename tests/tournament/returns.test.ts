/**
 * returnEffects: what reinstating a dropped player does, as the roster
 * states it before asking, must be what the return then does.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand, type Command, type CommandContext } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { returnEffects } from '../../shared/tournament/returns.ts';
import type { Pod, Tournament } from '../../shared/tournament/types.ts';
import { commandRunner, pendingResults } from '../__utils__/commands.ts';

function context(seed = 1): CommandContext {
  return { now: 1_000_000, localTime: '09/28/2026 10:00:00', season: 2027, random: seededRandom(seed) };
}

const run = commandRunner(current => context(current.players.length + 7));
const pod = (t: Tournament): Pod => t.pods[0] as Pod;
const reportAll = (t: Tournament): Tournament => run(t, ...pendingResults(pod(t)));

function withPlayers(count: number, ...commands: Command[]): Tournament {
  const adds: Command[] = Array.from({ length: count }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: 'Player', lastName: String(i + 1), id: String(100 + i), birthDate: '01/01/1990' }
  }));
  return run(emptyTournament({ name: 'Return Cup' }), ...adds, ...commands);
}

/** The rounds the reinstated player holds a bye in, or the refusal the return met. */
function reinstated(t: Tournament, id: string): number[] | string {
  const result = applyCommand(t, { type: 'undropPlayer', id }, context());
  if (!result.ok) {
    return result.error;
  }
  return pod(result.tournament)
    .rounds.filter(round => round.matches.some(m => m.p1 === id && m.p2 === null && m.outcome === 'bye'))
    .map(round => round.number);
}

/** Asserts returnEffects says what the return does, and returns what it says. */
function agreed(t: Tournament, id: string) {
  const effects = returnEffects(t, id);
  const done = reinstated(t, id);
  if (effects.refusal) {
    assert.equal(done, effects.refusal);
  } else {
    assert.deepEqual(done, effects.byeRound === undefined ? [] : [effects.byeRound]);
  }
  return effects;
}

/** Round 1 played by four, player 100 dropped after it, round 2 paired without them. */
const missedRoundTwo = () =>
  run(
    reportAll(withPlayers(4, { type: 'pairRound', pod: 'masters' })),
    { type: 'dropPlayer', id: '100' },
    {
      type: 'pairRound',
      pod: 'masters'
    }
  );

test('a player back for a round that started without them gets a bye for it', () => {
  const effects = agreed(run(missedRoundTwo(), { type: 'startClock', pod: 'masters' }), '100');
  assert.deepEqual(effects, { offered: true, liftsDisqualification: false, byeRound: 2 });
});

test('a player back before the round they missed starts gets no bye', () => {
  assert.deepEqual(agreed(missedRoundTwo(), '100'), { offered: true, liftsDisqualification: false });
});

test('reinstating a disqualified player lifts the disqualification', () => {
  const t = run(withPlayers(4, { type: 'pairRound', pod: 'masters' }), { type: 'disqualifyPlayer', id: '100' });
  assert.equal(agreed(t, '100').liftsDisqualification, true);
});

test('a player whose only matches were not saved is refused, as the return refuses them', () => {
  const t = run(withPlayers(5, { type: 'dropPlayer', id: '104' }), { type: 'pairRound', pod: 'masters' });
  const unsaved = { ...t, pods: [{ ...pod(t), unsavedPlayers: ['104'] }] };
  const effects = agreed(unsaved, '104');
  assert.equal(effects.refusal, 'A player whose only matches were not saved cannot return');
  assert.equal(effects.offered, true, 'the roster offers it, to say why not');
});

test('a player who never played is refused once round three is paired', () => {
  let t = withPlayers(5, { type: 'dropPlayer', id: '104' });
  for (let i = 0; i < 3; i += 1) {
    t = run(i ? reportAll(t) : t, { type: 'pairRound', pod: 'masters' });
  }
  const effects = agreed(t, '104');
  assert.equal(effects.refusal, 'A player without match history cannot return after round two');
  assert.equal(effects.offered, false, 'gone since before round one, they are past offering one');
});

test('a player gone more than a round is no longer offered a return, and the return refuses them', () => {
  let t = run(reportAll(withPlayers(16, { type: 'pairRound', pod: 'masters' })), { type: 'dropPlayer', id: '100' });
  for (let i = 0; i < 2; i += 1) {
    t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  }
  t = run(t, { type: 'pairRound', pod: 'masters' }, { type: 'startClock', pod: 'masters' });
  const effects = agreed(t, '100');
  assert.equal(effects.refusal, 'A player cannot return after missing more than one round');
  assert.equal(effects.offered, false);
});

test('an event from before the lifecycle engine takes a player back only until the next round is paired', () => {
  const t = run(reportAll(withPlayers(4, { type: 'pairRound', pod: 'masters' })), { type: 'dropPlayer', id: '100' });
  const { settings: _settings, ...legacy } = t;
  assert.deepEqual(returnEffects(legacy, '100'), { offered: true, liftsDisqualification: false });
  const paired = {
    ...legacy,
    pods: [{ ...pod(legacy), rounds: [...pod(legacy).rounds, { ...pod(legacy).rounds[0]!, number: 2 }] }]
  };
  assert.deepEqual(returnEffects(paired, '100'), {
    offered: false,
    liftsDisqualification: false,
    refusal: 'They dropped before round 2 was paired, so they can’t come back now'
  });
});

test('a player still in has nothing to return from', () => {
  assert.equal(returnEffects(withPlayers(4), '100').refusal, 'The player is not dropped');
});
