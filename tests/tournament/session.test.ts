/**
 * Who is signed in, shared by every tournament page. The module makes a solid
 * resource, which needs the browser build of solid-js, so it runs in a child.
 */

import test from 'node:test';

import { passesUnderBrowserBuild } from '../__utils__/browserBuild.ts';

test('the shared session behaves under the browser build of solid-js', () => {
  passesUnderBrowserBuild('tests/tournament/session.browser.ts');
});

test('a tab that was signed in opens on that session under the browser build of solid-js', () => {
  passesUnderBrowserBuild('tests/tournament/kept-session.browser.ts');
});
