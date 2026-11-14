/**
 * The public event page's state: what the account asks the server of its own
 * accord, when a finished event lets go of who the viewer is, and which
 * answers say something new of the viewer. The page's copy and its viewer
 * make solid resources and effects, so those run in a child under the
 * browser build of solid-js.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DAY_MS } from '../../shared/tournament/limits.ts';
import type { TournamentView, Viewer } from '../../shared/tournament/view.ts';
import { ApiError } from '../../src/lib/tournament/api.ts';
import { missing, sameViewer } from '../../src/pages/tournaments/publicView.ts';
import { accountStep, pastEvent } from '../../src/pages/tournaments/viewerIdentity.ts';
import { passesUnderBrowserBuild } from '../__utils__/browserBuild.ts';

const NOBODY: Viewer = { role: null, me: null, via: null, signedIn: false };
const POP_ID = { popId: '1234567' };
const NAME = { firstName: 'Ash', lastName: 'Ketchum' };

function event(viewer: Partial<Viewer>, settings: Record<string, unknown> = {}, mode = 'swiss'): TournamentView {
  return {
    code: 'EVENT1',
    mode,
    updatedAt: 0,
    settings: { finished: false, sanctioned: false, playerReporting: true, ...settings },
    viewer: { ...NOBODY, ...viewer }
  } as unknown as TournamentView;
}

test('an account that is the player by its POP ID asks for the seat when this device holds no token', () => {
  const view = event({ signedIn: true, me: 'p1', via: 'pop', claim: POP_ID }, { sanctioned: true });
  assert.deepEqual(accountStep(view, { claim: null, token: null }), { claim: POP_ID });
  assert.equal(accountStep(view, { claim: null, token: 'tok' }), null, 'the device already reports');
  const noReporting = event({ signedIn: true, me: 'p1', via: 'pop', claim: POP_ID }, { playerReporting: false });
  assert.equal(accountStep(noReporting, { claim: null, token: null }), null, 'staff enter every result');
});

test('a device that proved who it is before signing in says so again with its token at an unsanctioned event', () => {
  const view = event({ signedIn: true });
  assert.deepEqual(accountStep(view, { claim: NAME, token: 'tok' }), { claim: NAME, token: 'tok' });
  assert.equal(accountStep(view, { claim: NAME, token: null }), null, 'no token, nothing to prove');
  assert.equal(accountStep(view, { claim: null, token: 'tok' }), null, 'no claim, nobody to be');
  assert.equal(accountStep(event({ signedIn: true }, { sanctioned: true }), { claim: NAME, token: 'tok' }), null);
  assert.equal(
    accountStep(event({ signedIn: true }, {}, 'tom'), { claim: NAME, token: 'tok' }),
    null,
    'TOM is sanctioned'
  );
  const claimed = event({ signedIn: true, me: 'p1', via: 'claim' });
  assert.equal(accountStep(claimed, { claim: NAME, token: 'tok' }), null, 'the account is a player already');
});

test('nothing is asked signed out or once the event has finished', () => {
  const device = { claim: NAME, token: 'tok' };
  assert.equal(accountStep(event({}), device), null);
  assert.equal(accountStep(event({ signedIn: true }, { finished: true }), device), null);
});

test('a finished event lets go of who the viewer is a day after its last change', () => {
  const finished = { ...event({}, { finished: true }), updatedAt: 1_000 } as TournamentView;
  assert.equal(pastEvent(finished, 1_000 + DAY_MS), false);
  assert.equal(pastEvent(finished, 1_001 + DAY_MS), true);
  assert.equal(
    pastEvent({ ...finished, settings: { ...finished.settings, finished: false } }, 1_000 + 2 * DAY_MS),
    false
  );
});

test('two reads of the viewer are the same only when role, player, link and sign-in all agree', () => {
  const viewer: Viewer = { role: null, me: 'p1', via: 'claim', signedIn: true };
  assert.equal(sameViewer(viewer, { ...viewer, claim: NAME }), true, 'the claim itself is not compared');
  assert.equal(sameViewer(viewer, { ...viewer, role: 'staff' }), false);
  assert.equal(sameViewer(viewer, { ...viewer, me: 'p2' }), false);
  assert.equal(sameViewer(viewer, { ...viewer, via: 'pop' }), false);
  assert.equal(sameViewer(viewer, { ...viewer, signedIn: false }), false);
});

test('only a 404 says the event is not there', () => {
  assert.equal(missing(new ApiError('Not found', 404)), true);
  assert.equal(missing(new ApiError('Busy', 503)), false);
  assert.equal(missing(new Error('offline')), false);
});

test("the page's copy of the event behaves under the browser build of solid-js", () => {
  passesUnderBrowserBuild('tests/tournament/public-view.browser.ts');
});

test("the page's viewer behaves under the browser build of solid-js", () => {
  passesUnderBrowserBuild('tests/tournament/viewer-identity.browser.ts');
});
