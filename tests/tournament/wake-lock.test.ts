import assert from 'node:assert/strict';
import test from 'node:test';
import { screenWakeLock } from '../../src/pages/tournaments/wakeLock.ts';

function sentinel() {
  const target = new EventTarget();
  let released = false;
  Object.defineProperty(target, 'released', { get: () => released });
  return Object.assign(target, {
    type: 'screen',
    release: async () => {
      released = true;
      target.dispatchEvent(new Event('release'));
    }
  }) as WakeLockSentinel;
}

test('wake lock is acquired once, reacquired after returning, and released on cleanup', async () => {
  let visible = true;
  let asks = 0;
  const locks: WakeLockSentinel[] = [];
  const wake = screenWakeLock(
    async () => {
      asks += 1;
      const next = sentinel();
      locks.push(next);
      return next;
    },
    () => visible
  );
  await Promise.all([wake.resume(), wake.resume()]);
  assert.equal(asks, 1);
  visible = false;
  await locks[0]!.release();
  await wake.resume();
  assert.equal(asks, 1);
  visible = true;
  await wake.resume();
  assert.equal(asks, 2);
  wake.stop();
  await wake.resume();
  assert.equal(asks, 2);
});

test('a late lock is released after cleanup; a refused request can retry on return', async () => {
  let deliver!: (value: WakeLockSentinel) => void;
  const late = sentinel();
  const wake = screenWakeLock(
    () =>
      new Promise(resolve => {
        deliver = resolve;
      }),
    () => true
  );
  const pending = wake.resume();
  wake.stop();
  deliver(late);
  await pending;
  assert.equal(late.released, true);
  let asks = 0;
  const retry = screenWakeLock(
    async () => {
      asks += 1;
      throw new Error('Power saving');
    },
    () => true
  );
  await retry.resume();
  await retry.resume();
  assert.equal(asks, 2);
  retry.stop();
});
