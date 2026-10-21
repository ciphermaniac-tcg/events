/**
 * What a failed call says. The server's own words pass through; what the
 * browser says of a call that never got an answer, or of a server that failed
 * without saying why, is put in words a player at the venue can act on.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, call, errorText } from '../../src/lib/tournament/api.ts';

const OFFLINE = 'Couldn’t reach the site. Check your connection.';

test('a call that never got an answer says so, whatever the browser called it', async t => {
  for (const message of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    t.mock.method(globalThis, 'fetch', () => Promise.reject(new TypeError(message)));
    const failed = await call('/api/me').catch((err: unknown) => err);
    assert.equal(errorText(failed), OFFLINE, message);
    assert.equal((failed as ApiError).status, 0);
    t.mock.restoreAll();
  }
});

test('a TypeError from anything but fetch keeps its own words', () => {
  const bug = new TypeError("Cannot read properties of undefined (reading 'id')");
  assert.equal(errorText(bug), bug.message);
});

test('a call that timed out says the site took too long', () => {
  assert.equal(errorText(new DOMException('signal timed out', 'TimeoutError')), 'The site took too long to answer');
});

test('a server failure without a reason says the site hit an error, and one with a reason keeps it', () => {
  assert.equal(errorText(new ApiError('Request failed (500)', 500)), 'The site hit an error.');
  assert.equal(errorText(new ApiError('Request failed (502)', 502, null)), 'The site hit an error.');
  const explained = new ApiError('Round 3 is already paired', 500, { error: 'Round 3 is already paired' });
  assert.equal(errorText(explained), 'Round 3 is already paired');
});

test('a refusal keeps the server’s words', () => {
  assert.equal(
    errorText(new ApiError('Sign in to run this event', 401, { error: 'Sign in to run this event' })),
    'Sign in to run this event'
  );
  assert.equal(errorText(new ApiError('Request failed (404)', 404)), 'Request failed (404)');
  assert.equal(errorText('plain'), 'plain');
});
