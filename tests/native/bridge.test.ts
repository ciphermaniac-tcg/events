/** The site's way to the desktop app: inert in a normal browser, Tauri's own bridge inside the app. */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { nativeTom } from '../../src/lib/native/bridge';
import { inNativeApp } from '../../src/lib/native/detect';

const global = globalThis as { window?: unknown };

afterEach(() => {
  delete global.window;
});

test('outside the desktop app the site sees no app and calls nothing', () => {
  assert.equal(inNativeApp(), false, 'no window at all');
  global.window = {};
  assert.equal(inNativeApp(), false);
  assert.throws(() => nativeTom(), /Not in the desktop app/);
});

test('inside the app the site calls the TOM commands through Tauri’s bridge', async () => {
  const calls: unknown[][] = [];
  const internals = {
    seen: 'internals',
    invoke(this: { seen: string }, command: string, args?: Record<string, unknown>) {
      calls.push([this.seen, command, args]);
      return Promise.resolve([{ status: 'accepted' }]);
    }
  };
  global.window = { __TAURI_INTERNALS__: internals };
  assert.equal(inNativeApp(), true);
  assert.deepEqual(await nativeTom().submit(['21113']), [{ status: 'accepted' }]);
  assert.deepEqual(calls, [['internals', 'tom_submit', { codes: ['21113'] }]]);
});
