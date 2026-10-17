import assert from 'node:assert/strict';
import test from 'node:test';
import { archetypeOfList, rulesFromIndex } from '../../shared/tournament/archetypes';

const rules = rulesFromIndex([
  {
    label: 'Dragapult',
    deckCount: 896,
    signatureCards: [
      { name: 'Dragapult ex', pct: 100 },
      { name: "Rosa's Encouragement", pct: 93 },
      { name: 'Crushing Hammer', pct: 92 },
      { name: 'Crispin', pct: 99 }
    ]
  },
  {
    label: 'Dragapult Dusknoir',
    deckCount: 300,
    signatureCards: [
      { name: 'Dragapult ex', pct: 100 },
      { name: 'Dusknoir', pct: 100 },
      { name: 'Crispin', pct: 93 }
    ]
  },
  {
    label: 'Basic Box',
    deckCount: 382,
    signatureCards: [
      { name: 'Wellspring Mask Ogerpon ex', pct: 98 },
      { name: 'Chien-Pao', pct: 97 },
      { name: 'Area Zero Underdepths', pct: 100 },
      { name: 'Energy Switch', pct: 100 }
    ]
  },
  { label: 'Broken', signatureCards: 'nope' },
  { label: '', signatureCards: [{ name: 'X', pct: 1 }] },
  { label: 'No cards', signatureCards: [{ name: 3 }] }
]);

test('only index entries that read as rules are kept', () => {
  assert.deepEqual(
    rules.map(rule => rule.label),
    ['Dragapult', 'Dragapult Dusknoir', 'Basic Box']
  );
  assert.deepEqual(rulesFromIndex({}), []);
});

test('a list is the archetype whose signature it holds the most of', () => {
  const plain = '3 Dragapult ex TWM 130\n4 Crispin SCR 133\n4 Crushing Hammer POR 71\n2 Rosa’s Encouragement POR 84';
  assert.equal(archetypeOfList(plain, rules), 'Dragapult');
  const dusk = '3 Dragapult ex TWM 130\n2 Dusknoir PRE 37\n4 Crispin SCR 133';
  assert.equal(archetypeOfList(dusk, rules), 'Dragapult Dusknoir');
});

test('one card many decks play is not enough, and a list fitting nothing is nobody’s', () => {
  assert.equal(archetypeOfList('1 Area Zero Underdepths SCR 131\n4 Ultra Ball SVI 196', rules), null);
  assert.equal(archetypeOfList('60 Basic {G} Energy SVE 1', rules), null);
  assert.equal(archetypeOfList('  ', rules), null);
});
