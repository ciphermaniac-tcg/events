import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitPlan, namedSpecs, smokeSpecs, specKeys } from '../../scripts/quality/commit-plan.mjs';

const specs = [
  'tests/e2e/home.spec.ts',
  'tests/e2e/initial-load.spec.ts',
  'tests/e2e/stores.spec.ts',
  'tests/e2e/tournament-console.spec.ts',
  'tests/e2e/tournaments.spec.ts'
];
const tests = ['tests/api/stores.test.ts', 'tests/quality/x.test.mjs'];

function plan(changed, affected = changed, inCoverageScope = () => false) {
  return commitPlan({ changed, affected: new Set(affected), specs, tests, inCoverageScope });
}

test('spec keys drop the tournament prefix and accept a singular', () => {
  assert.deepEqual(specKeys('tests/e2e/tournament-console.spec.ts'), ['console']);
  assert.deepEqual(specKeys('tests/e2e/stores.spec.ts'), ['stores', 'store']);
  assert.deepEqual(specKeys('tests/e2e/tournaments.spec.ts'), ['tournaments']);
  assert.deepEqual(specKeys('tests/e2e/deck-checks.spec.ts'), ['deck-checks', 'deck-check']);
});

test('specs match app files named after them', () => {
  assert.deepEqual(namedSpecs(['src/styles/pages/tournament-store-page.css'], specs), ['tests/e2e/stores.spec.ts']);
  assert.deepEqual(namedSpecs(['src/pages/tournaments/Console.tsx'], specs), ['tests/e2e/tournament-console.spec.ts']);
  assert.deepEqual(namedSpecs(['src/pages/TournamentsPage.tsx'], specs), ['tests/e2e/tournaments.spec.ts']);
});

test('a page stylesheet builds and runs only its own spec', () => {
  const css = 'src/styles/pages/tournament-console.css';
  assert.deepEqual(plan([css], [css, 'src/pages/tournaments/Console.tsx']), {
    build: true,
    tests: [],
    coverage: false,
    specs: ['tests/e2e/tournament-console.spec.ts']
  });
});

test('an app change no spec is named after falls back to the smoke specs', () => {
  assert.deepEqual(plan(['src/lib/format.ts']).specs, smokeSpecs);
});

test('a changed spec runs itself without a build', () => {
  const result = plan(['tests/e2e/stores.spec.ts']);
  assert.equal(result.build, false);
  assert.deepEqual(result.specs, ['tests/e2e/stores.spec.ts']);
});

test('a backend change runs the tests that import it and checks its coverage', () => {
  const changed = ['functions/api/stores.ts'];
  assert.deepEqual(
    plan(changed, [...changed, 'tests/api/stores.test.ts'], () => true),
    {
      build: false,
      tests: ['tests/api/stores.test.ts'],
      coverage: true,
      specs: []
    }
  );
});

test('an untested in-scope change still runs the coverage check', () => {
  const result = plan(['functions/api/new.ts'], ['functions/api/new.ts'], () => true);
  assert.deepEqual(result.tests, []);
  assert.equal(result.coverage, true);
});

test('shared files run the whole suite they affect', () => {
  for (const file of ['package.json', 'tsconfig.json']) {
    assert.deepEqual({ ...plan([file]), build: true }, { build: true, tests: 'all', coverage: true, specs: 'all' });
  }
  for (const file of [
    'playwright.local.config.ts',
    'src/styles/global.css',
    'src/components/SiteHead.tsx',
    'tests/e2e/serve-fixtures.ts'
  ]) {
    assert.equal(plan([file]).specs, 'all', file);
  }
  assert.equal(plan(['tests/fixtures/e2e/reports/a.json']).tests, 'all');
  assert.equal(plan(['config/quality/bundle-budgets.json']).build, true);
});

test('docs-only changes run neither tests, build nor specs', () => {
  assert.deepEqual(plan(['DESIGN.md']), { build: false, tests: [], coverage: false, specs: [] });
});
