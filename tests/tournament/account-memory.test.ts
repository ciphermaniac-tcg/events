/**
 * The account's lists kept for the tab. The module makes solid resources,
 * which need the browser build of solid-js, so it runs in a child.
 */

import test from 'node:test';

import { passesUnderBrowserBuild } from '../__utils__/browserBuild.ts';

test('the kept account lists behave under the browser build of solid-js', () => {
  passesUnderBrowserBuild('tests/tournament/account-memory.browser.ts');
});
