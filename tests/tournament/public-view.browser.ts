/**
 * The public event page's copy of the event: the published file first, the
 * API for who a signed-in viewer is, a copy older than the one shown never
 * taken (though what it says of the viewer is), and with no signal the copy
 * this device last saw, shown as behind.
 *
 * Run by public-event-state.test.ts under the browser build of solid-js, the
 * one the site ships; the server build the test runner resolves runs no effects.
 */

import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { createRoot } from 'solid-js';

import type { PublishedView, TournamentView, Viewer } from '../../shared/tournament/view.ts';
import { announceChange } from '../../src/lib/tournament/changes.ts';
import { keepEventCopy } from '../../src/lib/tournament/eventCopies.ts';
import { createView } from '../../src/pages/tournaments/publicView.ts';

/** The page's document and window, with what listens to them. */
const listening = new Set<() => void>();
const target = {
  hidden: false,
  addEventListener: (_: string, listener: () => void) => listening.add(listener),
  removeEventListener: (_: string, listener: () => void) => listening.delete(listener)
};
Object.assign(globalThis, { document: target, window: target });

const NOBODY: Viewer = { role: null, me: null, via: null, signedIn: false };
const PLAYER: Viewer = { role: null, me: 'p1', via: 'claim', signedIn: true };

const published = (version: number, code = 'EVENT1') =>
  ({
    code,
    version,
    updatedAt: 0,
    mode: 'swiss',
    settings: { finished: false, deckVisibility: 'off' },
    tournament: { pods: [] },
    decks: {}
  }) as unknown as PublishedView;
const withViewer = (view: PublishedView, viewer: Viewer): TournamentView => ({ ...view, viewer });

/** Answers the published file and the API as the test says, and counts what each was asked. */
function server(answers: { file?: () => Promise<Response>; api?: () => Promise<Response> }): {
  file: () => number;
  api: () => number;
} {
  const fetches = mock.method(globalThis, 'fetch', (url: string) =>
    url.startsWith('/api/')
      ? (answers.api ?? (async () => Response.json({ error: 'Down' }, { status: 503 })))()
      : (answers.file ?? (async () => new Response(null, { status: 404 })))()
  );
  const count = (api: boolean) =>
    fetches.mock.calls.filter(call => String(call.arguments[0]).startsWith('/api/') === api).length;
  return { file: () => count(false), api: () => count(true) };
}

/** Lets every answer under way land, and the effects they start run. */
async function settled(until: () => boolean = () => true) {
  for (let i = 0; i < 50 && !until(); i += 1) {
    await new Promise(resolve => {
      setTimeout(resolve, 5);
    });
  }
  await new Promise(resolve => {
    setTimeout(resolve, 5);
  });
}

function open(code: string, signedIn: () => boolean) {
  return createRoot(dispose => ({ ...createView(() => code, signedIn, { every: 60_000, decks: false }), dispose }));
}

afterEach(() => mock.restoreAll());

test('the first load takes the published file, and a signed-in viewer is asked for once', async () => {
  const asked = server({
    file: async () => Response.json(published(5)),
    api: async () => Response.json(withViewer(published(4), PLAYER))
  });
  const page = open('EVENT1', () => true);
  await settled(() => page.view.latest?.viewer.me === 'p1');
  assert.equal(page.view.latest?.version, 5, 'an older copy is not taken');
  assert.deepEqual(page.view.latest?.viewer, PLAYER, 'but what it says of the viewer is');
  assert.equal(page.freshness().failure, null);
  assert.ok((page.freshness().checkedAt ?? 0) > 0);
  assert.equal(asked.api(), 1);
  page.take(published(3));
  assert.equal(page.view.latest?.version, 5, 'a copy handed over that is older is not taken either');
  page.take(published(6));
  assert.equal(page.view.latest?.version, 6);
  assert.deepEqual(page.view.latest?.viewer, PLAYER, 'a copy handed over keeps the viewer shown');
  page.dispose();
  assert.equal(listening.size, 0, 'nothing listens once the page is gone');
});

test("an answer asked for before the viewer's own undo keeps the undone viewer", async () => {
  let release = () => {};
  let first = true;
  server({
    file: async () => Response.json(published(5)),
    api: async () => {
      if (first) {
        first = false;
        return Response.json(withViewer(published(5), PLAYER));
      }
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return Response.json(withViewer(published(7), PLAYER));
    }
  });
  const page = open('EVENT1', () => true);
  await settled(() => page.view.latest?.viewer.me === 'p1');
  page.whoAmI();
  page.unlinked();
  assert.deepEqual(page.view.latest?.viewer, { role: null, me: null, via: null, signedIn: true });
  release();
  await settled(() => page.view.latest?.version === 7);
  assert.equal(page.view.latest?.version, 7, 'the event it carries is taken');
  assert.equal(page.view.latest?.viewer.me, null, 'what it says of the viewer is not');
  page.dispose();
});

test('back in view the page notes when, asks who a signed-in viewer is, and another tab can start a look', async () => {
  const asked = server({
    file: async () => Response.json(published(5)),
    api: async () => Response.json(withViewer(published(5), PLAYER))
  });
  let signedIn = false;
  const page = open('EVENT1', () => signedIn);
  await settled(() => page.view.latest !== undefined);
  assert.equal(asked.api(), 0, 'nobody signed in, nobody asked for');
  signedIn = true;
  target.hidden = true;
  listening.forEach(listener => listener());
  assert.equal(page.freshness().shownAt, undefined, 'a hidden page is not shown');
  target.hidden = false;
  listening.forEach(listener => listener());
  assert.ok((page.freshness().shownAt ?? 0) > 0);
  await settled(() => asked.api() > 0);
  assert.ok(asked.api() > 0, 'the viewer is asked for');
  const looks = asked.file();
  announceChange('EVENT1', 9);
  await settled(() => asked.file() > looks);
  assert.ok(asked.file() > looks, 'a newer version elsewhere starts a look at once');
  page.dispose();
});

test('with no signal the copy this device last saw is shown, as behind', async () => {
  keepEventCopy(withViewer(published(3, 'KEPT01'), NOBODY), 1_000);
  server({
    file: async () => {
      throw new TypeError('offline');
    },
    api: async () => {
      throw new TypeError('offline');
    }
  });
  const page = open('KEPT01', () => false);
  await settled(() => page.view.latest !== undefined);
  assert.equal(page.view.latest?.version, 3);
  assert.equal(page.freshness().kept, true);
  assert.equal(page.freshness().checkedAt, 1_000);
  assert.notEqual(page.freshness().failure, null);
  page.dispose();
});

test('an event that is not there is reported, and not looked for again', async () => {
  const asked = server({ api: async () => Response.json({ error: 'No such event' }, { status: 404 }) });
  const page = open('GONE01', () => false);
  await settled(() => page.view.state === 'errored');
  assert.equal(page.view.state, 'errored');
  assert.notEqual(page.freshness().failure, null);
  const calls = asked.api();
  page.retry();
  await settled();
  assert.equal(asked.api(), calls, 'a missing event is not asked for again');
  page.dispose();
});

test('a first load that failed is tried again, and takes the event once it is there', async () => {
  let up = false;
  const asked = server({
    file: async () => (up ? Response.json(published(2, 'LATE01')) : new Response(null, { status: 503 }))
  });
  const page = open('LATE01', () => false);
  await settled(() => page.view.state === 'errored');
  up = true;
  page.retry();
  // An errored resource throws when read, so its state is asked first.
  await settled(() => page.view.state === 'ready');
  assert.equal(page.view.latest?.version, 2);
  assert.ok(asked.file() >= 2);
  page.dispose();
});
