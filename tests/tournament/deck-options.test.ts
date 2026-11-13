/** A Standard event's deck pickers: the online meta first, as played, then the long tail the icon map names. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const ONLINE = [{ name: 'dragapult ex', label: 'Dragapult ex', deckCount: 40, percent: 0.2, icons: ['dragapult'] }];
const ICONS = { 'Dragapult ex': ['dragapult'], 'Gardevoir ex': ['gardevoir'] };

test('Standard offers the online meta, scaled to percent, then every other deck the icon map names', async t => {
  // The release pointer and the live format list 404, which the pickers read past.
  t.mock.method(console, 'warn', () => undefined);
  const requested: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = decodeURIComponent(String(url));
    requested.push(href);
    if (href.endsWith('/Online - Last 14 Days/archetypes/index.json')) {
      return Response.json(ONLINE);
    }
    return href.endsWith('/assets/archetype-icons.json')
      ? Response.json(ICONS)
      : new Response('not found', { status: 404 });
  }) as typeof fetch;
  const { decksFor, learnFormatIcons } = await import('../../src/pages/tournaments/deckOptions.ts');

  await learnFormatIcons('Standard');
  const decks = await decksFor('Standard');
  assert.ok(!requested.some(url => url.endsWith('/assets/format-archetypes.json')));
  assert.ok(requested.some(url => url.endsWith('/assets/archetype-icons.json')));
  assert.strictEqual(await decksFor('Standard'), decks);
  assert.deepEqual(decks.slice(0, 2), [
    { label: 'Dragapult ex', icons: ['dragapult'], percent: 20, played: true },
    { label: 'Gardevoir ex' }
  ]);
});

test('past formats still refresh live metadata before choosing their decks', async t => {
  const snapshot = JSON.parse(
    readFileSync(new URL('../fixtures/e2e/assets/format-archetypes.json', import.meta.url), 'utf8')
  ) as unknown;
  const requested: string[] = [];
  t.mock.method(console, 'warn', () => undefined);
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const href = String(url);
    requested.push(href);
    return href.endsWith('/assets/format-archetypes.json')
      ? Response.json(snapshot)
      : new Response('not found', { status: 404 });
  });
  const { decksFor } = await import('../../src/pages/tournaments/deckOptions.ts');
  const decks = await decksFor('Expanded');
  assert.equal(decks[0]?.label, 'Synthetic Expanded Deck');
  assert.equal(requested.filter(url => url.endsWith('/assets/format-archetypes.json')).length, 1);
});
