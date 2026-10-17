import assert from 'node:assert/strict';
import test from 'node:test';
import { currencyOf, formatFee } from '../../src/lib/events/format';

test('an event takes its fee in its country’s currency, US dollars when unknown', () => {
  assert.equal(currencyOf('SV'), 'USD');
  assert.equal(currencyOf('br'), 'BRL');
  assert.equal(currencyOf(''), 'USD');
  assert.equal(currencyOf('ZZ'), 'USD');
});

test('a fee shows in its currency', () => {
  assert.equal(formatFee(10, 'US'), '$10.00');
  assert.match(formatFee(25, 'BR'), /R\$\s?25\.00/);
});
