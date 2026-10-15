import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';
import type { PublicProfile, PublicStore } from '../../shared/accounts/types';
import { emptyTournament } from '../../shared/tournament/create';
import { DEFAULT_SETTINGS, type Manage, type TournamentView } from '../../shared/tournament/view';
import { deferred } from '../__utils__/deferred';

const USER = {
  id: 'transition-user',
  name: 'Organizer',
  handle: 'organizer',
  role: 'community',
  stores: [],
  avatar: null,
  popId: null,
  firstName: null,
  lastName: null,
  birthDate: null,
  providers: ['google']
};

async function navigate(page: Page, path: string) {
  await page.evaluate(href => {
    const link = document.createElement('a');
    link.href = href;
    document.body.append(link);
    link.click();
    link.remove();
  }, path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

function manage(code: string): Manage {
  return {
    code,
    mode: 'swiss',
    version: 1,
    updatedAt: 0,
    tournament: emptyTournament({ name: `Event ${code}` }),
    pending: [],
    reports: [],
    decks: {},
    settings: { ...DEFAULT_SETTINGS, sanctioned: false },
    role: 'owner',
    staffToken: null,
    store: null
  };
}

function publicView(code: string): TournamentView {
  const event = manage(code);
  return { ...event, divisions: {}, viewer: { role: null, me: null, via: null, signedIn: true } };
}

function store(id: string): PublicStore {
  return {
    id,
    name: `Store ${id}`,
    leagueId: null,
    address: '',
    city: '',
    region: '',
    postal: '',
    country: 'US',
    lat: null,
    lon: null,
    timeZone: 'America/Chicago',
    website: '',
    discord: '',
    details: '',
    nights: [],
    exceptions: [],
    events: [],
    past: []
  };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route =>
    route.fulfill({ status: 500, json: { error: `Unexpected request: ${route.request().url()}` } })
  );
  await page.route('**/api/me', route => route.fulfill({ json: { user: USER, providers: ['google'] } }));
  await page.route('**/tournaments/v1/*.json', route =>
    route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' } })
  );
});

test('a missing profile never lends its error to the next profile @mobile', async ({ page }) => {
  const next = deferred<void>();
  await page.route('**/api/profiles/missing', route => route.fulfill({ status: 404, json: { error: 'Not found' } }));
  const profile: PublicProfile = { handle: 'next', name: 'Next Player', avatar: null, entries: [] };
  await page.route('**/api/profiles/next', async route => {
    await next.promise;
    await route.fulfill({ json: profile });
  });
  await page.goto('/u/missing');
  await expect(page.getByRole('heading', { name: 'Profile not found' })).toBeVisible();
  await navigate(page, '/u/next');
  await expect(page.locator('main .skeleton')).toBeVisible();
  await expect(page.locator('main .error-state')).toHaveCount(0);
  next.resolve();
  await expect(page.getByRole('heading', { name: 'Next Player' })).toBeVisible();
});

for (const prefix of ['/t/', '/host/']) {
  test(`${prefix} waits on a new event without showing the previous event @mobile`, async ({ page }) => {
    const next = deferred<void>();
    const suffix = prefix === '/host/' ? '/manage' : '';
    const answer = prefix === '/host/' ? manage : publicView;
    await page.route(`**/api/tournaments/FIRST${suffix}*`, route => route.fulfill({ json: answer('FIRST') }));
    await page.route(`**/api/tournaments/SECOND${suffix}*`, async route => {
      await next.promise;
      await route.fulfill({ json: answer('SECOND') });
    });
    await page.goto(`${prefix}FIRST`);
    await expect(page.getByRole('heading', { name: 'Event FIRST', exact: true })).toBeVisible();
    await navigate(page, `${prefix}SECOND`);
    await expect(page.locator('main .skeleton')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Event FIRST', exact: true })).toHaveCount(0);
    await expect(page.locator('main .error-state')).toHaveCount(0);
    next.resolve();
    await expect(page.getByRole('heading', { name: 'Event SECOND', exact: true })).toBeVisible();
  });
}

test('an old console response cannot overwrite the new event after navigation', async ({ page }) => {
  const old = deferred<void>();
  const oldStarted = deferred<void>();
  await page.route('**/api/tournaments/FIRST/manage*', async route => {
    oldStarted.resolve();
    await old.promise;
    await route.fulfill({ json: manage('FIRST') });
  });
  await page.route('**/api/tournaments/SECOND/manage*', route => route.fulfill({ json: manage('SECOND') }));
  await page.goto('/host/FIRST');
  await oldStarted.promise;
  await navigate(page, '/host/SECOND');
  await expect(page.getByRole('heading', { name: 'Event SECOND', exact: true })).toBeVisible();
  const response = page.waitForResponse('**/api/tournaments/FIRST/manage*');
  old.resolve();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise<void>(done => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      })
  );
  await expect(page.getByRole('heading', { name: 'Event SECOND', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Event FIRST', exact: true })).toHaveCount(0);
});

for (const suffix of ['', '/settings']) {
  test(`store${suffix} resets its content when the store changes @mobile`, async ({ page }) => {
    const next = deferred<void>();
    await page.route('**/api/stores/first', route =>
      route.fulfill({ json: { store: store('first'), role: 'manager' } })
    );
    await page.route('**/api/stores/second', async route => {
      await next.promise;
      await route.fulfill({ json: { store: store('second'), role: 'manager' } });
    });
    await page.goto(`/stores/first${suffix}`);
    await expect(page.getByRole('heading', { name: 'Store first', exact: true })).toBeVisible();
    await navigate(page, `/stores/second${suffix}`);
    await expect(page.locator('main .skeleton')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Store first', exact: true })).toHaveCount(0);
    next.resolve();
    await expect(page.getByRole('heading', { name: 'Store second', exact: true })).toBeVisible();
  });
}

test('a console refusal appears only after the request fails and clears while retrying', async ({ page }) => {
  const first = deferred<void>();
  await page.route('**/api/tournaments/FIRST/manage*', async route => {
    await first.promise;
    await route.fulfill({ status: 403, json: { error: 'Forbidden' } });
  });
  await page.goto('/host/FIRST');
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
  await expect(page.locator('main .skeleton')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  first.resolve();
  await expect(page.getByRole('alert')).toHaveText('Forbidden');
  const retry = deferred<void>();
  await page.route('**/api/tournaments/FIRST/manage*', async route => {
    await retry.promise;
    await route.fulfill({ json: manage('FIRST') });
  });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main .skeleton')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  retry.resolve();
  await expect(page.getByRole('heading', { name: 'Event FIRST', exact: true })).toBeVisible();
});

for (const path of ['/history', '/settings']) {
  test(`a refused logout at ${path} keeps the account and can be retried`, async ({ page }) => {
    await page.route('**/api/history', route => route.fulfill({ json: { entries: [] } }));
    await page.route('**/api/applications/mine', route =>
      route.fulfill({ json: { application: null, eligible: { profile: true, email: true } } })
    );
    await page.route('**/api/me/profile', route => route.fulfill({ json: { links: {}, preferences: {} } }));
    await page.route('**/api/auth/logout', route =>
      route.fulfill({ status: 503, json: { error: 'Logout unavailable' } })
    );
    await page.goto(path);
    const account = page.getByRole('button', { name: 'Account', exact: true });
    await expect(account).toBeVisible();
    if (path === '/history') {
      await account.click();
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Logout unavailable');
    await expect(account).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    // Successful logout must not depend on a follow-up /me response.
    await page.route('**/api/me', route => route.fulfill({ status: 503, json: { error: 'Session unavailable' } }));
    await page.route('**/api/auth/logout', route => route.fulfill({ status: 204 }));
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('.tm-home')).toBeVisible();
    await expect(account).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  });
}

test('a session read started before logout cannot restore the signed-in account', async ({ page }) => {
  const stale = deferred<void>();
  const started = deferred<void>();
  let reads = 0;
  await page.route('**/api/me', async route => {
    reads += 1;
    if (reads > 1) {
      started.resolve();
      await stale.promise;
    }
    await route.fulfill({ json: { user: { ...USER, role: null }, providers: ['google'] } });
  });
  await page.route('**/api/history', route => route.fulfill({ json: { entries: [] } }));
  await page.route('**/api/tournaments', route => route.fulfill({ json: { tournaments: [] } }));
  await page.route('**/api/applications/mine', route =>
    route.fulfill({
      json: {
        application: {
          id: 'approved',
          status: 'approved',
          explanation: '',
          createdAt: 0,
          decidedAt: 0,
          note: null,
          store: null
        },
        eligible: { profile: true, email: true }
      }
    })
  );
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 204 }));
  await page.goto('/');
  await started.promise;
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('.tm-home')).toBeVisible();
  const response = page.waitForResponse('**/api/me');
  stale.resolve();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise<void>(done => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      })
  );
  await expect(page.locator('.tm-home')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account' })).toHaveCount(0);
});

const RETRY_PAGES = [
  { path: '/history', endpoint: '/api/history', answer: { entries: [] } },
  {
    path: '/apply',
    endpoint: '/api/applications/mine',
    answer: { application: null, eligible: { profile: true, email: true } }
  },
  { path: '/admin?tab=events', endpoint: '/api/admin/events', answer: { events: [] } },
  { path: '/admin?tab=organizers', endpoint: '/api/admin/organizers', answer: { accounts: [] } },
  { path: '/admin', endpoint: '/api/admin/applications?status=pending', answer: { applications: [] } }
];

for (const { path, endpoint, answer } of RETRY_PAGES) {
  test(`a manual retry at ${path} clears its old error while the request is pending`, async ({ page }) => {
    await page.route('**/api/me', route =>
      route.fulfill({
        json: { user: { ...USER, role: path.startsWith('/admin') ? 'admin' : 'community' }, providers: ['google'] }
      })
    );
    await page.route('**/api/admin/applications*', route => route.fulfill({ json: { applications: [] } }));
    await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
    await page.goto(path);
    await expect(page.getByRole('alert')).toHaveText('Unavailable');
    const retry = deferred<void>();
    await page.route(`**${endpoint}`, async route => {
      await retry.promise;
      await route.fulfill({ json: answer });
    });
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('main .skeleton')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    retry.resolve();
    await expect(page.locator('main .skeleton')).toHaveCount(0);
    await expect(page.locator('main .error-state, main [role=alert]')).toHaveCount(0);
  });
}

test('a console keeps its stale marker throughout failed background polls', async ({ page }) => {
  await page.clock.install();
  const pending = deferred<void>();
  const started = deferred<void>();
  let reads = 0;
  await page.route('**/api/tournaments/FIRST/manage*', async route => {
    reads += 1;
    if (reads === 3) {
      started.resolve();
      await pending.promise;
    }
    return reads === 2 || reads === 3
      ? route.fulfill({ status: 503, json: { error: 'Unavailable' } })
      : route.fulfill({ json: manage('FIRST') });
  });
  await page.goto('/host/FIRST');
  await expect(page.getByRole('heading', { name: 'Event FIRST', exact: true })).toBeVisible();
  await page.clock.fastForward(15_000);
  await expect(page.getByText(/not updating/)).toBeVisible();
  await page.clock.fastForward(30_000);
  await started.promise;
  await expect(page.getByText(/not updating/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Event FIRST', exact: true })).toBeVisible();
  const response = page.waitForResponse('**/api/tournaments/FIRST/manage*');
  pending.resolve();
  await (await response).finished();
  await expect(page.getByText(/not updating/)).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect.poll(() => reads).toBe(4);
  await expect(page.getByText(/not updating/)).toHaveCount(0);
});

test('closing the account menu during logout preserves busy state and shows a later failure', async ({ page }) => {
  await page.route('**/api/history', route => route.fulfill({ json: { entries: [] } }));
  const pending = deferred<void>();
  await page.route('**/api/auth/logout', async route => {
    await pending.promise;
    await route.fulfill({ status: 503, json: { error: 'Logout unavailable' } });
  });
  await page.goto('/history');
  const account = page.getByRole('button', { name: 'Account', exact: true });
  await account.click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('heading', { name: 'History', exact: true }).click();
  await expect(page.locator('.tm-acct-menu')).toHaveCount(0);
  await account.click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeDisabled();
  await page.getByRole('heading', { name: 'History', exact: true }).click();
  await expect(page.locator('.tm-acct-menu')).toHaveCount(0);
  pending.resolve();
  await expect(page.locator('.tm-acct-menu').getByRole('alert')).toHaveText('Logout unavailable');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
});

for (const failure of [
  { status: 401, label: 'Access expired' },
  { status: 503, label: 'Updates unavailable' },
  { status: 0, label: 'Connection unavailable' }
]) {
  test(`the console identifies ${failure.label} and retries unchanged successful checks`, async ({ page }) => {
    await page.clock.install();
    await page.route('**/api/tournaments/FIRST/manage*', route => route.fulfill({ json: manage('FIRST') }));
    await page.goto('/host/FIRST');
    await expect(page.getByRole('heading', { name: 'Event FIRST', exact: true })).toBeVisible();
    await page.clock.fastForward(20_000);
    await expect(page.locator('.tm-live-data')).toHaveCount(0);
    await page.route('**/api/tournaments/FIRST/manage*', route =>
      failure.status ? route.fulfill({ status: failure.status, json: { error: 'Unavailable' } }) : route.abort()
    );
    // The last good poll schedules the next one as its answer is taken, which can land after a single jump;
    // jumping on until the failure shows reaches that poll wherever it was scheduled.
    await expect(async () => {
      await page.clock.fastForward(failure.status === 401 ? 15_000 : 45_000);
      await expect(page.getByText(failure.label, { exact: true })).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(page.getByText(/Last updated/)).toBeVisible();
    await expect(page.getByText(/not updating/)).toBeVisible();
    await page.route('**/api/tournaments/FIRST/manage*', route => route.fulfill({ status: 204 }));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.tm-live-data')).toHaveCount(0);
    await expect(page.getByText(/not updating/)).toHaveCount(0);
  });
}

test('an initial console network failure offers retry without suggesting a different account', async ({ page }) => {
  await page.route('**/api/tournaments/FIRST/manage*', route => route.abort());
  await page.goto('/host/FIRST');
  await expect(page.getByText('Connection unavailable. Try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch account' })).toHaveCount(0);
});
