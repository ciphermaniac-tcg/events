/** The site's way to the desktop app: inert in a normal browser, Tauri's own bridge inside the app. */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { bind, nativeTom, tomEventOf, unbindFileless } from '../../src/lib/native/bridge';
import type { TournamentInfo } from '../../shared/tournament/types';
import { startTomRound } from '../../src/lib/native/tomRound';
import { drivesTom, hasTom, inNativeApp } from '../../src/lib/native/detect';

const global = globalThis as { window?: unknown; localStorage?: unknown };

/** An event's info as TOM's commands read it. */
const info = (sanctionId: string) => ({ name: 'Spring Cup', sanctionId }) as TournamentInfo;

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
    ['internals', 'tom_submit', { entries: [entry], tournament: undefined, tournamentId: undefined, source: undefined }]
  ]);
});

test('starting a pod’s round in TOM names the pod by TOM’s category code and says why it did not start', async () => {
  const calls: unknown[][] = [];
  const answers: unknown[] = [{ result: 'already_started' }, { result: 'not_ready', reason: 'TOM is not running' }];
  global.window = {
    __TAURI_INTERNALS__: {
      invoke: (command: string, args?: Record<string, unknown>) => {
        if (command === 'tom_state') {
          return Promise.resolve({ on: true, tom: 'open', file: null });
        }
        calls.push([command, args]);
        return Promise.resolve(answers.shift());
      }
    }
  };
  const event = info('26-10-000001');
  assert.equal(await startTomRound('masters', event, 3), null);
  assert.equal(await startTomRound('mixed', event, 1), 'TOM is not running');
  assert.deepEqual(calls, [
    [
      'tom_start_round',
      { pod: 2, round: 3, tournament: 'Spring Cup', tournamentId: '26-10-000001', source: undefined }
    ],
    [
      'tom_start_round',
      { pod: 10, round: 1, tournament: 'Spring Cup', tournamentId: '26-10-000001', source: undefined }
    ]
  ]);
  global.window = { __TAURI_INTERNALS__: { invoke: () => Promise.reject(new Error('IPC closed')) } };
  assert.equal(await startTomRound('masters', event, 3), 'IPC closed');
});

test('with TOM off on the computer, starting the clock leaves TOM alone and says nothing', async () => {
  const calls: string[] = [];
  global.window = {
    __TAURI_INTERNALS__: {
      invoke: (command: string) => {
        calls.push(command);
        return Promise.resolve({ on: false, tom: 'reopening', file: null });
      }
    }
  };
  assert.equal(await startTomRound('masters', info('26-10-000001'), 1), null);
  assert.deepEqual(calls, ['tom_state']);
});

test('only the desktop app, which marks its window, has TOM; the Android app has the bridge alone', () => {
  assert.equal(hasTom(), false, 'no window at all');
  global.window = { __TAURI_INTERNALS__: {} };
  assert.equal(inNativeApp(), true);
  assert.equal(hasTom(), false, 'Android');
  global.window = { __TAURI_INTERNALS__: {}, __CM_TOM__: 3 };
  assert.equal(hasTom(), true, 'desktop');
  global.window = { __CM_TOM__: 3 };
  assert.equal(hasTom(), false, 'a flag without the app');
  global.window = { __TAURI_INTERNALS__: {}, __CM_TOM__: true };
  assert.equal(hasTom(), false, 'an older desktop build, which sends without checking TOM');
  global.window = { __TAURI_INTERNALS__: {}, __CM_TOM__: 2 };
  assert.equal(hasTom(), false, 'a desktop build that launched TOM from the site, through its panel');
});

test('the console drives TOM only for an event run in TOM, never one the site runs itself', () => {
  global.window = { __TAURI_INTERNALS__: {}, __CM_TOM__: 3 };
  assert.equal(drivesTom('tom'), true);
  assert.equal(drivesTom('swiss'), false, 'a Swiss event on the site has no TOM at all');
  assert.equal(drivesTom(undefined), false, 'before the event is loaded');
  global.window = { __TAURI_INTERNALS__: {} };
  assert.equal(drivesTom('tom'), false, 'the Android app');
});

test('an event without a sanction ID starts no round in TOM until it is bound to TOM’s file, as its sends', async () => {
  const calls: string[] = [];
  global.window = {
    __TAURI_INTERNALS__: {
      invoke: (command: string) => {
        calls.push(command);
        return Promise.resolve(command === 'tom_state' ? { on: true, tom: 'open', file: null } : { result: 'started' });
      }
    }
  };
  assert.equal(await startTomRound('masters', tomEventOf(info(''), 'UNBOUND'), 1), null);
  assert.deepEqual(calls, [], 'TOM is not even asked');
  bind('BOUND', '26-10-000002');
  assert.equal(await startTomRound('masters', tomEventOf(info(''), 'BOUND'), 1), null);
  assert.deepEqual(calls, ['tom_state', 'tom_start_round']);
});

test('a binding to a file with a sanction ID is kept, one to a file without only until the page closes', () => {
  const kept = new Map<string, string>();
  global.localStorage = {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => kept.set(key, value)
  };
  bind('WITH', '26-10-000003');
  bind('WITHOUT', '');
  assert.deepEqual([...kept.entries()], [['cm-tom-event:WITH', '26-10-000003']]);
  assert.deepEqual(tomEventOf(info(''), 'WITHOUT'), { name: 'Spring Cup', sanctionId: '' });
  delete global.localStorage;
});

test('a binding to a file without a sanction ID ends when TOM opens another file; one with an ID stays', () => {
  bind('FILELESS', '');
  bind('WITH-ID', '26-10-000004');
  unbindFileless('FILELESS');
  unbindFileless('WITH-ID');
  assert.equal(tomEventOf(info(''), 'FILELESS'), null, 'asked again for the next file');
  assert.deepEqual(tomEventOf(info(''), 'WITH-ID'), { name: 'Spring Cup', sanctionId: '26-10-000004' });
});

test('a send for an event bound to a file without a sanction ID names that file, for the app to check', async () => {
  const calls: unknown[] = [];
  global.window = {
    __TAURI_INTERNALS__: {
      invoke: (command: string, args?: unknown) => {
        calls.push([command, args]);
        return Promise.resolve([]);
      }
    }
  };
  await nativeTom().submit([], { name: 'Spring Cup', sanctionId: '', source: 7 });
  assert.deepEqual(calls, [
    ['tom_submit', { entries: [], tournament: 'Spring Cup', tournamentId: undefined, source: 7 }]
  ]);
});
