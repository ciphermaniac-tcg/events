/**
 * The home page's sample timeline: each round opens after the last has read
 * through, results land a beat apart, the event ends and restarts after its
 * rest, and a seat's mark and a record read as the app writes them.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { SampleTable } from '../../src/lib/tournament/sampleEvent.ts';
import { markOf, recordOf, scheduleRounds } from '../../src/lib/tournament/sampleSchedule.ts';

const TIMING = { beat: 100, read: 1000, rest: 5000 };

const table = (p1: string, p2: string | null, winner: string | null): SampleTable => ({ p1, p2, winner });

test('a seat marks W, L and T only once its table is in', () => {
  const win = table('A', 'B', 'A');
  assert.equal(markOf(win, 'A', true), 'W');
  assert.equal(markOf(win, 'B', true), 'L');
  assert.equal(markOf(table('A', 'B', null), 'B', true), 'T');
  assert.equal(markOf(win, 'A', false), '');
});

test('a record reads wins, losses, ties, and zeros for a player not yet seen', () => {
  assert.equal(recordOf({ name: 'A', points: 6, wins: 2, losses: 1, ties: 0 }), '2-1-0');
  assert.equal(recordOf(undefined), '0-0-0');
});

test('round one is not scheduled, since the page starts on it', () => {
  const steps = scheduleRounds([[table('A', 'B', 'A')]], TIMING);
  assert.equal(
    steps.some(step => step.kind === 'round'),
    false
  );
});

test('each later round opens after the last has read through, its results a beat apart', () => {
  const rounds = [
    [table('A', 'B', 'A'), table('C', 'D', 'C')],
    [table('A', 'C', 'A'), table('B', 'D', 'B')]
  ];
  const steps = scheduleRounds(rounds, TIMING);
  const opened = steps.find(step => step.kind === 'round');
  // Round one: two tables, a beat each, then the read before round two.
  assert.deepEqual(opened, { at: 3 * 100 + 1000, kind: 'round', round: 2 });
  const landed = steps.filter(step => step.kind === 'landed').map(step => step.at);
  assert.deepEqual(landed, [100, 200, 1400, 1500]);
});

test('the event ends after its last result and restarts after the rest', () => {
  const steps = scheduleRounds([[table('A', 'B', 'A')]], TIMING);
  const finished = steps.find(step => step.kind === 'finished');
  const restart = steps.find(step => step.kind === 'restart');
  // One table: two beats (a bye counts as one more), then the read is taken back off the end.
  assert.equal(finished?.at, 2 * 100);
  assert.equal(restart?.at, 2 * 100 + 5000);
});

test('steps come out in the order they are due, ending with the restart', () => {
  const steps = scheduleRounds(
    [
      [table('A', 'B', 'A'), table('C', 'D', 'C')],
      [table('A', 'C', 'A'), table('B', 'D', 'B')],
      [table('A', 'D', 'A'), table('B', 'C', 'B')]
    ],
    TIMING
  );
  const times = steps.map(step => step.at);
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b)
  );
  assert.equal(steps.at(-1)?.kind, 'restart');
});
