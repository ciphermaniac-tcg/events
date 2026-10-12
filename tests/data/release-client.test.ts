/**
 * tests/data/release-client.test.ts
 * Release-aware path resolution against the main site's current release.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCurrentResolver, resolvePathWith } from '../../src/lib/releaseClient.ts';

const ORIGIN = 'https://data.example';
const MANIFEST = {
  contractVersion: 2,
  releaseId: '20260713T000000Z-abc',
  publishedAt: '2026-07-13T00:00:00Z',
  roots: {
    online: '/releases/v1/online/aaa',
    trends: '/releases/v1/trends/bbb',
    players: '/releases/v1/players/ccc',
    prices: '/releases/v1/prices/ddd',
    catalogs: '/releases/v1/catalogs/eee',
    snapshots: '/releases/v1/snapshots/fff',
    assets: '/releases/v1/assets/ggg'
  },
  events: {},
  dependencies: {}
};

/** A data origin that answers the listed paths and 404s the rest, recording what was asked and how. */
function origin(files: Record<string, unknown>) {
  const asked: { url: string; cache?: RequestCache }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    asked.push({ url: href, cache: init?.cache });
    const path = href.slice(ORIGIN.length);
    return path in files ? Response.json(files[path]) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { asked, fetchImpl };
}

const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
  const { warn } = console;
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.warn = warn;
  }
};

test('the current release comes from the uncached pointer and the manifest it names', async () => {
  const manifest = '/releases/v1/manifests/20260713T000000Z-abc.json';
  const { asked, fetchImpl } = origin({ '/current.json': { channel: 'production', manifest }, [manifest]: MANIFEST });
  const resolver = await loadCurrentResolver(fetchImpl, ORIGIN);
  assert.strictEqual(resolver.isReleaseAware, true);
  assert.strictEqual(resolver.releaseId, '20260713T000000Z-abc');
  assert.deepStrictEqual(asked, [
    { url: `${ORIGIN}/current.json`, cache: 'no-store' },
    { url: `${ORIGIN}${manifest}`, cache: undefined }
  ]);
});

test('an unreadable or invalid release leaves paths unchanged', async () => {
  const manifest = '/releases/v1/manifests/x.json';
  for (const files of [
    {},
    { '/current.json': { manifest: 'https://elsewhere.example/x.json' } },
    { '/current.json': { manifest } },
    { '/current.json': { manifest }, [manifest]: { ...MANIFEST, roots: {} } }
  ]) {
    const resolver = await quietly(() => loadCurrentResolver(origin(files).fetchImpl, ORIGIN));
    assert.strictEqual(resolver.isReleaseAware, false, JSON.stringify(files));
    assert.strictEqual(
      resolvePathWith(resolver, '/reports/Online - Last 14 Days/master.json'),
      '/reports/Online - Last 14 Days/master.json'
    );
  }
});

test('with a release, scope paths resolve to immutable release roots', async () => {
  const { createReleaseResolver } = await import('../../shared/releaseManifest.ts');
  const resolver = createReleaseResolver({
    contractVersion: 2,
    releaseId: '20260713T000000Z-abc',
    publishedAt: '2026-07-13T00:00:00Z',
    roots: {
      online: '/releases/v1/online/aaa',
      trends: '/releases/v1/trends/bbb',
      players: '/releases/v1/players/ccc',
      prices: '/releases/v1/prices/ddd',
      catalogs: '/releases/v1/catalogs/eee',
      snapshots: '/releases/v1/snapshots/fff',
      assets: '/releases/v1/assets/ggg'
    },
    events: { '2026-01-16, Regional X': '/releases/v1/events/2026-01-16, Regional X/999' },
    dependencies: {}
  });
  assert.strictEqual(resolvePathWith(resolver, '/upcoming.json'), '/upcoming.json');
  // Served keys rewrite to their immutable roots.
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/Online - Last 14 Days/master.json'),
    '/releases/v1/online/aaa/master.json'
  );
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/Trends - Last 30 Days/trends.json'),
    '/releases/v1/trends/bbb/trends.json'
  );
  assert.strictEqual(resolvePathWith(resolver, '/players/index-slim.json'), '/releases/v1/players/ccc/index-slim.json');
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/tournaments.json'),
    '/releases/v1/catalogs/eee/tournaments.json'
  );
  assert.strictEqual(resolvePathWith(resolver, '/reports/prices.json'), '/releases/v1/prices/ddd/prices.json');
  assert.strictEqual(
    resolvePathWith(resolver, '/assets/card-synonyms.json'),
    '/releases/v1/assets/ggg/card-synonyms.json'
  );
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/price-movers.json'),
    '/releases/v1/prices/ddd/price-movers.json'
  );
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/price-history/SCR.json'),
    '/releases/v1/prices/ddd/price-history/SCR.json'
  );
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/majors-trends.json'),
    '/releases/v1/trends/bbb/majors-trends.json'
  );
  assert.strictEqual(
    resolvePathWith(resolver, '/players/1272/profile.json'),
    '/releases/v1/players/ccc/1272/profile.json'
  );
  assert.strictEqual(resolvePathWith(resolver, '/players/1272/decks.json'), '/releases/v1/players/ccc/1272/decks.json');
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/Online - Last 14 Days/conversion.json'),
    '/releases/v1/online/aaa/conversion.json'
  );
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/Snapshots/2025-05-01/master.json'),
    '/releases/v1/snapshots/fff/2025-05-01/master.json'
  );
  // Event-folder paths resolve when the event is in the release's map.
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/2026-01-16, Regional X/master.json'),
    '/releases/v1/events/2026-01-16, Regional X/999/master.json'
  );
  assert.throws(() => resolvePathWith(resolver, '/reports/2026-02-01, Other/master.json'), /not present in release/);
  // The real data layer encodes folder names before passing them to the resolver.
  const { tournamentPath } = await import('../../src/lib/data/paths.ts');
  for (const folder of ['Online - Last 14 Days', 'Trends - Last 30 Days', '2026-01-16, Regional X']) {
    assert.strictEqual(
      resolvePathWith(resolver, `${tournamentPath(folder)}/master.json`),
      resolvePathWith(resolver, `/reports/${folder}/master.json`)
    );
  }
  assert.strictEqual(
    resolvePathWith(resolver, `${tournamentPath('Online - Last 14 Days')}/archetypes/Mega%20Gardevoir.json`),
    '/releases/v1/online/aaa/archetypes/Mega%20Gardevoir.json'
  );
});

test('missing-release-body recovery: reload once for a release path, never for legacy or twice', async () => {
  const { planMissingBodyRecovery, isReleasePath } = await import('../../src/lib/releaseClient.ts');
  // Release-aware + immutable release path + not yet reloaded -> one reload.
  assert.strictEqual(planMissingBodyRecovery('/releases/v1/online/aaa/master.json', true, false), 'reload');
  // Already reloaded once -> passthrough (no loop; must not combine roots).
  assert.strictEqual(planMissingBodyRecovery('/releases/v1/online/aaa/master.json', true, true), 'passthrough');
  // A legacy path 404 is a normal miss, never a recovery reload.
  assert.strictEqual(planMissingBodyRecovery('/reports/Online - Last 14 Days/master.json', true, false), 'passthrough');
  // Not release-aware (no release could be read) -> never reloads.
  assert.strictEqual(planMissingBodyRecovery('/releases/v1/online/aaa/master.json', false, false), 'passthrough');
  assert.strictEqual(isReleasePath('/releases/v1/x/y.json'), true);
  assert.strictEqual(isReleasePath('/reports/x/y.json'), false);
});

test('a release that could not be read is asked for again by the next path', async () => {
  const manifest = '/releases/v1/manifests/20260713T000000Z-abc.json';
  const { R2_ORIGIN } = await import('../../src/lib/constants.ts');
  const { resolveDataPath } = await import('../../src/lib/releaseClient.ts');
  let up = false;
  const previous = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const path = String(url).slice(R2_ORIGIN.length);
    if (!up) {
      throw new TypeError('fetch failed');
    }
    return path === '/current.json' ? Response.json({ manifest }) : Response.json(MANIFEST);
  }) as typeof fetch;
  try {
    const path = '/reports/Online - Last 14 Days/master.json';
    assert.strictEqual(await quietly(() => resolveDataPath(path)), path);
    up = true;
    assert.strictEqual(await resolveDataPath(path), '/releases/v1/online/aaa/master.json');
  } finally {
    globalThis.fetch = previous;
  }
});
