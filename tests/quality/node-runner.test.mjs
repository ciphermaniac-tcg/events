import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'node-runner-test-'));
after(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, 'scripts'));
copyFileSync(new URL('../../scripts/run-node-tests.mjs', import.meta.url), join(root, 'scripts/run-node-tests.mjs'));
symlinkSync(new URL('../../node_modules', import.meta.url), join(root, 'node_modules'), 'junction');
for (const directory of ['unit/nested', 'api', 'e2e', 'mobile', 'perf']) {
  mkdirSync(join(root, 'tests', directory), { recursive: true });
  writeFileSync(
    join(root, 'tests', directory, 'sample.test.mjs'),
    `import { test } from 'node:test'; test('${directory} selected', () => {});`
  );
}
writeFileSync(join(root, 'tests/unit/nested/ignored.ts'), "throw new Error('not a test');");

function run(suite, ...args) {
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
  return spawnSync(process.execPath, [join(root, 'scripts/run-node-tests.mjs'), suite, ...args], {
    env,
    encoding: 'utf8'
  });
}

test('selects each suite and excludes browser/performance directories', () => {
  for (const suite of ['unit', 'api', 'node']) {
    const result = run(suite);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes('unit/nested selected'), suite !== 'api');
    assert.equal(result.stdout.includes('api selected'), suite !== 'unit');
    for (const excluded of ['e2e', 'mobile', 'perf']) {
      assert.ok(!result.stdout.includes(`${excluded} selected`));
    }
  }
});

test('rejects unknown and empty suites', () => {
  assert.match(run('unknown').stderr, /Unknown test suite/);
  const file = join(root, 'tests/api/sample.test.mjs');
  rmSync(file);
  try {
    const result = run('api');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No Node test files found/);
  } finally {
    writeFileSync(file, "import { test } from 'node:test'; test('api selected', () => {});");
  }
});

test('forwards Node test options and propagates failures', () => {
  const result = run('unit', '--test-reporter=dot');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('unit/nested selected'));
  const file = join(root, 'tests/unit/failure.test.mjs');
  writeFileSync(file, "throw new Error('intentional failure');");
  try {
    const failed = run('unit');
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout + failed.stderr, /intentional failure/);
  } finally {
    rmSync(file);
  }
});
