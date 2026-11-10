import assert from 'node:assert/strict';
import test from 'node:test';
import { ownPath } from '../../src/lib/ownPath.ts';

const ORIGIN = 'https://events.ciphermaniac.com';

test('a path on this site comes back whole', () => {
  assert.equal(ownPath('/t/ABC234/decklist?step=2#deck', ORIGIN), '/t/ABC234/decklist?step=2#deck');
  assert.equal(ownPath('/', ORIGIN), '/');
});

test('anything that leads off the site is refused', () => {
  for (const next of [
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    // The parser strips the leading space, as a browser does; the lint refuses the bare scheme in source.
    ' javascript:alert(1)',
    'https://evil.example/',
    'http://events.ciphermaniac.com/',
    'http://[::1'
  ]) {
    assert.equal(ownPath(next, ORIGIN), null, JSON.stringify(next));
  }
});
