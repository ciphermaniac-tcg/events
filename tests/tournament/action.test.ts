/**
 * createAction: one request at a time, busy while it goes, and every way out
 * of it ends busy unless it leaves the page.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../../src/lib/tournament/api.ts';
import { createAction } from '../../src/pages/tournaments/action.ts';

/** A request the test answers or fails when it chooses. */
function deferred<T>() {
  let resolve = (_: T) => {};
  let reject = (_: unknown) => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('a request is busy while it goes, lands as saved, and ends busy', async () => {
  const action = createAction();
  const request = deferred<number>();
  const answer = action.run(() => request.promise);
  assert.equal(action.busy(), true);
  request.resolve(7);
  assert.equal(await answer, 7);
  assert.deepEqual([action.busy(), action.saved(), action.error()], [false, true, null]);
});

test('a press while a request is on its way sends nothing', async () => {
  const action = createAction();
  const request = deferred<number>();
  const first = action.run(() => request.promise);
  let sent = false;
  assert.equal(
    await action.run(() => {
      sent = true;
      return Promise.resolve(1);
    }),
    undefined
  );
  assert.equal(sent, false);
  request.resolve(2);
  assert.equal(await first, 2);
});

test('a failure shows its words, ends busy, and is handed on', async () => {
  const action = createAction();
  const seen: unknown[] = [];
  const failure = new ApiError('Nope', 409);
  assert.equal(
    await action.run(
      () => Promise.reject(failure),
      err => seen.push(err)
    ),
    undefined
  );
  assert.deepEqual([action.busy(), action.saved(), action.error()], [false, false, 'Nope']);
  assert.deepEqual(seen, [failure]);
  action.clear();
  assert.equal(action.error(), null);
});

test('a request that leaves the page stays busy once it lands, but not once it fails', async () => {
  const action = createAction({ staysBusy: true });
  await action.run(() => Promise.resolve());
  assert.equal(action.busy(), true);
  const failing = createAction({ staysBusy: true });
  await failing.run(() => Promise.reject(new Error('offline')));
  assert.equal(failing.busy(), false);
});
