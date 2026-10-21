import assert from 'node:assert/strict';
import test from 'node:test';
import { liveDataStale, liveFailure, STALE_AFTER_MS, staleSince } from '../../src/lib/tournament/liveData.ts';

test('unchanged successful checks stay fresh and a single missed check stays quiet independently of the event mutation time', () => {
  const checkedAt = 1_000_000;
  assert.equal(liveDataStale({ checkedAt, failure: null }, checkedAt + STALE_AFTER_MS - 1), false);
  assert.equal(liveDataStale({ checkedAt, failure: null }, checkedAt + STALE_AFTER_MS), true);
  assert.equal(liveDataStale({ checkedAt: null, failure: null }, checkedAt), false);
  assert.equal(liveDataStale({ checkedAt, failure: 'network' }, checkedAt + 1), false);
  assert.equal(liveDataStale({ checkedAt, failure: 'network' }, checkedAt + STALE_AFTER_MS), true);
  assert.equal(liveDataStale({ checkedAt, failure: 'authorization' }, checkedAt + 1), true);
  assert.equal(liveDataStale({ checkedAt: null, failure: 'network' }, checkedAt), true);
});

test('authorization, network and server errors have distinct context', () => {
  assert.equal(liveFailure({ status: 401 }), 'authorization');
  assert.equal(liveFailure({ status: 403 }), 'authorization');
  assert.equal(liveFailure({ status: 503 }), 'unavailable');
  assert.equal(liveFailure(new TypeError('Failed to fetch')), 'network');
  assert.equal(liveFailure(null), 'network');
});

test('clocks stop at the last good check once the data is stale, and run again once it is fresh', () => {
  const checkedAt = 1_000_000;
  assert.equal(staleSince({ checkedAt, failure: null }, checkedAt + 1), null);
  assert.equal(staleSince({ checkedAt, failure: 'network' }, checkedAt + STALE_AFTER_MS), checkedAt);
  assert.equal(staleSince({ checkedAt, failure: 'authorization' }, checkedAt + 1), checkedAt);
  assert.equal(staleSince({ checkedAt: null, failure: 'network' }, checkedAt), checkedAt, 'never heard from');
});
