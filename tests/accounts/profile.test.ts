import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readProfileLinks, validProfileLink } from '../../shared/accounts/profile.ts';

test('profile links are optional, trimmed, and restricted to their platform', () => {
  assert.deepEqual(readProfileLinks({ instagram: ' https://www.instagram.com/reese/ ', facebook: '' }), {
    instagram: 'https://www.instagram.com/reese/'
  });
  assert.deepEqual(
    readProfileLinks({ metafy: 'https://metafy.gg/@reese', ciphermaniac: 'https://ciphermaniac.com/players/45677' }),
    {
      metafy: 'https://metafy.gg/@reese',
      ciphermaniac: 'https://ciphermaniac.com/players/45677'
    }
  );
  for (const value of [null, [], 'links', { unknown: 'https://example.com' }, { twitter: 5 }]) {
    assert.equal(readProfileLinks(value), null);
  }
  for (const value of [
    'not a URL',
    ['javascript', 'alert(1)'].join(':'),
    'http://x.com/reese',
    'https://x.com.evil.test/reese',
    'https://user:pass@x.com/reese',
    'https://x.com:444/reese',
    'https://x.com/',
    `https://x.com/${'a'.repeat(512)}`
  ]) {
    assert.equal(validProfileLink('twitter', value), false, value);
  }
  assert.equal(validProfileLink('ciphermaniac', 'https://ciphermaniac.com/players/reese'), false);
  assert.equal(validProfileLink('metafy', 'https://metafy.gg/@reese'), true);
  assert.equal(validProfileLink('twitter', 'https://twitter.com/reese'), true);
  assert.equal(validProfileLink('twitter', ''), true);
});
