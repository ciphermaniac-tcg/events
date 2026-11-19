/**
 * The registration an event page reads for its device or account. The module
 * makes a solid resource, which needs the browser build of solid-js, so it
 * runs in a child.
 */

import test from 'node:test';

import { passesUnderBrowserBuild } from '../__utils__/browserBuild.ts';

test('the page’s read of its registration behaves under the browser build of solid-js', () => {
  passesUnderBrowserBuild('tests/tournament/my-list.browser.ts');
});
