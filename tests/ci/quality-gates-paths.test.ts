/** Which changes the site's quality gates skip: only native code they do not check. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/quality-gates.yml', import.meta.url), 'utf8');

/** Every `paths-ignore` list in the workflow, one per trigger. */
const ignoreLists = [...workflow.matchAll(/paths-ignore:\s*\[([^\]]*)\]/g)].map(([, list]) =>
  [...list!.matchAll(/'([^']+)'/g)].map(([, glob]) => glob!)
);

const skipped = (file: string) => ignoreLists.every(list => list.some(glob => matchesGlob(file, glob)));

test('a change to the native package still runs the site gates', () => {
  assert.equal(ignoreLists.length, 2, 'pull requests and pushes to main');
  for (const file of ['native/package.json', 'native/package-lock.json']) {
    assert.equal(skipped(file), false, file);
  }
});

test('a change only to the Rust or Java side skips them', () => {
  for (const file of ['native/src-tauri/src/lib.rs', 'native/tom-link/src/code.rs', 'native/tom-bridge/build.mjs']) {
    assert.equal(skipped(file), true, file);
  }
});
