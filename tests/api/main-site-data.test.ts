import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { mainSiteData } from '../../functions/lib/stores/mainSiteData.ts';

afterEach(() => mock.restoreAll());

test('a league file read that hangs is abandoned after three seconds and reads as absent', async () => {
  mock.timers.enable({ apis: ['setTimeout'], now: 0 });
  let signal: AbortSignal | undefined;
  mock.method(
    globalThis,
    'fetch',
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })
  );
  const reading = mainSiteData('https://slow.test').get('file.json');
  mock.timers.tick(2999);
  mock.timers.tick(1);
  assert.equal(await reading, null);
  assert.equal(signal?.aborted, true);
});

test('a failed league file read resolves as absent', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  assert.equal(await mainSiteData('https://down.test').get('file.json'), null);
});
