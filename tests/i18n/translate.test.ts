import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  locale,
  ordinalSuffix,
  setTranslations,
  t,
  tc,
  tn,
  translateMessage,
  tx
} from '../../src/lib/i18n/translate.ts';
import { ordinal } from '../../src/lib/format.ts';

afterEach(() => setTranslations('en', {}));

test('English passes through, its placeholders filled', () => {
  assert.equal(t('Round {round} of {total}', { round: 2, total: 5 }), 'Round 2 of 5');
  assert.equal(t('Start round'), 'Start round');
  assert.equal(locale(), 'en');
});

test('a catalog answers in its own word order, and a missing entry falls back to the English', () => {
  setTranslations('es', { 'Round {round} of {total}': 'Ronda {round} de {total}' });
  assert.equal(t('Round {round} of {total}', { round: 2, total: 5 }), 'Ronda 2 de 5');
  assert.equal(t('Start round'), 'Start round');
  assert.equal(locale(), 'es');
});

test('a placeholder without a value is left showing rather than emptied', () => {
  assert.equal(t('Hello {name}'), 'Hello {name}');
  assert.equal(t('Hello {name}', {}), 'Hello {name}');
});

test('counts pick the form by the language rules', () => {
  assert.equal(tn(1, '{n} player', '{n} players'), '1 player');
  assert.equal(tn(0, '{n} player', '{n} players'), '0 players');
  setTranslations('es', { '{n} players': { one: '{n} jugador', other: '{n} jugadores' } });
  assert.equal(tn(1, '{n} player', '{n} players'), '1 jugador');
  assert.equal(tn(4, '{n} player', '{n} players'), '4 jugadores');
  // Spanish uses "many" for round millions; without one, "other" stands.
  assert.equal(tn(1_000_000, '{n} player', '{n} players'), '1000000 jugadores');
  setTranslations('fr', { '{n} players': { one: '{n} joueur', other: '{n} joueurs' } });
  assert.equal(tn(0, '{n} player', '{n} players'), '0 joueur');
});

test('a count whose entry is plain text falls back to English rather than ignore the count', () => {
  setTranslations('es', { '{n} players': '{n} jugadores' });
  assert.equal(tn(1, '{n} player', '{n} players'), '1 player');
});

test('markup lands wherever the translation puts it', () => {
  const link = { link: true } as unknown as Element;
  assert.deepEqual(tx('Read the {terms} first', { terms: link }), ['Read the ', link, ' first']);
  setTranslations('es', { 'Read the {terms} first': 'Primero lee {terms}' });
  assert.deepEqual(tx('Read the {terms} first', { terms: link }), ['Primero lee ', link, '']);
});

test('placements read as each language writes them', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 103, 1699].map(ordinal), [
    '1st',
    '2nd',
    '3rd',
    '4th',
    '11th',
    '12th',
    '13th',
    '21st',
    '22nd',
    '103rd',
    '1699th'
  ]);
  setTranslations('es', {});
  assert.deepEqual([1, 2, 22].map(ordinal), ['1.º', '2.º', '22.º']);
  setTranslations('fr', {});
  assert.deepEqual([1, 2].map(ordinal), ['1er', '2e']);
  assert.equal(ordinalSuffix(-1), 'er');
  setTranslations('de', {});
  assert.deepEqual([1, 22].map(ordinal), ['1.', '22.']);
});

test('the same English in two senses gets a translation for each', () => {
  assert.equal(tc('league night', 'Off'), 'Off');
  setTranslations('es', { Off: 'Apagado', 'Off ‖ league night': 'Sin liga' });
  assert.equal(tc('league night', 'Off'), 'Sin liga');
  assert.equal(t('Off'), 'Apagado');
  assert.equal(tc('toggle', 'Off'), 'Off');
});

test('a message the API filled in is matched back to its key, its values translated too', () => {
  assert.equal(translateMessage('Round 3 is the current round'), 'Round 3 is the current round');
  setTranslations('es', {
    'Admins only': 'Solo administradores',
    'Round {round} is the current round': 'La ronda {round} es la actual',
    'The {division} top cut (1.5) has started': 'Ya empezó el top cut (1.5) de {division}',
    Masters: 'Máster'
  });
  assert.equal(translateMessage('Admins only'), 'Solo administradores');
  assert.equal(translateMessage('Round 3 is the current round'), 'La ronda 3 es la actual');
  assert.equal(translateMessage('The Masters top cut (1.5) has started'), 'Ya empezó el top cut (1.5) de Máster');
  assert.equal(translateMessage('Something new'), 'Something new');
  assert.equal(translateMessage('Round 3 is the current round, really'), 'Round 3 is the current round, really');
});
