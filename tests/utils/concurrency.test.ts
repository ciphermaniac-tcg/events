import assert from 'node:assert/strict';
import test from 'node:test';
import { createLimiter } from '../../src/lib/concurrency';

test('a limiter runs jobs as they come, no more than its limit at once, the rest in turn', async () => {
  const limit = createLimiter(2);
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  const job = (value: number) => async () => {
    started.push(value);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>(resolve => {
      setTimeout(resolve, 5);
    });
    active -= 1;
    return value;
  };
  const results = await Promise.all([1, 2, 3, 4, 5].map(value => limit(job(value))));
  assert.deepEqual(results, [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
  assert.deepEqual(started, [1, 2, 3, 4, 5], 'first come, first served');
});

test('a failed job frees its place for the job waiting on it', async () => {
  const limit = createLimiter(1);
  const failing = limit(
    () =>
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('offline')), 5);
      })
  );
  const next = limit(async () => 'next');
  await assert.rejects(failing, /offline/);
  assert.equal(await next, 'next');
});

test('a job that turns up as another finishes waits behind the one already waiting', async () => {
  const limit = createLimiter(1);
  let active = 0;
  let peak = 0;
  const started: string[] = [];
  const job = (name: string) => async () => {
    started.push(name);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>(resolve => {
      setTimeout(resolve, 5);
    });
    active -= 1;
  };
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const first = limit(() => gate);
  const queued = limit(job('queued'));
  // Asked in the same turn as the first job's place is given up, before the waiting job takes it.
  const late = gate.then(() => limit(job('late')));
  release();
  await Promise.all([first, queued, late]);
  assert.deepEqual(started, ['queued', 'late']);
  assert.equal(peak, 1);
});
