/**
 * What a browser last wrote into an event's .tdf: kept per event across a
 * reload, forgotten on request, and nothing at all where storage refuses or
 * holds something else.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { recallWrite, rememberWrite } from '../../src/lib/tournament/tomLink.ts';

let values: Map<string, string>;
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
  });
});
afterEach(() => {
  if (original) {
    Object.defineProperty(globalThis, 'localStorage', original);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('a write is remembered per event until it is forgotten', () => {
  const write = { at: 1792254953890, results: ['mixed:2:1', 'mixed:2:3'] };
  rememberWrite('ABCDEF', write);
  assert.deepEqual(recallWrite('ABCDEF'), write);
  assert.equal(recallWrite('GHIJKL'), null);
  rememberWrite('ABCDEF', null);
  assert.equal(recallWrite('ABCDEF'), null);
});

test('anything but a write in its place is no write', () => {
  values.set('cm-tdf-write:ABCDEF', 'not json');
  assert.equal(recallWrite('ABCDEF'), null);
  values.set('cm-tdf-write:ABCDEF', JSON.stringify({ at: '12', results: [] }));
  assert.equal(recallWrite('ABCDEF'), null);
  values.set('cm-tdf-write:ABCDEF', JSON.stringify({ at: 12 }));
  assert.equal(recallWrite('ABCDEF'), null);
});

test('storage that refuses remembers nothing and throws nothing', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('Storage unavailable');
    }
  });
  assert.doesNotThrow(() => rememberWrite('ABCDEF', { at: 1, results: [] }));
  assert.doesNotThrow(() => rememberWrite('ABCDEF', null));
  assert.equal(recallWrite('ABCDEF'), null);
});
