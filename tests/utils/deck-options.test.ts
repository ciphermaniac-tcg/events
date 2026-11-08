/** The Players tab's deck picker list: a format's presets or archetypes, with the event's own decks laid over them. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deckList } from '../../src/pages/tournaments/deckPresets.ts';

const FORMAT = [
  { label: 'Dark Tyranitar', icons: ['tyranitar'], percent: 14, played: true },
  { label: 'Gardevoir', icons: ['gardevoir'] }
];

const event = (format: string, startDate = '', inEvent: string[] = []) => ({ format, startDate, inEvent });

test('Gym Leader Challenge offers each type as a played deck', () => {
  const decks = deckList(event('Gym Leader Challenge'));
  assert.deepEqual(
    decks.map(deck => deck.label),
    ['Grass', 'Fire', 'Water', 'Lightning', 'Fighting', 'Psychic', 'Darkness', 'Metal', 'Dragon', 'Colorless', 'Fairy']
  );
  assert.ok(decks.every(deck => deck.played));
  assert.ok(
    decks.every(deck => deck.type),
    'each draws its type icon, however many decks the event adds'
  );
});

test('an upcoming prerelease offers its fixed archetypes before the cutoff', () => {
  const decks = deckList(event('Prerelease', '11/06/2026'));
  assert.deepEqual(
    decks.map(deck => deck.label),
    ['Enamorus', 'Kommo-o', 'Masquerain', 'Magmortar']
  );
  assert.ok(decks.every(deck => deck.played));
});

test('a prerelease on the cutoff date, or without one, uses the format’s loaded archetypes', () => {
  assert.deepEqual(deckList({ ...event('Prerelease', '11/07/2026'), loaded: FORMAT }), FORMAT);
  assert.deepEqual(deckList({ ...event('Prerelease', 'not a date'), loaded: FORMAT }), FORMAT);
  assert.deepEqual(deckList({ ...event('Standard', '11/06/2026'), loaded: FORMAT }), FORMAT);
  assert.deepEqual(deckList(event('Standard')), [], 'nothing is offered before they load');
});

test('event decks are merged into the preset list', () => {
  const decks = deckList(event('Gym Leader Challenge', '', ['Grass', 'Custom deck']));
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
});

test('the event’s decks count as played, and ones the format lacks join the list', () => {
  const decks = deckList({ ...event('Standard', '', ['Gardevoir', 'Mono Water', 'Mono Water']), loaded: FORMAT });
  assert.deepEqual(decks, [
    FORMAT[0],
    { label: 'Gardevoir', icons: ['gardevoir'], played: true },
    { label: 'Mono Water', played: true }
  ]);
});

test('every picker on a page shares one list while nothing changes', () => {
  const first = deckList({ ...event('Standard', '', ['Gardevoir']), loaded: FORMAT });
  assert.equal(deckList({ ...event('Standard', '', ['Gardevoir']), loaded: FORMAT }), first);
  assert.notEqual(
    deckList({ ...event('Standard', '', ['Gardevoir', 'Mono Water']), loaded: FORMAT }),
    first,
    'a deck entered makes a new list'
  );
  assert.notEqual(
    deckList({ ...event('Standard', '', ['Gardevoir']), loaded: [...FORMAT] }),
    first,
    'as does a new format list'
  );
});
