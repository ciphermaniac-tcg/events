/**
 * The demo at demo.events.ciphermaniac.com: the site with its server in the
 * browser. It opens signed in on a sample event with sixteen players and their
 * lists, runs the console for real, keeps what you do across a reload, starts
 * over on Reset, and sends nothing anywhere.
 */

import { expect, type Page, test } from '@playwright/test';

/** Every request that left the page for another origin; the public card data is answered empty. */
async function watched(page: Page): Promise<string[]> {
  const out: string[] = [];
  await page.route(
    url => url.hostname !== '127.0.0.1',
    route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'r2.ciphermaniac.com' || url.hostname === 'r2.limitlesstcg.net') {
        return route.fulfill({ status: 404, body: '' });
      }
      out.push(url.href);
      return route.abort('blockedbyclient');
    }
  );
  return out;
}

async function openConsole(page: Page) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Console' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo Games League Challenge');
}

test('opens signed in on the sample event, and pairs a round for real @mobile', async ({ page }) => {
  const out = await watched(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Demo' })).toContainText('This is a demo.');
  await expect(page.getByRole('cell', { name: 'Demo Games League Challenge' })).toBeVisible();
  await page.getByRole('link', { name: 'Console' }).click();
  await page.getByRole('button', { name: 'Pair round 1' }).click();
  await expect(page.getByText('Round 1 of 5 in progress')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(8);
  expect(out).toEqual([]);
});

test('every player handed in a real list, named by its archetype', async ({ page }) => {
  await watched(page);
  await openConsole(page);
  await page.getByRole('tab', { name: 'Decklists' }).click();
  await expect(page.getByText('16 lists')).toBeVisible();
  await expect(page.getByText('Archaludon Zoroark').first()).toBeVisible();
  await expect(page.getByText(/unclassified/i)).toHaveCount(0);
});

test('what you do stays across a reload, and Reset starts over', async ({ page }) => {
  await watched(page);
  await openConsole(page);
  await page.getByRole('button', { name: 'Pair round 1' }).click();
  await expect(page.getByText('Round 1 of 5 in progress')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Round 1 of 5 in progress')).toBeVisible();

  const bar = page.getByRole('region', { name: 'Demo' });
  await bar.getByRole('button', { name: 'Reset demo' }).click();
  await expect(bar).toContainText('Start the demo over?');
  await bar.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: 'Console' }).click();
  await expect(page.getByRole('button', { name: 'Pair round 1' })).toBeVisible();
});

test('signing out leaves you signed in, since the demo has one account', async ({ page }) => {
  await watched(page);
  await page.goto('/');
  await expect(page.getByRole('cell', { name: 'Demo Games League Challenge' })).toBeVisible();
  const handle = await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    return ((await (await fetch('/api/me')).json()) as { user?: { handle?: string } }).user?.handle;
  });
  expect(handle).toBe('demo');
});

test('a request for anywhere else is refused before it leaves', async ({ page }) => {
  const out = await watched(page);
  await page.goto('/');
  await expect(page.getByRole('cell', { name: 'Demo Games League Challenge' })).toBeVisible();
  const refused = await page.evaluate(() =>
    fetch('https://events.ciphermaniac.com/api/me').then(
      () => 'sent',
      (error: unknown) => String(error)
    )
  );
  expect(refused).toContain('The demo sends nothing');
  expect(out).toEqual([]);
});
