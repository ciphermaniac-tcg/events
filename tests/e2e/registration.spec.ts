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

import { applyCommand, type Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import { seededRandom } from '../../shared/tournament/random';
import type { Tournament } from '../../shared/tournament/types';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicTournament,
  type PublishedView,
  type TournamentSettings
} from '../../shared/tournament/view';

const CODE = 'REGIST';
const DECK = '4 Iono PAL 185\n56 Basic {G} Energy SVE 1';

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command, {
      now: 0,
      localTime: '10/10/2026 10:00:00',
      season: 2027,
      random: seededRandom(3)
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.tournament;
  }, tournament);
}

interface Held {
  popId: string;
  firstName: string;
  lastName: string;
  year: string;
  deck: string;
  mode: 'digital' | 'paper';
}

/** An event taking registrations, with Avery Chen and the two Kims already in; `calls` records what the page sent. */
async function mockEvent(page: Page, settings: Partial<TournamentSettings> = {}) {
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
    return typed === 'avery chen' || typed === 'avry chen' ? people.slice(0, 1) : [];
  };
  await page.route(`**/tournaments/v1/${CODE}.json`, route =>
    route.fulfill({ json: published, headers: { 'access-control-allow-origin': '*' } })
  );
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    if (url.pathname !== `/api/tournaments/${CODE}/decklists`) {
      return route.fulfill({ json: { ...published, viewer: { role: null, me: null, via: null, signedIn: false } } });
    }
    const query = Object.fromEntries(url.searchParams);
    const body = request.method() === 'PUT' ? (request.postDataJSON() as Record<string, unknown>) : null;
    calls.push({ method: request.method(), query, body });
    if (request.method() === 'PUT') {
      const profile = body?.profile as { firstName: string; lastName: string; popId: string; birthDate: string };
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
          matches: near.map(({ firstName, lastName }) => ({ firstName, lastName })),
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
  await expect(page.getByText('Changes close at')).toBeVisible();
  const more = page.getByRole('button', { name: 'More' });
  await more.click();
  // The menu hangs from its button at its own width, not stretched across the page.
  const menu = (await page.getByRole('group', { name: /^More for / }).boundingBox()) ?? { x: 0, width: Infinity };
  const trigger = (await more.boundingBox()) ?? { x: 0, width: 0 };
  expect(menu.width).toBeLessThan(320);
  expect(Math.abs(menu.x + menu.width - (trigger.x + trigger.width))).toBeLessThan(2);
  await page.getByRole('button', { name: 'Change name' }).click();
  await page.getByRole('textbox', { name: 'First name' }).fill('Avery J.');
  await page.getByText('In person').click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();
  const put = calls.find(call => call.method === 'PUT');
  expect(put?.body).toMatchObject({
    mode: 'paper',
    deck: '',
    profile: { popId: '7', firstName: 'Avery J.', lastName: 'Chen', birthDate: '02/27/1998' }
  });

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page.getByRole('group', { name: 'Withdraw' }).getByRole('button', { name: 'Keep my spot' }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page.getByRole('group', { name: 'Withdraw' }).getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.getByText('You’ve withdrawn.')).toBeVisible();
  expect(calls.at(-1)).toMatchObject({ method: 'DELETE', query: { popId: '7', birthYear: '1998' } });
});

test('any other Player ID registers, with a pasted list, and is told when check-in is @mobile', async ({ page }) => {
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
  await register.click();
  await expect(page.getByRole('status')).toContainText('You’re registered.');
  await expect(page.getByRole('status')).toContainText(/Check-in is at .*10:00/);
  await expect(page.locator('.tm-reg-who')).toContainText('Nia Okafor');
  expect(calls.at(-1)?.body).toMatchObject({ mode: 'digital', deck: '60 Basic {G} Energy SVE 1' });
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
  await expect(page.getByText('Did you mean Avery Chen?')).toBeVisible();
  await expect(page.locator('.tm-reg-who')).toHaveCount(0);
  await page.getByRole('button', { name: 'No, register Avry Chen' }).click();
  await expect(page.getByText('New registration')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue('Avry');

  await page.getByRole('button', { name: 'Not you?' }).click();
  await lookUp('Avry', 'Chen');
  await page.getByRole('button', { name: 'Avery Chen' }).click();
  await expect(page.locator('.tm-reg-who')).toContainText('Avery Chen');

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Register someone else' }).click();
  // The name exactly as typed opens straight away.
  await lookUp('Avery', 'Chen');
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

test('a full event says so to a newcomer', async ({ page }) => {
  await mockEvent(page, { playerCap: 3 });
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'Player ID' }).fill('999');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('This event is full.')).toBeVisible();
  await expect(page.getByText('A spot opens if someone withdraws.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register' })).toHaveCount(0);
});
