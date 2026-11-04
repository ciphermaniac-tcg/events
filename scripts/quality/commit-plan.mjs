import { posix } from 'node:path';

const everyRun = ['package.json', 'package-lock.json', /^tsconfig.*\.json$/];

// Files every browser test depends on: the build, the shell and its global
// styles, the copy, and the fixture data the preview server answers with.
const sharedByBrowserTests = [
  ...everyRun,
  /^playwright.*\.config\.ts$/,
  'vite.config.ts',
  'index.html',
  'src/main.tsx',
  'src/app.tsx',
  /^src\/styles\/[^/]+\.css$/,
  /^src\/components\//,
  /^src\/locales\//,
  /^static\//,
  /^tests\/fixtures\//,
  'tests/e2e/serve-fixtures.ts',
  'tests/e2e/fixture-server.ts'
];

// Files that change what every node test runs against or how it is measured.
const sharedByNodeTests = [...everyRun, '.c8rc.json', 'scripts/run-node-tests.mjs', /^config\//, /^tests\/fixtures\//];

const shippedToBrowser = [
  ...everyRun,
  /^(?:src|shared|static)\//,
  'index.html',
  'vite.config.ts',
  'config/quality/bundle-budgets.json',
  'scripts/check-bundle-budget.mjs',
  'scripts/quality/bundle-budget.mjs'
];

/** Specs run when the app changed but no spec is named after the change. */
export const smokeSpecs = ['tests/e2e/home.spec.ts', 'tests/e2e/initial-load.spec.ts'];

const matches = (file, patterns) =>
  patterns.some(pattern => (typeof pattern === 'string' ? pattern === file : pattern.test(file)));

const touches = (files, patterns) => files.some(file => matches(file, patterns));

/** A name as dash-joined lowercase words: TournamentsPage -> tournaments-page. */
const words = name =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');

/** The names a spec answers to: tournament-console.spec.ts -> console. */
export function specKeys(spec) {
  const key = words(posix.basename(spec, '.spec.ts')).replace(/^tournament-/, '');
  const singular = key.replace(/s$/, '');
  return singular === key || singular === 'tournament' ? [key] : [key, singular];
}

/** Specs whose name is a run of words in the name of a changed or affected app file. */
export function namedSpecs(appFiles, specs) {
  const names = appFiles.map(file => `-${words(posix.basename(file).replace(/\.[^.]+$/, ''))}-`);
  return specs.filter(spec => specKeys(spec).some(key => names.some(name => name.includes(`-${key}-`))));
}

function browserSpecs(changed, affected, specs) {
  if (touches(changed, sharedByBrowserTests)) {
    return 'all';
  }
  const appFiles = [...affected].filter(file => file.startsWith('src/'));
  const selected = new Set([...specs.filter(spec => affected.has(spec)), ...namedSpecs(appFiles, specs)]);
  if (selected.size === 0 && appFiles.length > 0) {
    return smokeSpecs.filter(spec => specs.includes(spec));
  }
  return [...selected].sort();
}

function nodeTests(changed, affected, tests) {
  return touches(changed, sharedByNodeTests) ? 'all' : tests.filter(test => affected.has(test));
}

/**
 * What a commit must pass locally. `changed` is the staged diff, `affected`
 * adds everything that imports it, and `specs`/`tests` list the suites.
 * `inCoverageScope` says whether a file counts toward changed-line coverage.
 */
export function commitPlan({ changed, affected, specs, tests, inCoverageScope }) {
  const selectedTests = nodeTests(changed, affected, tests);
  return {
    build: touches(changed, shippedToBrowser),
    tests: selectedTests,
    coverage: selectedTests.length > 0 || changed.some(inCoverageScope),
    specs: browserSpecs(changed, affected, specs)
  };
}
