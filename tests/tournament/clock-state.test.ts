/** One clock's state, which every clock on the site draws from. */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Round } from '../../shared/tournament/types.ts';
import { clockState, clockTime } from '../../src/lib/tournament/clockState.ts';

const START = 1_000_000;
const round = (changes: Partial<Round> = {}): Round => ({
  number: 2,
  kind: 'swiss',
  status: 'started',
  timeLeft: 600,
  pairTime: '',
  startTime: '10/03/2026 15:00:00',
  clockStartedAt: START,
  matches: [],
  ...changes
});
const at = (seconds: number) => START + seconds * 1000;
const phase = (input: Parameters<typeof clockState>[0]) => clockState(input)?.phase;

test('m:ss drops the sign and pads the seconds', () => {
  assert.equal(clockTime(600), '10:00');
  assert.equal(clockTime(65), '1:05');
  assert.equal(clockTime(0), '0:00');
  assert.equal(clockTime(-133), '2:13');
});

test('a round whose clock never started has no clock, unless it is done', () => {
  const waiting = round({ startTime: '', clockStartedAt: null, status: 'paired' });
  assert.equal(clockState({ round: waiting, now: at(0) }), null);
  assert.equal(phase({ round: waiting, now: at(0), done: true }), 'done');
});

test('a running clock counts down, and is over from zero', () => {
  assert.deepEqual(clockState({ round: round(), now: at(0) }), { phase: 'running', left: 600, time: '10:00' });
  assert.deepEqual(clockState({ round: round(), now: at(599) }), { phase: 'running', left: 1, time: '0:01' });
  assert.deepEqual(clockState({ round: round(), now: at(600) }), { phase: 'over', left: 0, time: '0:00' });
  assert.deepEqual(clockState({ round: round(), now: at(733) }), { phase: 'over', left: -133, time: '2:13' });
});

test('a paused clock holds its time, and one paused past time reads as over', () => {
  const paused = round({ clockStartedAt: null, timeLeft: 425 });
  assert.deepEqual(clockState({ round: paused, now: at(0) }), { phase: 'paused', left: 425, time: '7:05' });
  assert.deepEqual(clockState({ round: paused, now: at(9_000) }), { phase: 'paused', left: 425, time: '7:05' });
  assert.equal(phase({ round: round({ clockStartedAt: null, timeLeft: -30 }), now: at(0) }), 'over');
});

test('a table on extra time runs past the round, extended, until its own time is out', () => {
  const extra = 300;
  assert.deepEqual(clockState({ round: round(), now: at(120), extraSeconds: extra }), {
    phase: 'running',
    left: 780,
    time: '13:00'
  });
  assert.deepEqual(clockState({ round: round(), now: at(720), extraSeconds: extra }), {
    phase: 'extended',
    left: 180,
    time: '3:00'
  });
  assert.equal(phase({ round: round(), now: at(900), extraSeconds: extra }), 'over');
  assert.equal(phase({ round: round(), now: at(720) }), 'over', 'the round itself is over');
  assert.equal(
    phase({ round: round({ clockStartedAt: null, timeLeft: -60 }), now: at(0), extraSeconds: extra }),
    'paused'
  );
});

test('a stale clock stops where it was at the last good check, whatever its phase was', () => {
  const stale = clockState({ round: round(), now: at(500), staleSince: at(200) });
  assert.deepEqual(stale, { phase: 'stale', left: 400, time: '6:40' });
  assert.deepEqual(clockState({ round: round(), now: at(900), staleSince: at(200) }), stale, 'it does not tick');
  assert.deepEqual(clockState({ round: round(), now: at(900), staleSince: at(700) }), {
    phase: 'stale',
    left: -100,
    time: '1:40'
  });
  assert.equal(phase({ round: round({ clockStartedAt: null }), now: at(5), staleSince: at(0) }), 'stale');
  assert.equal(phase({ round: round(), now: at(5), staleSince: null }), 'running', 'fresh again, it runs');
});

test('a clock with its result is done, stale or not, and says so before anything else', () => {
  assert.equal(phase({ round: round(), now: at(0), done: true }), 'done');
  assert.equal(phase({ round: round(), now: at(900), done: true, extraSeconds: 300 }), 'done');
  assert.equal(phase({ round: round(), now: at(900), done: true, staleSince: at(0) }), 'done');
});

test('one table through its round: running, extended, over, and done once it reports', () => {
  const table = (seconds: number, done = false) => phase({ round: round(), now: at(seconds), extraSeconds: 180, done });
  assert.deepEqual(
    [table(0), table(599), table(600), table(779), table(780), table(800, true)],
    ['running', 'running', 'extended', 'extended', 'over', 'done']
  );
});
