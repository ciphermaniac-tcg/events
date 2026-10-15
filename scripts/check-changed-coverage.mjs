import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import coverage from 'istanbul-lib-coverage';
import { addedLines, changedLineCoverage, inCoverageScope, resolveBase } from './quality/changed-coverage.mjs';

const git = args => execFileSync('git', args, { encoding: 'utf8' });
const resolves = revision => {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// CI supplies the PR base SHA, or the previous tip of the branch a push moved.
const configured = process.env.QUALITY_BASE || 'HEAD';
const base = resolveBase(configured, resolves);
if (!base) {
  console.warn(`check-changed-coverage: ${configured} does not resolve and HEAD has no parent; skipping.`);
  process.exit(0);
}
if (base !== configured) {
  console.warn(`check-changed-coverage: ${configured} does not resolve; diffing against ${base}.`);
}
const files = git(['diff', '--name-only', '--diff-filter=ACMR', '-z', base, '--']).split('\0').filter(Boolean);
const map = coverage.createCoverageMap(JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8')));
const measured = new Set(map.files());
const scope = JSON.parse(readFileSync('.c8rc.json', 'utf8'));

/** Why a changed file fails the gate, or null when it passes or is out of scope. */
function failure(file) {
  const path = resolve(file);
  if (!measured.has(path)) {
    return inCoverageScope(file, scope)
      ? `${file}: in the coverage scope of .c8rc.json but missing from the report`
      : null;
  }
  const diff = git(['diff', '--no-ext-diff', '--unified=0', base, '--', file]);
  const result = changedLineCoverage(addedLines(diff), map.fileCoverageFor(path).getLineCoverage());
  return result.percent < 80
    ? `${file}: ${result.percent.toFixed(1)}% changed-line coverage; minimum 80%. Uncovered: ${result.uncovered.join(', ')}`
    : null;
}

const failures = files.map(failure).filter(Boolean);
for (const message of failures) {
  console.error(message);
}
process.exitCode = failures.length ? 1 : 0;
