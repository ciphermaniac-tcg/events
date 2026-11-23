/** The TOM panel's sends name the picked file's event, so TOM refuses them with another event open. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

test('the panel sends results and Start Round with the picked file’s event name', async () => {
  const calls: [string, unknown][] = [];
  Object.assign(globalThis, {
    window: {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args: unknown) => {
          calls.push([command, args]);
          return Promise.resolve(command === 'tom_submit' ? [] : { result: 'started' });
        }
      }
    }
  });
  const { createLog } = await import('../../native/panel/src/log');
  const log = createLog(() => 'Spring Cup');
  const entry = { pod: 2, flight: null, round: 1, table: 1, outcome: 1 as const, code: '21113', p1: '1', p2: '2' };
  await log.send([{ entry, what: 'table 1' }]);
  await log.startRound(2, 1, 'Start round 1');
  assert.deepEqual(calls, [
    ['tom_submit', { entries: [entry], tournament: 'Spring Cup' }],
    ['tom_start_round', { pod: 2, round: 1, tournament: 'Spring Cup' }]
  ]);
});
