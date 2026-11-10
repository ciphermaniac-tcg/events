import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { _forgetRules, archetypeRules } from '../../functions/lib/tournaments/archetypeRules.ts';
import { deferred, never } from '../__utils__/deferred.ts';

const INDEX = {
  rules: [{ identifier: 'dragapult-ex', name: 'Dragapult', priority: 11, cards: [{ name: 'Dragapult ex', count: 2 }] }]
};

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  _forgetRules();
});

test('the rules are read once for six hours', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json(INDEX));
  assert.equal((await archetypeRules(0)).length, 1);
  assert.equal((await archetypeRules(1000)).length, 1);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(String(fetch.mock.calls[0]?.arguments[0]), 'https://r2.ciphermaniac.com/limitless/deck-rules.json');
  await archetypeRules(6 * 60 * 60 * 1000);
  assert.equal(fetch.mock.callCount(), 2);
});

test('rules that cannot be read keep the last copy, and is not asked again for a while', async () => {
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

test('requests that arrive while the rules are read share the one read', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json(INDEX));
  const rules = await Promise.all(Array.from({ length: 5 }, () => archetypeRules(0)));
  assert.ok(rules.every(each => each.length === 1));
  assert.equal(fetch.mock.callCount(), 1);
});

test('a caller waiting on a never-settling fetch retries within a bounded wait', { timeout: 1000 }, async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = mock.method(globalThis, 'fetch', () => never<Response>());
  void archetypeRules(0);
  const later = archetypeRules(1000);
  assert.equal(fetch.mock.callCount(), 1, 'the later request initially shares the read');
  mock.timers.tick(2999);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => Response.json(INDEX));
  mock.timers.tick(1);
  assert.equal((await later).length, 1, 'the later request resolves without the first fetch settling');
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal((await archetypeRules(2000)).length, 1);
  assert.equal(fetch.mock.callCount(), 2, 'the replacement populated the cache');
});

test('concurrent joiners share the replacement of a stuck fetch', { timeout: 1000 }, async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = mock.method(globalThis, 'fetch', () => never<Response>());
  void archetypeRules(0);
  const joined = Array.from({ length: 5 }, () => archetypeRules(1000));
  fetch.mock.mockImplementation(async () => Response.json(INDEX));
  mock.timers.tick(3000);
  const rules = await Promise.all(joined);
  assert.ok(rules.every(each => each.length === 1));
  assert.equal(fetch.mock.callCount(), 2);
});

test('settling an abandoned read cannot clear its pending replacement', { timeout: 1000 }, async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred<Response>();
  const replacement = deferred<Response>();
  const fetch = mock.method(globalThis, 'fetch', () => first.promise);
  const original = archetypeRules(0);
  const later = archetypeRules(1000);
  fetch.mock.mockImplementation(() => replacement.promise);
  mock.timers.tick(3000);
  first.resolve(Response.json(INDEX));
  await original;
  // Expire the original's cache to observe whether the replacement is still shared.
  const next = archetypeRules(6 * 60 * 60 * 1000);
  assert.equal(fetch.mock.callCount(), 2);
  replacement.resolve(Response.json(INDEX));
  await Promise.all([later, next]);
});

test('a failed refresh retains old rules for five minutes before retrying', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json(INDEX));
  await archetypeRules(0);
  const expired = 6 * 60 * 60 * 1000;
  fetch.mock.mockImplementation(async () => new Response('down', { status: 503 }));
  assert.equal((await archetypeRules(expired)).length, 1);
  assert.equal((await archetypeRules(expired + 5 * 60 * 1000 - 1)).length, 1);
  assert.equal(fetch.mock.callCount(), 2);
  fetch.mock.mockImplementation(async () => Response.json({ rules: [] }));
  assert.deepEqual(await archetypeRules(expired + 5 * 60 * 1000), []);
  assert.equal(fetch.mock.callCount(), 3);
});

test('an unreadable response falls back to no rules and retries after five minutes', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => new Response('invalid json'));
  assert.deepEqual(await archetypeRules(0), []);
  assert.deepEqual(await archetypeRules(5 * 60 * 1000 - 1), []);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => Response.json(INDEX));
  assert.equal((await archetypeRules(5 * 60 * 1000)).length, 1);
  assert.equal(fetch.mock.callCount(), 2);
});

for (const outcome of ['success', 'failure'] as const) {
  test(`a late abandoned ${outcome} cannot overwrite the newer cache`, { timeout: 1000 }, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const first = deferred<Response>();
    const fetch = mock.method(globalThis, 'fetch', () => first.promise);
    const original = archetypeRules(0);
    const later = archetypeRules(1000);
    const freshIndex = { rules: [{ ...INDEX.rules[0], name: 'Fresh rules' }] };
    fetch.mock.mockImplementation(async () => Response.json(freshIndex));
    mock.timers.tick(3000);
    const fresh = await later;
    first.resolve(outcome === 'success' ? Response.json(INDEX) : new Response('down', { status: 503 }));
    await original;
    assert.deepEqual(await archetypeRules(2000), fresh, 'the newer rules remain cached');
    assert.deepEqual(await archetypeRules(1000 + 5 * 60 * 1000), fresh, 'a late failure cannot shorten the cache');
    assert.equal(fetch.mock.callCount(), 2);
    await archetypeRules(1000 + 6 * 60 * 60 * 1000 - 1);
    assert.equal(fetch.mock.callCount(), 2, 'the newer read keeps its six-hour lifetime');
    await archetypeRules(1000 + 6 * 60 * 60 * 1000);
    assert.equal(fetch.mock.callCount(), 3);
  });
}
