import { expect, type Page, test } from '@playwright/test';
import { deferred } from '../__utils__/deferred';
import { chunkOf } from './build-manifest';

const homeChunk = () => chunkOf('src/pages/tournaments/HostIndex.tsx');

async function mockHome(page: Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') {
      return route.fulfill({
        json: {
          user: { id: 'admin', name: 'Reese', handle: 'reese', role: 'admin', avatar: null, stores: [] },
          providers: ['google']
        }
      });
    }
    const answers: Record<string, unknown> = {
      '/api/tournaments': { tournaments: [] },
      '/api/history': { entries: [] },
      '/api/admin/applications': { applications: [] }
    };
    return route.fulfill({ status: path in answers ? 200 : 500, json: answers[path] ?? { error: path } });
  });
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const error = document.querySelector('main .error-state');
      if (error) {
        sessionStorage.setItem('test:preload-error', error.textContent ?? '');
      }
    }).observe(document, { subtree: true, childList: true });
  });
}

test('a stale home chunk stays loading throughout its recovery reload @mobile', async ({ page }) => {
  await mockHome(page);
  const reload = deferred<void>();
  let documents = 0;
  page.on('request', request => {
    if (request.isNavigationRequest()) {
      documents += 1;
    }
  });
  let chunks = 0;
  await page.route(`**/${homeChunk()}`, async route => {
    chunks += 1;
    // Pages answers an obsolete asset with the HTML shell and a 200 status.
    if (chunks === 1) {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Stale asset</title>' });
    }
    await reload.promise;
    return route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => chunks).toBe(2);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        loading: Boolean(document.querySelector('main .skeleton')),
        error: document.querySelector('main .error-state')?.textContent ?? null
      }))
    )
    .toEqual({ loading: true, error: null });
  expect(await page.evaluate(() => sessionStorage.getItem('test:preload-error'))).toBeNull();
  reload.resolve();
  await expect(page.getByRole('tabpanel', { name: 'Organizing' })).toBeVisible();
  expect(documents).toBe(2);
  expect(chunks).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem('test:preload-error'))).toBeNull();
});

test('a chunk that still fails after recovery shows its real error without a reload loop', async ({ page }) => {
  await mockHome(page);
  let documents = 0;
  page.on('request', request => {
    if (request.isNavigationRequest()) {
      documents += 1;
    }
  });
  await page.route(`**/${homeChunk()}`, route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Missing asset</title>' })
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  expect(documents).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem('cm:preload-reload'))).not.toBeNull();
});
