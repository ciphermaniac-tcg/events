/**
 * The drifting feature rows: an offset that wraps without a seam, a throw
 * that carries the speed of the last moves, and a coast back to the drift.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { coast, MAX_THROW, throwSpeed, wrapOffset } from '../../src/lib/reel.ts';

test('an offset wraps into one copy of the row, either way', () => {
  assert.equal(wrapOffset(250, 200), 50);
  assert.equal(wrapOffset(-30, 200), 170);
  assert.equal(wrapOffset(0, 200), 0);
  assert.equal(wrapOffset(42, 0), 0);
});

test('a throw eases back to the drift, quickly at first', () => {
  const drift = 40;
  const afterTenth = coast(2000, drift, 0.1);
  const afterSecond = coast(2000, drift, 1);
  assert.ok(afterTenth < 2000 && afterTenth > afterSecond);
  assert.ok(Math.abs(afterSecond - drift) < 0.05 * (2000 - drift) + 1);
  assert.equal(coast(drift, drift, 0.5), drift);
});

test('a drag to the left throws the row forward at the speed of the last moves', () => {
  const speed = throwSpeed(
    [
      { dx: -40, ms: 10 },
      { dx: -40, ms: 10 }
    ],
    5
  );
  assert.equal(speed, Math.min(4000, MAX_THROW));
  assert.equal(throwSpeed([{ dx: 30, ms: 15 }], 5), -2000);
});

test('a release after the pointer stopped throws nothing', () => {
  assert.equal(throwSpeed([{ dx: -40, ms: 10 }], 200), 0);
  assert.equal(throwSpeed([], 0), 0);
});

test('a throw never exceeds the fastest a row may go', () => {
  assert.equal(throwSpeed([{ dx: -900, ms: 10 }], 1), MAX_THROW);
  assert.equal(throwSpeed([{ dx: 900, ms: 10 }], 1), -MAX_THROW);
});
