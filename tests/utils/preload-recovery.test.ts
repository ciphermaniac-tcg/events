/**
 * Recovery from a lazy chunk that a deploy removed.
 *
 * The DOM side is a listener and a reload; the part worth pinning is the
 * guard, since getting it wrong means either a blank route (never reload) or a
 * reload loop (always reload).
 */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
  installPreloadRecovery,
  isRecoveringPreload,
  RELOAD_GUARD_MS,
  shouldReloadAfterPreloadError,
  warmChunks
} from '../../src/lib/preloadRecovery.ts';

const NOW = 1_800_000_000_000;

test('a preload failure reloads unless the last reload was within the guard window', () => {
  const cases = [
    ['the first preload failure reloads', null, true],
    ['a second failure straight after the reload does not loop', NOW - 1_000, false],
    ['a failure just inside the guard does not loop', NOW - (RELOAD_GUARD_MS - 1), false],
    // A failure long after the last reload is a new deploy.
    ['a failure at the guard edge reloads again', NOW - RELOAD_GUARD_MS, true],
    ['a failure an hour later reloads again', NOW - 60 * 60_000, true],
    ['unreadable guard state reloads rather than giving up', Number.NaN, true]
  ] as const;
  for (const [name, lastReload, expected] of cases) {
    assert.equal(shouldReloadAfterPreloadError(lastReload, NOW), expected, name);
  }
});

/** A browser for the listener: session storage, a counted reload, and a site that answers or doesn't. */
function fakeBrowser(t: TestContext, remembered: Map<string, string>, answers: () => Promise<Response>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  const seen = { reloads: 0, recoveringAtReload: false, probes: [] as RequestInit[] };
  const browser = Object.assign(target, {
    sessionStorage: {
      getItem: (key: string) => remembered.get(key) ?? null,
      setItem: (key: string, value: string) => remembered.set(key, value)
    },
    location: {
      reload() {
        seen.reloads += 1;
        seen.recoveringAtReload = isRecoveringPreload();
      }
    },
    requestIdleCallback: (run: () => void) => run()
  });
  Object.defineProperty(globalThis, 'window', { value: browser, configurable: true });
  t.after(() => {
    if (original) {
      Object.defineProperty(globalThis, 'window', original);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    seen.probes.push(init);
    return answers();
  });
  installPreloadRecovery();
  /** Fires a preload failure and lets the probe settle. */
  const fail = async () => {
    const event = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(event);
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
    return event;
  };
  return { seen, fail };
}

test('only an accepted recovery marks the boundary as loading, and reloads once the site answers', async t => {
  const remembered = new Map<string, string>([['cm:preload-reload', String(NOW - 1000)]]);
  const { seen, fail } = fakeBrowser(t, remembered, () => Promise.resolve(new Response('shell')));
  const blocked = await fail();
  assert.equal(blocked.defaultPrevented, false);
  assert.equal(isRecoveringPreload(), false);
  assert.equal(seen.reloads, 0);
  assert.equal(seen.probes.length, 0);
  remembered.clear();
  const accepted = await fail();
  assert.equal(accepted.defaultPrevented, true);
  assert.equal(seen.probes[0]?.cache, 'no-store');
  assert.equal(seen.reloads, 1);
  assert.equal(seen.recoveringAtReload, true);
  assert.equal(remembered.get('cm:preload-reload'), String(NOW));
});

test('a chunk that failed with the site out of reach does not reload into the offline page', async t => {
  const remembered = new Map<string, string>();
  for (const answers of [
    () => Promise.reject(new TypeError('Failed to fetch')),
    () => Promise.resolve(new Response('', { status: 503 }))
  ]) {
    const { seen, fail } = fakeBrowser(t, remembered, answers);
    const failed = await fail();
    assert.equal(failed.defaultPrevented, true);
    assert.equal(seen.reloads, 0);
    // The boundary shows its error, and the next failure is free to try again.
    assert.equal(isRecoveringPreload(), false);
    assert.equal(remembered.size, 0);
  }
});

test('a chunk fetched ahead of need fails quietly, without a reload', async t => {
  const remembered = new Map<string, string>();
  const { seen, fail } = fakeBrowser(t, remembered, () => Promise.resolve(new Response('shell')));
  let failed: Event | undefined;
  warmChunks([
    async () => {
      failed = await fail();
      throw new TypeError('Failed to fetch dynamically imported module');
    }
  ]);
  await new Promise(resolve => {
    setTimeout(resolve, 10);
  });
  assert.equal(failed?.defaultPrevented, false);
  assert.equal(seen.reloads, 0);
  // Once the warming is over, a failure the page asked for recovers as before.
  await fail();
  assert.equal(seen.reloads, 1);
});
