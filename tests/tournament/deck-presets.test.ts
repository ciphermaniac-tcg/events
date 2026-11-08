/**
 * The Players tab's deck picker list as the page makes it. The module makes a
 * solid resource, which needs the browser build of solid-js, so it runs in a child.
 */

import test from 'node:test';

import { passesUnderBrowserBuild } from '../__utils__/browserBuild.ts';

test('the deck picker list behaves under the browser build of solid-js', () => {
  passesUnderBrowserBuild('tests/tournament/deck-presets.browser.ts');
});
