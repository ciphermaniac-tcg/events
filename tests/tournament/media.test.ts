/**
 * A media query as a signal: it follows the window as it changes, and stops
 * listening when its owner is disposed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoot } from 'solid-js';

import { createMedia, NOT_TOM_DESKTOP } from '../../src/lib/media.ts';

test('a media query is followed as the window changes, until its owner goes', () => {
  const listeners = new Set<() => void>();
  const list = {
    matches: false,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener)
  };
  const asked: string[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      matchMedia: (query: string) => {
        asked.push(query);
        return list;
      }
    }
  });
  try {
    createRoot(dispose => {
      const narrow = createMedia(NOT_TOM_DESKTOP);
      assert.deepEqual(asked, ['(max-width: 640px), (pointer: coarse)']);
      assert.equal(narrow(), false);
      list.matches = true;
      for (const listener of listeners) {
        listener();
      }
      assert.equal(narrow(), true);
      dispose();
    });
    assert.equal(listeners.size, 0);
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
});
