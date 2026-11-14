/**
 * Which player the public event page's viewer is: a player proved on this
 * device is remembered and reports with its token, a lookup never reports,
 * an account that is the player asks for the seat of its own accord, and a
 * finished event lets go of who the viewer is.
 *
 * Run by public-event-state.test.ts under the browser build of solid-js, the
 * one the site ships; the server build the test runner resolves runs no effects.
 */

import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { createRoot, createSignal } from 'solid-js';

import { DAY_MS } from '../../shared/tournament/limits.ts';
import type { PublishedView, TournamentView, Viewer } from '../../shared/tournament/view.ts';
import { keepBrowserMemory, readBrowserMemory } from '../../src/lib/tournament/browserMemory.ts';
import { createMe } from '../../src/pages/tournaments/viewerIdentity.ts';

const NOBODY: Viewer = { role: null, me: null, via: null, signedIn: false };
const NAME = { firstName: 'Ash', lastName: 'Ketchum' };
const POP_ID = { popId: '1234567' };

function event(code: string, viewer: Partial<Viewer> = {}, settings: Record<string, unknown> = {}): TournamentView {
  return {
    code,
    version: 1,
    updatedAt: 0,
    mode: 'swiss',
    settings: { finished: false, sanctioned: false, playerReporting: true, ...settings },
    viewer: { ...NOBODY, ...viewer }
  } as unknown as TournamentView;
}
const publishedOf = (view: TournamentView) => ({ ...view, viewer: undefined }) as unknown as PublishedView;

/** Answers "Which player are you?" with `answer`, and keeps what each ask sent. */
function server(answer: Record<string, unknown>) {
  const fetches = mock.method(globalThis, 'fetch', async () => Response.json(answer));
  return () => fetches.mock.calls.map(call => JSON.parse(String(call.arguments[1]?.body)) as Record<string, unknown>);
}

function open(view: TournamentView) {
  const shown: PublishedView[] = [];
  let linked = 0;
  const [current, setCurrent] = createSignal(view);
  const page = createRoot(dispose => ({
    ...createMe(current, { onView: v => shown.push(v), onLinked: () => (linked += 1) }),
    dispose
  }));
  return { ...page, shown, linked: () => linked, setView: setCurrent };
}

const settled = () =>
  new Promise(resolve => {
    setTimeout(resolve, 10);
  });

afterEach(() => mock.restoreAll());

test('a player proved on this device is remembered, and reports with its token', () => {
  const view = event('PROVE1');
  const page = open(view);
  assert.equal(page.me(), null);
  page.identified({ claim: NAME, key: 'p1', view: publishedOf(view), reportToken: 'tok', reporter: true });
  assert.equal(page.me(), 'p1');
  assert.deepEqual(page.claim(), NAME);
  assert.equal(page.reportToken(), 'tok');
  assert.equal(page.reports(), true);
  assert.equal(page.shown.length, 1, 'the event it answered with is shown');
  assert.equal(page.linked(), 0, 'no account took the player');
  page.dispose();
  const again = open(view);
  assert.equal(again.me(), 'p1', 'the next load knows the player');
  assert.equal(again.reportToken(), 'tok');
  again.forget();
  assert.equal(again.me(), null);
  assert.equal(again.reports(), false);
  assert.equal(readBrowserMemory('cm-tournament-report:PROVE1', true), null, 'the token goes too');
  again.dispose();
});

test('a lookup is followed but never reports', () => {
  const view = event('LOOKS1');
  const page = open(view);
  page.identified({ claim: NAME, key: 'p2', lookup: true, view: publishedOf(view), reportToken: 'tok' });
  assert.equal(page.me(), 'p2');
  assert.equal(page.claim(), null);
  assert.equal(page.reports(), false);
  assert.equal(readBrowserMemory('cm-tournament-report:LOOKS1', true), 'tok', 'a token the server gave is kept');
  page.identified({ claim: NAME, key: 'p2', lookup: true, view: publishedOf(view) });
  assert.equal(page.reportToken(), null);
  page.dispose();
});

test('a Claim just made tells the page, whose copy does not know it yet', () => {
  const view = event('CLAIM1', { signedIn: true });
  const page = open(view);
  page.identified({ claim: NAME, key: 'p3', view: publishedOf(view), linked: true, reporter: true });
  assert.equal(page.linked(), 1);
  page.setView(event('CLAIM1', { signedIn: true, me: 'p3', via: 'claim' }));
  assert.equal(page.reports(), true, "a Claim holds the player's seat");
  page.identified({ claim: NAME, key: 'p3', view: publishedOf(view), linked: true, reporter: true });
  assert.equal(page.linked(), 1, 'a Claim the copy already knows is no news');
  page.dispose();
});

test('a question put away stays away until the viewer says who they are', () => {
  const view = event('WATCH1');
  const page = open(view);
  assert.equal(page.watching(), false);
  page.watch();
  page.dispose();
  const again = open(view);
  assert.equal(again.watching(), true, 'on this device, across loads');
  again.identified({ claim: NAME, key: 'p1', view: publishedOf(view) });
  assert.equal(again.watching(), false);
  again.dispose();
});

test('a player kept without a token asks for one as the page opens', async () => {
  keepBrowserMemory('cm-tournament-me:TOKEN1', 'p1', true);
  keepBrowserMemory('cm-tournament-player:TOKEN1', JSON.stringify(NAME));
  const view = event('TOKEN1');
  const sent = server({ key: 'p1', reportToken: 'new', reporter: true, view: publishedOf(view) });
  const page = open(view);
  await settled();
  assert.equal(sent().length, 1);
  assert.equal(sent()[0]?.lastName, 'Ketchum');
  assert.equal(page.reportToken(), 'new');
  page.dispose();
});

test('a device that proved who it is before signing in says so again with its token', async () => {
  keepBrowserMemory('cm-tournament-me:LATER1', 'p1', true);
  keepBrowserMemory('cm-tournament-player:LATER1', JSON.stringify(NAME));
  keepBrowserMemory('cm-tournament-report:LATER1', 'tok', true);
  const view = event('LATER1', { signedIn: true });
  const sent = server({ key: 'p1', reportToken: 'tok', reporter: true, linked: true, view: publishedOf(view) });
  const page = open(view);
  await settled();
  assert.equal(sent().length, 1, 'once for the player');
  assert.equal(sent()[0]?.reportToken, 'tok');
  assert.equal(page.linked(), 1);
  page.dispose();
});

test('an account that is the player by its POP ID holds the seat, and asks again once a report is refused', async () => {
  const view = event('POPID1', { signedIn: true, me: 'p1', via: 'pop', claim: POP_ID }, { sanctioned: true });
  const sent = server({ key: 'p1', reporter: true, linked: true, view: publishedOf(view) });
  const page = open(view);
  await settled();
  assert.deepEqual(
    sent().map(body => body.popId),
    ['1234567']
  );
  assert.equal(sent()[0]?.reportToken, undefined, 'asked as the account, with no token');
  assert.equal(page.me(), 'p1');
  assert.equal(page.reports(), true);
  assert.equal(page.reportToken(), null, 'the device keeps nothing of it');
  assert.equal(page.shown.length, 1);
  page.recheck();
  await settled();
  assert.equal(sent().length, 2);
  page.dispose();
});

test('a day after the event finishes, which player this is is let go', () => {
  keepBrowserMemory('cm-tournament-me:ENDED1', 'p1', true);
  const ended = { ...event('ENDED1', {}, { finished: true }), updatedAt: Date.now() - 2 * DAY_MS } as TournamentView;
  const page = open(ended);
  assert.equal(page.me(), null);
  assert.equal(readBrowserMemory('cm-tournament-me:ENDED1', true), null);
  page.dispose();
});
