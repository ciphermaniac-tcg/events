/**
 * Registering from an event's page, against mocked functions that hold one
 * registered player. What must hold: before round 1 the page is the
 * registration tab alone, and asks nobody who they are; a registered Player
 * ID asks its birth year and opens the registration, which renames and
 * withdraws from its menu; any other registers, on paper or with a pasted
 * list; at an unsanctioned event a player's exact name opens theirs, a name a
 * slip from it asks before opening anything and offers to register the name
 * as typed, and two named alike are offered to pick from; a full event says so.
 */

import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';

import { type Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import { fullNameKey, nameKey, shortLastNames } from '../../shared/tournament/identify';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicTournament,
  type PublishedView,
  type TournamentSettings
} from '../../shared/tournament/view';
import { commandRunner, freshContext } from '../__utils__/commands';

const CODE = 'REGIST';
const DECK = '4 Iono PAL 185\n56 Basic {G} Energy SVE 1';

const run = commandRunner(freshContext(3, '10/10/2026 10:00:00'));

interface Held {
  popId: string;
  firstName: string;
  lastName: string;
  year: string;
  deck: string;
  mode: 'digital' | 'paper';
}

/** The account signed in, as /api/me answers with it; null signed out. */
type Account = { firstName: string; lastName: string; popId: string | null; birthDate: string | null } | null;

/** An event taking registrations, with Avery Chen and the two Kims already in; `calls` records what the page sent. */
async function mockEvent(page: Page, settings: Partial<TournamentSettings> = {}, user: Account = null) {
  const sanctioned = settings.sanctioned ?? true;
  const people: Held[] = [
    { popId: '7', firstName: 'Avery', lastName: 'Chen', year: '1998', deck: DECK, mode: 'digital' },
    { popId: '412', firstName: 'Alex', lastName: 'Kim', year: '2004', deck: '', mode: 'paper' },
    { popId: '413', firstName: 'Alexa', lastName: 'Kim', year: '2001', deck: '', mode: 'paper' },
    // Registered by staff at the desk, as a player under 13 is.
    {
      popId: '88',
      firstName: 'Sam',
      lastName: 'Lee',
      year: String(new Date().getFullYear() - 9),
      deck: '',
      mode: 'paper'
    }
  ];
  const t = run(
    emptyTournament({ name: 'D2G TCG League Cup' }),
    ...people.map(
      ({ popId, firstName, lastName, year }) =>
        ({
          type: 'addPlayer',
          player: { firstName, lastName, ...(sanctioned ? { id: popId, birthDate: `02/27/${year}` } : {}) }
        }) as Command
    )
  );
  const published: PublishedView = {
    code: CODE,
    mode: 'swiss',
    version: 1,
    updatedAt: 0,
    tournament: publicTournament(t, assignKeys(t, {}), !sanctioned),
    pending: [],
    reports: [],
    divisions: {},
    decks: {},
    settings: {
      ...DEFAULT_SETTINGS,
      decklists: 'open',
      startsAt: '2099-10-24T11:00',
      timeZone: 'America/Chicago',
      ...settings
    }
  };
  const calls: { method: string; query: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  // The event as the API has it: a registration adds its player, in a new version.
  let event = published;
  const listOf = (held: Held) => ({
    popId: sanctioned ? held.popId : '',
    firstName: held.firstName,
    lastName: held.lastName,
    birthDate: sanctioned ? `02/27/${held.year}` : '',
    deck: held.deck,
    mode: held.mode,
    archetype: null,
    submittedAt: 0,
    problems: [],
    registered: true,
    fromList: true,
    locked: true
  });
  // The server's lookup by name, as it answers these: a slip of a letter finds Avery, and Alex finds both Kims.
  const named = (query: Record<string, string>) => {
    const typed = `${query.firstName} ${query.lastName}`.toLowerCase();
    if (typed === 'alex kim') {
      return people.filter(p => p.lastName === 'Kim');
    }
    return typed === 'avery chen' || typed === 'avry chen' || typed === 'avery chon' ? people.slice(0, 1) : [];
  };
  const short = shortLastNames(t.players);
  const rawByName = new Map(t.players.map(player => [fullNameKey(player), player]));
  const displayMatch = (person: Held, query: Record<string, string>) => {
    const raw = rawByName.get(fullNameKey(person));
    const typed = { firstName: query.firstName ?? '', lastName: query.lastName ?? '' };
    return {
      firstName: person.firstName,
      lastName: (raw && short.get(raw.id)) || person.lastName,
      sameName: raw ? fullNameKey(raw) === fullNameKey(typed) : false,
      sameSurname: raw ? nameKey(raw.lastName) === nameKey(typed.lastName) : false
    };
  };
  await page.route(`**/tournaments/v1/${CODE}.json`, route =>
    route.fulfill({ json: published, headers: { 'access-control-allow-origin': '*' } })
  );
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: user && { id: 'u1', name: user.firstName, ...user }, providers: [] } });
    }
    if (url.pathname !== `/api/tournaments/${CODE}/decklists`) {
      return route.fulfill({ json: { ...event, viewer: { role: null, me: null, via: null, signedIn: false } } });
    }
    const query = Object.fromEntries(url.searchParams);
    const body = request.method() === 'PUT' ? (request.postDataJSON() as Record<string, unknown>) : null;
    calls.push({ method: request.method(), query, body });
    if (request.method() === 'PUT') {
      const profile = body?.profile as { firstName: string; lastName: string; popId: string; birthDate: string };
      const joined = run(t, {
        type: 'addPlayer',
        player: { firstName: profile.firstName, lastName: profile.lastName }
      });
      event = { ...published, version: 2, tournament: publicTournament(joined, assignKeys(joined, {}), !sanctioned) };
      return route.fulfill({
        json: {
          decklist: listOf({
            ...profile,
            year: profile.birthDate.slice(-4),
            deck: String(body?.deck),
            mode: body?.mode as 'paper'
          }),
          registration: 'added',
          token: 'device-token-0000001'
        }
      });
    }
    if (request.method() === 'DELETE') {
      return route.fulfill({ status: 204 });
    }
    if (!sanctioned) {
      const near = named(query);
      return route.fulfill({
        json: {
          known: near.length > 0,
          matches: near.map(person => displayMatch(person, query)),
          mine: null
        }
      });
    }
    const held = people.find(p => p.popId === query.popId);
    if (!held || !query.birthYear) {
      return route.fulfill({ json: { known: Boolean(held), mine: null } });
    }
    return query.birthYear === held.year
      ? route.fulfill({
          json: { known: true, player: { firstName: held.firstName, lastName: held.lastName }, mine: listOf(held) }
        })
      : route.fulfill({ status: 403, json: { error: 'That birth year doesn’t match this Player ID.' } });
  });
  return { calls };
}

test('before round 1 the page is the registration tab alone, and asks nobody who they are', async ({ page }) => {
  await mockEvent(page);
  await page.goto(`/t/${CODE}`);
  await expect(page.getByRole('tab', { name: 'Register' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Pairings' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Standings' })).toHaveCount(0);
  await expect(page.getByText('Which player are you?')).toHaveCount(0);
});

test('the Player ID field says where to get one, with a way to sign up @mobile', async ({ page }) => {
  await mockEvent(page, {});
  await page.goto(`/t/${CODE}?tab=decklist`);
  const tip = page.getByRole('button', { name: 'Where to find it' });
  await expect(tip).toHaveAccessibleDescription(/^Your PLAY! Pokémon ID\. Create an account or ask your organizer/);
  await tip.click();
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
    'href',
    'https://club.pokemon.com/us/pokemon-trainer-club/sign-up/'
  );
  const box = await page.getByRole('tooltip').filter({ visible: true }).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('a registered Player ID asks its birth year, then opens the registration to change and withdraw @mobile', async ({
  page
}) => {
  const { calls } = await mockEvent(page, { entryFee: 10 });
  await page.goto(`/t/${CODE}?tab=decklist`);
  await expect(page.getByText('$10.00 entry')).toBeVisible();
  const id = page.getByRole('textbox', { name: 'Player ID' });
  await id.fill('7');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  await id.press('Enter');
  await expect(page.getByText('Confirm your birth year to continue.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change ID' })).toBeVisible();
  const year = page.getByRole('textbox', { name: 'Birth year' });
  await year.fill('1997');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('That birth year doesn’t match this Player ID.');
  await year.fill('1998');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.locator('.tm-reg-who')).toContainText('Avery Chen');
  await expect(page.getByRole('textbox', { name: 'Decklist' })).toHaveValue(DECK);
  const more = page.getByRole('button', { name: 'More' });
  await more.click();
  // The menu hangs from its button at its own width, not stretched across the page.
  const menu = (await page.getByRole('group', { name: /^More for / }).boundingBox()) ?? { x: 0, width: Infinity };
  const trigger = (await more.boundingBox()) ?? { x: 0, width: 0 };
  expect(menu.width).toBeLessThan(320);
  expect(Math.abs(menu.x + menu.width - (trigger.x + trigger.width))).toBeLessThan(2);
  await page.getByRole('button', { name: 'Change name or year' }).click();
  await page.getByRole('textbox', { name: 'First name' }).fill('Avery J.');
  // A mistyped year is corrected before round 1, proved by the year the registration was opened with.
  await page.getByRole('textbox', { name: 'Birth year' }).fill('2000');
  await expect(page.locator('.tm-reg-division')).toHaveText('Masters Division');
  await page.getByText('In person').click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Changes saved.');
  const put = calls.find(call => call.method === 'PUT');
  expect(put?.body).toMatchObject({
    mode: 'paper',
    deck: '',
    wasYear: '1998',
    profile: { popId: '7', firstName: 'Avery J.', lastName: 'Chen', birthDate: '02/27/2000' }
  });

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page.getByRole('group', { name: 'Withdraw' }).getByRole('button', { name: 'Keep my spot' }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page.getByRole('group', { name: 'Withdraw' }).getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.getByRole('status')).toHaveText('You’ve withdrawn.');
  expect(calls.at(-1)).toMatchObject({ method: 'DELETE', query: { popId: '7', birthYear: '2000' } });
});

test('on a 320px phone, the withdraw question keeps both answers inside the box @mobileOnly', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockEvent(page, { entryFee: 10 });
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'Player ID' }).fill('7');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('textbox', { name: 'Birth year' }).fill('1998');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Withdraw' }).click();
  const box = await page.locator('.tm-reg').boundingBox();
  const keep = await page
    .getByRole('group', { name: 'Withdraw' })
    .getByRole('button', { name: 'Keep my spot' })
    .boundingBox();
  expect((keep?.x ?? 0) + (keep?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0));
});

test('any other Player ID registers, with a pasted list, and the Registered card says check-in is done @mobile', async ({
  page
}) => {
  const { calls } = await mockEvent(page, { checkInAt: '2099-10-24T10:00' });
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'Player ID' }).fill('1234567');
  await page.getByRole('button', { name: 'Continue' }).click();
  // A mistyped ID goes back to be typed again.
  await page.getByRole('button', { name: 'Change ID' }).click();
  await page.getByRole('textbox', { name: 'Player ID' }).fill('12345678');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('New registration')).toBeVisible();
  await page.getByRole('textbox', { name: 'First name' }).fill('Nia');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Okafor');
  await page.getByRole('textbox', { name: 'Birth year' }).fill('2001');
  const register = page.getByRole('button', { name: 'Register' });
  await expect(register).toBeDisabled();
  await page.getByText('Digital').click();
  await expect(page.getByText('Paste a decklist')).toBeVisible();
  await page.getByRole('textbox', { name: 'Decklist' }).fill('60 Basic {G} Energy SVE 1');
  const hero = page.locator('.tm-hero');
  await expect(hero).toContainText('4 players');
  // Cmd or Ctrl and Enter in the box sends it, as Register does.
  await page.getByRole('textbox', { name: 'Decklist' }).press('ControlOrMeta+Enter');
  await expect(page.getByRole('status')).toHaveText('You’re registered.');
  // The count under the event's name has them in it.
  await expect(hero).toContainText('5 players');
  const card = page.getByRole('region', { name: 'Your registration' });
  await expect(card).toContainText('Registered');
  await expect(card).toContainText('Checked in');
  await expect(card).toContainText('Nia Okafor · Masters');
  await expect(page.locator('.tm-reg-who')).toContainText('Nia Okafor');
  expect(calls.at(-1)?.body).toMatchObject({ mode: 'digital', deck: '60 Basic {G} Energy SVE 1' });
  // Focus follows the step that replaced the button pressed, rather than falling to the page.
  await expect(page.locator('.tm-reg-steps')).toBeFocused();
  // A paper list waits for staff, which the card says once the change is saved.
  await page.getByText('In person').click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Changes saved.');
  await expect(card).toContainText('Hand your list to staff to check in');
});

test('a birth year under 13 says to register with staff as it is typed, before anything is filled in @mobile', async ({
  page
}) => {
  const { calls } = await mockEvent(page);
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'Player ID' }).fill('12345678');
  await page.getByRole('button', { name: 'Continue' }).click();
  const year = page.getByRole('textbox', { name: 'Birth year' });
  await year.fill(String(new Date().getFullYear() - 8));
  await expect(year).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Players under 13 register with staff at the event.')).toBeVisible();
  await expect(page.getByText('In person')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Register' })).toHaveCount(0);
  await year.fill('2001');
  await expect(page.getByText('Players under 13 register with staff at the event.')).toHaveCount(0);
  await expect(page.getByText('In person')).toBeVisible();
  expect(calls.some(call => call.method === 'PUT')).toBe(false);
});

test('a registration staff made for a player under 13 still opens by its birth year', async ({ page }) => {
  await mockEvent(page);
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'Player ID' }).fill('88');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('textbox', { name: 'Birth year' }).fill(String(new Date().getFullYear() - 9));
  await expect(page.getByText('Players under 13 register with staff at the event.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.tm-reg-who')).toContainText('Sam Lee');
  // Opened, but never offered a list the server refuses for a player under 13; withdrawing stays.
  await expect(page.getByText('Players under 13 register with staff at the event.')).toBeVisible();
  await expect(page.getByText('In person')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More' })).toBeVisible();
});

test('a refused withdrawal for a player under 13 is announced', async ({ page }) => {
  await mockEvent(page);
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'Player ID' }).fill('88');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('textbox', { name: 'Birth year' }).fill(String(new Date().getFullYear() - 9));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.tm-reg-who')).toContainText('Sam Lee');
  await page.route(`**/api/tournaments/${CODE}/decklist**`, route =>
    route.fulfill({ status: 403, json: { error: 'Registration is closed.' } })
  );
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Withdraw…', exact: true }).click();
  await page.getByRole('group', { name: 'Withdraw' }).getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.getByRole('alert')).toHaveText('Registration is closed.');
});

test('the Player ID keeps only its digits, and the birth year is four digits the browser can fill in', async ({
  page
}) => {
  await mockEvent(page);
  await page.goto(`/t/${CODE}?tab=decklist`);
  const id = page.getByRole('textbox', { name: 'Player ID' });
  await id.fill('POP-12345');
  await expect(id).toHaveValue('12345');
  await id.fill('12a');
  await expect(id).toHaveValue('12');
  await expect(id).toHaveAttribute('inputmode', 'numeric');
  await expect(id).toHaveAttribute('spellcheck', 'false');
  await page.getByRole('button', { name: 'Continue' }).click();
  const year = page.getByRole('textbox', { name: 'Birth year' });
  await year.fill('1998-02');
  await expect(year).toHaveValue('1998');
  await expect(year).toHaveAttribute('autocomplete', 'bday-year');
  await expect(year).toHaveAttribute('inputmode', 'numeric');
});

test('at an unsanctioned event a name a slip away is asked about, never opened, and two named alike are offered', async ({
  page
}) => {
  await mockEvent(page, { sanctioned: false });
  await page.goto(`/t/${CODE}?tab=decklist`);
  const lookUp = async (first: string, last: string) => {
    await page.getByRole('textbox', { name: 'First name' }).fill(first);
    await page.getByRole('textbox', { name: 'Last name' }).fill(last);
    await page.getByRole('button', { name: 'Continue' }).click();
  };
  // One letter off Avery Chen is someone new until they say otherwise: nothing of Avery's opens.
  await lookUp('Avry', 'Chen');
  await expect(page.getByText('Did you mean Avery C.?')).toBeVisible();
  await expect(page.locator('.tm-reg-who')).toHaveCount(0);
  await page.getByRole('button', { name: 'No, register Avry Chen' }).click();
  await expect(page.getByText('New registration')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue('Avry');

  await page.getByRole('button', { name: 'Not you?' }).click();
  await lookUp('Avry', 'Chen');
  await page.getByRole('button', { name: 'Avery C.' }).click();
  await expect(page.locator('.tm-reg-who')).toContainText('Avery Chen');

  // A surname one letter off cannot open the match by the shortened name: it asks for the surname to be corrected.
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Register someone else' }).click();
  await lookUp('Avery', 'Chon');
  await page.getByRole('button', { name: 'Avery C.' }).click();
  await expect(page.getByText('That last name isn’t this player’s')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Last name' })).toHaveValue('Chon');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Chen');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.tm-reg-who')).toContainText('Avery Chen');

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Register someone else' }).click();
  // The name exactly as typed opens straight away, from Enter in the last field as from Continue.
  await page.getByRole('textbox', { name: 'First name' }).fill('Avery');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Chen');
  await page.getByRole('textbox', { name: 'Last name' }).press('Enter');
  await expect(page.locator('.tm-reg-who')).toContainText('Avery Chen');

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Register someone else' }).click();
  await lookUp('Alex', 'Kim');
  await expect(page.getByText('Which one are you?')).toBeVisible();
  await page.getByRole('button', { name: 'None of these' }).click();
  await expect(page.getByText('New registration')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue('Alex');
});

test('at an unsanctioned event, registering someone else asks first when the device would lose its own registration', async ({
  page
}) => {
  await mockEvent(page, { sanctioned: false });
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'First name' }).fill('Nia');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Okafor');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('In person').click();
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.locator('.tm-reg-who')).toContainText('Nia Okafor');

  const confirm = page.getByRole('group', { name: 'Register someone else' });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Register someone else' }).click();
  await expect(confirm).toContainText('You won’t be able to change Nia Okafor’s registration from this phone.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(await page.evaluate(code => localStorage.getItem(`cm-decklist:${code}`), CODE)).toContain('device-token');

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Register someone else' }).click();
  await confirm.getByRole('button', { name: 'Register someone else' }).click();
  await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue('');
});

test('with storage full, a registration still goes in, and stays this page’s to change', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
  });
  const { calls } = await mockEvent(page, { sanctioned: false });
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'First name' }).fill('Nia');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Okafor');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('In person').click();
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('status')).toHaveText('You’re registered.');
  await page.getByText('Digital').click();
  await page.getByRole('textbox', { name: 'Decklist' }).fill(DECK);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Changes saved.');
  const puts = calls.filter(call => call.method === 'PUT');
  expect(puts).toHaveLength(2);
  // The change carries the token the server gave, so the server knows it for this device's.
  expect(puts[1]?.body?.token).toBe('device-token-0000001');
});

test('a full event says so to a newcomer', async ({ page }) => {
  await mockEvent(page, { playerCap: 3 });
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'Player ID' }).fill('999');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('This event is full.')).toBeVisible();
  await expect(page.getByText('A spot opens if someone withdraws.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register' })).toHaveCount(0);
});

const SAGE = { firstName: 'Sage', lastName: 'Newfield', popId: '4183529', birthDate: '02/27/1994' };

test('signed in, the box is the account’s own: its name, Player ID and birth year, and nothing to type @mobile', async ({
  page
}) => {
  const { calls } = await mockEvent(page, {}, SAGE);
  await page.goto(`/t/${CODE}?tab=decklist`);
  const head = page.locator('.tm-reg-head');
  await expect(head).toContainText('Sage Newfield');
  await expect(head).toContainText('Player ID 4183529 · Born 1994');
  await expect(page.getByRole('textbox', { name: 'Player ID' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'First name' })).toHaveCount(0);
  await page.getByText('In person').click();
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('status')).toHaveText('You’re registered.');
  expect(calls.at(-1)?.body).toMatchObject({ mode: 'paper', profile: SAGE });
  const card = page.getByRole('region', { name: 'Your registration' });
  await expect(card).toContainText('Hand your list to staff to check in');
  await expect(card).toContainText('Sage Newfield · Masters');
});

test('signed in without a Player ID, the box asks for it under the head and Register waits for it', async ({
  page
}) => {
  const { calls } = await mockEvent(page, {}, { ...SAGE, popId: null });
  await page.goto(`/t/${CODE}?tab=decklist`);
  await expect(page.locator('.tm-reg-head')).toContainText('Born 1994');
  await expect(page.locator('.tm-reg-head')).not.toContainText('Player ID');
  await page.getByText('In person').click();
  const register = page.getByRole('button', { name: 'Register' });
  await expect(register).toBeDisabled();
  await page.getByRole('textbox', { name: 'Player ID' }).fill('5550001');
  await register.click();
  await expect(page.getByRole('status')).toHaveText('You’re registered.');
  expect(calls.at(-1)?.body).toMatchObject({ profile: { ...SAGE, popId: '5550001' } });
  // The ID went in with this registration only: saving it to the profile is offered, never required.
  await expect(page.getByRole('button', { name: 'Save ID to my profile' })).toBeVisible();
});

test('signed in, Someone else? opens blank fields for another player, and Back returns to the account’s own', async ({
  page
}) => {
  const { calls } = await mockEvent(page, {}, SAGE);
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('button', { name: 'Someone else?' }).click();
  await expect(page.getByText('New registration')).toBeVisible();
  for (const name of ['Player ID', 'First name', 'Last name', 'Birth year']) {
    await expect(page.getByRole('textbox', { name })).toHaveValue('');
  }
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.tm-reg-head')).toContainText('Sage Newfield');
  await page.getByRole('button', { name: 'Someone else?' }).click();
  await page.getByRole('textbox', { name: 'Player ID' }).fill('12345678');
  await page.getByRole('textbox', { name: 'First name' }).fill('Nia');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Okafor');
  await page.getByRole('textbox', { name: 'Birth year' }).fill('2001');
  await page.getByText('In person').click();
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.locator('.tm-reg-who')).toContainText('Nia Okafor');
  expect(calls.at(-1)?.body).toMatchObject({
    profile: { popId: '12345678', firstName: 'Nia', lastName: 'Okafor', birthDate: '02/27/2001' }
  });
});

test('signed in at an unsanctioned event, a name a slip from a registered one is asked about before it registers', async ({
  page
}) => {
  const { calls } = await mockEvent(page, { sanctioned: false }, { ...SAGE, firstName: 'Avry', lastName: 'Chen' });
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByText('In person').click();
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Did you mean Avery C.?')).toBeVisible();
  expect(calls.filter(call => call.method === 'PUT')).toEqual([]);
  // Registering the name as typed goes on with the list already chosen.
  await page.getByRole('button', { name: 'No, register Avry Chen' }).click();
  await expect(page.getByRole('status')).toHaveText('You’re registered.');
  expect(calls.at(-1)).toMatchObject({
    method: 'PUT',
    body: { mode: 'paper', profile: { firstName: 'Avry', lastName: 'Chen' } }
  });
});

test('signed in, Someone else? at an unsanctioned event asks about a near name, and the match keeps the list chosen', async ({
  page
}) => {
  const { calls } = await mockEvent(page, { sanctioned: false }, SAGE);
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('button', { name: 'Someone else?' }).click();
  await page.getByRole('textbox', { name: 'First name' }).fill('Avry');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Chen');
  await page.getByText('In person').click();
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Did you mean Avery C.?')).toBeVisible();
  expect(calls.filter(call => call.method === 'PUT')).toEqual([]);
  await page.getByRole('button', { name: 'Avery C.' }).click();
  await expect(page.locator('.tm-reg-who')).toContainText('Avery Chen');
  await expect(page.getByRole('radio', { name: /In person/ })).toBeChecked();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Changes saved.');
  expect(calls.at(-1)).toMatchObject({
    method: 'PUT',
    body: { mode: 'paper', was: { firstName: 'Avery', lastName: 'Chen' }, profile: { firstName: 'Avery' } }
  });
});

test('signed in at an unsanctioned event, the account’s own box asks for no Player ID or birth year', async ({
  page
}) => {
  const { calls } = await mockEvent(page, { sanctioned: false }, SAGE);
  await page.goto(`/t/${CODE}?tab=decklist`);
  const head = page.locator('.tm-reg-head');
  await expect(head).toHaveText(/^Sage NewfieldSomeone else\?$/);
  await page.getByText('In person').click();
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('status')).toHaveText('You’re registered.');
  expect(calls.at(-1)?.body).toMatchObject({ profile: { firstName: 'Sage', lastName: 'Newfield' } });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Register someone else' }).click();
  await page
    .getByRole('group', { name: 'Register someone else' })
    .getByRole('button', { name: 'Register someone else' })
    .click();
  await expect(page.getByRole('region', { name: 'Your registration' })).toHaveCount(0);
});
