import test from 'node:test';
import assert from 'node:assert/strict';

import { countsFeet, formatTag, localeOf, offeredLocale, pickLocale } from '../../src/lib/i18n/locales.ts';

const signals = (languages: string[], extra: { query?: string; stored?: string } = {}) => ({
  query: extra.query ?? null,
  stored: extra.stored ?? null,
  languages
});

test('a browser that puts Spanish first reads Spanish, whatever the region', () => {
  assert.equal(pickLocale(signals(['es-MX', 'en'])), 'es');
  assert.equal(pickLocale(signals(['es-419'])), 'es');
  assert.equal(pickLocale(signals(['ES_es'])), 'es');
});

test('English stays first for a browser that lists it before another language, or lists none the site speaks', () => {
  assert.equal(pickLocale(signals(['en-US', 'es'])), 'en');
  assert.equal(pickLocale(signals(['pt-BR', 'ja'])), 'en');
  assert.equal(pickLocale(signals([])), 'en');
});

test('an unsupported first language passes to the next one the site speaks', () => {
  assert.equal(pickLocale(signals(['pt-BR', 'es', 'en'])), 'es');
});

test('French and German browsers read their own language, wherever they are', () => {
  assert.equal(pickLocale(signals(['fr-CA', 'en'])), 'fr');
  assert.equal(pickLocale(signals(['de-AT'])), 'de');
  assert.equal(pickLocale(signals(['de-CH', 'fr-CH'])), 'de');
  assert.equal(pickLocale(signals(['pt-BR', 'fr', 'en'])), 'fr');
});

test('a named language beats a remembered one, which beats the browser', () => {
  assert.equal(pickLocale(signals(['es'], { stored: 'en' })), 'en');
  assert.equal(pickLocale(signals(['en'], { stored: 'es' })), 'es');
  assert.equal(pickLocale(signals(['en'], { query: 'es', stored: 'en' })), 'es');
  assert.equal(pickLocale(signals(['es'], { stored: 'klingon' })), 'es');
});

test('the footer offers another language only to someone whose browser lists it, and English back to anyone reading another', () => {
  assert.equal(offeredLocale('en', ['en-US', 'es-MX']), 'es');
  assert.equal(offeredLocale('en', ['en-US', 'fr']), 'fr');
  assert.equal(offeredLocale('en', ['en-US', 'ja']), null);
  assert.equal(offeredLocale('en', ['en-US']), null);
  assert.equal(offeredLocale('es', ['es-MX']), 'en');
});

test('dates follow the browser variant of the language shown, never another language', () => {
  assert.equal(formatTag('es', ['en-US', 'es-MX']), 'es-MX');
  assert.equal(formatTag('en', ['es-MX', 'en-GB']), 'en-GB');
  assert.equal(formatTag('en', ['es-MX']), 'en');
});

test('localeOf reads the language out of any tag', () => {
  assert.equal(localeOf('es-AR'), 'es');
  assert.equal(localeOf(' EN '), 'en');
  assert.equal(localeOf('pt'), null);
  assert.equal(localeOf(''), null);
});

test('a room is measured in feet only where the reader’s country counts in them', () => {
  for (const tag of ['en', 'en-US', 'es-US']) {
    assert.equal(countsFeet(tag), true, tag);
  }
  for (const tag of ['en-GB', 'es', 'es-MX', 'fr', 'fr-CA', 'de-AT']) {
    assert.equal(countsFeet(tag), false, tag);
  }
  assert.equal(countsFeet('not a tag'), true);
});
