/**
 * A deck typed as two Pokémon (src/pages/live/deckPairs.ts): the site's own
 * archetypes lead, a pair the site already names is offered as that archetype
 * once, the rest are new pairs saved under their sorted label, and any query
 * that doesn't open with a whole Pokémon is left to the usual ranking.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SUGGESTION_LIMIT } from '@ciphermaniac/design/lib/rankByQuery';
import * as species from '../../shared/pokemon/species.ts';
import { pairSearch } from '../../src/pages/live/deckPairs.ts';

const RANKING = { weight: () => 0, tier: () => 0 };
const DECKS = [{ label: 'Dragapult Dusknoir' }, { label: 'Dragapult' }, { label: 'Gardevoir' }];

test('a query that does not open with a whole Pokémon is left to the ranking', () => {
  assert.equal(pairSearch(DECKS, 'Drag', species, RANKING), undefined);
});

test('the named archetype leads, and its pair is not offered a second time', () => {
  const list = pairSearch(DECKS, 'Dragapult D', species, RANKING) ?? [];
  assert.equal(list[0]?.label, 'Dragapult Dusknoir');
  assert.equal(list.filter(deck => deck.label.includes('Dusknoir')).length, 1);
});

test('a new pair keeps the order typed and is saved under its sorted label', () => {
  const list = pairSearch(DECKS, 'Dragapult D', species, RANKING) ?? [];
  const darkrai = list.find(deck => deck.label === 'Dragapult Darkrai');
  assert.deepEqual(darkrai, { label: 'Dragapult Darkrai', pair: 'Darkrai Dragapult' });
});

test('the list stops at the suggestion limit', () => {
  const list = pairSearch(DECKS, 'Dragapult ', species, RANKING) ?? [];
  assert.equal(list.length, SUGGESTION_LIMIT);
});
