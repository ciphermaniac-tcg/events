import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { forgetBrowserMemory, keepBrowserMemory, readBrowserMemory } from '../../src/lib/tournament/browserMemory.ts';

const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
afterEach(() => {
  for (const [name, descriptor] of [
    ['localStorage', originalLocal],
    ['sessionStorage', originalSession]
  ] as const) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});

function session(): Map<string, string> {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
  });
  return values;
}

test('denied localStorage access falls back to session storage and can be forgotten', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('denied');
    }
  });
  const values = session();
  keepBrowserMemory('denied-device', 'stable-device', true);
  assert.equal(readBrowserMemory('denied-device', true), 'stable-device');
  assert.equal(values.get('denied-device'), 'stable-device');
  values.set('prior-token', 'token');
  assert.equal(readBrowserMemory('prior-token', true), 'token');
  keepBrowserMemory('denied-device', null, true);
  assert.equal(values.has('denied-device'), false);
  assert.equal(readBrowserMemory('denied-device', true), null);
});

test('quota failures use session storage; denied session storage uses stable page memory', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      }
    }
  });
  const values = session();
  keepBrowserMemory('quota-device', 'device', true);
  assert.equal(values.get('quota-device'), 'device');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get: () => {
      throw new Error('denied');
    }
  });
  keepBrowserMemory('page-player', 'player');
  keepBrowserMemory('page-device', 'device', true);
  assert.equal(readBrowserMemory('page-player'), 'player');
  assert.equal(readBrowserMemory('page-device', true), 'device');
});

test('forgetting by prefix clears those keys from both storages and page memory, and keeps the rest', () => {
  const local: Record<string, string> = {};
  Object.defineProperties(local, {
    getItem: { value: (key: string) => local[key] ?? null },
    setItem: { value: (key: string, value: string) => (local[key] = value) },
    removeItem: { value: (key: string) => Reflect.deleteProperty(local, key) }
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  session();
  keepBrowserMemory('cm-tournament-me:ABC123', 'p1', true);
  keepBrowserMemory('cm-tournament-report:ABC123', 'token', true);
  keepBrowserMemory('cm-decklist:ABC123', 'list', true);
  forgetBrowserMemory(/^cm-tournament-(me|report):/);
  assert.deepEqual(Object.keys(local), ['cm-decklist:ABC123']);
  assert.equal(readBrowserMemory('cm-tournament-me:ABC123', true), null);
  assert.equal(readBrowserMemory('cm-tournament-report:ABC123', true), null);
  assert.equal(readBrowserMemory('cm-decklist:ABC123', true), 'list');
});
