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

test('a page back in view counts from its return, not from the checks it skipped while hidden', () => {
  const checkedAt = 1_000_000;
  const back = checkedAt + 10 * STALE_AFTER_MS;
  assert.equal(liveDataStale({ checkedAt, failure: null }, back), true, 'without the return, it reads as behind');
  assert.equal(liveDataStale({ checkedAt, failure: null, shownAt: back }, back + 1), false);
  assert.equal(liveDataStale({ checkedAt, failure: 'network', shownAt: back }, back + STALE_AFTER_MS), true);
  assert.equal(
    liveDataStale({ checkedAt, failure: 'authorization', shownAt: back }, back),
    true,
    'lost access shows at once'
  );
});

test('authorization, network and server errors have distinct context', () => {
  assert.equal(liveFailure({ status: 401 }), 'authorization');
  assert.equal(liveFailure({ status: 403 }), 'authorization');
  assert.equal(liveFailure({ status: 503 }), 'unavailable');
  assert.equal(liveFailure(new TypeError('Failed to fetch')), 'network');
  assert.equal(liveFailure(null), 'network');
});

test('clocks run until the data turns stale and stop there, never back at the last good check', () => {
  const checkedAt = 1_000_000;
  const behind = checkedAt + STALE_AFTER_MS;
  assert.equal(staleSince({ checkedAt, failure: null }, checkedAt + 1), null);
  assert.deepEqual(staleSince({ checkedAt, failure: 'network' }, behind), { since: behind, checkedAt });
  assert.deepEqual(
    staleSince({ checkedAt, failure: 'network' }, behind + 60_000),
    { since: behind, checkedAt },
    'it stays stopped'
  );
  assert.deepEqual(
    staleSince({ checkedAt, failure: 'authorization' }, checkedAt + 1),
    { since: checkedAt + 1, checkedAt },
    'lost access stops the clocks where they are'
  );
  assert.deepEqual(staleSince({ checkedAt: null, failure: 'network' }, checkedAt), {
    since: checkedAt,
    checkedAt
  });
});

test('a page back in view stops its clocks once it falls behind after the return, not at the check before it hid', () => {
  const checkedAt = 1_000_000;
  const back = checkedAt + 10 * 60_000;
  const behind = back + STALE_AFTER_MS;
  assert.equal(staleSince({ checkedAt, failure: 'network', shownAt: back }, behind - 1), null);
  assert.deepEqual(staleSince({ checkedAt, failure: 'network', shownAt: back }, behind + 5_000), {
    since: behind,
    checkedAt
  });
});
