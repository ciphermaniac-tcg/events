/**
 * A late entrant's registration on the event's page, against mocked
 * functions: in the round they joined in, the registration tab still takes
 * their list; once the next round pairs, it shows the receipt alone.
 */

import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';

import type { Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import type { Tournament } from '../../shared/tournament/types';
import { assignKeys, DEFAULT_SETTINGS, publicTournament, type PublishedView } from '../../shared/tournament/view';
import { commandRunner, freshContext, pendingResults } from '../__utils__/commands';

const CODE = 'LATELS';
const DECK = '4 Iono PAL 185\n56 Basic {G} Energy SVE 1';

const run = commandRunner(freshContext(3, '10/10/2026 10:00:00'));

const add = (id: string, firstName: string): Command => ({
  type: 'addPlayer',
  player: { firstName, lastName: 'Player', id, birthDate: '02/27/1998' }
});

const pair: Command = { type: 'pairRound', pod: 'masters' };
const finishRound = (t: Tournament) => run(t, ...pendingResults(t.pods.find(pod => pod.rounds.length > 0)!));

/** Round 2 paired with Lena entered late during it, and the same event once round 3 pairs. */
function rounds() {
  const start = run(
    emptyTournament({ name: 'Late Cup' }),
    add('1', 'Ana'),
    add('2', 'Bo'),
    add('3', 'Cy'),
    add('4', 'Di')
  );
  const round2 = run(finishRound(run(start, pair)), pair, add('7777', 'Lena'));
  return { round2, round3: run(finishRound(round2), pair) };
}

const publish = (t: Tournament): PublishedView => ({
  code: CODE,
  mode: 'swiss',
  version: 1,
  updatedAt: 0,
  tournament: publicTournament(t, assignKeys(t, {}), false),
  pending: [],
  reports: [],
  divisions: {},
  decks: {},
  settings: { ...DEFAULT_SETTINGS, decklists: 'open', timeZone: 'America/Chicago' }
});

/** Serves `current()` as the event, and Lena's registration: none until she sends one. */
async function mockEvent(page: Page, current: () => PublishedView) {
  const puts: Record<string, unknown>[] = [];
  const mine = () =>
    puts.length === 0
      ? null
      : {
          popId: '7777',
          firstName: 'Lena',
          lastName: 'Player',
          birthDate: '02/27/1998',
          deck: DECK,
          mode: 'digital',
          archetype: null,
          submittedAt: 0,
          problems: [],
          registered: true,
          fromList: false,
          late: true,
          locked: true
        };
  await page.route(`**/tournaments/v1/${CODE}.json`, route =>
    route.fulfill({ json: current(), headers: { 'access-control-allow-origin': '*' } })
  );
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    if (url.pathname !== `/api/tournaments/${CODE}/decklists`) {
      return route.fulfill({ json: { ...current(), viewer: { role: null, me: null, via: null, signedIn: false } } });
    }
    if (request.method() === 'PUT') {
      puts.push(request.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { decklist: mine(), registration: 'matched', token: 'device-token-0000001' } });
    }
    const asked = url.searchParams;
    const known = asked.get('popId') === '7777' || asked.get('token') !== null;
    return route.fulfill({
      json: { known, ...(known ? { player: { firstName: 'Lena', lastName: 'Player' } } : {}), mine: mine() }
    });
  });
  return { puts };
}

test('a late entrant sends their list in the round they joined in, and it locks when the next round pairs', async ({
  page
}) => {
  const { round2, round3 } = rounds();
  let view = publish(round2);
  const { puts } = await mockEvent(page, () => view);
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'Player ID' }).fill('7777');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('textbox', { name: 'Birth year' }).fill('1998');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.tm-reg-who')).toContainText('Lena Player');
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('button', { name: 'Change name' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw' }), 'the server refuses a late withdrawal').toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByText('Digital').click();
  await page.getByRole('textbox', { name: 'Decklist' }).fill(DECK);
  await page.getByRole('button', { name: /Register|Save changes/ }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toMatchObject({ mode: 'digital', deck: DECK, profile: { popId: '7777' } });

  view = publish(round3);
  await page.reload();
  await expect(page.getByText('Registration closed when the round after you joined was paired.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Decklist' })).toHaveCount(0);
  await expect(page.locator('pre.tm-decklist-sent')).toHaveText(DECK);
});

test('a list sent without an answer stays this device’s to change', async ({ page }) => {
  await mockEvent(page, () => publish(rounds().round2));
  await page.route(`**/api/tournaments/${CODE}/decklists`, route =>
    route.request().method() === 'PUT' ? route.abort('failed') : route.fallback()
  );
  await page.goto(`/t/${CODE}?tab=decklist`);
  await page.getByRole('textbox', { name: 'Player ID' }).fill('7777');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('textbox', { name: 'Birth year' }).fill('1998');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Digital').click();
  await page.getByRole('textbox', { name: 'Decklist' }).fill(DECK);
  await page.getByRole('button', { name: /Register|Save changes/ }).click();
  await expect(page.getByText('Couldn’t reach the site. Check your connection.')).toBeVisible();
  expect(await page.evaluate(code => localStorage.getItem(`cm-decklist:${code}`), CODE)).toContain('"token"');
});

test('during a late entrant’s window a locked list stays a receipt, and a newcomer is told who can still send', async ({
  page
}) => {
  await mockEvent(page, () => publish(rounds().round2));
  await page.goto(`/t/${CODE}?tab=decklist`);
  await expect(page.getByRole('tab', { name: 'Late decklist' })).toBeVisible();
  await expect(
    page.getByText('Round 1 has started. Only a player already in the event can send a late list.')
  ).toBeVisible();
  // Ana's device sent her list before round 1: it locked then, whoever else may still send one.
  await page.addInitScript(code => {
    localStorage.setItem(`cm-decklist:${code}`, JSON.stringify({ token: 'ana-device-token-000001' }));
    sessionStorage.setItem(
      `cm-decklist:${code}`,
      JSON.stringify({ popId: '1', firstName: 'Ana', lastName: 'Player', birthDate: '02/27/1998' })
    );
  }, CODE);
  await page.route(`**/api/tournaments/${CODE}/decklists**`, route =>
    route.fulfill({
      json: {
        known: true,
        player: { firstName: 'Ana', lastName: 'Player' },
        mine: {
          popId: '1',
          firstName: 'Ana',
          lastName: 'Player',
          birthDate: '02/27/1998',
          deck: DECK,
          mode: 'digital',
          archetype: null,
          submittedAt: 0,
          problems: [],
          registered: true,
          fromList: false,
          late: false,
          locked: true,
          editable: false
        }
      }
    })
  );
  await page.reload();
  await expect(page.getByText('Registration closed when round 1 was paired.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Decklist' })).toHaveCount(0);
});
