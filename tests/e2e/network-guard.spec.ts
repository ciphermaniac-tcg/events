/**
 * The guard every browser test runs under (network-guard.ts): a request past
 * the local servers is refused and recorded against the test, while the
 * sprite fallback is drawn from a local image.
 */

import { expect } from '@playwright/test';
import { test } from './network-guard';

test('a request past the local servers is refused and held against the test', async ({ page, externalRequests }) => {
  await page.goto('/');
  const answer = await page.evaluate(() =>
    fetch('https://example.com/data.json').then(
      () => 'answered',
      () => 'refused'
    )
  );
  expect(answer).toBe('refused');
  expect(externalRequests).toEqual(['https://example.com/data.json']);
  // Recorded as it should be: cleared so this test, unlike any other, passes having made it.
  externalRequests.splice(0);
});

test('a sprite missing from the fixtures falls back to a local image', async ({ page, externalRequests }) => {
  await page.goto('/');
  const loaded = await page.evaluate(
    () =>
      new Promise<number>(resolve => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth);
        image.onerror = () => resolve(0);
        image.src = 'https://r2.limitlesstcg.net/pokemon/gen9/tyrantrum.png';
      })
  );
  expect(loaded).toBeGreaterThan(0);
  expect(externalRequests).toEqual([]);
});
