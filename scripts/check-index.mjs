import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inCoverageScope } from './quality/changed-coverage.mjs';
import { commitPlan } from './quality/commit-plan.mjs';
import { affectedFiles, importersOf, readSources } from './quality/import-graph.mjs';
import { checkoutIndex } from './quality/index-snapshot.mjs';

const windows = process.platform === 'win32';
const npx = windows ? 'npx.cmd' : 'npx';
const npm = windows ? 'npm.cmd' : 'npm';
const testFile = /^tests\/(?!e2e\/|mobile\/|perf\/).*\.test\.(?:ts|mjs)$/;
const specFile = /^tests\/e2e\/.*\.spec\.ts$/;

/** The paths the staged commit adds, changes, deletes or renames, or null without a HEAD. */
function stagedFiles() {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { stdio: 'ignore' });
  } catch {
    return null;
  }
  const diff = execFileSync('git', ['diff', '--cached', '--name-only', '--no-renames', '-z', 'HEAD'], {
    encoding: 'utf8'
  });
  return diff.split('\0').filter(Boolean);
}

function fullSteps() {
  return [['the full verify', npm, ['run', 'verify']]];
}

function testSteps(plan) {
  if (plan.tests === 'all') {
    return [['node tests with coverage', npm, ['run', 'verify:tests']]];
  }
  if (!plan.coverage) {
    return [];
  }
  // With no related tests, c8 still reports every in-scope file at 0%, so a
  // changed module nothing tests fails the changed-line check as it would in CI.
  const run = plan.tests.length > 0 ? ['--test', '--import', 'tsx', ...plan.tests] : ['-e', '0'];
  return [
    [
      `${plan.tests.length} related node test files`,
      npx,
      ['c8', '--reporter=json', '--reporter=text-summary', 'node', ...run]
    ],
    ['changed-line coverage', npm, ['run', 'coverage:check:changed']]
  ];
}

function specSteps(plan) {
  if (plan.specs === 'all') {
    return [['every browser spec', npm, ['run', 'test:e2e:local']]];
  }
  const run = ['playwright', 'test', '--config', 'playwright.local.config.ts', ...plan.specs];
  return plan.specs.length > 0 ? [[`browser specs: ${plan.specs.join(' ')}`, npx, run]] : [];
}

function incrementalSteps(directory, changed) {
  const sources = readSources(directory);
  const files = [...sources.keys()];
  const scope = JSON.parse(readFileSync(join(directory, '.c8rc.json'), 'utf8'));
  const plan = commitPlan({
    changed,
    affected: affectedFiles(changed, importersOf(sources)),
    specs: files.filter(file => specFile.test(file)),
    tests: files.filter(file => testFile.test(file)).sort(),
    inCoverageScope: file => inCoverageScope(file, scope)
  });
  const build = plan.build ? [['the build and bundle budget', npm, ['run', 'verify:build']]] : [];
  return [['static checks', npm, ['run', 'verify:static']], ...testSteps(plan), ...build, ...specSteps(plan)];
}

function run(steps, directory, env) {
  for (const [label, command, args] of steps) {
    console.log(`\npre-commit: ${label}`);
    const result = spawnSync(command, args, { shell: windows, cwd: directory, stdio: 'inherit', env });
    if (result.error) {
      console.error(result.error.message);
    }
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

const directory = mkdtempSync(join(tmpdir(), 'ciphermaniac-commit-'));
try {
  checkoutIndex(process.cwd(), directory);
  const changed = process.env.VERIFY_FULL === '1' ? null : stagedFiles();
  console.log(
    changed ? 'Verifying the staged tree (VERIFY_FULL=1 runs everything)...' : 'Verifying the staged tree in full...'
  );
  const localVariables = new Set(
    execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).trim().split('\n')
  );
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !localVariables.has(key)));
  const steps = changed ? incrementalSteps(directory, changed) : fullSteps();
  process.exitCode = run(steps, directory, { ...environment, QUALITY_BASE: 'HEAD' });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
