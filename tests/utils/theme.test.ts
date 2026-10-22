/**
 * Light and dark mode: a choice against the OS is kept, and choosing what the
 * OS already gives goes back to following it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const stored = new Map<string, string>();
const body = { dataset: {} as Record<string, string> };
let systemDark = false;
const listeners: ((event: { matches: boolean }) => void)[] = [];
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key)
  },
  matchMedia: () => ({
    get matches() {
      return systemDark;
    },
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.push(listener)
  }),
  document: { body }
});

const { initTheme, mode, setMode } = await import('../../src/lib/theme.ts');

/** The OS changes its mode, as at sunset. */
function osTurns(dark: boolean): void {
  systemDark = dark;
  for (const listener of listeners) {
    listener({ matches: dark });
  }
}

test('a mode chosen against the system is kept, and the system no longer overrides it', () => {
  initTheme();
  assert.equal(body.dataset.mode, 'light');
  setMode('dark');
  assert.equal(stored.get('cm:mode'), 'dark');
  osTurns(true);
  osTurns(false);
  assert.equal(mode(), 'dark');
});

test('choosing the mode the system gives follows the system again', () => {
  setMode('light');
  assert.equal(stored.has('cm:mode'), false);
  osTurns(true);
  assert.equal(mode(), 'dark');
  assert.equal(body.dataset.mode, 'dark');
});
