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
import type { Decklist } from '../../src/lib/tournament/api.ts';

import { createListRereads, createMyList } from '../../src/pages/tournaments/myList.ts';
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

/** A page that can be hidden and shown again, and a clock that only moves when told. */
function shownAgain() {
  const page = Object.assign(new EventTarget(), { hidden: false });
  const realNow = Date.now;
  let now = 1_000_000;
  Object.assign(globalThis, { document: page });
  Date.now = () => now;
  return {
    show: (after = 0) => {
      now += after;
      page.hidden = false;
      page.dispatchEvent(new Event('visibilitychange'));
    },
    hide: () => {
      page.hidden = true;
      page.dispatchEvent(new Event('visibilitychange'));
    },
    restore: () => {
      Date.now = realNow;
    }
  };
}

/** A hold for the page's newest read, and what it holds. */
function holder() {
  const box: { held: Decklist | null | undefined } = { held: undefined };
  return { box, held: () => box.held, hold: (list: Decklist | null | undefined) => void (box.held = list) };
}

test('back in view before round 1 the page reads the registration again, at most every 30 seconds', async () => {
  answer(200);
  const page = shownAgain();
  await createRoot(async dispose => {
    const [started, setStarted] = createSignal(false);
    const { box, held, hold } = holder();
    const list = createMyList(
      'REGIST',
      () => null,
      () => false
    );
    createListRereads(list, started, held, hold);
    page.show();
    await settled();
    assert.deepEqual(asked, [], 'no token kept and no account: nothing to ask by');
    remember('REGIST', { profile: null, token: 'device-token' });
    page.show(30_000);
    await settled();
    assert.equal(asked.length, 1);
    assert.match(asked[0] ?? '', /token=device-token/);
    assert.deepEqual(box.held, LIST);
    page.hide();
    page.show(10_000);
    await settled();
    assert.equal(asked.length, 1, 'shown again within 30 seconds, it reads nothing');
    setStarted(true);
    page.show(30_000);
    await settled();
    assert.equal(asked.length, 1, 'once round 1 is paired, it reads nothing');
    dispose();
  });
  page.restore();
});

test('the newest read wins: an older answer arriving later, or one for an owner since changed, is dropped', async () => {
  const answers: ((list: object) => void)[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    const list = await new Promise<object>(resolve => {
      answers.push(resolve);
    });
    return Response.json({ known: true, mine: list });
  }) as typeof fetch;
  const page = shownAgain();
  await createRoot(async dispose => {
    const [owner, setOwner] = createSignal<{ popId: string; firstName: string; lastName: string } | null>({
      popId: '7',
      firstName: '',
      lastName: ''
    });
    const { box, held, hold } = holder();
    const list = createMyList('REGIST', owner, () => false);
    createListRereads(list, () => false, held, hold);
    page.show();
    page.show(30_000);
    await settled();
    assert.equal(asked.length, 2);
    const paid = { ...LIST, openChecks: [] };
    answers[1]?.(paid);
    await settled();
    answers[0]?.({ ...LIST, openChecks: ['paid'] });
    await settled();
    assert.deepEqual(box.held, paid, 'the older answer leaves the newer one standing');

    page.show(30_000);
    await settled();
    setOwner(null);
    answers[2]?.({ ...LIST, firstName: 'Someone' });
    await settled();
    assert.equal(box.held, undefined, 'a read for the owner before is no longer the page’s');
    dispose();
  });
  page.restore();
});

test('a read held for an account goes when the account changes; a device’s own, read by its token, stays', async () => {
  answer(200);
  const page = shownAgain();
  await createRoot(async dispose => {
    const [owner, setOwner] = createSignal<{ popId: string; firstName: string; lastName: string } | null>({
      popId: '7',
      firstName: '',
      lastName: ''
    });
    const { box, held, hold } = holder();
    const list = createMyList('ACCT01', owner, () => false);
    createListRereads(list, () => false, held, hold);
    page.show();
    await settled();
    assert.deepEqual(box.held, LIST);
    assert.match(asked[0] ?? '', /own=1/, 'the page asks for its own list only');
    setOwner({ popId: '8', firstName: '', lastName: '' });
    assert.equal(box.held, undefined, 'the page shows the new account’s, as read for it');

    remember('ACCT01', { profile: null, token: 'device-token' });
    page.show(30_000);
    await settled();
    assert.deepEqual(box.held, LIST);
    setOwner(null);
    assert.deepEqual(box.held, LIST, 'the device’s own list is the device’s whoever is signed in');
    dispose();
  });
  page.restore();
});
