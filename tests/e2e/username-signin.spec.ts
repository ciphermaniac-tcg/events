/**
 * Username and password sign-in on the page (src/lib/tournament/clerk.ts,
 * SignIn.tsx), against a stand-in for Clerk's script: the form sits beside the
 * provider buttons only when the server offers it, posts Clerk's token to
 * /api/auth/clerk as a form with its session still live for the server to
 * check and end, makes an
 * account from the same form with an email proven by code, has an account
 * made without one add it, resets a forgotten password back to the page that
 * asked through our own server, never asking Clerk who a name is, and says
 * what went wrong when Clerk refuses.
 */

import { expect, type Page, test } from '@playwright/test';

const KEY = `pk_test_${Buffer.from('clerk.cm.test$').toString('base64')}`;
const SCRIPT = 'https://clerk.cm.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js';

/**
 * Clerk's browser SDK as far as the form uses it. `window.clerkFake.error`
 * makes the next attempt fail with that code; `email: null` is an account
 * made before email was asked for; the code 000000 is always wrong. Every
 * attempt, other call and removed session is counted on `window.clerkFake`.
 */
const FAKE_CLERK = `
window.clerkFake = Object.assign(
  { attempts: [], steps: [], removed: 0, error: null, email: { status: 'verified', strategy: 'email_code' } },
  window.clerkFake
);
const fake = window.clerkFake;
const RESET = 'reset_password_email_code';
function attempt(mode, params) {
  fake.attempts.push({ mode, ...params });
  // Kept where the form post can't wipe it: whether Clerk's bot check had somewhere to draw.
  sessionStorage.setItem('captcha-' + mode, String(document.querySelectorAll('#clerk-captcha').length));
  const error = fake.error;
  if (error) throw { errors: [error] };
}
function step(name, params) {
  fake.steps.push([name, params]);
  if (params && params.code === '000000') throw { errors: [{ code: 'form_code_incorrect' }] };
}
function signInResource(params) {
  const resource = {
    status: params.password === undefined ? 'needs_first_factor' : 'complete',
    createdSessionId: 'sess_' + fake.attempts.length,
    supportedFirstFactors: fake.email
      ? [{ strategy: 'password' }, { strategy: RESET, emailAddressId: 'idn_1', safeIdentifier: 'p***@example.com' }]
      : [{ strategy: 'password' }],
    prepareFirstFactor: async p => step('prepareFirstFactor', p),
    attemptFirstFactor: async p => { step('attemptFirstFactor', p); resource.status = 'needs_new_password'; return resource; },
    resetPassword: async p => { step('resetPassword', p); resource.status = 'complete'; return resource; }
  };
  return resource;
}
function signUpResource() {
  const resource = {
    status: 'missing_requirements',
    createdSessionId: 'sess_' + fake.attempts.length,
    prepareEmailAddressVerification: async p => step('prepareEmailAddressVerification', p),
    attemptEmailAddressVerification: async p => {
      step('attemptEmailAddressVerification', p);
      resource.status = 'complete';
      return resource;
    }
  };
  return resource;
}
const user = {
  get primaryEmailAddress() { return fake.email ? { verification: fake.email } : null; },
  createEmailAddress: async ({ email }) => {
    step('createEmailAddress', { email });
    return {
      id: 'idn_2',
      emailAddress: email,
      prepareVerification: async p => step('prepareVerification', p),
      attemptVerification: async p => { step('attemptVerification', p); return { id: 'idn_2' }; }
    };
  },
  update: async p => { step('update', p); fake.email = { status: 'verified', strategy: 'email_code' }; }
};
window.Clerk = {
  session: null,
  user: null,
  load: async () => {},
  client: {
    signIn: { create: async params => { attempt('in', params); return signInResource(params); } },
    signUp: { create: async params => { attempt('up', params); return signUpResource(); } }
  },
  setActive: async ({ session }) => {
    window.Clerk.user = user;
    window.Clerk.session = {
      getToken: async () => 'token-' + session,
      remove: async () => { fake.removed += 1; window.Clerk.session = null; window.Clerk.user = null; }
    };
  }
};`;

interface Posted {
  token: string | null;
  next: string | null;
  link: string | null;
  reset?: string | null;
}

/** What the page sent our password reset (functions/api/auth/reset), path and body, in each test. */
let resets: [string, Record<string, string>][] = [];

/** Our password reset as the server answers it: alike for any name, and the code 123456 holds. */
function resetAnswer(path: string, body: Record<string, string>) {
  if (path === '/api/auth/reset') {
    return { status: 202, json: { sent: true } };
  }
  return body.code === '123456'
    ? { status: 200, json: { ok: true } }
    : { status: 400, json: { error: 'Password not reset', code: 'form_code_incorrect' } };
}

async function mockSite(page: Page, providers: string[], clerkKey: string | null = KEY) {
  const posted: Posted[] = [];
  resets = [];
  await page.route(SCRIPT, route => route.fulfill({ contentType: 'text/javascript', body: FAKE_CLERK }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/clerk') {
      const form = new URLSearchParams(route.request().postData() ?? '');
      const reset = form.get('reset');
      posted.push({
        token: form.get('token'),
        next: form.get('next'),
        link: form.get('link'),
        ...(reset ? { reset } : {})
      });
      return route.fulfill({ contentType: 'text/html', body: '<p>posted</p>' });
    }
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers, clerkKey } });
    }
    if (url.pathname.startsWith('/api/auth/reset')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, string>;
      resets.push([url.pathname, body]);
      return route.fulfill(resetAnswer(url.pathname, body));
    }
    if (url.pathname.startsWith('/api/tournaments/')) {
      return route.fulfill({ status: 401, json: { error: 'Sign in first' } });
    }
    return route.fulfill({ json: {} });
  });
  return posted;
}

const form = (page: Page) => page.locator('.tm-signin-form');
const other = (page: Page) => page.getByRole('button', { name: 'Sign in with username and password' });

/** Beside a provider, the form waits behind its own button. */
async function openForm(page: Page) {
  await other(page).click();
  await expect(form(page)).toBeVisible();
}

async function fill(page: Page, username: string, password: string) {
  await form(page).getByLabel('Username').fill(username);
  await form(page).getByLabel('Password').fill(password);
}

test('the form waits under the provider buttons, opens focused, and closes again', async ({ page }) => {
  await mockSite(page, ['google', 'discord', 'clerk']);
  await page.goto('/settings');
  await expect(page.locator('.tm-sso-google')).toBeVisible();
  await expect(form(page)).toHaveCount(0);
  const buttons = await page.locator('.tm-signin').boundingBox();
  const option = await other(page).boundingBox();
  expect(option!.y).toBeGreaterThanOrEqual(buttons!.y + buttons!.height - 1);
  expect(Math.abs(option!.width - buttons!.width)).toBeLessThan(2);

  await openForm(page);
  await expect(form(page).getByLabel('Username')).toBeFocused();
  await expect(other(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(other(page)).toBeFocused();

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockSite(page, ['google', 'discord']);
  await page.goto('/settings');
  await expect(page.locator('.tm-sso-google')).toBeVisible();
  await expect(other(page)).toHaveCount(0);
});

test('without the publishable key there is no form, even when the server lists it', async ({ page }) => {
  await mockSite(page, ['google', 'clerk'], null);
  await page.goto('/settings');
  await expect(page.locator('.tm-sso-google')).toBeVisible();
  await expect(form(page)).toHaveCount(0);
});

test('signing in posts Clerk’s token here', async ({ page }) => {
  const posted = await mockSite(page, ['google', 'clerk']);
  await page.goto('/settings');
  await openForm(page);
  await fill(page, '  pat_plays ', 'correct horse battery staple');
  await form(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('posted')).toBeVisible();
  expect(posted).toEqual([{ token: 'token-sess_1', next: '/settings', link: null }]);
});

test('Clerk is asked with the trimmed username, and its session is left live for the server to end', async ({
  page
}) => {
  await mockSite(page, ['clerk']);
  // The page stays put, so what the fake counted can be read back.
  await page.addInitScript(() => {
    HTMLFormElement.prototype.submit = function submit() {
      (window as any).submitted = Object.fromEntries(new FormData(this));
    };
  });
  await page.goto('/settings');
  await fill(page, '  pat_plays ', 'correct horse battery staple');
  await form(page).getByRole('button', { name: 'Sign in' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).submitted)).toBeTruthy();
  // Signed out first, the session would be refused; the server checks it is live, then ends it.
  expect(await page.evaluate(() => (window as any).clerkFake.removed)).toBe(0);
  const attempts = await page.evaluate(() => (window as any).clerkFake.attempts);
  expect(attempts).toEqual([{ mode: 'in', identifier: 'pat_plays', password: 'correct horse battery staple' }]);
  expect(await page.evaluate(() => (window as any).submitted)).toEqual({ token: 'token-sess_1', next: '/settings' });
});

test('the same form makes an account: an email proven by code, a new password, the length it needs, and one place for Clerk’s bot check while it is made', async ({
  page
}) => {
  const posted = await mockSite(page, ['google', 'clerk']);
  await page.goto('/settings');
  await openForm(page);
  await form(page).getByRole('button', { name: 'Create an account' }).click();
  const password = form(page).getByLabel('Password');
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await expect(password).toHaveAttribute('minlength', '8');
  await expect(password).toHaveAccessibleDescription('At least 8 characters');
  await expect(page.locator('#clerk-captcha')).toHaveCount(0);
  await fill(page, 'new_player', 'a long enough passphrase');
  const email = form(page).getByLabel('Email');
  await expect(email).toHaveAttribute('type', 'email');
  await email.fill('new@example.com');
  await form(page).getByRole('button', { name: 'Create account' }).click();
  const code = form(page).getByLabel('Code');
  await expect(code).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem('captcha-up'))).toBe('1');
  await expect(code).toHaveAccessibleDescription('Sent to new@example.com');
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await code.fill('000000');
  await form(page).getByRole('button', { name: 'Verify' }).click();
  await expect(form(page).getByRole('alert')).toHaveText('That code is wrong.');
  await form(page).getByRole('button', { name: 'Send again' }).click();
  await expect(form(page).getByRole('button', { name: 'Sent again' })).toBeVisible();
  await code.fill('123456');
  await form(page).getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('posted')).toBeVisible();
  expect(posted).toEqual([{ token: 'token-sess_1', next: '/settings', link: null }]);

  await page.goto('/settings');
  await openForm(page);
  await form(page).getByRole('button', { name: 'Create an account' }).click();
  await form(page).getByRole('button', { name: 'I have an account' }).click();
  await expect(form(page).getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('#clerk-captcha')).toHaveCount(0);
});

test('when Clerk refuses, the form says why, marks the fields, and can be sent again', async ({ page }) => {
  const posted = await mockSite(page, ['google', 'clerk']);
  await page.addInitScript(() => {
    (window as any).clerkFake = { error: { code: 'form_password_incorrect' } };
  });
  await page.goto('/settings');
  await openForm(page);
  await fill(page, 'pat_plays', 'not the password at all');
  const submit = form(page).getByRole('button', { name: 'Sign in' });
  await submit.click();
  await expect(form(page).getByRole('alert')).toHaveText('Wrong username or password.');
  await expect(form(page).getByLabel('Username')).toHaveAttribute('aria-invalid', 'true');
  await expect(submit).toBeEnabled();

  await page.evaluate(() => {
    (window as any).clerkFake.error = { code: 'something_new', longMessage: 'Clerk’s own words.' };
  });
  await submit.click();
  await expect(form(page).getByRole('alert')).toHaveText('Clerk’s own words.');

  await page.evaluate(() => {
    (window as any).clerkFake.error = null;
  });
  await form(page).getByRole('button', { name: 'Create an account' }).click();
  await expect(form(page).getByRole('alert')).toHaveCount(0);
  expect(posted).toEqual([]);
});

test('with no provider to prefer, the form shows from the start', async ({ page }) => {
  await mockSite(page, ['clerk']);
  await page.goto('/settings');
  await expect(form(page)).toBeVisible();
  await expect(other(page)).toHaveCount(0);
});

test('while a sign-in is under way the form can’t switch to making an account', async ({ page }) => {
  await mockSite(page, ['google', 'clerk']);
  // Clerk never answers, so the form stays busy.
  await page.route(SCRIPT, route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `${FAKE_CLERK}; window.Clerk.client.signIn.create = () => new Promise(() => {});`
    })
  );
  await page.goto('/settings');
  await openForm(page);
  await fill(page, 'pat_plays', 'correct horse battery staple');
  await form(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(form(page).getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await expect(form(page).getByRole('button', { name: 'Create an account' })).toBeDisabled();
});

test('an account made before email was asked for adds one by code, then goes where it was headed', async ({ page }) => {
  const posted = await mockSite(page, ['google', 'clerk']);
  await page.addInitScript(() => {
    (window as any).clerkFake = { email: null };
  });
  await page.goto('/host/ABCD');
  await openForm(page);
  await fill(page, 'old_timer', 'correct horse battery staple');
  await form(page).getByRole('button', { name: 'Sign in' }).click();
  const email = form(page).getByLabel('Email');
  await expect(email).toBeFocused();
  await expect(email).toHaveAccessibleDescription(/reset your password/u);
  // There is no way past it but the email: the way out goes back to the start.
  await expect(form(page).getByRole('button')).toHaveText(['Send code', 'Cancel']);
  await email.fill('old@example.com');
  await form(page).getByRole('button', { name: 'Send code' }).click();
  const code = form(page).getByLabel('Code');
  await expect(code).toHaveAccessibleDescription('Sent to old@example.com');
  await code.fill('123456');
  await form(page).getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('posted')).toBeVisible();
  expect(posted).toEqual([{ token: 'token-sess_1', next: '/host/ABCD', link: null }]);
});

test('a forgotten password is reset by the emailed code, and the console it was for opens', async ({ page }) => {
  const posted = await mockSite(page, ['google', 'clerk']);
  await page.goto('/host/ABCD');
  await openForm(page);
  await fill(page, 'pat_plays', 'the forgotten one');
  await form(page).getByRole('button', { name: 'Forgot password?' }).click();
  const who = form(page).getByLabel('Username or email');
  await expect(who).toBeFocused();
  await expect(who).toHaveValue('pat_plays');
  await form(page).getByRole('button', { name: 'Send code' }).click();

  const code = form(page).getByLabel('Code');
  await expect(code).toBeFocused();
  await expect(code).toHaveAccessibleDescription('If the account has an email, a code is on its way.');
  const password = form(page).getByLabel('New password');
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await expect(password).toHaveValue('');
  await code.fill('000000');
  await password.fill('a brand new passphrase');
  await form(page).getByRole('button', { name: 'Reset password' }).click();
  await expect(form(page).getByRole('alert')).toHaveText('That code is wrong.');
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await code.fill('123456');
  await form(page).getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByText('posted')).toBeVisible();
  // The reset went through our server; Clerk was asked only to sign in with the new password.
  expect(resets).toEqual([
    ['/api/auth/reset', { identifier: 'pat_plays' }],
    ['/api/auth/reset/complete', { code: '000000', password: 'a brand new passphrase' }],
    ['/api/auth/reset/complete', { code: '123456', password: 'a brand new passphrase' }]
  ]);
  expect(posted).toEqual([{ token: 'token-sess_1', next: '/host/ABCD', link: null }]);
});

test('a reset never asks Clerk who a name is, and the way back is there', async ({ page }) => {
  await mockSite(page, ['clerk']);
  await page.goto('/settings');
  for (const name of ['old_timer', 'nobody_at_all']) {
    await form(page).getByRole('button', { name: 'Forgot password?' }).click();
    await form(page).getByLabel('Username or email').fill(name);
    await form(page).getByRole('button', { name: 'Send code' }).click();
    await expect(form(page).getByLabel('Code')).toHaveAccessibleDescription(
      'If the account has an email, a code is on its way.'
    );
    await form(page).getByRole('button', { name: 'Start over' }).click();
    await form(page).getByRole('button', { name: 'Back to sign in' }).click();
  }
  await expect(form(page).getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
  expect(resets.map(([path, body]) => [path, body.identifier])).toEqual([
    ['/api/auth/reset', 'old_timer'],
    ['/api/auth/reset', 'nobody_at_all']
  ]);
  // Clerk was never asked anything: nothing it could say about a name reached the page.
  expect(await page.evaluate(() => (window as any).clerkFake?.attempts ?? [])).toEqual([]);
});
