/**
 * The console's copy of the event: a request's answer replaces it, an older
 * answer never does, and a refusal is shown rather than applied.
 */

import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';

import type { Manage } from '../../src/lib/tournament/api.ts';
import { createManage } from '../../src/pages/tournaments/manageState.ts';

const event = (version: number, code = 'EVENT1') => ({ code, version }) as unknown as Manage;
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => mock.restoreAll());

test('a read takes the event and clears an earlier failure', async () => {
  const fetches = mock.method(globalThis, 'fetch', async () => answer(event(3)));
  const manage = createManage(() => 'EVENT1');
  assert.equal(await manage.load(), true);
  assert.equal(manage.data()?.version, 3);
  assert.equal(manage.freshness().failure, null);
  assert.equal(await manage.load(), true);
  assert.match(String(fetches.mock.calls[1].arguments[0]), /\?since=3$/, 'the second read asks only for news');
});

test('a read that fails is reported and keeps the copy shown', async () => {
  const manage = createManage(() => 'EVENT1');
  mock.method(globalThis, 'fetch', async () => answer(event(3)));
  await manage.load();
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => answer({ error: 'Not today.' }, 503));
  assert.equal(await manage.load(), false);
  assert.equal(manage.data()?.version, 3);
  assert.equal(manage.loadError()?.status, 503);
  assert.equal(manage.freshness().failure, 'unavailable');
});

test('an answer older than the copy shown is not taken', () => {
  const manage = createManage(() => 'EVENT1');
  manage.take(event(5));
  manage.take(event(4));
  assert.equal(manage.data()?.version, 5);
  manage.take(event(6));
  assert.equal(manage.data()?.version, 6);
  manage.take(event(1, 'EVENT2'));
  assert.equal(manage.data()?.code, 'EVENT2', 'another event replaces it whatever its version');
});

test('a command takes the server answer, and a refusal is shown with the copy untouched', async () => {
  const manage = createManage(() => 'EVENT1');
  manage.take(event(1));
  mock.method(globalThis, 'fetch', async () => answer(event(2)));
  assert.equal(await manage.send({ type: 'start-round' } as never), true);
  assert.equal(manage.data()?.version, 2);
  assert.equal(manage.busy(), false);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => answer({ error: 'Too late.' }, 409));
  assert.equal(await manage.send({ type: 'start-round' } as never), false);
  assert.equal(manage.error(), 'Too late.');
  assert.equal(manage.data()?.version, 2);
  manage.clearError();
  assert.equal(manage.error(), null);
  manage.fail('Pick a player first.');
  assert.equal(manage.error(), 'Pick a player first.');
});

test('run takes a request that answers with the event, and shows why one that throws did not', async () => {
  const manage = createManage(() => 'EVENT1');
  assert.equal(await manage.run(async () => event(7)), true);
  assert.equal(manage.data()?.version, 7);
  assert.equal(
    await manage.run(() => {
      throw new Error('Nothing sent.');
    }),
    false
  );
  assert.equal(manage.error(), 'Nothing sent.');
  assert.equal(await manage.act(Promise.resolve()), true);
  assert.equal(manage.error(), null, 'a request that goes through clears the last failure');
});
