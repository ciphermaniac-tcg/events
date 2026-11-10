import test from 'node:test';
import assert from 'node:assert/strict';

import { countsFeet, formatTag, localeOf, offeredLocale, pickLocale } from '../../src/lib/i18n/locales.ts';

const signals = (languages: string[], extra: { query?: string; stored?: string } = {}) => ({
  query: extra.query ?? null,
  stored: extra.stored ?? null,
  languages
});

// Spanish, French and German are paused: built and reachable by ?lang=, offered to no one.
test('a browser that asks for a paused language reads English', () => {
  assert.equal(pickLocale(signals(['es-MX', 'en'])), 'en');
  assert.equal(pickLocale(signals(['fr-CA'])), 'en');
  assert.equal(pickLocale(signals(['pt-BR', 'de', 'en'])), 'en');
  assert.equal(pickLocale(signals([])), 'en');
});

test('a named language beats a remembered one, and a paused one is remembered only by name', () => {
  assert.equal(pickLocale(signals(['es'], { stored: 'en' })), 'en');
  assert.equal(pickLocale(signals(['en'], { stored: 'es' })), 'en');
  assert.equal(pickLocale(signals(['en'], { query: 'es', stored: 'en' })), 'es');
  assert.equal(pickLocale(signals(['es'], { stored: 'klingon' })), 'en');
});

test('the footer offers no paused language, and English back to anyone reading another', () => {
  assert.equal(offeredLocale('en', ['en-US', 'es-MX']), null);
  assert.equal(offeredLocale('en', ['en-US', 'fr']), null);
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
