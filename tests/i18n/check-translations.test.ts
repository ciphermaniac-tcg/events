import test from 'node:test';
import assert from 'node:assert/strict';

import { checkCatalog, requiredForms, scanSource } from '../../scripts/quality/translations.ts';

const SOURCE = `
import { msg, t, tn, tx } from '../lib/i18n';
const TITLE = msg('Run events');
export function Page(props: { n: number }) {
  return (
    <section aria-label='Players' title={t('Standings')}>
      <h1>{t('Round {round}', { round: 1 })}</h1>
      <p>{tn(props.n, '{n} player', '{n} players')}</p>
      <p>{tx('Read the {terms}', { terms: <a>x</a> })}</p>
      Unwrapped words
      {t(TITLE)}
    </section>
  );
}
function api() { return jsonError('Admins only', 403); }
`;

test('the scan finds every literal key, the plural form of a count, and English left in markup', () => {
  const { keys, unwrapped } = scanSource('Page.tsx', SOURCE);
  assert.deepEqual(
    keys.map(key => [key.key, key.plural]),
    [
      ['Run events', false],
      ['Standings', false],
      ['Round {round}', false],
      ['{n} players', true],
      ['Read the {terms}', false],
      ['Admins only', false]
    ]
  );
  assert.deepEqual(
    unwrapped.map(item => item.text),
    ['Players', 'Unwrapped words']
  );
});

test('generic code in a .ts file is not read as markup', () => {
  const { unwrapped } = scanSource('x.ts', 'const a = <T,>(value: T) => value; const b = f<Words>(c);');
  assert.deepEqual(unwrapped, []);
});

const { keys } = scanSource('Page.tsx', SOURCE);

test('a full, faithful catalog passes, and missing entries are only counted', () => {
  const report = checkCatalog(
    keys,
    { 'Round {round}': 'Ronda {round}', '{n} players': { one: '{n} jugador', other: '{n} jugadores' } },
    requiredForms('es')
  );
  assert.deepEqual(report.stale, []);
  assert.deepEqual(report.broken, []);
  assert.deepEqual(report.missing, ['Run events', 'Standings', 'Read the {terms}', 'Admins only']);
});

test('an entry the code no longer asks for is stale', () => {
  assert.deepEqual(checkCatalog(keys, { 'Round {r}': 'Ronda {r}' }, []).stale, ['Round {r}']);
});

test('a translation that drops or invents a placeholder is broken', () => {
  const report = checkCatalog(keys, { 'Round {round}': 'Ronda', 'Read the {terms}': 'Lee {terminos}' }, []);
  assert.equal(report.broken.length, 2);
});

test('a count needs plural forms with the plural English placeholders only, and plain text needs plain text', () => {
  const required = requiredForms('es');
  assert.deepEqual(required, ['one']);
  assert.equal(checkCatalog(keys, { '{n} players': '{n} jugadores' }, required).broken.length, 1);
  assert.equal(checkCatalog(keys, { '{n} players': { other: '{n} jugadores' } }, required).broken.length, 1);
  assert.equal(checkCatalog(keys, { '{n} players': { one: '{x}', other: '{n}' } }, required).broken.length, 1);
  assert.equal(checkCatalog(keys, { Standings: { other: 'Clasificación' } }, required).broken.length, 1);
});

test('a key in context is the English joined to its context', () => {
  const { keys: found } = scanSource('x.tsx', "tc('league night', 'Off {day}', { day });");
  assert.deepEqual(
    found.map(key => key.key),
    ['Off {day} ‖ league night']
  );
  assert.deepEqual(checkCatalog(found, { 'Off {day} ‖ league night': 'Sin liga el {day}' }, []).broken, []);
});
