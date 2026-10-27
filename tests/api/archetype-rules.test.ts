import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { _forgetRules, archetypeRules } from '../../functions/lib/tournaments/archetypeRules.ts';

const INDEX = [{ label: 'Dragapult', deckCount: 1, signatureCards: [{ name: 'Dragapult ex', pct: 100 }] }];

afterEach(() => {
  mock.restoreAll();
  _forgetRules();
});

test('the rules are read once for six hours', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json(INDEX));
  assert.equal((await archetypeRules(0)).length, 1);
  assert.equal((await archetypeRules(1000)).length, 1);
  assert.equal(fetch.mock.callCount(), 1);
  await archetypeRules(6 * 60 * 60 * 1000);
  assert.equal(fetch.mock.callCount(), 2);
});

test('an index that cannot be read keeps the last copy, and is not asked again for a while', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json(INDEX));
  await archetypeRules(0);
  fetch.mock.mockImplementation(async () => new Response('down', { status: 503 }));
  const later = 7 * 60 * 60 * 1000;
  assert.equal((await archetypeRules(later)).length, 1, 'the old copy');
  assert.equal((await archetypeRules(later + 1000)).length, 1);
  assert.equal(fetch.mock.callCount(), 2, 'not asked again straight away');
  fetch.mock.mockImplementation(async () => {
    throw new Error('offline');
  });
  _forgetRules();
  assert.deepEqual(await archetypeRules(0), [], 'with no copy, none');
});

test('requests that arrive while the index is read share the one read', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json(INDEX));
  const rules = await Promise.all(Array.from({ length: 5 }, () => archetypeRules(0)));
  assert.ok(rules.every(each => each.length === 1));
  assert.equal(fetch.mock.callCount(), 1);
});
