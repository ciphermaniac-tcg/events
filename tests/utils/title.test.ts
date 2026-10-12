import assert from 'node:assert/strict';
import test from 'node:test';
import { pageTitle, SITE_NAME } from '../../src/lib/title.ts';

test('a page is titled by its own name, then the site; the home page by the site alone', () => {
  assert.equal(pageTitle('Settings'), 'Settings — Ciphermaniac Events');
  assert.equal(pageTitle(), SITE_NAME);
  assert.equal(pageTitle(''), SITE_NAME);
});
