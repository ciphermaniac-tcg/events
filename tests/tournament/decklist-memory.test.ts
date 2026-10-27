/**
 * What a device keeps of a sent decklist: the token in local storage across
 * visits, who sent it in session storage for the tab only.
 */

import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import type { PlayerProfile } from '../../shared/tournament/profile.ts';
import { recall, remember } from '../../src/pages/tournaments/decklistMemory.ts';

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

const profile = { firstName: 'Piter', lastName: 'Perker' } as unknown as PlayerProfile;

beforeEach(() => {
  Object.assign(globalThis, { localStorage: storage(), sessionStorage: storage() });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
  Reflect.deleteProperty(globalThis, 'sessionStorage');
});

test('a remembered list comes back with its token and its sender', () => {
  assert.equal(recall('EVENT1'), null);
  remember('EVENT1', { profile, token: 'abc' });
  assert.deepEqual(recall('EVENT1'), { profile, token: 'abc' });
  assert.equal(recall('EVENT2'), null, 'another event has its own');
});

test('the sender is for the tab only; the token outlasts it', () => {
  remember('EVENT1', { profile, token: 'abc' });
  sessionStorage.clear();
  assert.deepEqual(recall('EVENT1'), { profile: null, token: 'abc' });
});

test('forgetting drops both, and unreadable memory reads as nothing', () => {
  remember('EVENT1', { profile, token: 'abc' });
  remember('EVENT1', null);
  assert.equal(recall('EVENT1'), null);
  assert.equal(localStorage.length + sessionStorage.length, 0);
  localStorage.setItem('anything', '{');
  Reflect.deleteProperty(globalThis, 'localStorage');
  assert.equal(recall('EVENT1'), null, 'no storage at all is no memory');
});

/** Storage that reads but refuses every write, as a full or blocked one does. */
function refusing(): Storage {
  return Object.assign(storage(), {
    setItem: () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
  });
}

for (const blocked of ['localStorage', 'sessionStorage'] as const) {
  test(`with ${blocked} refusing writes, the page keeps the list until it is withdrawn`, () => {
    Object.assign(globalThis, { [blocked]: refusing() });
    remember('EVENT1', { profile, token: 'abc' });
    assert.deepEqual(recall('EVENT1'), { profile, token: 'abc' });
    remember('EVENT1', null);
    assert.equal(recall('EVENT1'), null);
  });
}
