/**
 * Becoming an organizer, against mocked functions: the apply page's store
 * Application sends with a note or without one, sends an incomplete profile to Settings, and shows where a
 * sent one stands, with Apply again after a rejection. The store form's own
 * fields are covered in stores.spec.ts.
 */

import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';

import type { AccountRole } from '../../shared/accounts/roles';
import { emptyTournament } from '../../shared/tournament/create';
import { DEFAULT_SETTINGS } from '../../shared/tournament/view';
import type { ApplicationState, MyApplication, MyStore } from '../../shared/accounts/types';

const ME = {
  id: 'acct-1',
  name: 'Mary',
  avatar: null,
  popId: '7200001' as string | null,
  firstName: 'Mary',
  lastName: 'Jackson',
  birthDate: '02/27/1995',
  role: null as AccountRole | null,
  handle: 'reese',
  publicProfile: false,
  profileName: 'real' as 'real' | 'handle',
  providers: ['google'],
  stores: [] as MyStore[]
};

/** The store an approved Application made, as /api/me lists it. */
const STORE: MyStore = {
  id: 'store-1',
  name: 'Combat Power Gaming',
  leagueId: '6238620',
  status: 'active',
  timeZone: 'America/Chicago',
  role: 'manager'
};

const NONE: ApplicationState = { application: null, eligible: { profile: true, email: true } };

/** What the locator knows of the league applied for. */
const LEAGUE = {
  leagueId: '6238620',
  shop: 'COMBAT POWER GAMING',
  // As pokemon.com lists it, on one line; the city and region are the locator's own reading of the place.
  address: '4522 FREDERICKSBURG RD SUITE B64, SAN ANTONIO, TX 78201, US',
  city: 'Balcones Heights',
  region: 'Texas',
  cc: 'US',
  lat: 29.49,
  lon: -98.55,
  timeZone: 'America/Chicago'
};

const DAY = Date.UTC(2026, 8, 28, 12);

const application = (status: MyApplication['status'], extra: Partial<MyApplication> = {}): MyApplication => ({
  id: 'app-1',
  status,
  explanation: '',
  createdAt: DAY,
  decidedAt: status === 'pending' ? null : DAY + 86_400_000,
  note: null,
  store: null,
  ...extra
});

interface Asked {
  method: string;
  path: string;
  body: unknown;
}

interface Options {
  /** The Application the account's latest is once a pending one is withdrawn: the one decided before it, or none. */
  afterWithdraw?: MyApplication | null;
  /** The account as /api/me reads it the second time, after a decision the page has not seen. */
  reread?: typeof ME;
}

/** The applicant endpoints, holding the account's state as the functions would, and every ask they get. */
async function mockApplicant(page: Page, start: ApplicationState, user: typeof ME | null = ME, options: Options = {}) {
  const asks: Asked[] = [];
  let state = start;
  let reads = 0;
  // The account as it stands after a resignation or leaving a store.
  let live = user;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method();
    const { pathname } = new URL(request.url());
    const key = `${method} ${pathname}`;
    asks.push({ method, path: pathname, body: method === 'POST' ? request.postDataJSON() : null });
    if (key === 'GET /api/me') {
      reads += 1;
      const current = reads > 1 && options.reread ? options.reread : live;
      return route.fulfill({ json: { user: current, providers: ['google', 'discord'] } });
    }
    if (key === 'DELETE /api/community') {
      live = live && { ...live, role: null };
      return route.fulfill({ json: { user: live } });
    }
    if (method === 'DELETE' && /^\/api\/stores\/[^/]+\/members$/.test(pathname)) {
      const left = pathname.split('/')[3];
      live = live && { ...live, stores: live.stores.filter(store => store.id !== left) };
      return route.fulfill({ status: 204 });
    }
    if (key === 'PUT /api/me') {
      live = live && { ...live, ...(request.postDataJSON() as Partial<typeof ME>) };
      return route.fulfill({ json: { user: live } });
    }
    if (key === 'GET /api/applications/mine') {
      return route.fulfill({ json: state });
    }
    if (method === 'GET' && pathname.startsWith('/api/leagues/')) {
      return route.fulfill({ json: { leagueId: '6238620', league: LEAGUE, taken: false } });
    }
    if (key === 'POST /api/applications') {
      const body = request.postDataJSON() as { explanation: string };
      const sent = application('pending', { explanation: body.explanation });
      state = { ...state, application: sent };
      return route.fulfill({ status: 201, json: { application: sent } });
    }
    if (key === 'DELETE /api/applications/mine') {
      state = { ...state, application: options.afterWithdraw ?? null };
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return asks;
}

const posted = (asks: Asked[]) =>
  asks
    .filter(a => a.method === 'POST')
    .map(a => {
      const { explanation, store } = a.body as { explanation: string; store: unknown };
      return { explanation, store: Boolean(store) };
    });

/** Picks the Store row and looks its league up, then answers the questions the form needs answered. */
async function openStoreForm(page: Page) {
  await page.getByRole('button', { name: 'Apply as store' }).click();
  await page.getByLabel('League ID or pokemon.com league page').fill('6238620');
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByLabel('Why are you applying for this store?').selectOption('owner');
  await page.getByRole('checkbox', { name: /certified/ }).check();
}

test('the store application sends with the note, and asks for no file @mobile', async ({ page }) => {
  const asks = await mockApplicant(page, NONE);
  await page.goto('/apply');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run events');
  await openStoreForm(page);
  const send = page.getByRole('button', { name: 'Send application' });
  // One filled button in the view: Send, with the community row's gone quiet.
  await expect(page.locator('.btn-primary')).toHaveText(['Send application']);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await page.getByLabel('Note').fill('I run the Thursday league.');
  await expect(page.locator('.tm-apply-count')).toHaveText('26 / 2000');
  await send.click();
  await expect(page.locator('.tm-applicant')).toContainText('Application pending');
  await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  await expect(send).toHaveCount(0);
  expect(posted(asks)).toEqual([{ explanation: 'I run the Thursday league.', store: true }]);
});

test('a store application sends without a note', async ({ page }) => {
  const asks = await mockApplicant(page, NONE);
  await page.goto('/apply');
  await openStoreForm(page);
  await page.getByLabel('Note').fill('   ');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.locator('.tm-applicant')).toContainText('Application pending');
  expect(posted(asks)).toEqual([{ explanation: '', store: true }]);
});

test('a store application lists everything it still needs at once, each a way to Settings', async ({ page }) => {
  await mockApplicant(page, { ...NONE, eligible: { profile: false, email: false } }, { ...ME, popId: null });
  await page.goto('/apply');
  await page.getByRole('button', { name: 'Apply as store' }).click();
  const needs = page.locator('.tm-apply-needs li');
  await expect(needs).toHaveText([
    /Your name and Player ID\s*Add in Settings/,
    /An email from Google or Discord\s*Link in Settings/
  ]);
  await expect(needs.getByRole('link', { name: 'Add in Settings' })).toHaveAttribute(
    'href',
    '/settings?section=profile&next=%2Fapply%3Fstore'
  );
  await expect(needs.getByRole('link', { name: 'Link in Settings' })).toHaveAttribute(
    'href',
    '/settings?next=%2Fapply%3Fstore'
  );
  // One filled button on the page: the community row's.
  await expect(page.locator('.btn-primary')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Send application' })).toHaveCount(0);
});

test('Settings opened from the application offers the way back after a save, and links back to it', async ({
  page
}) => {
  await mockApplicant(page, { ...NONE, eligible: { profile: false, email: false } }, { ...ME, providers: [] });
  await page.goto('/apply');
  await page.getByRole('button', { name: 'Apply as store' }).click();
  await page.getByRole('link', { name: 'Add in Settings' }).click();
  // Linking an email comes back to the application as well.
  await expect(page.getByRole('link', { name: 'Link Discord' })).toHaveAttribute('href', /next=%2Fapply%3Fstore/);
  await expect(page.getByRole('link', { name: 'Back to your application' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByRole('link', { name: 'Back to your application' }).click();
  // Back where it was left: the store application open on what it still needs.
  await expect(page).toHaveURL(/\/apply\?store$/);
  await expect(page.locator('.tm-apply-needs li')).toHaveCount(2);
  // Opened on its own, Settings keeps its Save button after a save.
  await page.goto('/settings?section=profile');
  await expect(page.getByRole('link', { name: 'Link Discord' })).toHaveAttribute('href', /next=%2Fsettings/);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByRole('link', { name: 'Back to your application' })).toHaveCount(0);
});

test('a pending Application shows where it stands instead of the form, and withdraws', async ({ page }) => {
  const asks = await mockApplicant(page, { ...NONE, application: application('pending') });
  await page.goto('/apply');
  const status = page.locator('.tm-applicant');
  await expect(status).toContainText('Application pending');
  await expect(status).toContainText('Sent');
  // The status and its steps say it all: no paragraph explains it again.
  await expect(status.locator('.tm-applicant-note')).toHaveCount(0);
  await expect(status.getByRole('link', { name: 'Contact us' })).toHaveAttribute(
    'href',
    'https://ciphermaniac.com/feedback'
  );
  await expect(page.getByRole('button', { name: 'Send application' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page
    .getByRole('group', { name: 'Withdraw your application?' })
    .getByRole('button', { name: 'Withdraw' })
    .click();
  await expect(page.getByRole('button', { name: 'Apply as store' })).toBeVisible();
  expect(asks.filter(a => a.method === 'DELETE').map(a => a.path)).toEqual(['/api/applications/mine']);
});

/** The store a sent Application asked for, as the account reads it back. */
const APPLIED: MyApplication['store'] = {
  leagueId: '6238620',
  details: {
    name: 'Combat Power Gaming',
    address: '4522 Fredericksburg Rd',
    city: 'San Antonio',
    region: 'TX',
    postal: '78201',
    country: 'US',
    website: '',
    discord: '',
    phone: '',
    email: '',
    details: ''
  },
  place: { lat: LEAGUE.lat, lon: LEAGUE.lon, timeZone: 'America/Chicago' },
  timeZone: 'America/Chicago',
  relationship: 'owner',
  certified: true,
  nights: [{ id: 'wed', weekday: 3, time: '19:30', name: 'Locals', fee: '$5' }]
};

test('after a rejection, the note shows and Apply again opens the form', async ({ page }) => {
  const asks = await mockApplicant(page, {
    ...NONE,
    application: application('rejected', {
      note: 'Send your certificate, please.',
      explanation: 'I run the Thursday league.',
      store: APPLIED
    })
  });
  await page.goto('/apply');
  const status = page.locator('.tm-applicant');
  await expect(status).toContainText('Not approved');
  // It names the store and league it asked for, before its day.
  await expect(status.locator('.tm-applicant-stage span')).toHaveText(
    /^Combat Power Gaming · League 6238620 · Decided /
  );
  await expect(status).toContainText('Send your certificate, please.');
  await expect(status).toContainText('Think this is a mistake?');
  await expect(page.getByRole('button', { name: 'Send application' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply again' }).click();
  await expect(page.getByRole('button', { name: 'Apply again' })).toHaveCount(0);
  // Applying again is applying for a store again: its row opens at once.
  await expect(page.getByRole('button', { name: 'Apply as store' })).toHaveAttribute('aria-expanded', 'true');
  // The form starts from what was sent, so only what the admin asked about needs changing.
  await expect(page.getByLabel('League ID or pokemon.com league page')).toHaveValue('6238620');
  await expect(page.getByLabel('Why are you applying for this store?')).toHaveValue('owner');
  await expect(page.getByLabel('Store name')).toHaveValue('Combat Power Gaming');
  await expect(page.getByLabel('League night 1 start')).toHaveValue('19:30');
  await expect(page.getByLabel('Note')).toHaveValue('I run the Thursday league.');
  await page.getByLabel('Note').fill('Certificate is on its way.');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(status).toContainText('Application pending');
  const [sent] = asks.filter(a => a.method === 'POST').map(a => a.body as { explanation: string; store: unknown });
  expect(sent).toEqual({ explanation: 'Certificate is on its way.', store: APPLIED });
});

test('a store application draft keeps the league as typed, gives way to an application decided since, and goes on sign-out', async ({
  page
}) => {
  await mockApplicant(page, NONE);
  const draft = () => page.evaluate(() => sessionStorage.getItem('cm-store-application:acct-1'));
  await page.goto('/apply');
  await page.getByRole('button', { name: 'Apply as store' }).click();
  // Opening the form keeps nothing.
  expect(await draft()).toBeNull();
  const league = page.getByLabel('League ID or pokemon.com league page');
  await league.fill('6238621');
  await page.reload();
  await expect(league).toHaveValue('6238621');
  // Another tab sends an application for another store meanwhile, and it is turned down.
  const rejected = application('rejected', { id: 'app-2', store: APPLIED });
  await page.route('**/api/applications/mine', route => route.fulfill({ json: { ...NONE, application: rejected } }));
  await page.reload();
  await expect(page.locator('.tm-applicant')).toContainText('Not approved');
  await expect(league).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply again' }).click();
  await expect(league).toHaveValue('6238620');
  await page.getByLabel('Note').fill('Certificate is on its way.');
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 204 }));
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(draft).toBeNull();
});

test('an organizer whose access was removed sees so, and applies again from there', async ({ page }) => {
  await mockApplicant(page, NONE, { ...ME, role: 'revoked' });
  await page.goto('/apply');
  await expect(page.locator('.tm-applicant')).toContainText('Organizer access removed');
  await expect(page.locator('.tm-applicant').getByRole('link', { name: 'Contact us' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply as store' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply again' }).click();
  // Community access was taken away, so only the store is offered.
  await expect(page.getByRole('button', { name: 'Community organizer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply as store' })).toHaveAttribute('aria-expanded', 'true');
});

test('an approved account sees its store was approved, with the way to its events', async ({ page }) => {
  await mockApplicant(page, { ...NONE, application: application('approved') }, { ...ME, stores: [STORE] });
  await page.goto('/apply');
  await expect(page.locator('.tm-applicant-stage strong')).toHaveText('Store approved');
  await expect(page.locator('.tm-applicant').getByRole('link', { name: 'Your events' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('button', { name: 'Send application' })).toHaveCount(0);
});

test('signed out, the apply page shows both ways in to read, and sign-in that comes back to it', async ({ page }) => {
  await mockApplicant(page, NONE, null);
  await page.goto('/apply');
  await expect(page.locator('.tm-path-title')).toHaveText([
    'I want to run a tournament for fun',
    'I run an official Play! Pokémon store'
  ]);
  await expect(page.locator('.tm-paths').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', /next=%2Fapply/);
});

test('an account approved since the page read it is read again, and starts events', async ({ page }) => {
  const asks = await mockApplicant(page, { ...NONE, application: application('approved') }, ME, {
    reread: { ...ME, stores: [STORE] }
  });
  await page.route('**/api/tournaments', route => route.fulfill({ json: { tournaments: [] } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start an event' })).toBeVisible();
  expect(asks.filter(a => a.path === '/api/me')).toHaveLength(2);
});

// ---------- Settings: where the account stands ----------

test('Settings shows where an Application stands, with its step @mobile', async ({ page }) => {
  const stages: [ApplicationState, string, string, string][] = [
    [NONE, '', 'Apply to run events', '/apply'],
    [
      { ...NONE, application: application('rejected', { note: 'Send your certificate.' }) },
      'Not approved',
      'Apply again',
      '/apply?again=1'
    ]
  ];
  for (const [state, words, step, href] of stages) {
    await page.unrouteAll();
    const asks = await mockApplicant(page, state, ME);
    await page.goto('/settings?section=organizer');
    const status = page.locator('.tm-applicant');
    await expect(status.getByRole('link', { name: step, exact: true })).toHaveAttribute('href', href);
    if (words) {
      await expect(status.locator('.tm-applicant-stage strong')).toHaveText(words);
    } else {
      await expect(status.locator('.tm-applicant-stage')).toHaveCount(0);
    }
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(1);
    // Anyone may apply for a store, so every account's page asks where its Application stands.
    expect(asks.some(a => a.path === '/api/applications/mine')).toBe(true);
  }
});

/** A store the account staffs, beside the one it owns. */
const STAFFED: MyStore = { ...STORE, id: 'store-2', name: 'Tower Games', leagueId: '6238621', role: 'staff' };

test('Settings lists every way the account runs events, each with its step @mobile', async ({ page }) => {
  await mockApplicant(
    page,
    { ...NONE, application: application('approved') },
    {
      ...ME,
      role: 'community',
      stores: [{ ...STORE, role: 'owner' }, STAFFED]
    }
  );
  await page.goto('/settings?section=organizer');
  const rows = page.locator('.tm-organizer .tm-set-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Community organizer');
  await expect(rows.nth(0).getByRole('button', { name: 'Resign' })).toBeVisible();
  await expect(rows.nth(1)).toContainText('Combat Power Gaming');
  await expect(rows.nth(1)).toContainText('Owner');
  await expect(rows.nth(1).getByRole('link', { name: 'Store settings' })).toHaveAttribute(
    'href',
    '/stores/store-1/settings'
  );
  await expect(rows.nth(1).getByRole('button', { name: 'Leave' })).toHaveCount(0);
  await expect(rows.nth(2)).toContainText('Tower Games');
  await expect(rows.nth(2)).toContainText('Staff');
  await expect(rows.nth(2).getByRole('link', { name: 'Store page' })).toHaveAttribute('href', '/stores/store-2');
  await expect(rows.nth(2).getByRole('button', { name: 'Leave' })).toBeVisible();
  await expect(rows.nth(3).getByRole('link', { name: 'Apply for a store' })).toHaveAttribute('href', '/apply');
  // An approved Application says nothing more than the store's own row does.
  await expect(page.locator('.tm-applicant')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(1);
});

test('Settings: the account’s standing as a community organizer, for each role', async ({ page }) => {
  const cases: [typeof ME, string, string][] = [
    [{ ...ME, stores: [STORE] }, 'Community organizer', 'Join'],
    [{ ...ME, role: 'revoked' }, 'Community organizer', 'Access removed'],
    [{ ...ME, role: 'admin' }, 'Admin', 'Admin page']
  ];
  for (const [user, label, step] of cases) {
    await page.unrouteAll();
    await mockApplicant(page, NONE, user);
    await page.goto('/settings?section=organizer');
    const first = page.locator('.tm-organizer .tm-set-row').first();
    await expect(first.locator('.tm-set-label')).toContainText(label);
    await expect(first.locator('.tm-set-control')).toContainText(step);
  }
});

test('Settings: resigning as a community organizer and leaving a store are asked first, then gone', async ({
  page
}) => {
  const asks = await mockApplicant(page, NONE, { ...ME, role: 'community', stores: [STAFFED] });
  await page.goto('/settings?section=organizer');
  const organizer = page.locator('.tm-organizer');
  await organizer.getByRole('button', { name: 'Resign' }).click();
  expect(asks.filter(a => a.method === 'DELETE')).toEqual([]);
  await organizer
    .getByRole('group', { name: 'Resign as a community organizer?' })
    .getByRole('button', { name: 'Resign' })
    .click();
  await expect(organizer.getByRole('link', { name: 'Join' })).toHaveAttribute('href', '/apply');
  await organizer.getByRole('button', { name: 'Leave' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave Tower Games?' });
  await expect(leave).toContainText('Only a new invite from a manager lets you back in.');
  await leave.getByRole('button', { name: 'Leave' }).click();
  await expect(organizer).not.toContainText('Tower Games');
  expect(asks.filter(a => a.method === 'DELETE').map(a => a.path)).toEqual([
    '/api/community',
    '/api/stores/store-2/members'
  ]);
});

test('Settings: an account that ran a store and left it is offered the way to apply, not its old approval', async ({
  page
}) => {
  await mockApplicant(page, { ...NONE, application: application('approved') }, ME);
  await page.goto('/settings?section=organizer');
  const apply = page.locator('.tm-applicant').getByRole('link', { name: 'Apply to run events' });
  await expect(apply).toBeVisible();
  await expect(page.locator('.tm-applicant-stage')).toHaveCount(0);
  // Alone in its row, the way to apply starts the line rather than floating at the far end.
  const row = await page.locator('.tm-applicant .tm-box-bar').boundingBox();
  const link = await apply.boundingBox();
  expect((link?.x ?? 0) - (row?.x ?? 0)).toBeLessThan(40);
});

test('Settings: after a rejection, Apply again is the one way to apply', async ({ page }) => {
  await mockApplicant(page, { ...NONE, application: application('rejected') }, { ...ME, role: 'community' });
  await page.goto('/settings?section=organizer');
  await expect(page.locator('.tm-applicant').getByRole('link', { name: 'Apply again' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Apply for a store' })).toHaveCount(0);
});

test('Settings: with an Application pending, no second one is offered', async ({ page }) => {
  await mockApplicant(page, { ...NONE, application: application('pending') }, { ...ME, role: 'community' });
  await page.goto('/settings?section=organizer');
  await expect(page.locator('.tm-applicant')).toContainText('Application pending');
  await expect(page.getByRole('link', { name: 'Apply for a store' })).toHaveCount(0);
});

test('Settings shows a pending Application with its day, and withdraws it', async ({ page }) => {
  const asks = await mockApplicant(page, { ...NONE, application: application('pending') });
  await page.goto('/settings?section=organizer');
  const status = page.locator('.tm-applicant');
  await expect(status).toContainText('Application pending');
  await expect(status).toContainText(/Sent .*2026/);
  await status.getByRole('button', { name: 'Withdraw' }).click();
  await status
    .getByRole('group', { name: 'Withdraw your application?' })
    .getByRole('button', { name: 'Withdraw' })
    .click();
  await expect(status.getByRole('link', { name: 'Apply to run events' })).toBeVisible();
  expect(asks.filter(a => a.method === 'DELETE').map(a => a.path)).toEqual(['/api/applications/mine']);
});

test('withdrawn, an Application gives way to the decision before it @mobile', async ({ page }) => {
  const rejected = application('rejected', { id: 'app-0', note: 'Send your certificate.' });
  await mockApplicant(page, { ...NONE, application: application('pending') }, ME, { afterWithdraw: rejected });
  // The narrowest phones, where the question and its buttons are wider than the box.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/settings?section=organizer');
  const status = page.locator('.tm-applicant');
  await status.getByRole('button', { name: 'Withdraw' }).click();
  const question = status.getByRole('group', { name: 'Withdraw your application?' });
  // The question wraps inside the screen rather than running past it.
  const asked = await question.boundingBox();
  expect((asked?.x ?? 0) + (asked?.width ?? 0)).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await question.getByRole('button', { name: 'Withdraw' }).click();
  await expect(status.locator('.tm-applicant-stage strong')).toHaveText('Not approved');
  await expect(status).toContainText('Send your certificate.');
});

test('Apply again on Settings opens the apply page at its form', async ({ page }) => {
  await mockApplicant(page, { ...NONE, application: application('rejected') });
  await page.goto('/settings?section=organizer');
  await page.locator('.tm-applicant').getByRole('link', { name: 'Apply again' }).click();
  await expect(page).toHaveURL(/\/apply\?again=1$/);
  await expect(page.locator('.tm-applicant')).toContainText('Not approved');
  await expect(page.getByRole('button', { name: 'Apply as store' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('League ID or pokemon.com league page')).toBeVisible();
});

// ---------- /host: only Organizers start events ----------

const SUMMARY = {
  code: 'OWNED1',
  name: 'Thursday Locals',
  startDate: '09/24/2026',
  mode: 'swiss',
  players: 12,
  rounds: 4,
  finished: true,
  role: 'owner',
  updatedAt: 0
};

/** /host for an account, its events listed, and an event start refused as the functions refuse it. */
async function mockHost(page: Page, user: typeof ME, state: ApplicationState = NONE) {
  const asks: Asked[] = [];
  let current = user;
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    asks.push({ method: request.method(), path: pathname, body: null });
    if (pathname === '/api/me') {
      return route.fulfill({ json: { user: current, providers: ['google', 'discord'] } });
    }
    if (pathname === '/api/applications/mine') {
      return route.fulfill({ json: state });
    }
    if (pathname === '/api/tournaments' && request.method() === 'POST') {
      current = { ...current, role: 'revoked' };
      return route.fulfill({ status: 403, json: { error: 'Only organizers can start events', apply: true } });
    }
    return route.fulfill({ json: { tournaments: [SUMMARY] } });
  });
  return asks;
}

test('/host: an account that is not an Organizer starts no event, applies instead, and keeps its events @mobile', async ({
  page
}) => {
  await mockHost(page, ME);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Apply to run events' })).toHaveAttribute('href', '/apply');
  await expect(page.getByRole('button', { name: 'Start an event' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Link .tdf file' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Thursday Locals' })).toHaveAttribute('href', '/host/OWNED1');
  // Counted by the phases that hold an event, with no zeros.
  await expect(page.getByText('1 finished', { exact: true })).toBeVisible();
});

test('/host: the events table says where each event runs only once one runs in TOM', async ({ page }) => {
  await mockHost(page, { ...ME, role: 'community' });
  await page.goto('/');
  const table = page.locator('.tm-host-table');
  await expect(table.getByRole('link', { name: 'Thursday Locals' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Run in' })).toHaveCount(0);
  const other = await page.context().newPage();
  await mockHost(other, { ...ME, role: 'community' });
  const tom = { ...SUMMARY, code: 'TOMEV1', name: 'Autumn Regional', mode: 'tom' };
  await other.route('**/api/tournaments', route => route.fulfill({ json: { tournaments: [SUMMARY, tom] } }));
  await other.goto('/');
  const both = other.locator('.tm-host-table');
  await expect(both.getByRole('columnheader', { name: 'Run in' })).toBeVisible();
  await expect(both.getByRole('row', { name: /Thursday Locals/ })).toContainText('Ciphermaniac');
  await expect(both.getByRole('row', { name: /Autumn Regional/ })).toContainText('TOM');
});

test('/host: on a phone, an event row keeps its links on screen without scrolling sideways @mobile', async ({
  page
}) => {
  await mockHost(page, { ...ME, role: 'community' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const row = page.locator('.tm-host-table tbody tr').first();
  // On a phone the row's links wait in its menu, Run again among them.
  await row.getByRole('button', { name: 'More for Thursday Locals' }).click();
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();
  for (const name of ['Results', 'Public page']) {
    const box = await page
      .getByRole('group', { name: 'More for Thursday Locals' })
      .getByRole('link', { name })
      .boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  }
  const wrap = page.locator('.tm-host-section .table-wrap').first();
  expect(await wrap.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  await expect(row.locator('.tm-host-players')).toHaveAttribute('data-unit', 'players');
});

test('/host: Run again opens the setup on a finished event’s answers, named, with no date', async ({ page }) => {
  await mockHost(page, { ...ME, role: 'community' });
  const tournament = {
    ...emptyTournament({ name: 'Thursday Locals' }),
    info: { ...emptyTournament({ name: 'Thursday Locals' }).info, roundTime: 35, startDate: '09/24/2026' }
  };
  const settings = { ...DEFAULT_SETTINGS, format: 'Expanded', startsAt: '2026-09-24T18:00', venue: 'Back room' };
  await page.route('**/api/tournaments/OWNED1/manage', route =>
    route.fulfill({ json: { code: 'OWNED1', tournament, settings, store: null } })
  );
  await page.goto('/');
  const row = page.locator('.tm-host-table tbody tr').first();
  await expect(row.getByRole('link', { name: 'Results' })).toBeVisible();
  await row.getByRole('button', { name: 'More for Thursday Locals' }).click();
  await page.getByRole('button', { name: 'Run again' }).click();
  await expect(page.getByText('From Thursday Locals · Sep 24')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Event name' })).toHaveValue('Thursday Locals');
  const draft = await page.evaluate(() =>
    Object.entries(localStorage).find(([key]) => key.startsWith('cm-event-setup:') && key.includes(':swiss:'))
  );
  expect(JSON.parse(draft?.[1] ?? '{}')).toMatchObject({ format: 'Expanded', venue: 'Back room', roundTime: '35' });
  expect(JSON.parse(draft?.[1] ?? '{}')).not.toHaveProperty('startsAt');
});

test('/host: on a phone, a long event name wraps clear of its player count @mobile', async ({ page }) => {
  await mockHost(page, { ...ME, role: 'community' });
  const name = 'Lakeside Games Thursday Night League Challenge Cup Qualifier';
  expect(name).toHaveLength(60);
  await page.route('**/api/tournaments', route => route.fulfill({ json: { tournaments: [{ ...SUMMARY, name }] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const row = page.locator('.tm-host-table tbody tr').first();
  const [link, players] = await Promise.all([
    row.getByRole('link', { name }).boundingBox(),
    row.locator('.tm-host-players').boundingBox()
  ]);
  expect((link?.x ?? 0) + (link?.width ?? 0)).toBeLessThanOrEqual(players?.x ?? 0);
  // Wrapped, not cut: the whole name still shows.
  expect(await row.getByRole('link', { name }).evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
});

test('/host: the events table keeps the box’s rounded corners @mobile', async ({ page }) => {
  await mockHost(page, { ...ME, role: 'community' });
  await page.goto('/');
  const box = page.locator('.tm-host-section .tm-box').first();
  await box.locator('tbody tr').first().hover();
  const radii = await box.evaluate(el => {
    const wrap = el.querySelector('.table-wrap') as HTMLElement;
    const outer = parseFloat(getComputedStyle(el).borderBottomLeftRadius);
    return { outer, inner: parseFloat(getComputedStyle(wrap).borderBottomLeftRadius) };
  });
  expect(radii.outer).toBeGreaterThan(0);
  expect(radii.inner).toBe(radii.outer - 1);
});

test('/host: a pending Application shows in place of the way to apply', async ({ page }) => {
  await mockHost(page, ME, { ...NONE, application: application('pending') });
  await page.goto('/');
  await expect(page.locator('.tm-applicant-line')).toHaveText('Application pending');
  await expect(page.getByRole('link', { name: 'Apply to run events' })).toHaveCount(0);
  // The words lead to where the Application stands.
  await expect(page.getByRole('link', { name: 'Application pending' })).toHaveAttribute('href', '/apply');
});

test('/host: an Organizer whose access goes while the page is open is refused, and offered the way to apply', async ({
  page
}) => {
  const asks = await mockHost(page, { ...ME, role: 'community' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await page.getByRole('textbox', { name: 'Event name' }).fill('Tuesday League');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.locator('.tm-error')).toHaveText('Only organizers can start events');
  await expect(page.locator('.tm-applicant-line')).toContainText('Organizer access removed');
  await expect(page.getByRole('button', { name: 'Start an event' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Thursday Locals' })).toBeVisible();
  // The Organizer's page asked for no Application until the account read as one that may apply.
  expect(asks.filter(a => a.path === '/api/applications/mine')).toHaveLength(1);
});

test('/host: the new event form is in the address, so a reload keeps it and Back closes it', async ({ page }) => {
  await mockHost(page, { ...ME, role: 'community' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await expect(page).toHaveURL(/[?&]new=swiss/);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Event name' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('textbox', { name: 'Event name' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start an event' })).toBeVisible();
});

test('/host: on a phone the new event form leaves the keyboard closed until a field is pressed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockHost(page, { ...ME, role: 'community' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  const name = page.getByRole('textbox', { name: 'Event name' });
  await expect(name).toBeVisible();
  // Past the microtask a wider screen focuses it in.
  await page.evaluate(
    () =>
      new Promise(resolve => {
        setTimeout(resolve, 50);
      })
  );
  expect(await name.evaluate(field => field === document.activeElement)).toBe(false);
});

test('/host: a hero with nothing for its meta line draws none, so its action sits level with the counts', async ({
  page
}) => {
  await mockHost(page, ME);
  await page.goto('/');
  const apply = page.getByRole('link', { name: 'Apply to run events' });
  await expect(apply).toBeVisible();
  await expect(page.locator('.tm-hero .hero-meta')).toHaveCount(0);
  const text = await page.locator('.tm-hero-text').boundingBox();
  const button = await apply.boundingBox();
  // Bottom-aligned: the action's foot meets the title block's, the counts line now its last.
  expect(Math.abs((text?.y ?? 0) + (text?.height ?? 0) - ((button?.y ?? 0) + (button?.height ?? 0)))).toBeLessThan(2);
});

test('/host: an account that runs events is offered a store, after the stores it already has', async ({ page }) => {
  await mockHost(page, { ...ME, role: 'community' });
  await page.goto('/');
  const meta = page.locator('.tm-hero .hero-meta');
  await expect(meta.getByRole('link')).toHaveText(['Apply for a store']);
  await page.unrouteAll();
  await mockHost(page, {
    ...ME,
    stores: [
      { ...STORE, role: 'owner' },
      { ...STORE, id: 'store-2', name: 'Tower Games', role: 'staff' }
    ]
  });
  await page.goto('/');
  await expect(meta.getByRole('link')).toHaveText(['Combat Power Gaming settings', 'Tower Games', 'Apply for a store']);
  await expect(meta.getByRole('link', { name: 'Tower Games' })).toHaveAttribute('href', '/stores/store-2');
});

test('/host: an account whose only store was revoked keeps its link, and applies through the hero action', async ({
  page
}) => {
  await mockHost(page, { ...ME, stores: [{ ...STORE, role: 'staff', status: 'revoked' }] });
  await page.goto('/');
  await expect(page.locator('.tm-hero .hero-meta').getByRole('link')).toHaveText(['Combat Power Gaming']);
  await expect(page.getByRole('link', { name: 'Apply to run events' })).toBeVisible();
});

test('the new event setup leaves player reporting, archetypes and decklists to Settings', async ({ page }) => {
  await mockHost(page, { ...ME, role: 'community' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await expect(page.getByRole('textbox', { name: 'Event name' })).toBeVisible();
  for (const setting of ['Mobile result reporting', 'Archetypes', 'Decklists']) {
    await expect(page.locator('.tm-set-row', { hasText: setting })).toHaveCount(0);
  }
});

test('/host: an event’s row says when it starts, on a phone under its name @mobile', async ({ page }) => {
  await mockHost(page, { ...ME, role: 'community' });
  await page.route('**/api/tournaments', route =>
    route.fulfill({ json: { tournaments: [{ ...SUMMARY, finished: false, rounds: 0, startsAt: '2026-11-14T18:00' }] } })
  );
  await page.goto('/');
  await expect(page.locator('.tm-host-table .tm-host-when').first()).toHaveText('Sat, Nov 14 · 6:00 PM');
  await expect(page.locator('.tm-host-table .tm-host-when').first()).toBeVisible();
});
