/**
 * Result corrections in the Pairings tab, against mocked functions that
 * correct the event as the real ones do (shared/tournament/corrections.ts).
 * Round 1, viewed during round 2, says it can be corrected; its table menu
 * opens the dialog, which previews the standings before anything is sent and
 * sends the event's version with the correction. Staff who cannot approve
 * are told who can, and a round past the window says why it is locked.
 */

import { expect, type Page, type Route } from '@playwright/test';
import { test } from './network-guard';

import type { Command } from '../../shared/tournament/commands';
import { correctedTournament, type CorrectionEntry } from '../../shared/tournament/corrections';
import { emptyTournament } from '../../shared/tournament/create';
import type { Tournament } from '../../shared/tournament/types';
import { DEFAULT_SETTINGS } from '../../shared/tournament/view';
import { manageOf, organizerMe, runCommands } from './console-fixture';

const CODE = 'FIX001';

/** Every two-player match of the latest round won by its first seat. */
function reportAll(t: Tournament): Tournament {
  const round = t.pods[0]!.rounds.at(-1)!;
  const reports = round.matches
    .filter(m => m.p2 !== null)
    .map((m): Command => ({
      type: 'reportResult',
      pod: 'masters',
      round: round.number,
      table: m.table,
      p1: m.p1,
      p2: m.p2,
      outcome: 'p1'
    }));
  return runCommands(t, ...reports);
}

const NAMES = ['Ada', 'Ben', 'Cy', 'Di', 'Eve', 'Flo', 'Gus', 'Hal'];

/** Eight players, round 1 played, and round 2 paired. */
function inRound2(): Tournament {
  const adds = NAMES.map((firstName): Command => ({ type: 'addPlayer', player: { firstName, lastName: 'Test' } }));
  const played = reportAll(
    runCommands(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' })
  );
  return runCommands(played, { type: 'pairRound', pod: 'masters' });
}

type Body = Record<string, unknown>;

function meRoute(route: Route) {
  return route.fulfill({ json: organizerMe() });
}

/**
 * The console's API, correcting the event as the functions do; every
 * correction sent is recorded. `writesFirst`: how many corrections find the
 * event changed by another write since their preview, as the functions refuse them.
 */
async function mockConsole(page: Page, start: Tournament, approver: 'organizer' | null, writesFirst = 0) {
  let tournament = start;
  let version = 3;
  let writes = writesFirst;
  const sent: Body[] = [];
  const entries: CorrectionEntry[] = [];
  const view = () => manageOf(CODE, tournament, { version, role: approver ? 'owner' : 'staff' });
  function correctionsRoute(route: Route) {
    if (route.request().method() !== 'POST') {
      return route.fulfill({ json: { corrections: entries, headJudge: null, approver } });
    }
    const body = route.request().postDataJSON() as Body;
    sent.push(body);
    if (writes > 0) {
      writes -= 1;
      version += 1;
      return route.fulfill({
        status: 409,
        json: { error: 'The event changed since you looked; check the preview again' }
      });
    }
    const request = body as unknown as Parameters<typeof correctedTournament>[1];
    const from = tournament.pods[0]!.rounds[0]!.matches.find(m => m.table === request.table)!.outcome;
    tournament = correctedTournament(tournament, request, body.localTime as string);
    version += 1;
    entries.unshift({
      ...(request as unknown as Pick<CorrectionEntry, 'pod' | 'round' | 'table' | 'p1' | 'p2'>),
      id: `c${entries.length + 1}`,
      from,
      to: request.outcome,
      note: body.note as string,
      approvedBy: 'Organizer',
      role: 'organizer',
      alone: true,
      during: 2,
      recordedAt: Date.now()
    });
    return route.fulfill({ json: view() });
  }
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const routes: Record<string, () => Promise<void>> = {
      '/api/me': () => meRoute(route),
      [`/api/tournaments/${CODE}/manage`]: () =>
        url.searchParams.get('since') === String(version)
          ? route.fulfill({ status: 204 })
          : route.fulfill({ json: view() }),
      [`/api/tournaments/${CODE}/corrections`]: () => correctionsRoute(route)
    };
    return (routes[url.pathname] ?? (() => route.fulfill({ status: 404, json: { error: 'Not found' } })))();
  });
  await page.goto(`/host/${CODE}`);
  await page.getByRole('button', { name: 'Previous round' }).click();
  return sent;
}

test('the organizer corrects a round 1 result during round 2, after seeing what it changes', async ({ page }) => {
  const t = inRound2();
  const table1 = t.pods[0]!.rounds[0]!.matches.find(m => m.table === 1)!;
  const [winner, loser] = [table1.p1, table1.p2!].map(id => t.players.find(p => p.id === id)!.firstName);
  const sent = await mockConsole(page, t, 'organizer');
  await expect(page.getByText('Round 1 can be corrected until round 3 is paired.')).toBeVisible();

  await page.getByRole('button', { name: 'More for table 1' }).click();
  await page.getByRole('button', { name: 'Correct result' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct round 1, table 1' });
  await expect(dialog).toContainText('Recorded 1–0. Correct to');
  await expect(dialog.getByRole('button', { name: 'Apply correction' })).toBeDisabled();
  await expect(dialog).toContainText('Approving as Organizer, organizer (no head judge named)');

  await dialog.getByRole('radio', { name: `${loser} Test won` }).click();
  await expect(dialog).toContainText('What changes');
  await expect(dialog.locator('.tm-correction-diff tbody tr').filter({ hasText: `${winner} Test` })).toContainText(
    '1-0-0 to 0-1-0'
  );
  await expect(dialog).toContainText("Round 2's pairings stay as they are.");
  await expect(dialog).toContainText('Round 3 pairs from the corrected standings.');

  await dialog.getByRole('button', { name: 'Apply correction' }).click();
  // Under the note, where it is fixed.
  await expect(dialog.locator('#correction-note-error')).toHaveText('Say which slip and what was wrong');
  await expect(dialog.getByLabel('Note')).toHaveAttribute('aria-invalid', 'true');
  expect(sent).toHaveLength(0);
  await dialog.getByLabel('Note').fill('Slip for table 1 has the wrong winner circled.');
  await dialog.getByRole('button', { name: 'Apply correction' }).click();
  await expect(dialog).toBeHidden();

  expect(sent[0]).toMatchObject({
    pod: 'masters',
    round: 1,
    table: 1,
    p1: table1.p1,
    p2: table1.p2,
    outcome: 'p2',
    note: 'Slip for table 1 has the wrong winner circled.',
    version: 3
  });
  const row = page
    .locator('.tm-matches tbody tr')
    .filter({ hasText: `${loser} Test` })
    .first();
  await expect(row).toContainText('0–1');
  await expect(row).toContainText('Corrected');
  const log = page.locator('.tm-corrections');
  await expect(log).toContainText('Table 1');
  await expect(log).toContainText('1–0 to 0–1');
  await expect(log).toContainText('Approved by Organizer, organizer (no head judge named)');
});

test('a correction refused because the event changed reads it again, and the next try goes on the fresh copy', async ({
  page
}) => {
  const t = inRound2();
  const table1 = t.pods[0]!.rounds[0]!.matches.find(m => m.table === 1)!;
  const loser = t.players.find(p => p.id === table1.p2)!.firstName;
  const sent = await mockConsole(page, t, 'organizer', 1);
  await page.getByRole('button', { name: 'More for table 1' }).click();
  await page.getByRole('button', { name: 'Correct result' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct round 1, table 1' });
  await dialog.getByRole('radio', { name: `${loser} Test won` }).click();
  await dialog.getByLabel('Note').fill('Slip for table 1 has the wrong winner circled.');
  await dialog.getByRole('button', { name: 'Apply correction' }).click();
  await expect(dialog).toContainText('The event changed since you looked');
  // The fresh copy doesn't build a new dialog: what was chosen and typed stays.
  await expect(dialog.getByLabel('Note')).toHaveValue('Slip for table 1 has the wrong winner circled.');
  await expect(dialog.getByRole('radio', { name: `${loser} Test won` })).toBeChecked();
  await dialog.getByRole('button', { name: 'Apply correction' }).click();
  await expect(dialog).toBeHidden();
  expect(sent.map(body => body.version)).toEqual([3, 4]);
});

test('staff who cannot approve are told who can, and get no correction to make', async ({ page }) => {
  await mockConsole(page, inRound2(), null);
  await expect(
    page.getByText('Round 1 can be corrected until round 3 is paired, by the organizer or head judge.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'More for table 1' })).toHaveCount(0);
});

test('a round past the window says why it is locked', async ({ page }) => {
  await mockConsole(page, runCommands(reportAll(inRound2()), { type: 'pairRound', pod: 'masters' }), 'organizer');
  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(
    page.getByText('Round 1 can no longer be corrected. Its records locked when round 3 was paired.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'More for table 1' })).toHaveCount(0);
});

test('the organizer names a head judge from the staff in Settings', async ({ page }) => {
  const puts: Body[] = [];
  const staff = [
    { id: 'u2', name: 'Dana Kim' },
    { id: 'u3', name: 'Sam Lee' }
  ];
  let headJudge: { id: string; name: string } | null = null;
  await mockConsole(page, inRound2(), 'organizer');
  await page.route('**/api/tournaments/*/staff', route => route.fulfill({ json: { staff: [] } }));
  await page.route('**/api/tournaments/*/head-judge', route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Body;
      puts.push(body);
      headJudge = staff.find(member => member.id === body.userId) ?? null;
    }
    return route.fulfill({ json: { headJudge, staff } });
  });
  await page.getByRole('tab', { name: 'Settings' }).click();
  const select = page.getByLabel('Head judge');
  await expect(select).toHaveValue('');
  await select.selectOption({ label: 'Dana Kim' });
  await expect(select).toHaveValue('u2');
  await select.selectOption({ label: 'None' });
  await expect(select).toHaveValue('');
  expect(puts).toEqual([{ userId: 'u2' }, { userId: null }]);
});
