/**
 * The account and its lists kept for the tab: a resource opens on the last
 * answer its account got and reads the list again, waits like any other with
 * none kept, and forgets everything on sign-out. Only a signed-in session is kept.
 *
 * Run by account-memory.test.ts under the browser build of solid-js, the one
 * the site ships; the server build the test runner resolves cannot make a resource.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoot } from 'solid-js';

import { accountList, forgetAccountMemory, keepSession, keptSession } from '../../src/lib/tournament/accountMemory.ts';
import type { OwnHistory, Session, TournamentSummary } from '../../src/lib/tournament/api.ts';
import { keepBrowserMemory, readBrowserMemory } from '../../src/lib/tournament/browserMemory.ts';

const answer = (code: string) => ({ entries: [{ code }], activity: [] }) as unknown as OwnHistory;

/** The resource, made in a root of its own, with its first read held until `release`. */
function history(account: string, value: OwnHistory) {
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const [resource] = createRoot(() => accountList('history', account, () => held.then(() => value)));
  return {
    resource,
    release,
    settled: () =>
      held.then(
        () =>
          new Promise(resolve => {
            setTimeout(resolve, 0);
          })
      )
  };
}

test('with nothing kept the list waits for its first answer, then keeps it', async () => {
  forgetAccountMemory();
  const read = history('u1', answer('FIRST1'));
  assert.equal(read.resource.state, 'pending');
  read.release();
  await read.settled();
  assert.deepEqual([read.resource.state as string, read.resource.latest], ['ready', answer('FIRST1')]);
});

test('a kept list shows at once while it is read again, then gives way to the new answer', async () => {
  const read = history('u1', answer('SECND2'));
  assert.equal(read.resource.state, 'refreshing');
  assert.deepEqual(read.resource.latest, answer('FIRST1'));
  read.release();
  await read.settled();
  assert.deepEqual(read.resource(), answer('SECND2'));
});

test('another account does not see the kept list', () => {
  const read = history('u2', answer('OTHER3'));
  assert.equal(read.resource.state, 'pending');
});

test('lists are kept apart', () => {
  const [events] = createRoot(() => accountList('events', 'u1', () => new Promise<TournamentSummary[]>(() => {})));
  assert.equal(events.state, 'pending');
});

test('forgetting drops the lists and the kept History rows', () => {
  keepBrowserMemory('cm-history-row:ABCDEF:1', '{}', true);
  keepBrowserMemory('cm-history-rows', JSON.stringify(['ABCDEF:1']), true);
  forgetAccountMemory();
  assert.equal(history('u1', answer('GONE04')).resource.state, 'pending');
  assert.equal(readBrowserMemory('cm-history-row:ABCDEF:1', true), null);
  assert.equal(readBrowserMemory('cm-history-rows', true), null);
});

test('a kept list that does not parse is no list', () => {
  keepBrowserMemory('cm-account-history', '{not json');
  assert.equal(history('u1', answer('BROKE5')).resource.state, 'pending');
});

const signedIn = { user: { id: 'u1', name: 'Piter' }, providers: ['google'] } as unknown as Session;

test('a signed-in session is kept for the tab', () => {
  forgetAccountMemory();
  assert.equal(keptSession(), undefined);
  keepSession(signedIn);
  assert.deepEqual(keptSession(), signedIn);
});

test('a signed-out answer is never kept, and drops the account with its lists', () => {
  keepSession(signedIn);
  keepBrowserMemory('cm-account-history', JSON.stringify({ account: 'u1', value: answer('LEFT06') }));
  keepSession({ user: null, providers: ['google'] });
  assert.equal(keptSession(), undefined);
  assert.equal(history('u1', answer('LEFT06')).resource.state, 'pending');
});

test('a signed-out answer with no session kept leaves the kept History rows', () => {
  forgetAccountMemory();
  keepBrowserMemory('cm-history-rows', JSON.stringify(['ABCDEF:1']), true);
  keepSession({ user: null, providers: [] });
  assert.equal(readBrowserMemory('cm-history-rows', true), JSON.stringify(['ABCDEF:1']));
});

test('a kept session that does not parse, or holds nobody, is no session', () => {
  keepBrowserMemory('cm-account-session', '{not json');
  assert.equal(keptSession(), undefined);
  keepBrowserMemory('cm-account-session', JSON.stringify({ user: null, providers: [] }));
  assert.equal(keptSession(), undefined);
});
