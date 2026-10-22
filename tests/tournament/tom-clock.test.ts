/**
 * A TOM event's round clocks are the site's: a synced file's timer is set
 * aside, and neither the revision a sync is checked against nor the
 * comparison of a file with the site's copy sees clocks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { olderThan, revisionOf } from '../../shared/tournament/revision.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import { withoutClocks, withSiteClocks } from '../../shared/tournament/tomClock.ts';
import type { Round, Tournament } from '../../shared/tournament/types.ts';

const CHALLENGE = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));

const roundsOf = (tournament: Tournament) => tournament.pods[0]?.rounds ?? [];

function withRounds(tournament: Tournament, change: (round: Round) => Round): Tournament {
  return { ...tournament, pods: tournament.pods.map(pod => ({ ...pod, rounds: pod.rounds.map(change) })) };
}

test('a file with no copy held starts every round unstarted with its full time', () => {
  assert.equal(roundsOf(CHALLENGE)[0]?.timeLeft, 612, 'the fixture carries a TOM timer');
  const fresh = roundsOf(withSiteClocks(CHALLENGE, null));
  for (const round of fresh) {
    assert.equal(round.timeLeft, 30 * 60);
    assert.equal(round.startTime, '');
    assert.equal(round.clockStartedAt, null);
  }
  assert.equal(fresh[0]?.status, 'finished', 'only the clock is set aside');
});

test('a top cut round starts with the finals round time', () => {
  const cut = withRounds(CHALLENGE, round => ({ ...round, kind: 'elimination' }));
  assert.equal(roundsOf(withSiteClocks(cut, null))[0]?.timeLeft, 75 * 60);
});

test('a round the site holds keeps its clock whatever the file says', () => {
  const held = withRounds(CHALLENGE, round =>
    round.number === 2 ? { ...round, timeLeft: 900, startTime: '10/03/2026 13:00:00', clockStartedAt: 1_000 } : round
  );
  const file = withRounds(CHALLENGE, round => ({ ...round, timeLeft: 42, startTime: '10/03/2026 13:05:00' }));
  const [first, second] = roundsOf(withSiteClocks(file, held));
  assert.deepEqual(
    { timeLeft: second?.timeLeft, startTime: second?.startTime, clockStartedAt: second?.clockStartedAt },
    { timeLeft: 900, startTime: '10/03/2026 13:00:00', clockStartedAt: 1_000 }
  );
  assert.equal(first?.timeLeft, 612, 'the held round 1 keeps the clock it was created with');
});

test('a round new from TOM gets a fresh clock beside the ones kept', () => {
  const held = { ...CHALLENGE, pods: CHALLENGE.pods.map(pod => ({ ...pod, rounds: pod.rounds.slice(0, 1) })) };
  const [first, second] = roundsOf(withSiteClocks(CHALLENGE, withSiteClocks(held, null)));
  assert.equal(first?.timeLeft, 30 * 60);
  assert.equal(second?.timeLeft, 30 * 60);
  assert.equal(second?.startTime, '');
});

test('the revision does not change with the clock, but does with anything else', async () => {
  const running = withRounds(CHALLENGE, round => ({ ...round, timeLeft: 1, clockStartedAt: 5, startTime: 'x' }));
  assert.equal(await revisionOf(running), await revisionOf(CHALLENGE));
  const renamed = { ...CHALLENGE, info: { ...CHALLENGE.info, name: 'Another' } };
  assert.notEqual(await revisionOf(renamed), await revisionOf(CHALLENGE));
  assert.equal('timeLeft' in (withoutClocks(CHALLENGE).pods[0]?.rounds[0] ?? {}), false);
});

test('a file is older than the site’s copy only when it lacks a round or a result the site has', () => {
  const stored = readTournament(JSON.parse(JSON.stringify(CHALLENGE)) as unknown);
  assert.ok(stored);
  assert.ok(!olderThan(CHALLENGE, stored), 'the same event, its fields in another order');
  assert.ok(!olderThan(CHALLENGE, { ...stored, info: { ...stored.info, name: 'Another' } }), 'only different');
  assert.ok(!olderThan(CHALLENGE, { ...stored, players: stored.players.slice(1) }), 'the file has a player more');
  const unseated = { ...stored.players[0]!, id: '9100000001' };
  assert.ok(!olderThan(CHALLENGE, { ...stored, players: [...stored.players, unseated] }), 'a player more on the site');
  const reported = stored.pods[0]!.rounds[0]!.matches.find(m => m.p2 !== null && m.outcome !== 'pending')!;
  const unreported = withRounds(CHALLENGE, round => ({
    ...round,
    matches: round.matches.map(m =>
      m.table === reported.table && round.number === 1 ? { ...m, outcome: 'pending' as const } : m
    )
  }));
  assert.ok(olderThan(unreported, stored), 'the file lacks a result');
  assert.ok(!olderThan(stored, unreported), 'the file has a result more');
  const fewerRounds = { ...CHALLENGE, pods: CHALLENGE.pods.map(pod => ({ ...pod, rounds: pod.rounds.slice(0, -1) })) };
  assert.ok(olderThan(fewerRounds, stored), 'the file lacks a round');
  assert.ok(!olderThan(stored, fewerRounds), 'the file has a round more');
});
