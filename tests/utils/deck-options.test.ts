import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoot } from 'solid-js';
import { createDeckOptions, type DeckResource, nicheDecks } from '../../src/pages/tournaments/deckPresets.ts';

const unusedLoader = async () => [];
const noDeckResource: DeckResource = source => {
  source();
  const empty = Object.assign(() => undefined, { state: 'unresolved', loading: false, error: undefined });
  return [empty as never];
};

test('Gym Leader Challenge offers each type as a played deck', () => {
  createRoot(dispose => {
    const decks = createDeckOptions(() => 'Gym Leader Challenge', unusedLoader, {
      createResource: noDeckResource
    })();
    assert.deepEqual(
      decks.map(deck => deck.label),
      [
        'Grass',
        'Fire',
        'Water',
        'Lightning',
        'Fighting',
        'Psychic',
        'Darkness',
        'Metal',
        'Dragon',
        'Colorless',
        'Fairy'
      ]
    );
    assert.ok(decks.every(deck => deck.played));
    assert.ok(
      decks.every(deck => deck.type),
      'each draws its type icon, however many decks the event adds'
    );
    dispose();
  });
});

test('an upcoming prerelease offers its fixed archetypes before the cutoff', () => {
  createRoot(dispose => {
    const decks = createDeckOptions(() => 'Prerelease', unusedLoader, {
      startDate: () => '11/06/2026',
      createResource: noDeckResource
    })();
    assert.deepEqual(
      decks.map(deck => deck.label),
      ['Enamorus', 'Kommo-o', 'Masquerain', 'Magmortar']
    );
    assert.ok(decks.every(deck => deck.played));
    dispose();
  });
});

test('a prerelease on the cutoff date uses the normal format options', () => {
  assert.equal(nicheDecks('Prerelease', '11/07/2026'), null);
  assert.equal(nicheDecks('Prerelease', 'not a date'), null);
  assert.equal(nicheDecks('Standard', '11/06/2026'), null);
});

test('event decks are merged into the preset list', () => {
  createRoot(dispose => {
    const decks = createDeckOptions(() => 'Gym Leader Challenge', unusedLoader, {
      inEvent: () => ['Grass', 'Custom deck'],
      createResource: noDeckResource
    })();
    assert.deepEqual(
      decks.find(deck => deck.label === 'Grass'),
      { label: 'Grass', played: true, type: true }
    );
    // A name typed in is not a type, so it keeps the archetype sprites.
    assert.deepEqual(
      decks.find(deck => deck.label === 'Custom deck'),
      { label: 'Custom deck', played: true }
    );
    assert.equal(decks.length, 12);
    dispose();
  });
});
