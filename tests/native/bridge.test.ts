/** The site's way to the desktop app: inert in a normal browser, Tauri's own bridge inside the app. */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { nativeTom, startTomRound } from '../../src/lib/native/bridge';
import { drivesTom, hasTom, inNativeApp } from '../../src/lib/native/detect';

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
  const entry = { pod: 2, flight: null, round: 1, table: 1, outcome: 1 as const, code: '21113', p1: '1', p2: '2' };
  assert.deepEqual(await nativeTom().submit([entry]), [{ result: 'accepted', code: '21113' }]);
  assert.deepEqual(calls, [
    ['internals', 'tom_submit', { entries: [entry], tournament: undefined, tournamentId: undefined }]
  ]);
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
  const event = { name: 'Spring Cup', sanctionId: '26-10-000001' };
  assert.equal(await startTomRound('masters', event, 3), null);
  assert.equal(await startTomRound('mixed', event, 1), 'TOM is not running');
  assert.deepEqual(calls, [
    ['tom_start_round', { pod: 2, round: 3, tournament: 'Spring Cup', tournamentId: '26-10-000001' }],
    ['tom_start_round', { pod: 10, round: 1, tournament: 'Spring Cup', tournamentId: '26-10-000001' }]
  ]);
  global.window = { __TAURI_INTERNALS__: { invoke: () => Promise.reject(new Error('IPC closed')) } };
  assert.equal(await startTomRound('masters', event, 3), 'IPC closed');
});

test('only the desktop app, which marks its window, has TOM; the Android app has the bridge alone', () => {
  assert.equal(hasTom(), false, 'no window at all');
  global.window = { __TAURI_INTERNALS__: {} };
  assert.equal(inNativeApp(), true);
  assert.equal(hasTom(), false, 'Android');
  global.window = { __TAURI_INTERNALS__: {}, __CM_TOM__: true };
  assert.equal(hasTom(), true, 'desktop');
  global.window = { __CM_TOM__: true };
  assert.equal(hasTom(), false, 'a flag without the app');
});

test('the console drives TOM only for an event run in TOM, never one the site runs itself', () => {
  global.window = { __TAURI_INTERNALS__: {}, __CM_TOM__: true };
  assert.equal(drivesTom('tom'), true);
  assert.equal(drivesTom('swiss'), false, 'a Swiss event on the site has no TOM at all');
  assert.equal(drivesTom(undefined), false, 'before the event is loaded');
  global.window = { __TAURI_INTERNALS__: {} };
  assert.equal(drivesTom('tom'), false, 'the Android app');
});
