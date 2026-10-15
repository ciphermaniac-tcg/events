/**
 * Who is signed in, shared by every tournament page. The module makes a solid
 * resource, which needs the browser build of solid-js, so it runs in a child.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('the shared session behaves under the browser build of solid-js', () => {
  const run = spawnSync(
    process.execPath,
    ['--conditions=browser', '--import', 'tsx', '--test', 'tests/tournament/session.browser.ts'],
    { encoding: 'utf8' }
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
