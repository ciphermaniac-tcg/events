import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

/**
 * Runs a test file under the browser build of solid-js, the one the site
 * ships, which the server build the test runner resolves cannot stand in for
 * once a module makes a resource. The child is a test run of its own: one
 * that inherits the runner's NODE_TEST_CONTEXT reports to no one and exits 0
 * whatever its tests did.
 */
export function passesUnderBrowserBuild(file: string): void {
  const { NODE_TEST_CONTEXT: _runner, ...env } = process.env;
  const run = spawnSync(process.execPath, ['--conditions=browser', '--import', 'tsx', '--test', file], {
    encoding: 'utf8',
    env
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
}
