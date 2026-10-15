/** The home page's TOM file reader is the shared one, loaded on its own. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseTdf as shared } from '../../shared/tournament/tdf';
import { parseTdf } from '../../src/pages/tournaments/tdfReader';

test('the reader the home page loads on a pick is the shared TOM file reader', () => {
  assert.equal(parseTdf, shared);
  const source = readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8');
  assert.equal(parseTdf(source).info.name, 'Fixture Challenge & Friends');
});
