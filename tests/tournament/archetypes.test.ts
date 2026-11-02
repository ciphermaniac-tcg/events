import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { archetypeOfList, rulesFromPublished } from '../../shared/tournament/archetypes';

/** Real Play! Limitless rules, as the main site publishes them (trimmed from a November 2026 copy). */
const rules = rulesFromPublished(
  JSON.parse(readFileSync(new URL('../fixtures/limitless/deck-rules.json', import.meta.url), 'utf8'))
);

const DRAGAPULT_DUSKNOIR = `Pokémon: 20
4 Dreepy TWM 128
4 Drakloak TWM 129
2 Dragapult ex TWM 130
2 Duskull SFA 18
2 Dusclops SFA 19
1 Dusknoir SFA 20
1 Fezandipiti ex SFA 38

Trainer: 32
4 Arven SVI 166
4 Ultra Ball MEG 131

Energy: 8
5 Basic {R} Energy SVE 2
3 Basic {P} Energy SVE 5`;

test('the published rules read in, and anything that is not a rule is left out', () => {
  assert.equal(rules.length, 8);
  const dragapult = rules.find(rule => rule.identifier === 'dragapult-ex');
  assert.deepEqual(dragapult?.cards, [{ name: 'Dragapult ex', count: 2 }]);
  assert.equal(dragapult?.priority, 11);
  assert.ok(dragapult?.variants.some(variant => variant.name === 'Dragapult Dusknoir'));
  const loose = rulesFromPublished({
    rules: [
      { identifier: 'ok', name: 'Ok', cards: [{ name: 'Pikachu', count: 1 }] },
      {
        identifier: 'half',
        name: 'Half',
        cards: [
          { name: 'Pikachu', count: 1 },
          { name: 'Raichu', count: 'two' }
        ]
      },
      { identifier: '', name: 'No id', cards: [{ name: 'Pikachu', count: 1 }] },
      { identifier: 'none', name: 'No cards', cards: [] },
      {
        identifier: 'parent',
        name: 'Parent',
        priority: 3,
        icons: ['pikachu', 4],
        cards: [{ name: 'Pikachu', count: 2, set: ' ', number: '' }],
        variants: [{ identifier: 'v', name: 'V' }, 'nope']
      },
      'nope'
    ]
  });
  assert.deepEqual(loose, [
    { identifier: 'ok', name: 'Ok', icons: [], cards: [{ name: 'Pikachu', count: 1 }], priority: 10, variants: [] },
    {
      identifier: 'parent',
      name: 'Parent',
      icons: ['pikachu'],
      cards: [{ name: 'Pikachu', count: 2 }],
      priority: 3,
      variants: []
    }
  ]);
  assert.deepEqual(rulesFromPublished(null), []);
  assert.deepEqual(rulesFromPublished({ rules: 'nope' }), []);
});

test('a list takes the first rule it holds, then the first of its variants', () => {
  assert.equal(archetypeOfList(DRAGAPULT_DUSKNOIR, rules), 'Dragapult Dusknoir');
  assert.equal(archetypeOfList('3 Dreepy TWM 128\n3 Dragapult ex TWM 130', rules), 'Dragapult');
});

test('a rule holds its cards at their count, summed across prints', () => {
  assert.equal(archetypeOfList('1 Dragapult ex TWM 130', rules), null, 'Dragapult takes two');
  assert.equal(archetypeOfList('1 Dragapult ex TWM 130\n1 Dragapult ex PRE 73', rules), 'Dragapult');
});

test('a lower priority is tried first, whatever order the rules came in', () => {
  // Gholdengo (priority 10) is read before Dragapult (11), and a Gholdengo list with Dragapult in it is its variant.
  const both = '3 Gholdengo ex PAR 139\n2 Dragapult ex TWM 130';
  assert.equal(archetypeOfList(both, rules), 'Gholdengo Dragapult');
  assert.equal(archetypeOfList(both, [...rules].reverse()), 'Gholdengo Dragapult');
});

test('a card the rule names by set or number counts only in that print', () => {
  const comfey = (set: string) => `4 Comfey ${set} 79\n1 Radiant Charizard PGO 11`;
  assert.equal(archetypeOfList(comfey('LOR'), rules), 'Lost Box Charizard');
  assert.equal(archetypeOfList(comfey('SFA'), rules), null);
  const cinccino = (bunnelby: string) => `3 Cinccino SSH 229\n2 Bunnelby PRC ${bunnelby}`;
  assert.equal(archetypeOfList(cinccino('121'), rules), 'Cinccino Control');
  assert.equal(archetypeOfList(cinccino('0121'), rules), 'Cinccino Control', 'a leading zero is the same print');
  assert.equal(archetypeOfList(cinccino('120'), rules), null);
  const numbered = rulesFromPublished({
    rules: [{ identifier: 'n', name: 'Numbered', cards: [{ name: 'Unown', count: 1, number: '91' }] }]
  });
  assert.equal(archetypeOfList('1 Unown LOT 91', numbered), 'Numbered', 'a number with no set, in any set');
  assert.equal(archetypeOfList('1 Unown LOT 90', numbered), null);
});

test('names match whatever their case, accents and apostrophes', () => {
  assert.equal(archetypeOfList('2 DRAGAPULT EX TWM 130', rules), 'Dragapult');
  const rosa = rulesFromPublished({
    rules: [{ identifier: 'r', name: 'Rosa', cards: [{ name: "Rosa's Encouragement", count: 1 }] }]
  });
  assert.equal(archetypeOfList('1 Rosa’s Encouragement POR 84', rosa), 'Rosa');
  const flabebe = rulesFromPublished({
    rules: [{ identifier: 'f', name: 'Flabébé', cards: [{ name: 'Flabébé', count: 1 }] }]
  });
  assert.equal(archetypeOfList('1 Flabebe PAR 77', flabebe), 'Flabébé');
});

test('a list that fits no rule is nobody’s', () => {
  assert.equal(archetypeOfList('60 Basic {G} Energy SVE 1', rules), null);
  assert.equal(archetypeOfList('  ', rules), null);
  assert.equal(archetypeOfList(DRAGAPULT_DUSKNOIR, []), null);
});
