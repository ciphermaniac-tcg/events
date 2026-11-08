/** A Standard event's deck pickers: the online meta first, as played, then the long tail the icon map names. */

import assert from 'node:assert/strict';
import test from 'node:test';

const ONLINE = [{ name: 'dragapult ex', label: 'Dragapult ex', deckCount: 40, percent: 0.2, icons: ['dragapult'] }];
const ICONS = { 'Dragapult ex': ['dragapult'], 'Gardevoir ex': ['gardevoir'] };

test('Standard offers the online meta, scaled to percent, then every other deck the icon map names', async t => {
  // The release pointer and the live format list 404, which the pickers read past.
  t.mock.method(console, 'warn', () => undefined);
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = decodeURIComponent(String(url));
    if (href.endsWith('/Online - Last 14 Days/archetypes/index.json')) {
      return Response.json(ONLINE);
    }
    return href.endsWith('/assets/archetype-icons.json')
      ? Response.json(ICONS)
      : new Response('not found', { status: 404 });
  }) as typeof fetch;
  const { decksFor } = await import('../../src/pages/tournaments/deckOptions.ts');

  const decks = await decksFor('Standard');
  assert.deepEqual(decks.slice(0, 2), [
    { label: 'Dragapult ex', icons: ['dragapult'], percent: 20, played: true },
    { label: 'Gardevoir ex' }
  ]);
});
