/**
 * The registration an event page reads for its device or account: by the
 * token the device kept, else by the account's own details, and nothing
 * while no part of the page shows it.
 *
 * Run by my-list.test.ts under the browser build of solid-js, the one the
 * site ships; the server build the test runner resolves cannot make a resource.
 */

import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { createRoot, createSignal } from 'solid-js';

import { createMyList } from '../../src/pages/tournaments/myList.ts';
import { remember } from '../../src/pages/tournaments/decklistMemory.ts';

function storage(): Storage {
  const held = new Map<string, string>();
  return {
    get length() {
      return held.size;
    },
    clear: () => held.clear(),
    getItem: key => held.get(key) ?? null,
    key: index => [...held.keys()][index] ?? null,
    removeItem: key => void held.delete(key),
    setItem: (key, value) => void held.set(key, value)
  };
}

const realFetch = globalThis.fetch;
let asked: string[] = [];
const LIST = { firstName: 'Nia', lastName: 'Okafor', mode: 'paper', registered: true };

function answer(status: number) {
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    return Response.json(status === 200 ? { known: true, mine: LIST } : { error: 'Down' }, { status });
  }) as typeof fetch;
}

beforeEach(() => {
  Object.assign(globalThis, { localStorage: storage(), sessionStorage: storage() });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  asked = [];
});

const settled = () =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  });

test('a device that kept a list reads it by its token, once the page shows it', async () => {
  answer(200);
  remember('REGIST', { profile: null, token: 'device-token' });
  await createRoot(async dispose => {
    const [wanted, setWanted] = createSignal(false);
    const list = createMyList('REGIST', () => null, wanted);
    await settled();
    assert.deepEqual(asked, [], 'nothing on the page shows it, so nothing is read');
    setWanted(true);
    await settled();
    assert.equal(list.state(), 'known');
    assert.deepEqual(list.current(), LIST);
    assert.match(asked[0] ?? '', /token=device-token/);
    dispose();
  });
});

test('a device that kept none reads the account’s own; with no account it asks nothing and knows of none', async () => {
  answer(200);
  await createRoot(async dispose => {
    const owned = createMyList(
      'REGIST',
      () => ({ popId: '4183529', firstName: '', lastName: '' }),
      () => true
    );
    await settled();
    assert.match(asked[0] ?? '', /popId=4183529/);
    assert.doesNotMatch(asked[0] ?? '', /token=/);
    assert.deepEqual(owned.current(), LIST);
    const nobody = createMyList(
      'OTHER1',
      () => null,
      () => true
    );
    await settled();
    assert.equal(asked.length, 1);
    assert.equal(nobody.state(), 'known');
    assert.equal(nobody.current(), null);
    dispose();
  });
});

test('a read that fails says so, and a retry reads again', async () => {
  answer(500);
  await createRoot(async dispose => {
    const list = createMyList(
      'REGIST',
      () => ({ popId: '7', firstName: '', lastName: '' }),
      () => true
    );
    await settled();
    assert.equal(list.state(), 'failed');
    answer(200);
    list.retry();
    await settled();
    assert.equal(list.state(), 'known');
    dispose();
  });
});
