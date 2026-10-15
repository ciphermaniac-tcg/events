/**
 * The admin page against mocked admin endpoints: anyone but an Admin finds
 * nothing there; an Admin approves an Application with a note, revokes and
 * reinstates a Community organizer, and moves or clears a POP ID after
 * looking its holder up.
 */

import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';

import type { AccountRole } from '../../shared/accounts/roles';
import type { AdminApplication, FoundAccount, RoleHolder } from '../../shared/accounts/types';

const ADMIN = {
  id: 'reese',
  name: 'Reese',
  avatar: null,
  popId: null,
  firstName: null,
  lastName: null,
  birthDate: null,
  role: 'admin' as AccountRole | null,
  handle: 'reese',
  publicProfile: false,
  profileName: 'real',
  providers: ['google'],
  stores: []
};

const DAY = Date.UTC(2026, 8, 28, 12);

function application(id: string, extra: Partial<AdminApplication> = {}): AdminApplication {
  return {
    id,
    status: 'pending',
    explanation: 'I run the Thursday league at the card shop.',
    createdAt: DAY,
    decidedAt: null,
    note: null,
    account: { id: `acct-${id}`, name: 'Mary', email: 'mary@example.com', popId: '7200001', role: null },
    applied: { popId: '7200001', firstName: 'Mary', lastName: 'Jackson' },
    decidedBy: null,
    store: null,
    leagueTaken: null,
    ...extra
  };
}

const HOLDERS: RoleHolder[] = [
  { id: 'reese', name: 'Reese', email: 'reese@example.com', popId: null, role: 'admin', roleAt: null, events: 3 },
  {
    id: 'ada',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    popId: '1001',
    role: 'community',
    roleAt: DAY,
    events: 1
  }
];

const FOUND: FoundAccount = {
  id: 'Xk3_aQ9-pL0wZt7u',
  name: 'Mary',
  email: 'mary@example.com',
  popId: '7200001',
  role: null,
  createdAt: DAY
};

interface Asked {
  method: string;
  path: string;
  body: unknown;
}

const EVENTS = [
  {
    code: 'abc123',
    name: 'Friday League',
    store: { id: 'store-1', name: 'Combat Power Gaming' },
    owner: 'Mary Jackson',
    players: 24,
    startDate: '10/09/2026',
    finished: false,
    rounds: 3,
    updatedAt: DAY
  },
  {
    code: 'def456',
    name: 'Park Meetup',
    store: null,
    owner: 'Sam Lee',
    players: 8,
    startDate: '',
    finished: true,
    rounds: 4,
    updatedAt: DAY
  }
];

/** The admin endpoints, answering as the functions would, and every ask they get. */
async function mockAdmin(page: Page, user: typeof ADMIN | null = ADMIN, decidedElsewhere = new Set<string>()) {
  const asks: Asked[] = [];
  const pending = [application('app-1'), application('app-2', { explanation: 'I judge at the card shop.' })];
  let holders = HOLDERS;
  await page.route('**/api/**', route => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const body = method === 'POST' ? (request.postDataJSON() as Record<string, unknown>) : null;
    asks.push({ method, path: `${url.pathname}${url.search}`, body });
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user, providers: ['google'] } });
    }
    if (url.pathname === '/api/admin/applications') {
      const status = url.searchParams.get('status');
      const rejected = [application('old', { status: 'rejected', decidedAt: DAY, note: 'Not certified' })];
      return route.fulfill({ json: { applications: status === 'pending' ? pending : rejected } });
    }
    if (url.pathname.startsWith('/api/admin/applications/') && method === 'POST') {
      const id = url.pathname.split('/').pop() ?? '';
      if (decidedElsewhere.has(id)) {
        pending.splice(
          pending.findIndex(a => a.id === id),
          1
        );
        return route.fulfill({ status: 409, json: { error: 'Already decided' } });
      }
      const decided = application(id, {
        status: body?.decision === 'approve' ? 'approved' : 'rejected',
        decidedAt: DAY,
        note: (body?.note as string) || null,
        decidedBy: { id: 'reese', name: 'Reese' }
      });
      return route.fulfill({ json: { application: decided } });
    }
    if (url.pathname === '/api/admin/organizers') {
      return route.fulfill({ json: { accounts: holders } });
    }
    if (url.pathname.startsWith('/api/admin/organizers/')) {
      const id = url.pathname.split('/').pop();
      holders = holders.map(h => (h.id === id ? { ...h, role: body?.role as AccountRole } : h));
      return route.fulfill({ json: { account: holders.find(h => h.id === id) } });
    }
    if (url.pathname === '/api/admin/events') {
      return route.fulfill({ json: { events: EVENTS } });
    }
    if (url.pathname === '/api/admin/accounts') {
      return route.fulfill({ json: { accounts: url.searchParams.get('popId') === '404' ? [] : [FOUND] } });
    }
    if (url.pathname === '/api/admin/pop-ids' && body?.accountId === 'nobody') {
      return route.fulfill({ status: 404, json: { error: 'No such account' } });
    }
    if (url.pathname === '/api/admin/pop-ids') {
      return route.fulfill({ json: { from: FOUND.id, to: body?.accountId ?? null } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return asks;
}

const adminAsks = (asks: Asked[]) => asks.filter(a => a.path.startsWith('/api/admin/'));

test('anyone but an Admin finds no admin page, and it asks for nothing', async ({ page }) => {
  for (const user of [null, { ...ADMIN, role: null }, { ...ADMIN, role: 'community' as const }]) {
    await page.unrouteAll();
    const asks = await mockAdmin(page, user);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    await expect(page.getByRole('tablist', { name: 'Admin sections' })).toHaveCount(0);
    expect(adminAsks(asks)).toEqual([]);
  }
});

test('an Admin approves an Application with a note, and it shows as decided in place @mobile', async ({ page }) => {
  const asks = await mockAdmin(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Admin');
  const first = page.locator('.tm-app').first();
  await expect(first.locator('h3')).toHaveText('Mary Jackson');
  await expect(first).toContainText('7200001');
  await expect(first).toContainText('mary@example.com');
  await expect(first).toContainText('I run the Thursday league at the card shop.');
  const count = page.locator('.tm-apps > .tm-box-bar');
  await expect(count).toContainText('2 pending');
  await first.getByLabel('Note').fill('Welcome aboard');
  await first.getByRole('button', { name: 'Approve' }).click();
  await expect(first.locator('.tm-flag')).toHaveText('Approved');
  await expect(first).toContainText('by Reese');
  await expect(first.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(count).toContainText('1 pending');
  expect(adminAsks(asks).filter(a => a.method === 'POST')).toEqual([
    { method: 'POST', path: '/api/admin/applications/app-1', body: { decision: 'approve', note: 'Welcome aboard' } }
  ]);
});

test('an Admin rejects one, and reads the decided ones by status', async ({ page }) => {
  const asks = await mockAdmin(page);
  await page.goto('/admin');
  const second = page.locator('.tm-app').nth(1);
  await second.getByRole('button', { name: 'Reject' }).click();
  await expect(second.locator('.tm-flag')).toHaveText('Rejected');
  await page.getByRole('radiogroup', { name: 'Status' }).getByRole('radio', { name: 'Rejected' }).click();
  await expect(page.locator('.tm-app')).toHaveCount(1);
  await expect(page.locator('.tm-app')).toContainText('Not certified');
  const pendingReads = () => adminAsks(asks).filter(a => a.path === '/api/admin/applications?status=pending');
  // The rest in order; the queue is read by the page and, for its count, by the site's head, which
  // counts again once one is decided.
  expect(
    adminAsks(asks)
      .filter(a => !pendingReads().includes(a))
      .map(a => `${a.method} ${a.path}`)
  ).toEqual(['POST /api/admin/applications/app-2', 'GET /api/admin/applications?status=rejected']);
  await expect.poll(() => pendingReads().length).toBe(3);
  expect(adminAsks(asks).find(a => a.method === 'POST')?.body).toEqual({ decision: 'reject', note: '' });
});

test('an Admin revokes a Community organizer, asked first, and reinstates them; an Admin is not changed here', async ({
  page
}) => {
  const asks = await mockAdmin(page);
  await page.goto('/admin?tab=organizers');
  const ada = page.getByRole('row', { name: /Ada Lovelace/ });
  await expect(ada).toContainText('Community organizer');
  await expect(page.getByRole('row', { name: /Reese/ }).getByRole('button')).toHaveCount(0);
  await ada.getByRole('button', { name: 'Revoke' }).click();
  await ada.getByRole('group', { name: 'Revoke access?' }).getByRole('button', { name: 'Revoke' }).click();
  await expect(ada).toContainText('Revoked');
  await ada.getByRole('button', { name: 'Reinstate' }).click();
  await ada.getByRole('group', { name: 'Reinstate access?' }).getByRole('button', { name: 'Reinstate' }).click();
  await expect(ada.getByRole('button', { name: 'Revoke' })).toBeVisible();
  expect(adminAsks(asks).filter(a => a.method === 'POST')).toEqual([
    { method: 'POST', path: '/api/admin/organizers/ada', body: { role: 'revoked' } },
    { method: 'POST', path: '/api/admin/organizers/ada', body: { role: 'community' } }
  ]);
});

test('an Admin looks a POP ID up, moves it to another account and clears it, each asked first', async ({ page }) => {
  const asks = await mockAdmin(page);
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'POP IDs' }).click();
  await expect(page).toHaveURL(/tab=pop-ids/);
  await page.getByLabel('POP ID, email or account ID').fill('7200001');
  await page.getByRole('button', { name: 'Look up' }).click();
  const found = page.locator('.tm-found');
  await expect(found).toContainText('Xk3_aQ9-pL0wZt7u');
  await found.getByRole('button', { name: 'Move to account…' }).click();
  await found.getByLabel('Account ID').fill('Other_account_01');
  await found.getByRole('button', { name: 'Move' }).click();
  await found
    .getByRole('group', { name: 'Move 7200001 to Other_account_01?' })
    .getByRole('button', { name: 'Move' })
    .click();
  await expect(found.getByRole('button', { name: 'Move to account…' })).toBeVisible();
  await found.getByRole('button', { name: 'Clear' }).click();
  await found.getByRole('group', { name: 'Clear 7200001?' }).getByRole('button', { name: 'Clear' }).click();
  await expect.poll(() => adminAsks(asks).filter(a => a.method === 'POST').length).toBe(2);
  expect(adminAsks(asks).map(a => `${a.method} ${a.path}`)).toContain('GET /api/admin/accounts?popId=7200001');
  expect(adminAsks(asks).filter(a => a.method === 'POST')).toEqual([
    { method: 'POST', path: '/api/admin/pop-ids', body: { popId: '7200001', accountId: 'Other_account_01' } },
    { method: 'POST', path: '/api/admin/pop-ids', body: { popId: '7200001', accountId: null } }
  ]);
});

test('one another Admin decided first says so, and the queue is read again without it', async ({ page }) => {
  const asks = await mockAdmin(page, ADMIN, new Set(['app-1']));
  await page.goto('/admin');
  await page.locator('.tm-app').first().getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('.tm-app')).toHaveCount(1);
  // The one left is the second.
  await expect(page.locator('.tm-app')).toContainText('I judge at the card shop.');
  // The head's count, the page's queue, and the queue again: no decision was made, so no recount.
  expect(adminAsks(asks).filter(a => a.path === '/api/admin/applications?status=pending')).toHaveLength(3);
});

test('a lookup that finds no one says so, the same lookup asks again, and a move to no account is refused', async ({
  page
}) => {
  const asks = await mockAdmin(page);
  await page.goto('/admin?tab=pop-ids');
  const field = page.getByLabel('POP ID, email or account ID');
  await field.fill('404');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.locator('.tm-empty')).toHaveText('No account found');
  await field.fill('7200001');
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect.poll(() => adminAsks(asks).filter(a => a.path === '/api/admin/accounts?popId=7200001').length).toBe(2);
  const found = page.locator('.tm-found');
  await found.getByRole('button', { name: 'Move to account…' }).click();
  await found.getByLabel('Account ID', { exact: true }).fill('nobody');
  await found.getByRole('button', { name: 'Move' }).click();
  await found.getByRole('group', { name: 'Move 7200001 to nobody?' }).getByRole('button', { name: 'Move' }).click();
  await expect(found.getByRole('alert')).toHaveText('No such account');
});

test('a cleared POP ID leaves its account in sight, looked up by its ID', async ({ page }) => {
  const asks = await mockAdmin(page);
  await page.goto('/admin?tab=pop-ids');
  await page.getByLabel('POP ID, email or account ID').fill('7200001');
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.locator('.tm-found').getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('group', { name: 'Clear 7200001?' }).getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByLabel('POP ID, email or account ID')).toHaveValue(FOUND.id);
  await expect.poll(() => adminAsks(asks).at(-1)?.path).toBe(`/api/admin/accounts?id=${FOUND.id}`);
});

test('an Admin sees every event, a store’s and a community one, each opening its page', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/admin?tab=events');
  const rows = page.locator('.tm-admin-events tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Combat Power Gaming');
  await expect(rows.nth(0)).toContainText('Round 3');
  await expect(rows.nth(1)).toContainText('Sam Lee');
  await expect(rows.nth(1)).toContainText('Finished');
  await expect(rows.nth(1).getByRole('link', { name: 'Park Meetup' })).toHaveAttribute('href', '/t/def456');
});

test('the dashboard links an Admin to the admin page, and the old Admin tab address goes there', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/');
  const link = page.locator('.tm-dash-wide').getByRole('link', { name: /^Admin/ });
  await expect(link).toHaveAttribute('href', '/admin');
  await expect(link.locator('.tm-dash-count')).toHaveText('2');
  await expect(page.getByRole('tablist', { name: 'Dashboard' }).getByRole('tab', { name: /Admin/ })).toHaveCount(0);
  await page.goto('/?tab=admin&section=events');
  await expect(page).toHaveURL(/\/admin\?tab=events$/);
  await expect(page.locator('.tm-admin-events tbody tr')).not.toHaveCount(0);
});
