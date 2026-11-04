import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  affectedFiles,
  importersOf,
  readSources,
  resolveSpecifier,
  specifiers
} from '../../scripts/quality/import-graph.mjs';

test('finds static, side-effect, dynamic, CSS and repo-rooted path imports', () => {
  const text = [
    "import { a } from './a';",
    "export * from '../b.js';",
    "import './styles/c.css';",
    "const d = import('~/lib/d');",
    "@import url('./e.css');",
    "run('tests/tournament/f.browser.ts');"
  ].join('\n');
  assert.deepEqual(specifiers(text).sort(), [
    '../b.js',
    './a',
    './e.css',
    './styles/c.css',
    'tests/tournament/f.browser.ts',
    '~/lib/d'
  ]);
});

test('resolves relative, aliased and .js-suffixed specifiers to repository files', () => {
  const files = new Set(['src/lib/a.ts', 'src/lib/b/index.tsx', 'shared/c.ts', 'src/d.css', 'tests/e.ts']);
  assert.equal(resolveSpecifier('src/lib/x.ts', './a', files), 'src/lib/a.ts');
  assert.equal(resolveSpecifier('src/lib/x.ts', './b', files), 'src/lib/b/index.tsx');
  assert.equal(resolveSpecifier('src/lib/x.ts', '../../shared/c.js', files), 'shared/c.ts');
  assert.equal(resolveSpecifier('src/pages/x.tsx', '~/d.css', files), 'src/d.css');
  assert.equal(resolveSpecifier('tests/x.test.ts', 'tests/e.ts', files), 'tests/e.ts');
  assert.equal(resolveSpecifier('src/x.ts', 'solid-js', files), null);
  assert.equal(resolveSpecifier('src/x.ts', './missing', files), null);
});

test('a change reaches every file that imports it, directly or not', () => {
  const sources = new Map([
    ['shared/core.ts', "import './core';"],
    ['src/lib/use.ts', "import { core } from '../../shared/core';"],
    ['tests/use.test.ts', "import { use } from '../src/lib/use';"],
    ['tests/other.test.ts', "import 'node:test';"]
  ]);
  const affected = affectedFiles(['shared/core.ts'], importersOf(sources));
  assert.deepEqual([...affected].sort(), ['shared/core.ts', 'src/lib/use.ts', 'tests/use.test.ts']);
});

test('reads source modules under the code roots and skips fixture data', () => {
  const root = mkdtempSync(join(tmpdir(), 'import-graph-test-'));
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'tests', 'fixtures'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'a');
    writeFileSync(join(root, 'src', 'notes.md'), 'b');
    writeFileSync(join(root, 'tests', 'fixtures', 'c.ts'), 'c');
    assert.deepEqual([...readSources(root)], [['src/a.ts', 'a']]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
