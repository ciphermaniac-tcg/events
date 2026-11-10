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

test('PTCGL promo and gallery codes are read as Limitless files them', () => {
  assert.equal(cardArt({ name: 'Chien-Pao ex', set: 'PR-SV', number: '30' })?.src, `${ART}/SVP/SVP_030_R_EN_SM.webp`);
  assert.equal(cardArt({ name: "Boss's Orders", set: 'PR-SW', number: '251' })?.src, `${ART}/SP/SP_251_R_EN_SM.webp`);
  assert.equal(
    cardArt({ name: "Boss's Orders", set: 'LOR-TG', number: '24' })?.src,
    `${ART}/LOR/LOR_TG24_R_EN_SM.webp`
  );
  assert.equal(cardArt({ name: 'Arven', set: 'SVI', number: 'tg5' })?.src, `${ART}/SVI/SVI_TG05_R_EN_SM.webp`);
  assert.equal(cardArt({ name: 'Ultra Ball', set: '30C', number: '128' })?.src, `${ART}/30C/30C_128_R_EN_SM.webp`);
  assert.equal(cardArt({ name: 'Basic Grass Energy', set: '', number: '' })?.src, `${ART}/SVE/SVE_001_R_EN_SM.webp`);
});

test('a card whose print the list does not give has no art', () => {
  assert.equal(cardArt({ name: 'Mystery Card TG05', set: '', number: '' }), null);
  assert.equal(cardArt({ name: 'Snover', set: 'MEG', number: '' }), null);
  assert.equal(cardArt({ name: 'Arven', set: 'S/VI', number: '166' }), null);
  assert.equal(cardArt({ name: 'Basic {X} Energy', set: '', number: '' }), null);
});

test('a crop frames the art window by section, and Energy by whether it is basic', () => {
  assert.equal(artCrop({ name: 'Dreepy', section: 'pokemon' }), 'pokemon');
  assert.equal(artCrop({ name: 'Arven', section: 'trainer' }), 'trainer');
  assert.equal(artCrop({ name: 'Basic {R} Energy', section: 'energy' }), 'energy-basic');
  assert.equal(artCrop({ name: 'Jet Energy', section: 'energy' }), 'energy-special');
});

test('cards absent from the mirror can use the original PNG at every size', () => {
  const art = cardArt({ name: 'Fezandipiti ex', set: 'ASC', number: '142' }, true);
  const base = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/ASC/ASC_142_R_EN_';
  assert.deepEqual(art, {
    small: `${base}XS.png`,
    src: `${base}SM.png`,
    srcset: `${base}XS.png 136w, ${base}SM.png 274w, ${base}LG.png 460w`,
    large: `${base}LG.png`
  });
});
