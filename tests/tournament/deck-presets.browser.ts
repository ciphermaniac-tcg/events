/**
 * The Players tab's deck picker list as the page makes it: presets need no
 * load, a format's archetypes arrive once they have, and the event's decks
 * join either.
 *
 * Run by deck-presets.test.ts under the browser build of solid-js, the one the
 * site ships; the server build the test runner resolves cannot make a resource.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoot, createSignal } from 'solid-js';

import { createDeckOptions } from '../../src/pages/tournaments/deckPresets.ts';

const ONLINE = [{ name: 'dragapult ex', label: 'Dragapult ex', deckCount: 40, percent: 0.2, icons: ['dragapult'] }];

const event = (format: string, decks: Record<string, string> = {}) => ({
  settings: { format },
  tournament: { info: { startDate: '' } },
  decks
});

test('a format with presets offers them at once, with the event’s decks laid over them', () => {
  createRoot(dispose => {
    const [manage, setManage] = createSignal(event('Gym Leader Challenge'));
    const decks = createDeckOptions(manage);
    assert.equal(decks().length, 11);
    setManage(event('Gym Leader Challenge', { p1: 'Custom deck' }));
    assert.deepEqual(decks().at(-1), { label: 'Custom deck', played: true });
    dispose();
  });
});

test('Standard offers nothing until its archetypes load, then them', async t => {
  t.mock.method(console, 'warn', () => undefined);
  globalThis.fetch = (async (url: string | URL | Request) =>
    decodeURIComponent(String(url)).endsWith('/Online - Last 14 Days/archetypes/index.json')
      ? Response.json(ONLINE)
      : new Response('not found', { status: 404 })) as typeof fetch;
  await createRoot(async dispose => {
    const decks = createDeckOptions(() => event('Standard'));
    assert.deepEqual(decks(), []);
    for (let tick = 0; tick < 200 && decks().length === 0; tick += 1) {
      await new Promise(resolve => {
        setTimeout(resolve, 5);
      });
    }
    assert.equal(decks()[0]?.label, 'Dragapult ex');
    dispose();
  });
});
