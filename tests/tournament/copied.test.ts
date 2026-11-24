import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { createRoot } from 'solid-js';

import { createCopied } from '../../src/pages/tournaments/copied.ts';

/** The page's one live region, as the browser would hold it. */
const region = { textContent: '', className: '', setAttribute: () => undefined };
Object.assign(globalThis, { document: { createElement: () => region, body: { append: () => undefined } } });

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
afterEach(() => {
  if (original) {
    Object.defineProperty(globalThis, 'navigator', original);
  }
});

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText } },
    configurable: true,
    writable: true
  });
}

test('a copy reads as copied for a moment, then clears', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const written: string[] = [];
  clipboard(async text => {
    written.push(text);
  });
  await createRoot(async dispose => {
    const { copied, copy } = createCopied();
    await copy('link');
    assert.deepEqual(written, ['link']);
    assert.equal(copied(), true);
    assert.equal(region.textContent, 'Copied');
    mock.timers.tick(1500);
    assert.equal(copied(), false);
    assert.equal(region.textContent, '');
    dispose();
  });
  mock.timers.reset();
});

test('a refused clipboard leaves the button as it was', async () => {
  clipboard(() => Promise.reject(new Error('denied')));
  await createRoot(async dispose => {
    const { copied, copy } = createCopied();
    await copy('link');
    assert.equal(copied(), false);
    dispose();
  });
});
