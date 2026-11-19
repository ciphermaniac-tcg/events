/**
 * The admin page against mocked admin endpoints: anyone but an Admin finds
 * nothing there; an Admin approves an Application, rejects one with a note,
 * revokes and reinstates a Community organizer, takes a Manager out of a
 * store, and opens an account from Users to move its POP ID to an account
 * found by name, or clear it.
 */

import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';

import type { AccountRole } from '../../shared/accounts/roles';
import type { AdminApplication, AdminUser, RoleHolder } from '../../shared/accounts/types';

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

const STORE = { id: 'store-1', name: 'Combat Power Gaming' };

const HOLDERS: RoleHolder[] = [
  {
    id: 'reese',
    name: 'Reese',
    email: 'reese@example.com',
    popId: null,
    role: 'admin',
    store: null,
    roleAt: null,
    events: 3
  },
  {
    id: 'ada',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    popId: '1001',
    role: 'community',
    store: null,
    roleAt: DAY,
    events: 1
  },
  {
    id: 'kit',
    name: 'Kit Manager',
    email: null,
    popId: null,
    role: null,
    store: { ...STORE, role: 'manager' },
    roleAt: DAY,
    events: 0
  },
  {
    id: 'olive',
    name: 'Olive Owner',
    email: null,
    popId: null,
    role: null,
    store: { ...STORE, role: 'owner' },
    roleAt: DAY,
    events: 2
  }
];

const MARY: AdminUser = {
  id: 'Xk3_aQ9-pL0wZt7u',
  name: 'Mary',
  handle: 'mary',
  email: 'mary@example.com',
  popId: '7200001',
  role: null,
  createdAt: DAY,
  stores: [{ ...STORE, role: 'manager' }]
};

/** The account a POP ID moves to, found by name. */
const BEN: AdminUser = {
  id: 'Other_account_01',
  name: 'Ben Ortiz',
  handle: 'ben',
  email: null,
  popId: null,
  role: null,
  createdAt: DAY,
  stores: []
};

/** An account older than any the Users list holds, so only an exact lookup finds it. */
const OLDER = {
  id: 'Older_account_01',
  name: 'Dana Wells',
  email: 'dana@example.com',
  popId: null,
  role: null,
  createdAt: DAY
};

const USERS: AdminUser[] = [
  MARY,
  BEN,
  {
    id: 'reese',
    name: 'Reese',
    handle: 'reese',
    email: 'reese@example.com',
    popId: null,
    role: 'admin',
    createdAt: DAY,
    stores: []
  }
];

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
      if (body?.store) {
        holders = holders.filter(h => !(h.id === id && h.store?.id === body.store));
        return route.fulfill({ status: 204 });
      }
      holders = holders.map(h => (h.id === id && !h.store ? { ...h, role: body?.role as AccountRole } : h));
      return route.fulfill({ json: { account: holders.find(h => h.id === id) } });
    }
    if (url.pathname === '/api/admin/events') {
      return route.fulfill({ json: { events: EVENTS } });
    }
    if (url.pathname === '/api/admin/users') {
      return route.fulfill({ json: { users: USERS } });
    }
    if (url.pathname === '/api/admin/accounts') {
      // Past the newest accounts the list holds: one found only by its exact email.
      const found = url.searchParams.get('email') === OLDER.email ? [OLDER] : [];
      return route.fulfill({ json: { accounts: found } });
    }
    if (url.pathname === '/api/admin/pop-ids') {
      return route.fulfill({ json: { from: MARY.id, to: body?.accountId ?? null } });
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

test('an Admin approves an Application, and it shows as decided in place @mobile', async ({ page }) => {
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
  await first.getByLabel('Note to applicant if rejected').fill('Typed, then approved');
  await first.getByRole('button', { name: 'Approve' }).click();
  await expect(first.locator('.tm-flag')).toHaveText('Approved');
  await expect(first).toContainText('by Reese');
  await expect(first.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(count).toContainText('1 pending');
  expect(adminAsks(asks).filter(a => a.method === 'POST')).toEqual([
    { method: 'POST', path: '/api/admin/applications/app-1', body: { decision: 'approve', note: '' } }
  ]);
});

test('an Admin rejects one with a note beside Reject, and reads the decided ones by status', async ({ page }) => {
  const asks = await mockAdmin(page);
  await page.goto('/admin');
  const second = page.locator('.tm-app').nth(1);
  await second.getByPlaceholder('Note if rejecting').fill('Send the certificate');
  await second.getByRole('button', { name: 'Reject' }).click();
  expect(adminAsks(asks).filter(a => a.method === 'POST')).toEqual([]);
  await second.getByRole('group', { name: 'Reject Mary Jackson?' }).getByRole('button', { name: 'Reject' }).click();
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
  expect(adminAsks(asks).find(a => a.method === 'POST')?.body).toEqual({
    decision: 'reject',
    note: 'Send the certificate'
  });
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
  await ada
    .getByRole('group', { name: 'Revoke access for Ada Lovelace?' })
    .getByRole('button', { name: 'Revoke' })
    .click();
  await expect(ada).toContainText('Revoked');
  await ada.getByRole('button', { name: 'Reinstate' }).click();
  await ada
    .getByRole('group', { name: 'Reinstate access for Ada Lovelace?' })
    .getByRole('button', { name: 'Reinstate' })
    .click();
  await expect(ada.getByRole('button', { name: 'Revoke' })).toBeVisible();
  expect(adminAsks(asks).filter(a => a.method === 'POST')).toEqual([
    { method: 'POST', path: '/api/admin/organizers/ada', body: { role: 'revoked' } },
    { method: 'POST', path: '/api/admin/organizers/ada', body: { role: 'community' } }
  ]);
});

test('a store’s Manager is listed with the store and taken out of it, asked first; its Owner is not', async ({
  page
}) => {
  const asks = await mockAdmin(page);
  await page.goto('/admin?tab=organizers');
  const kit = page.getByRole('row', { name: /Kit Manager/ });
  await expect(kit).toContainText('Manager, Combat Power Gaming');
  await expect(kit.getByRole('link', { name: 'Combat Power Gaming' })).toHaveAttribute('href', '/stores/store-1');
  const olive = page.getByRole('row', { name: /Olive Owner/ });
  await expect(olive).toContainText('Owner, Combat Power Gaming');
  await expect(olive.getByRole('button')).toHaveCount(0);
  await kit.getByRole('button', { name: 'Remove from store' }).click();
  const ask = page.getByRole('dialog', { name: 'Remove Kit Manager from Combat Power Gaming?' });
  await expect(ask).toContainText('Kit Manager can no longer run Combat Power Gaming events. Their account stays.');
  await ask.getByRole('button', { name: 'Remove' }).click();
  await expect(kit).toHaveCount(0);
  expect(adminAsks(asks).filter(a => a.method === 'POST')).toEqual([
    { method: 'POST', path: '/api/admin/organizers/kit', body: { role: 'revoked', store: 'store-1' } }
  ]);
});

test('an Admin opens an account from Users, moves its POP ID to one found by name, and clears it, each asked first', async ({
  page
}) => {
  const asks = await mockAdmin(page);
  await page.goto('/admin');
  await expect(page.getByRole('tab', { name: 'POP IDs' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Users' }).click();
  await page.getByRole('row', { name: /Mary/ }).click();
  const card = page.getByRole('dialog', { name: 'Mary' });
  await expect(card).toContainText(MARY.id);
  await expect(card.getByRole('link', { name: 'Combat Power Gaming' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Remove from store' })).toBeVisible();
  await card.getByRole('button', { name: 'Move to account…' }).click();
  const search = card.getByRole('searchbox', { name: 'Move 7200001 to' });
  await expect(search).toBeFocused();
  await search.fill('nobody');
  await expect(card).toContainText('No users.');
  await search.fill('ben');
  await card.getByRole('row').filter({ hasText: 'Ben Ortiz' }).getByRole('button', { name: 'Move' }).click();
  const move = page.getByRole('dialog', { name: 'Move 7200001 to Ben Ortiz?' });
  await expect(move).toContainText('7200001 and its history leave Mary for Ben Ortiz, who joined');
  await move.getByRole('button', { name: 'Move' }).click();
  const ben = page.getByRole('dialog', { name: 'Ben Ortiz' });
  await expect(ben).toContainText('7200001');
  await ben.getByRole('button', { name: 'Clear' }).click();
  await ben
    .getByRole('group', { name: 'Clear 7200001 from Ben Ortiz?' })
    .getByRole('button', { name: 'Clear' })
    .click();
  await expect(ben.getByRole('button', { name: 'Clear' })).toHaveCount(0);
  await ben.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.tm-admin-users')).not.toContainText('7200001');
  expect(adminAsks(asks).filter(a => a.method === 'POST')).toEqual([
    { method: 'POST', path: '/api/admin/pop-ids', body: { popId: '7200001', accountId: BEN.id } },
    { method: 'POST', path: '/api/admin/pop-ids', body: { popId: '7200001', accountId: null } }
  ]);
});

test('the Move search finds an account past the newest ones by its exact email, and opens it once moved', async ({
  page
}) => {
  const asks = await mockAdmin(page);
  await page.goto('/admin?tab=users');
  await page.getByRole('row', { name: /Mary/ }).click();
  const card = page.getByRole('dialog', { name: 'Mary' });
  await card.getByRole('button', { name: 'Move to account…' }).click();
  await card.getByRole('searchbox', { name: 'Move 7200001 to' }).fill(OLDER.email);
  await card.getByRole('row').filter({ hasText: 'Dana Wells' }).getByRole('button', { name: 'Move' }).click();
  await page.getByRole('dialog', { name: 'Move 7200001 to Dana Wells?' }).getByRole('button', { name: 'Move' }).click();
  await expect(page.getByRole('dialog', { name: 'Dana Wells' })).toContainText('7200001');
  expect(adminAsks(asks).filter(a => a.method === 'POST')).toEqual([
    { method: 'POST', path: '/api/admin/pop-ids', body: { popId: '7200001', accountId: OLDER.id } }
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

test('an Admin sees every account, and finds one by what they type', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/admin?tab=users');
  const rows = page.locator('.tm-admin-users tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('mary@example.com');
  await expect(rows.nth(0)).toContainText('7200001');
  await expect(rows.nth(0)).toContainText('Manager, Combat Power Gaming');
  await expect(rows.nth(2)).toContainText('Admin');
  await page.getByLabel('Find a user').fill('7200001');
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('Mary');
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
