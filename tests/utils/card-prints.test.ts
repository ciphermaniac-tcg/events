/**
 * The main site's print index: an alternate art draws as the print it counts
 * as, a Trainer or Energy by its name alone, and a Pokémon only when its set
 * leaves one card to be.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalArt, canonicalId, printIndex } from '../../src/lib/cardPrints.ts';

const FILE = {
  synonyms: {
    "Boss's Orders::PAL::265": "Boss's Orders::MEG::114",
    'Snover::MEG::140': 'Snover::MEG::035',
    'Charmander::MEW::168': 'Charmander::MEW::004'
  },
  canonicals: { "Boss's Orders": "Boss's Orders::MEG::114", 'Pokégear 3.0': 'Pokégear 3.0::BLK::084' },
  prints: {
    "Boss's Orders::PAL::265": 1,
    "Boss's Orders::MEG::114": 1,
    'Snover::MEG::035': 1,
    'Snover::MEG::140': 1,
    'Charmander::MEW::004': 1,
    'Charmander::MEW::168': 1,
    'Charmander::PAF::007': 1,
    'Charmander::PAF::109': 1
  }
};
const index = printIndex(FILE);

test('an alternate art draws as the print it counts as', () => {
  assert.equal(
    canonicalId(index, { name: 'Boss’s Orders', set: 'PAL', number: '265', section: 'trainer' }),
    "Boss's Orders::MEG::114"
  );
});

test('a Trainer draws by its name alone, whatever print the list gives', () => {
  for (const [set, number] of [
    ['', ''],
    ['SMALT', '154']
  ]) {
    assert.equal(
      canonicalId(index, { name: 'pokegear 3.0', set, number, section: 'trainer' }),
      'Pokégear 3.0::BLK::084'
    );
  }
});

test('a Pokémon draws by name only when its set leaves one card to be', () => {
  assert.equal(canonicalId(index, { name: 'Snover', set: 'MEG', number: '', section: 'pokemon' }), 'Snover::MEG::035');
  assert.equal(canonicalId(index, { name: 'Charmander', set: 'PAF', number: '', section: 'pokemon' }), undefined);
  assert.equal(canonicalId(index, { name: 'Charmander', set: 'SVALT', number: '170', section: 'pokemon' }), undefined);
  assert.equal(canonicalId(index, { name: 'Snover', set: '', number: '', section: 'pokemon' }), undefined);
});

test('the index is fetched once, and a failed fetch is asked again', async () => {
  const real = globalThis.fetch;
  let asked = 0;
  const answers = [new Response('', { status: 503 }), Response.json(FILE)];
  globalThis.fetch = () => {
    asked += 1;
    return Promise.resolve(answers.shift()!);
  };
  try {
    const boss = { name: "Boss's Orders", set: '', number: '', section: 'trainer' } as const;
    assert.equal(await canonicalArt(boss), null);
    assert.match((await canonicalArt(boss))?.src ?? '', /\/MEG\/MEG_114_R_EN_SM\.webp$/);
    assert.equal(await canonicalArt({ name: 'Nobody', set: '', number: '', section: 'trainer' }), null);
    assert.equal(asked, 2);
  } finally {
    globalThis.fetch = real;
  }
});
