/**
 * Who is signed in, shared by every tournament page: a failed refresh keeps
 * what was known, and signing out is authoritative.
 *
 * Run by session.test.ts under the browser build of solid-js, the one the
 * site ships; the server build the test runner resolves cannot make a resource.
 */

import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';

import type { Session } from '../../src/lib/tournament/api.ts';
import { clearSession, leaveSession, session, setSession } from '../../src/pages/tournaments/session.ts';

afterEach(() => mock.restoreAll());

const signedIn = { user: { id: 'u1', name: 'Piter' }, providers: ['google'] } as unknown as Session;

test('clearing the session signs out but keeps the providers on offer', () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(signedIn)));
  setSession(signedIn);
  clearSession();
  assert.equal(session()?.user, null);
  assert.deepEqual(session()?.providers, ['google']);
});

test('leaving the session asks the server and then clears it, whatever the next read says', async () => {
  const fetches = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  setSession(signedIn);
  await leaveSession();
  assert.match(String(fetches.mock.calls[0].arguments[0]), /\/api\/auth\/logout$/);
  assert.equal(session()?.user, null);
});
