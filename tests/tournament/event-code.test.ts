/** What the player's door reads as an event code: a code, a path, or a link, and nothing else. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { eventCodeIn } from '../../shared/tournament/eventCode.ts';

test('reads a code from a bare code, a path, or a pasted link', () => {
  assert.equal(eventCodeIn(' k7rw2p '), 'K7RW2P');
  assert.equal(eventCodeIn('/t/49G96T'), '49G96T');
  assert.equal(eventCodeIn('https://events.ciphermaniac.com/t/49g96t?tab=standings#x'), '49G96T');
});

test('refuses anything that is not a code', () => {
  assert.equal(eventCodeIn('https://example.com/49G96T'), null);
  assert.equal(eventCodeIn('https://example.com/t/49G96T'), null, 'another site’s /t/ path');
  assert.equal(eventCodeIn('localhost:4173/t/49G96T', 'localhost:4173'), '49G96T');
  assert.equal(eventCodeIn('events.ciphermaniac.com/t/49G96T'), '49G96T');
  assert.equal(eventCodeIn('K7RW2'), null);
  assert.equal(eventCodeIn('K0RW2P'), null);
  assert.equal(eventCodeIn('/t/'), null);
});
