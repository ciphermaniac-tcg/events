/**
 * The demo's entry: start the in-browser server, then the site itself, with
 * the demo's bar above it. The site is the real one, unchanged; only where its
 * requests are answered differs (server/index.ts).
 */

import { showBanner } from './banner';
import { startDemoServer } from './server';

void startDemoServer().then(async () => {
  await import('../src/main');
  showBanner();
});
