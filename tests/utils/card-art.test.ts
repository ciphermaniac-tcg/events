import assert from 'node:assert/strict';
import test from 'node:test';

import { artCrop, cardArt } from '../../src/lib/cardArt.ts';

const ART = 'https://r2.ciphermaniac.com/card-images';

test('card art is the R2 copy by set and three-digit number, at three widths', () => {
  const art = cardArt({ name: 'Dreepy', set: 'twm', number: '8' });
  assert.deepEqual(art, {
    small: `${ART}/TWM/TWM_008_R_EN_XS.webp`,
    src: `${ART}/TWM/TWM_008_R_EN_SM.webp`,
    srcset: [
      `${ART}/TWM/TWM_008_R_EN_XS.webp 136w`,
      `${ART}/TWM/TWM_008_R_EN_SM.webp 274w`,
      `${ART}/TWM/TWM_008_R_EN_LG.webp 460w`
    ].join(', '),
    large: `${ART}/TWM/TWM_008_R_EN_LG.webp`
  });
  assert.equal(cardArt({ name: 'Pikachu', set: 'SVP', number: '0027a' })?.large, `${ART}/SVP/SVP_027a_R_EN_LG.webp`);
});

test('basic Energy draws from its Scarlet & Violet print whatever set the list names', () => {
  for (const [name, number] of [
    ['Basic {P} Energy', '005'],
    ['Basic {M} Energy', '008'],
    ['Grass Energy', '001'],
    ['darkness energy', '007']
  ]) {
    assert.equal(cardArt({ name, set: 'Energy', number: '4' })?.src, `${ART}/SVE/SVE_${number}_R_EN_SM.webp`, name);
  }
});

test('a card whose print the list does not give has no art', () => {
  assert.equal(cardArt({ name: 'Mystery Card TG05', set: '', number: '' }), null);
  assert.equal(cardArt({ name: 'Arven', set: 'SVI', number: 'TG05' }), null);
  assert.equal(cardArt({ name: 'Arven', set: 'S/VI', number: '166' }), null);
  assert.equal(cardArt({ name: 'Basic {X} Energy', set: '', number: '' }), null);
});

test('a crop frames the art window by section, and Energy by whether it is basic', () => {
  assert.equal(artCrop({ name: 'Dreepy', section: 'pokemon' }), 'pokemon');
  assert.equal(artCrop({ name: 'Arven', section: 'trainer' }), 'trainer');
  assert.equal(artCrop({ name: 'Basic {R} Energy', section: 'energy' }), 'energy-basic');
  assert.equal(artCrop({ name: 'Jet Energy', section: 'energy' }), 'energy-special');
});
