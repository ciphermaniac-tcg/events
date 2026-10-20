/**
 * A tab that was signed in opens on that session while it is read again: the
 * pages draw at once, the answer then takes over and is kept in turn, and a
 * signed-out answer drops what was kept. A first read that fails shows its
 * error rather than standing on the kept session, and a save is not undone by
 * a read that was already under way.
 *
 * Run by session.test.ts under the browser build of solid-js, the one the
 * site ships; the server build the test runner resolves cannot make a resource.
 * Its own file, since the session is made once, as its module loads.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Session } from '../../src/lib/tournament/api.ts';
import { keepSession, keptSession } from '../../src/lib/tournament/accountMemory.ts';

const before = { user: { id: 'u1', name: 'Piter' }, providers: ['google'] } as unknown as Session;
const renamed = { user: { id: 'u1', name: 'Piter Ward' }, providers: ['google'] } as unknown as Session;

keepSession(before);
let answer = (_: Session) => {};
let fail = () => {};
globalThis.fetch = () =>
  new Promise<Response>((resolve, reject) => {
    answer = value => resolve(Response.json(value));
    fail = () => reject(new Error('offline'));
  });
const { refreshSession, session, setSession } = await import('../../src/pages/tournaments/session.ts');
const { latestValue } = await import('../../src/lib/resource.ts');

const settle = () =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  });

test('the kept session is there at once while it is read again', () => {
  assert.deepEqual([session.state as string, session.latest], ['refreshing', before]);
});

test('a first read that fails shows its error, not the kept session', async () => {
  fail();
  await settle();
  assert.deepEqual([session.state as string, latestValue(session)], ['errored', undefined]);
});

test('the answer takes over and is kept', async () => {
  const read = refreshSession();
  answer(renamed);
  await read;
  await settle();
  assert.deepEqual(session(), renamed);
  assert.deepEqual(keptSession(), renamed);
});

test('once answered, a failed read keeps what is known', async () => {
  const read = refreshSession();
  fail();
  await read;
  assert.deepEqual(session(), renamed);
});

test('a save is not undone by a read already under way', async () => {
  const read = refreshSession();
  setSession(before);
  answer(renamed);
  await read;
  await settle();
  assert.deepEqual(session(), before);
  assert.deepEqual(keptSession(), before);
});

test('a signed-out answer drops the kept session', async () => {
  const read = refreshSession();
  answer({ user: null, providers: ['google'] });
  await read;
  await settle();
  assert.equal(session()?.user, null);
  assert.equal(keptSession(), undefined);
});
