/** The site's way to the desktop app: inert in a normal browser, Tauri's own bridge inside the app. */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { nativeTom, startTomRound } from '../../src/lib/native/bridge';
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
      return Promise.resolve([{ result: 'accepted', code: '21113' }]);
    }
  };
  global.window = { __TAURI_INTERNALS__: internals };
  assert.equal(inNativeApp(), true);
  const entry = { pod: 2, flight: null, round: 1, table: 1, outcome: 1 as const, code: '21113' };
  assert.deepEqual(await nativeTom().submit([entry]), [{ result: 'accepted', code: '21113' }]);
  assert.deepEqual(calls, [['internals', 'tom_submit', { entries: [entry] }]]);
});

test('starting a pod’s round in TOM names the pod by TOM’s category code and says why it did not start', async () => {
  const calls: unknown[][] = [];
  const answers: unknown[] = [{ result: 'already_started' }, { result: 'not_ready', reason: 'TOM is not running' }];
  global.window = {
    __TAURI_INTERNALS__: {
      invoke: (command: string, args?: Record<string, unknown>) => {
        calls.push([command, args]);
        return Promise.resolve(answers.shift());
      }
    }
  };
  assert.equal(await startTomRound('masters'), null);
  assert.equal(await startTomRound('mixed'), 'TOM is not running');
  assert.deepEqual(calls, [
    ['tom_start_round', { pod: 2 }],
    ['tom_start_round', { pod: 10 }]
  ]);
  global.window = { __TAURI_INTERNALS__: { invoke: () => Promise.reject(new Error('IPC closed')) } };
  assert.equal(await startTomRound('masters'), 'IPC closed');
});
