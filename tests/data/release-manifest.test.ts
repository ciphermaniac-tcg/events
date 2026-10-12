/**
 * tests/data/release-manifest.test.ts
 * Immutable release manifest: composition, validation, path resolution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  composeRelease,
  type ReleaseComposition,
  resolveEventPath,
  resolveScopePath,
  validateReleaseManifest
} from '../../shared/data/build/release.ts';

function composition(): ReleaseComposition {
  return {
    releaseId: '20260713T000000Z-abc1234',
    publishedAt: '2026-07-13T00:00:00Z',
    roots: {
      online: '/releases/v1/online/aaa111',
      trends: '/releases/v1/trends/bbb222',
      players: '/releases/v1/players/ccc333',
      prices: '/releases/v1/prices/ddd444',
      catalogs: '/releases/v1/catalogs/eee555',
      snapshots: '/releases/v1/snapshots/fff666',
      assets: '/releases/v1/assets/ggg777'
    },
    events: { 'labs:0042': '/releases/v1/events/labs:0042/999zzz' },
    dependencies: { 'prices.online': 'aaa111' }
  };
}

test('resolveScopePath joins the scope root and strips leading slashes', () => {
  const manifest = composeRelease(composition());
  assert.strictEqual(resolveScopePath(manifest, 'online', 'master.json'), '/releases/v1/online/aaa111/master.json');
  assert.strictEqual(
    resolveScopePath(manifest, 'online', '/archetypes/index.json'),
    '/releases/v1/online/aaa111/archetypes/index.json'
  );
});

test('resolveEventPath joins a linked event root and returns null for an unlinked event', () => {
  const manifest = composeRelease(composition());
  assert.strictEqual(
    resolveEventPath(manifest, 'labs:0042', 'cardUsage.json'),
    '/releases/v1/events/labs:0042/999zzz/cardUsage.json'
  );
  assert.strictEqual(resolveEventPath(manifest, 'labs:9999', 'cardUsage.json'), null);
});

test('composeRelease rejects a mutable (non-immutable) root', () => {
  const bad = composition();
  bad.roots.online = 'reports/Online - Last 14 Days';
  assert.throws(() => composeRelease(bad), /invalid manifest/);
});

test('validateReleaseManifest flags missing scopes and bad paths', () => {
  const errors = validateReleaseManifest({
    contractVersion: 2,
    releaseId: 'r',
    publishedAt: 't',
    roots: { online: '/releases/v1/online/x/' }, // trailing slash + missing scopes
    events: {},
    dependencies: {}
  });
  assert.ok(errors.some(e => e.includes('roots.online')));
  assert.ok(errors.some(e => e.includes('roots.trends: missing')));
});

test('validateReleaseManifest refuses whatever is not a whole manifest', () => {
  const whole = { contractVersion: 2, ...composition() };
  assert.deepEqual(validateReleaseManifest(whole), []);
  assert.deepEqual(validateReleaseManifest(null), ['manifest: expected object']);
  assert.deepEqual(validateReleaseManifest('manifest'), ['manifest: expected object']);
  const broken = validateReleaseManifest({
    ...whole,
    contractVersion: 1,
    releaseId: '',
    publishedAt: 7,
    roots: null,
    events: { 'labs:0042': '/reports/labs:0042' },
    dependencies: null
  });
  assert.deepEqual(broken, [
    'contractVersion: expected 2',
    'releaseId: expected non-empty string',
    'publishedAt: expected non-empty string',
    'roots: expected object',
    'events.labs:0042: expected an immutable /releases/v1/... path',
    'dependencies: expected object'
  ]);
  assert.deepEqual(validateReleaseManifest({ ...whole, events: null }), ['events: expected object']);
});

test('resolveScopePath refuses a scope the release has no root for', () => {
  const manifest = composeRelease(composition());
  delete (manifest.roots as Partial<typeof manifest.roots>).assets;
  assert.throws(() => resolveScopePath(manifest, 'assets', 'card-synonyms.json'), /has no root for scope "assets"/);
});
