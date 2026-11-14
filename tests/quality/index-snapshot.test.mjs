import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkoutIndex } from '../../scripts/quality/index-snapshot.mjs';

test('checks staged contents even when the working tree contains a later fix', () => {
  const root = mkdtempSync(join(tmpdir(), 'quality-index-test-'));
  const repository = join(root, 'repository');
  const snapshot = join(root, 'snapshot');
  mkdirSync(repository);
  mkdirSync(snapshot);
  try {
    execFileSync('git', ['init', '--quiet', repository]);
    writeFileSync(join(repository, 'code.ts'), 'staged version');
    execFileSync('git', ['add', 'code.ts'], { cwd: repository });
    writeFileSync(join(repository, 'code.ts'), 'unstaged fix');
    checkoutIndex(repository, snapshot);
    assert.equal(readFileSync(join(snapshot, 'code.ts'), 'utf8'), 'staged version');
    assert.equal(readFileSync(join(repository, 'code.ts'), 'utf8'), 'unstaged fix');
    assert.equal(execFileSync('git', ['show', ':code.ts'], { cwd: snapshot, encoding: 'utf8' }), 'staged version');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('links the dependencies of the root and of the desktop app when the snapshot has a place for them', () => {
  const root = mkdtempSync(join(tmpdir(), 'quality-index-test-'));
  const repository = join(root, 'repository');
  const snapshot = join(root, 'snapshot');
  mkdirSync(join(repository, 'native', 'node_modules', 'dep'), { recursive: true });
  mkdirSync(join(repository, 'node_modules'));
  mkdirSync(snapshot);
  try {
    execFileSync('git', ['init', '--quiet', repository]);
    writeFileSync(join(repository, 'native', 'package.json'), '{}');
    execFileSync('git', ['add', 'native/package.json'], { cwd: repository });
    checkoutIndex(repository, snapshot);
    assert.ok(existsSync(join(snapshot, 'node_modules')));
    assert.ok(existsSync(join(snapshot, 'native', 'node_modules', 'dep')));
    assert.ok(!existsSync(join(snapshot, '.venv')), 'nothing to link');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
