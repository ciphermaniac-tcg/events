/**
 * The icon map loads with the first deck drawn, not with every page, and a
 * deck's Pokémon wait for it: the map names most decks, and the Pokémon are a
 * chunk of their own.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { deferred } from '../__utils__/deferred';

/** Lets pending reads run until `check` holds, or fails after a hundred turns. */
async function until(check: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100 && !check(); turn += 1) {
    await tick();
  }
  assert.ok(check());
}

test('the first deck drawn loads the icon map, and no Pokémon stands in until it answers', async t => {
  // The release pointer 404s too, which the data layer warns about and reads past.
  t.mock.method(console, 'warn', () => undefined);
  const icons = deferred<Response>();
  const asked: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url);
    asked.push(href);
    return href.endsWith('/archetype-icons.json') ? icons.promise : new Response('not found', { status: 404 });
  }) as typeof fetch;
  const { deckIcons, loadSpecies } = await import('../../src/lib/deckIcons');
  assert.equal(asked.length, 0, 'nothing read before a deck is drawn');

  assert.deepEqual(
    deckIcons({ label: 'Tyrantrum', icons: ['tyrunt'] }),
    ['tyrunt'],
    'a deck’s own sprites need no map'
  );
  assert.equal(asked.length, 0);
  assert.deepEqual(deckIcons({ label: 'Tyrantrum' }), []);
  await loadSpecies();
  assert.deepEqual(deckIcons({ label: 'Tyrantrum' }), [], 'the Pokémon wait for the map');
  await until(() => asked.some(url => url.endsWith('/archetype-icons.json')));

  icons.resolve(Response.json({ 'Tyrantrum ex': ['tyrantrum', 'tyrunt'] }));
  await until(() => deckIcons({ label: 'Tyrantrum ex' }).length > 0);
  assert.deepEqual(deckIcons({ label: 'Tyrantrum ex' }), ['tyrantrum', 'tyrunt']);
  assert.deepEqual(deckIcons({ label: 'Tyrantrum' }), ['tyrantrum'], 'a deck the map lacks draws its Pokémon');
  assert.equal(asked.filter(url => url.endsWith('/archetype-icons.json')).length, 1, 'read once');
});

test('a map that cannot be read lets the Pokémon stand in', async () => {
  const { loadArchetypeIconMap } = await import('../../src/lib/data/archetypes');
  const { deckIcons, loadSpecies } = await import('../../src/lib/deckIcons');
  await assert.rejects(
    loadArchetypeIconMap(async () => null),
    /Invalid/
  );
  await loadSpecies();
  assert.deepEqual(deckIcons({ label: 'Tyrantrum' }), ['tyrantrum']);
});
