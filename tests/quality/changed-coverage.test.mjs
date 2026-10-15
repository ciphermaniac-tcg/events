import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  addedLines,
  changedLineCoverage,
  inCoverageScope,
  resolveBase
} from '../../scripts/quality/changed-coverage.mjs';

test('tracks replacement and insertion hunks without counting removed lines', () => {
  const diff =
    '--- a/code.ts\n+++ b/code.ts\n@@ -2,2 +2,3 @@\n-old\n-older\n+new\n+newer\n+newest\n@@ -10,0 +12 @@\n+last\n';
  assert.deepEqual([...addedLines(diff)], [2, 3, 4, 12]);
});

test('measures executable changed lines and exposes uncovered line numbers', () => {
  assert.deepEqual(changedLineCoverage(new Set([1, 2, 3]), { 1: 1, 3: 0 }), {
    executable: 2,
    uncovered: [3],
    percent: 50
  });
  assert.equal(changedLineCoverage(new Set([2]), { 1: 0 }).percent, 100);
});

test('falls back to the parent of HEAD when the configured base no longer resolves', () => {
  const reachable = new Set(['HEAD^']);
  assert.equal(
    resolveBase('deadbee', revision => reachable.has(revision)),
    'HEAD^'
  );
  assert.equal(
    resolveBase('deadbee', () => false),
    null
  );
  assert.equal(
    resolveBase('HEAD', () => true),
    'HEAD'
  );
});

test('the coverage scope takes page logic beside its components, not the components or type-only modules', () => {
  const scope = JSON.parse(readFileSync(new URL('../../.c8rc.json', import.meta.url), 'utf8'));
  for (const file of ['src/pages/tournaments/resultEntry.ts', 'src/lib/tournament/api.ts', 'functions/api/me.ts']) {
    assert.equal(inCoverageScope(file, scope), true, file);
  }
  for (const file of [
    'src/pages/tournaments/RoundPanel.tsx',
    'src/pages/live/reportedDeck.ts',
    'shared/tournament/types.ts',
    'src/types/index.ts',
    'scripts/check-changed-coverage.mjs',
    'tests/quality/changed-coverage.test.mjs'
  ]) {
    assert.equal(inCoverageScope(file, scope), false, file);
  }
});
