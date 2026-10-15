/**
 * A Swiss event's console and big screen against mocked functions: a double
 * click on a player records their win at once, the console's head offers the
 * top cut, another round and ending the event once the planned rounds are
 * played, decks are named from Players, the big screen marks each
 * table's winner as results come in, and staff can unlink a player from an
 * account at an unsanctioned event.
 * The event is built with the same shared commands the functions apply.
 */

import { expect, type Page, test } from '@playwright/test';
import { chunkOf } from './build-manifest';

import { applyCommand, type Command } from '../../shared/tournament/commands';
import type { PlayerReport } from '../../shared/tournament/reports';
import type { PlayerRequest } from '../../shared/tournament/requests';
import { emptyTournament } from '../../shared/tournament/create';
import { seededRandom } from '../../shared/tournament/random';
import { regularRounds } from '../../shared/tournament/rounds';
import type { Match, Tournament } from '../../shared/tournament/types';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDivisions,
  publicTournament,
  type TournamentSettings,
  type TournamentView
} from '../../shared/tournament/view';

const CODE = 'SWISS2';

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  let current = tournament;
  for (const command of commands) {
    const ctx = { now: 0, localTime: '09/29/2026 10:00:00', season: 2027, random: seededRandom(3) };
    const result = applyCommand(current, command, ctx);
    if (!result.ok) {
      throw new Error(`${command.type}: ${result.error}`);
    }
    current = result.tournament;
  }
  return current;
}

/** Every open table of the latest round won by the player at seat one. */
function reportAll(t: Tournament): Tournament {
  const pod = t.pods[0];
  const round = pod?.rounds.at(-1);
  const reports: Command[] = (round?.matches ?? [])
    .filter(m => m.p2 !== null && m.outcome === 'pending')
    .map(m => ({
      type: 'reportResult',
      pod: pod?.category ?? 'masters',
      round: round?.number ?? 0,
      ...m,
      outcome: 'p1'
    }));
  return run(t, ...reports);
}

/** The first table of the latest round. */
function firstMatch(t: Tournament): Match {
  const match = t.pods[0]?.rounds.at(-1)?.matches[0];
  if (!match) {
    throw new Error('no table');
  }
  return match;
}

/** An unsanctioned event of `players`, with `rounds` played and one more paired when `paired`. */
function event(players: number, rounds: number, paired: boolean): Tournament {
  const adds: Command[] = Array.from({ length: players }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: `Player${i + 1}`, lastName: 'Test' }
  }));
  let t = run(emptyTournament({ name: 'Friday League' }), ...adds);
  for (let r = 0; r < rounds; r += 1) {
    t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  }
  return paired ? run(t, { type: 'pairRound', pod: 'masters' }) : t;
}

const settingsOf = (patch: Partial<TournamentSettings>): TournamentSettings => ({
  ...DEFAULT_SETTINGS,
  sanctioned: false,
  ...patch
});

/** The console's API: the event as staff see it, and every command and deck sent recorded. */
async function mockConsole(
  page: Page,
  tournament: Tournament,
  settings: TournamentSettings,
  reports: readonly PlayerReport[] = [],
  apply = false,
  requests: PlayerRequest[] = []
) {
  const sent: Command[] = [];
  const answers: unknown[] = [];
  const decks: unknown[] = [];
  const saved: Partial<TournamentSettings>[] = [];
  const manage = {
    code: CODE,
    mode: 'swiss',
    version: 3,
    updatedAt: 0,
    tournament,
    pending: [],
    reports,
    requests,
    settings,
    decks: {},
    role: 'owner',
    staffToken: 'invite',
    store: 'store-1'
  };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      const user = { id: 'u1', name: 'Organizer', avatar: null, popId: null, firstName: null, lastName: null };
      const account = {
        ...user,
        birthDate: null,
        role: 'community',
        stores: [],
        handle: 'organizer',
        publicProfile: false,
        profileName: 'real',
        providers: ['dev']
      };
      return route.fulfill({ json: { user: account, providers: ['dev'] } });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/commands`) {
      const { command } = route.request().postDataJSON() as { command: Command };
      sent.push(command);
      if (apply) {
        manage.tournament = run(manage.tournament, command);
        manage.version += 1;
      }
      return route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/corrections`) {
      return route.fulfill({ json: { corrections: [], headJudge: null, approver: 'organizer' } });
    }
    if (url.pathname === `/api/tournaments/${CODE}/decks`) {
      decks.push(route.request().postDataJSON());
      return route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/requests`) {
      const answer = route.request().postDataJSON() as { id: string; status: PlayerRequest['status'] };
      answers.push(answer);
      manage.requests = manage.requests.map(request =>
        request.id === answer.id ? { ...request, status: answer.status, by: 'Organizer', answeredAt: 1 } : request
      );
      manage.version += 1;
      return route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/settings`) {
      const change = route.request().postDataJSON() as Partial<TournamentSettings>;
      saved.push(change);
      manage.settings = { ...manage.settings, ...change };
      manage.version += 1;
      return route.fulfill({ json: manage });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(`/host/${CODE}`);
  return Object.assign(sent, { decks, saved, answers });
}

test('a double click on a player records their win without asking', async ({ page }) => {
  const t = event(8, 0, true);
  const sent = await mockConsole(page, t, settingsOf({}));
  const table = t.pods[0]?.rounds[0]?.matches[0];
  const winner = page.getByRole('button', { name: 'Report Player' }).first();
  await winner.dblclick();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ type: 'reportResult', round: 1, table: table?.table, p1: table?.p1, outcome: 'p1' });
  await expect(page.getByRole('button', { name: 'Record' })).toHaveCount(0);
});

test('a result shows in its row while it is on its way, and its answer is not read a second time', async ({ page }) => {
  const t = event(8, 0, true);
  const table = t.pods[0]?.rounds[0]?.matches[0];
  if (!table) {
    throw new Error('no table');
  }
  await mockConsole(page, t, settingsOf({}));
  const rows = page.locator('.tm-matches tbody tr:not(.tm-group-row)');
  await expect(rows).toHaveCount(4);
  let answer = () => undefined as void;
  const held = new Promise<void>(resolve => {
    answer = resolve;
  });
  const reads: string[] = [];
  await page.route(`**/api/tournaments/${CODE}/manage*`, route => {
    reads.push(route.request().url());
    return route.fulfill({ status: 204 });
  });
  await page.route(`**/api/tournaments/${CODE}/commands`, async route => {
    await held;
    const tournament = run(t, { type: 'reportResult', pod: 'masters', round: 1, ...table, outcome: 'p1' });
    const manage = { code: CODE, mode: 'swiss', version: 4, updatedAt: 0, tournament, pending: [], reports: [] };
    return route.fulfill({
      json: { ...manage, settings: settingsOf({}), decks: {}, role: 'owner', staffToken: 'invite', store: 'store-1' }
    });
  });
  await rows.evaluateAll(els => els.forEach(el => el.setAttribute('data-kept', '')));
  await page.getByRole('button', { name: 'Report Player' }).first().dblclick();
  // Followed by its number: once its result is in, the table moves under Done.
  const first = rows.filter({ has: page.locator('td.tm-table-col', { hasText: new RegExp(`^${table.table}$`) }) });
  await expect(first.locator('.tm-result-label')).toHaveText('1–0');
  await expect(first.locator('.tm-pending-mark.is-awaiting > [aria-hidden]')).toHaveText(['W?', 'L?']);
  answer();
  await expect(first.locator('.tm-mark.is-win > [aria-hidden]')).toHaveText('W');
  await expect(first.locator('.tm-pending-mark.is-awaiting')).toHaveCount(0);
  await expect(page.locator('.tm-matches tbody tr[data-kept]:not(.tm-group-row)')).toHaveCount(3);
  expect(reads).toEqual([]);
});

/** The console's copy of `t`, as a command or a read answers with it. */
const manageOf = (t: Tournament, version: number) => ({
  code: CODE,
  mode: 'swiss',
  version,
  updatedAt: 0,
  tournament: t,
  pending: [],
  reports: [],
  settings: settingsOf({}),
  decks: {},
  role: 'owner',
  staffToken: 'invite',
  store: 'store-1'
});

/** The row of `match`, found by its table number. */
const rowOf = (page: Page, match: Match) =>
  page
    .locator('.tm-matches tbody tr:not(.tm-group-row)')
    .filter({ has: page.locator('td.tm-table-col', { hasText: new RegExp(`^${match.table}$`) }) });

test('a result the server does not take stays in its row as not saved, and Retry sends it again', async ({ page }) => {
  const t = event(8, 0, true);
  const match = firstMatch(t);
  await mockConsole(page, t, settingsOf({}));
  const tries: Command[] = [];
  await page.route(`**/api/tournaments/${CODE}/commands`, route => {
    const { command } = route.request().postDataJSON() as { command: Command };
    tries.push(command);
    return tries.length === 1
      ? route.fulfill({ status: 503, json: { error: 'Busy; try again' } })
      : route.fulfill({ json: manageOf(run(t, command), 4) });
  });
  await rowOf(page, match).locator('.tm-seat-link').first().dblclick();
  const unsaved = rowOf(page, match).getByRole('group', { name: 'Result not saved' });
  await expect(unsaved.locator('.tm-result-label')).toHaveText(/^Not saved: .+ wins$/);
  await expect(rowOf(page, match).locator('.tm-pending-mark.is-awaiting > [aria-hidden]')).toHaveText(['W?', 'L?']);
  await unsaved.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => tries.length).toBe(2);
  await expect(rowOf(page, match).locator('.tm-pending-mark.is-awaiting')).toHaveCount(0);
  await expect(rowOf(page, match).locator('.tm-mark.is-win > [aria-hidden]')).toHaveText('W');
  expect(tries[1]).toMatchObject({ type: 'reportResult', table: match.table, outcome: 'p1' });
});

test('a retry reads the event first and sends nothing when the result had landed', async ({ page }) => {
  const t = event(8, 0, true);
  const match = firstMatch(t);
  await mockConsole(page, t, settingsOf({}));
  // Loaded first, so the first read is the console's own and not the one below.
  await expect(rowOf(page, match)).toBeVisible();
  const landed = run(t, { type: 'reportResult', pod: 'masters', round: 1, ...match, outcome: 'p1' });
  const tries: Command[] = [];
  let saved = false;
  await page.route(`**/api/tournaments/${CODE}/commands`, route => {
    tries.push((route.request().postDataJSON() as { command: Command }).command);
    // Stored, and the answer lost on its way back.
    saved = true;
    return route.abort('connectionreset');
  });
  await page.route(`**/api/tournaments/${CODE}/manage*`, route =>
    saved ? route.fulfill({ json: manageOf(landed, 4) }) : route.fulfill({ status: 204 })
  );
  await rowOf(page, match).locator('.tm-seat-link').first().dblclick();
  const unsaved = rowOf(page, match).getByRole('group', { name: 'Result not saved' });
  await unsaved.getByRole('button', { name: 'Retry' }).click();
  // The saved result, not the preview a retry shows while it reads the event.
  await expect(rowOf(page, match).locator('.tm-pending-mark.is-awaiting')).toHaveCount(0);
  await expect(rowOf(page, match).locator('.tm-mark.is-win > [aria-hidden]')).toHaveText('W');
  await expect(unsaved).toHaveCount(0);
  expect(tries).toHaveLength(1);
});

test('a failed result can be discarded, and the row reads as it stands', async ({ page }) => {
  const t = event(8, 0, true);
  const match = firstMatch(t);
  await mockConsole(page, t, settingsOf({}));
  await page.route(`**/api/tournaments/${CODE}/commands`, route =>
    route.fulfill({ status: 400, json: { error: 'The reported match has changed' } })
  );
  await rowOf(page, match).locator('.tm-seat-link').first().dblclick();
  await expect(page.getByText('The reported match has changed')).toBeVisible();
  await rowOf(page, match).getByRole('button', { name: 'Discard' }).click();
  await expect(rowOf(page, match).locator('.tm-result-label')).toHaveText('In progress');
});

test('a past round takes no results and says so, with the way back to the current one', async ({ page }) => {
  const sent = await mockConsole(page, event(8, 1, true), settingsOf({}));
  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(page.getByText('Round 1 can be corrected until round 3 is paired.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Report / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear' })).toBeHidden();
  await page.locator('.tm-seat-link').first().dblclick();
  expect([...sent]).toEqual([]);
  await page.getByRole('button', { name: 'Current round' }).click();
  await expect(page.getByRole('combobox', { name: 'Round' })).toHaveValue('2');
  await expect(page.getByRole('button', { name: /^Report / }).first()).toBeVisible();
});

test('a past round’s table extensions show their minutes and keep no timer', async ({ page }) => {
  // Counts the one-second timers alive, as every ticking clock starts one.
  await page.addInitScript(() => {
    const live = new Set<number>();
    const start = window.setInterval.bind(window);
    const stop = window.clearInterval.bind(window);
    Object.assign(window, {
      liveSecondTimers: () => live.size,
      setInterval: (handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
        const id = start(handler, delay, ...rest);
        if (delay === 1000) {
          live.add(id);
        }
        return id;
      },
      clearInterval: (id?: number) => {
        live.delete(id ?? -1);
        stop(id);
      }
    });
  });
  const t = event(64, 1, true);
  for (const match of t.pods[0]!.rounds[0]!.matches) {
    match.timeExtension = { seconds: 180, reason: 'Judge call' };
  }
  await mockConsole(page, t, settingsOf({}));
  const timers = () =>
    page.evaluate(() => (window as unknown as { liveSecondTimers: () => number }).liveSecondTimers());
  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(page.locator('.tm-extension')).toHaveCount(32);
  await expect(page.locator('.tm-extension').first()).toHaveText('+3 min');
  expect(await timers()).toBeLessThan(4);
});

test('a past round stays shown when a colleague’s result changes the event, and a new round shows itself', async ({
  page
}) => {
  const t = event(8, 1, true);
  await mockConsole(page, t, settingsOf({}));
  await page.getByRole('button', { name: 'Previous round' }).click();
  const picker = page.getByRole('combobox', { name: 'Round' });
  await expect(picker).toHaveValue('1');
  const later = (tournament: Tournament, version: number) =>
    page.route('**/manage?since=*', route =>
      route.fulfill({
        json: {
          code: CODE,
          mode: 'swiss',
          version,
          updatedAt: 0,
          tournament,
          pending: [],
          reports: [],
          requests: [],
          settings: settingsOf({}),
          decks: {},
          role: 'owner',
          staffToken: 'invite',
          store: 'store-1'
        }
      })
    );
  const look = async () => {
    const answered = page.waitForResponse(response => response.url().includes('/manage?since='));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await answered;
  };
  const match = t.pods[0]!.rounds[1]!.matches.find(m => m.p2 !== null)!;
  const reported = run(t, { type: 'reportResult', pod: 'masters', round: 2, ...match, outcome: 'p1' } as Command);
  await later(reported, 4);
  await look();
  await expect(picker).toHaveValue('1');

  await page.unroute('**/manage?since=*');
  await later(run(reportAll(reported), { type: 'pairRound', pod: 'masters' }), 5);
  await look();
  await expect(picker).toHaveValue('3');
});

test('a table entered with the mouse keeps its place until the pointer leaves the tables', async ({ page }) => {
  const t = event(8, 0, true);
  await mockConsole(page, t, settingsOf({}), [], true);
  const rows = page.locator('.tm-matches tbody tr:not(.tm-group-row)');
  const first = firstMatch(t);
  await expect(rows.first().locator('td.tm-table-col')).toHaveText(String(first.table));
  await rowOf(page, first).locator('.tm-seat-link').first().dblclick();
  await expect(rowOf(page, first).locator('.tm-result-label')).toHaveText('1–0');
  await expect(rows.first().locator('td.tm-table-col')).toHaveText(String(first.table));
  await expect(page.locator('.tm-group-row')).toHaveCount(0);
  await page.mouse.move(1, 1);
  await expect(page.locator('.tm-group-row')).toHaveText(['In progress · 3', 'Done · 1']);
  await expect(rows.last().locator('td.tm-table-col')).toHaveText(String(first.table));
});

test('after the planned rounds the step is the top cut, set in a dialog, with another round and the end behind it', async ({
  page
}) => {
  // Sixteen players play five rounds and a top 4, as Play! Pokémon recommends.
  const sent = await mockConsole(page, event(16, 5, false), settingsOf({}));
  await expect(page.getByText('Round 5 of 5 complete')).toBeVisible();
  const step = page.locator('.tm-split');
  await expect(step.getByRole('button', { name: 'Start top cut' })).toHaveClass(/btn-primary/);
  await step.getByRole('button', { name: 'Other next steps' }).click();
  await expect(step.locator('.tm-menu-item')).toHaveText(['Pair round 6', 'End event']);
  await page.keyboard.press('Escape');
  await step.getByRole('button', { name: 'Start top cut' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start the top cut' });
  await expect(
    dialog.getByRole('radiogroup', { name: 'Top cut size' }).getByRole('radio', { checked: true })
  ).toHaveText('Top 4');
  await dialog.getByRole('radio', { name: 'Top 8' }).click();
  await dialog.getByLabel('Third place match').check();
  await dialog.getByRole('button', { name: 'Start top 8 cut' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'startTopCut', size: 8, playoff3rd4th: true });
});

function prerelease(rounds: number): Tournament {
  let t = event(9, 0, false);
  t = { ...t, info: { ...t.info, eventType: 'prerelease', finalsRoundTime: 30 } };
  for (let i = 0; i < rounds; i += 1) {
    t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  }
  return t;
}

test('Prerelease offers per-pod conclusion from round 3 @mobile', async ({ page }) => {
  const t = prerelease(3);
  const sent = await mockConsole(page, t, settingsOf({}), [], true);
  const step = page.locator('.tm-split');
  await step.getByRole('button', { name: 'Other next steps' }).click();
  await expect(step.getByRole('button', { name: 'End event', exact: true })).toHaveCount(0);
  await step.getByRole('button', { name: 'Conclude pod', exact: true }).click();
  await expect.poll(() => sent.at(-1)).toEqual({ type: 'concludePrerelease', pod: 'masters' });
  await expect(step.getByRole('button', { name: 'End event', exact: true })).toBeVisible();
});

test('Prerelease before round 3 has no early conclusion; its stored short time is raised on opening settings', async ({
  page
}) => {
  const t = prerelease(2);
  t.info.roundTime = 20;
  await mockConsole(page, t, settingsOf({}));
  await page.getByRole('button', { name: 'Other next steps' }).click();
  await expect(page.getByRole('button', { name: 'Conclude pod', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#info-round')).toHaveValue('30');
  await expect(page.locator('#info-round')).toHaveAttribute('min', '20');
  await expect(page.locator('#info-round')).toHaveAttribute('max', '90');
  await expect(page.locator('#info-finals')).toBeDisabled();
  await expect(page.locator('#info-finals')).toHaveValue('30');
});

test('ending the event from the next step asks first, in a dialog that reviews what is left', async ({ page }) => {
  const sent = await mockConsole(page, event(16, 5, false), settingsOf({}));
  const step = page.locator('.tm-split');
  await step.getByRole('button', { name: 'Other next steps' }).click();
  await step.locator('.tm-menu-item', { hasText: 'End event' }).click();
  const dialog = page.getByRole('dialog', { name: 'End the event early?' });
  await expect(dialog.locator('.tm-end-gaps li')).toHaveText(['Top cut not played']);
  await dialog.getByRole('button', { name: 'Keep running' }).click();
  await expect(dialog).toBeHidden();
  expect(sent.saved).toEqual([]);
});

test('a capped league that has played its rounds ends as planned', async ({ page }) => {
  const sent = await mockConsole(page, event(6, 3, false), settingsOf({ roundCap: 3 }));
  await page.locator('.tm-split > .btn', { hasText: 'End event' }).click();
  const dialog = page.getByRole('dialog', { name: 'End the event?' });
  await expect(dialog.locator('.tm-end-gaps')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'End event' }).click();
  await expect.poll(() => sent.saved).toEqual([{ finished: true }]);
  await expect(page.getByText('The event has ended. Reopen it to change results.')).toBeVisible();
});

test('ending from Settings with tables open lists them and ends the event early', async ({ page }) => {
  const sent = await mockConsole(page, event(8, 0, true), settingsOf({}));
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'End event' }).click();
  const dialog = page.getByRole('dialog', { name: 'End the event early?' });
  await expect(dialog.locator('.tm-end-gaps li')).toHaveText(['Round 1: 4 tables open']);
  await dialog.getByRole('button', { name: 'End early' }).click();
  await expect.poll(() => sent.saved).toEqual([{ finished: true }]);
  await expect(page.getByRole('button', { name: 'Reopen event' })).toBeVisible();
});

test('an ended event locks its results, round controls and roster until it is reopened', async ({ page }) => {
  const t = run(event(4, 0, true), {
    type: 'reportResult',
    pod: 'masters',
    round: 1,
    ...firstMatch(event(4, 0, true)),
    outcome: 'p1'
  });
  const sent = await mockConsole(page, t, settingsOf({ finished: true }));
  await expect(page.getByText('The event has ended. Reopen it to change results.')).toBeVisible();
  const rows = page.locator('.tm-matches tbody tr:not(.tm-group-row)');
  await expect(rows.first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Report / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear' })).toBeHidden();
  await expect(page.getByRole('button', { name: /^More for table/ })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Delete round' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Swap players' })).toHaveCount(0);
  await page.locator('.tm-seat-link').first().dblclick();
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page.getByRole('form', { name: 'Add a player' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  expect([...sent]).toEqual([]);
  await page.getByRole('tab', { name: 'Pairings' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen event' }).click();
  await expect.poll(() => sent.saved).toEqual([{ finished: false }]);
});

test('clearing a result confirms as Clear', async ({ page }) => {
  const t = run(event(4, 0, true), {
    type: 'reportResult',
    pod: 'masters',
    round: 1,
    ...firstMatch(event(4, 0, true)),
    outcome: 'p1'
  });
  const sent = await mockConsole(page, t, settingsOf({}));
  await page.getByRole('button', { name: 'Clear' }).first().click();
  const asking = page.getByRole('group', { name: 'Confirm result' });
  await expect(asking.locator('.tm-result-label')).toHaveText('Clear the result?');
  await asking.getByRole('button', { name: 'Clear' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'reportResult', outcome: 'pending' });
});

test('every Swiss round ends with another round as the step, the top cut and the end behind it', async ({ page }) => {
  // Sixteen players plan five rounds, so after round 2 another round is the step.
  await mockConsole(page, event(16, 2, false), settingsOf({}));
  const step = page.locator('.tm-split');
  await expect(step.locator('> .btn')).toHaveText('Pair round 3');
  await step.getByRole('button', { name: 'Other next steps' }).click();
  await expect(step.locator('.tm-menu-item')).toHaveText(['Start top cut', 'End event']);
});

test("an open table shows its players' reports in its one row, and a lone report can be accepted", async ({ page }) => {
  const t = event(8, 0, true);
  const [lone, disputed] = t.pods[0]?.rounds[0]?.matches ?? [];
  if (!lone?.p2 || !disputed?.p2) {
    throw new Error('the event has no first two tables');
  }
  const report = (m: Match, by: string, outcome: PlayerReport['outcome']): PlayerReport => ({
    pod: 'masters',
    round: 1,
    table: m.table,
    p1: m.p1,
    p2: m.p2 ?? '',
    by,
    outcome,
    at: 0
  });
  const sent = await mockConsole(page, t, settingsOf({ playerReporting: true }), [
    report(lone, lone.p2, 'p2'),
    report(disputed, disputed.p1, 'p1'),
    report(disputed, disputed.p2, 'p2')
  ]);
  const rows = page.locator('.tm-matches tbody tr');
  const first = rows.filter({ has: page.locator('.tm-result-label.is-reported:not(.is-problem)') });
  await expect(first.locator('.tm-result-label')).toHaveText(/^Reported\. Reported: .+ wins$/);
  await expect(first.locator('.tm-pending-mark > [aria-hidden]')).toHaveText(['L?', 'W?']);
  const second = rows.filter({ has: page.locator('.tm-result-label.is-problem') });
  await expect(second.locator('.tm-result-label')).toHaveText(/^Disputed\. Reports differ\./);
  await expect(second.locator('.tm-pending-mark.is-problem > [aria-hidden]')).toHaveText(['W?', 'W?']);
  await expect(second.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  await first.getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'reportResult', table: lone.table, outcome: 'p2' });
  await expect(page.locator('.tm-result.is-asking')).toHaveCount(0);
});

test('a capped league ends after its rounds instead of pairing on', async ({ page }) => {
  const sent = await mockConsole(page, event(6, 3, false), settingsOf({ roundCap: 3 }));
  await expect(page.getByText('Round 3 of 3 complete')).toBeVisible();
  const step = page.locator('.tm-split');
  await expect(step.locator('> .btn')).toHaveText('End event');
  await step.getByRole('button', { name: 'Other next steps' }).click();
  await step.locator('.tm-menu-item', { hasText: 'Pair round 4' }).click();
  await expect.poll(() => sent.map(c => c.type)).toEqual(['pairRound']);
});

test('the last planned round waits on its open tables before the decision', async ({ page }) => {
  await mockConsole(page, event(6, 2, true), settingsOf({ roundCap: 3 }));
  await expect(page.getByRole('button', { name: 'End event' })).toBeDisabled();
  await expect(page.getByText('3 tables open')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pair round 4' })).toHaveCount(0);
});

test('with decklists off the console has no Decklists tab', async ({ page }) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  await expect(page.getByRole('tab', { name: 'Pairings' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Decklists' })).toHaveCount(0);
});

test('before round 1 the console opens on Players, and Pairings says why it is locked', async ({ page }) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  await expect(page.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
  const pairings = page.getByRole('tab', { name: 'Pairings' });
  await expect(pairings).toHaveAttribute('aria-disabled', 'true');
  await expect(pairings).toHaveAccessibleDescription('Pairings open once round 1 starts.');
  await pairings.click({ force: true });
  await expect(page.locator('.tabs .info-tip-bubble', { hasText: 'Pairings open once round 1 starts.' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
});

test('the console’s tabs move with the arrow keys, pass over a locked one, and name the panel they open', async ({
  page
}) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  const tabs = page.getByRole('tablist', { name: 'Event sections' }).first();
  const players = tabs.getByRole('tab', { name: 'Players' });
  await expect(players).toHaveAttribute('tabindex', '0');
  await expect(tabs.getByRole('tab', { name: 'Standings' })).toHaveAttribute('tabindex', '-1');
  await players.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.getByRole('tab', { name: 'Pairings' })).toBeFocused();
  await expect(players).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  const settings = tabs.getByRole('tab', { name: 'Settings' });
  await expect(settings).toBeFocused();
  await expect(settings).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible();
  await expect(settings).toHaveAttribute('aria-controls', 'console-panel');
});

test('a player row keeps its rarer actions and fixed table under its menu', async ({ page }) => {
  const sent = await mockConsole(page, event(4, 0, false), settingsOf({}));
  await expect(page.getByRole('button', { name: 'Drop' })).toHaveCount(0);
  await page
    .getByRole('button', { name: /^More for / })
    .first()
    .click();
  const menu = page.getByRole('group', { name: /^More for / });
  await expect(menu.getByRole('button', { name: 'Disqualify' })).toBeVisible();
  await menu.getByRole('textbox', { name: /^Fixed table for / }).fill('7');
  await menu.getByRole('textbox', { name: /^Fixed table for / }).press('Enter');
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'setFixedTable', table: 7 });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('a player is corrected from their menu: the name, and a sanctioned event’s birth year', async ({ page }) => {
  const sent = await mockConsole(page, event(4, 0, true), settingsOf({ sanctioned: true }));
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page.locator('.tm-who-sub').first()).toContainText('Provisional ID');
  await page
    .getByRole('button', { name: /^More for / })
    .first()
    .click();
  await page
    .getByRole('group', { name: /^More for / })
    .getByRole('button', { name: 'Edit' })
    .click();
  await expect(page.getByRole('group', { name: /^More for / })).toHaveCount(0);
  const dialog = page.getByRole('dialog', { name: 'Edit player' });
  await dialog.getByLabel('Last name').fill('Tester');
  await expect(dialog.getByText('Enter a four-digit year')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await dialog.getByLabel('Birth year').fill('1988');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => sent.at(-1))
    .toMatchObject({ type: 'editPlayer', lastName: 'Tester', birthDate: '02/27/1988' });
});

test('a sanctioned event adds a player only with their Player ID and birth year', async ({ page }) => {
  const sent = await mockConsole(page, event(4, 0, false), settingsOf({ sanctioned: true }));
  const form = page.getByRole('form', { name: 'Add a player' });
  const add = form.getByRole('button', { name: 'Add player' });
  await form.getByLabel('First name').fill('Sam');
  await form.getByLabel('Last name').fill('Lee');
  await form.getByLabel('Birth year').fill('2001');
  await expect(add).toBeDisabled();
  await form.getByLabel('Player ID').fill('4242');
  await form.getByLabel('Birth year').fill('');
  await expect(add).toBeDisabled();
  await form.getByLabel('Birth year').fill('2001');
  await add.click();
  await expect
    .poll(() => sent.at(-1))
    .toMatchObject({ type: 'addPlayer', player: { id: '4242', birthDate: '02/27/2001' } });
});

test('an unsaved setting survives a switch to another tab', async ({ page }) => {
  const sent = await mockConsole(page, event(4, 0, true), settingsOf({}));
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Event description').fill('Doors at nine');
  await page.getByLabel('Event name').fill('Friday Night League');
  await page.getByRole('tab', { name: 'Pairings' }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByLabel('Event description')).toHaveValue('Doors at nine');
  await expect(page.getByLabel('Event name')).toHaveValue('Friday Night League');
  await expect(page.getByText('Unsaved changes')).toHaveCount(2);
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect.poll(() => sent.at(-1)).toEqual({ type: 'updateInfo', info: { name: 'Friday Night League' } });
});

test('a colleague’s change shows in an untouched setting, and saving sends only what was edited', async ({ page }) => {
  const settings = settingsOf({});
  const sent = await mockConsole(page, event(4, 0, true), settings);
  await page.getByRole('tab', { name: 'Settings' }).click();
  const reporting = page.getByRole('radiogroup', { name: 'Mobile result reporting' });
  await expect(reporting.getByRole('radio', { name: 'Disabled' })).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Event description').fill('Doors at nine');
  // A colleague turns reporting on; the console's next look brings it in.
  const changed = { ...manageOf(event(4, 0, true), 9), settings: { ...settings, playerReporting: true } };
  await page.route(`**/api/tournaments/${CODE}/manage*`, route => route.fulfill({ json: changed }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(reporting.getByRole('radio', { name: 'Enabled' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Event description')).toHaveValue('Doors at nine');
  const box = page.locator('section', { has: page.getByRole('heading', { name: 'For players' }) });
  await box.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.saved).toEqual([{ details: 'Doors at nine' }]);
});

test('a standalone event downloads its .tdf, named for the version it copies', async ({ page }) => {
  await mockConsole(page, event(4, 1, false), settingsOf({ sanctioned: false }));
  await page.getByRole('tab', { name: 'Settings' }).click();
  const row = page.locator('.tm-set-row', { hasText: 'Event file' });
  await expect(row.getByText('Version 3')).toBeVisible();
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download .tdf' }).click();
  expect((await download).suggestedFilename()).toBe('Friday League v3.tdf');
});

test('decks are named from Players, and a name the list lacks is taken as typed', async ({ page }) => {
  const t = event(8, 0, true);
  const sent = await mockConsole(page, t, settingsOf({ deckVisibility: 'always' }));
  await expect(page.getByRole('button', { name: 'Enter decks' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Players' }).click();
  const picker = page.getByRole('combobox', { name: 'Deck' }).first();
  await picker.fill('Homebrew Box');
  await expect(page.getByRole('option', { name: /Homebrew Box/ })).toBeVisible();
  await picker.press('Enter');
  await expect
    .poll(() => sent.decks)
    .toEqual([{ playerId: t.players.find(p => p.firstName === 'Player1')?.id, archetype: 'Homebrew Box' }]);
});

test('a deck list opened in the last row is drawn whole, not cut off at the table', async ({ page }) => {
  // The tables clip their overflow, and the list used to hang inside them: in
  // the bottom row it showed as a sliver under the field.
  await mockConsole(page, event(8, 0, true), settingsOf({ deckVisibility: 'always' }));
  await expect(page.getByRole('button', { name: 'Enter decks' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Players' }).click();
  await page.getByRole('combobox', { name: 'Deck' }).last().focus();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  // The deck options load after the list opens; measure it once they are in.
  await expect.poll(() => list.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(100);
  const drawn = await list.evaluate(el => {
    const r = el.getBoundingClientRect();
    const corners: [number, number][] = [
      [r.left + 4, r.top + 4],
      [r.right - 4, r.bottom - 4]
    ];
    return {
      tall: r.height > 100,
      onScreen: r.top >= 0 && r.bottom <= window.innerHeight,
      uncovered: corners.every(([x, y]) => el.contains(document.elementFromPoint(x, y)))
    };
  });
  expect(drawn).toEqual({ tall: true, onScreen: true, uncovered: true });
});

test('a Pokémon no archetype list names is offered with its sprite', async ({ page }) => {
  const t = event(8, 0, true);
  const sent = await mockConsole(page, t, settingsOf({ deckVisibility: 'always' }));
  await expect(page.getByRole('button', { name: 'Enter decks' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Players' }).click();
  const picker = page.getByRole('combobox', { name: 'Deck' }).first();
  await picker.fill('Tyrantrum');
  const option = page.getByRole('option', { name: /Tyrantrum/ });
  await expect(option).toHaveCount(1);
  await expect(option).not.toContainText('Custom');
  await expect(option.locator('img[src$="/tyrantrum.png"]')).toHaveCount(1);
  await picker.press('Enter');
  await expect
    .poll(() => sent.decks)
    .toEqual([{ playerId: t.players.find(p => p.firstName === 'Player1')?.id, archetype: 'Tyrantrum' }]);
});

test('the big screen marks who won each finished table', async ({ page }) => {
  let t = event(8, 0, true);
  const first = t.pods[0]?.rounds[0]?.matches[0];
  if (!first) {
    throw new Error('no table');
  }
  t = run(t, { type: 'reportResult', pod: 'masters', round: 1, ...first, outcome: 'p2' });
  const keys = assignKeys(t, {});
  const view: TournamentView = {
    code: CODE,
    mode: 'swiss',
    version: 2,
    updatedAt: 0,
    tournament: publicTournament(t, keys, true),
    pending: [],
    reports: [],
    divisions: publicDivisions(t, keys, 0),
    decks: {},
    settings: settingsOf({}),
    viewer: { role: null, me: null, via: null, signedIn: false }
  };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: view });
  });
  await page.goto(`/t/${CODE}?screen=1`);
  await expect(page.locator('.tm-screen-status')).toContainText('Round 1 of 3');
  const done = page.locator('.tm-screen-tables li.is-done');
  await expect(done).toHaveCount(1);
  await expect(done.locator('.tm-screen-seat.is-win')).toHaveCount(1);
  await expect(done.locator('.tm-screen-seat.is-out')).toHaveCount(1);
  // The second seat won: its mark faces it, on the right.
  await expect(done.locator('.tm-screen-score .tm-screen-mark')).toHaveText(['L', 'W']);
  await expect(page.locator('.tm-screen-mark')).toHaveCount(2);
});

test('on a phone a roster question asked from the row menu stays on screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockConsole(page, event(4, 0, false), settingsOf({ playerReporting: true }));
  // A phone's tabs sit in the bar along the bottom.
  await page.getByRole('navigation', { name: 'Event sections' }).getByRole('button', { name: 'Players' }).click();
  await page
    .getByRole('button', { name: /^More for / })
    .first()
    .click();
  await page.getByRole('button', { name: 'Reset reporting' }).first().click();
  const question = page.getByRole('group', { name: /Let another device report for/ });
  await expect(question).toBeVisible();
  const asked = await question.boundingBox();
  expect(asked?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((asked?.x ?? 0) + (asked?.width ?? Infinity)).toBeLessThanOrEqual(360);
});

test('a division cut stays in the shared pod and pairs the next bracket round', async ({ page }) => {
  // TOM combines five Juniors and ten Seniors in category 10; Seniors then cut to their own top four.
  const adds: Command[] = [...Array(5).fill('2016'), ...Array(10).fill('2012')].map((year: string, i) => ({
    type: 'addPlayer',
    player: { firstName: `Player${i + 1}`, lastName: 'Test', birthDate: `02/27/${year}` }
  }));
  let t = run(emptyTournament({ name: 'Friday League' }), ...adds);
  for (let pod = t.pods[0]; pod && pod.rounds.length < regularRounds(t, pod); pod = t.pods[0]) {
    t = reportAll(run(t, { type: 'pairRound', pod: 'mixed' }));
  }
  t = run(t, { type: 'startTopCut', pod: 'mixed', size: 4, division: 'senior' });
  await mockConsole(page, t, settingsOf({}));
  await expect(page.getByRole('radiogroup', { name: 'Division' })).toHaveCount(0);
  await expect(page.locator('.tm-hero')).toContainText('Semifinals');
  await expect(page.getByRole('button', { name: 'Pair the final' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Pair round/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Division to cut' })).toHaveCount(0);
  const finished = reportAll(t);
  const sent = await mockConsole(page, finished, settingsOf({}));
  await page.getByRole('button', { name: 'Pair the final' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'pairRound', pod: 'mixed' });
});

test('at an unsanctioned event where players do not report, staff can unlink a player from an account', async ({
  page
}) => {
  const released: string[] = [];
  page.on('request', request => {
    if (request.method() === 'DELETE') {
      released.push(new URL(request.url()).search);
    }
  });
  const t = event(4, 0, false);
  await mockConsole(page, t, settingsOf({ playerReporting: false }));
  await page.getByRole('tab', { name: 'Players' }).click();
  await page
    .getByRole('button', { name: /^More for / })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Reset reporting' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Unlink account' }).first().click();
  await page
    .getByRole('group', { name: /from their account\?$/ })
    .getByRole('button', { name: 'Unlink' })
    .click();
  await expect.poll(() => released).toEqual([`?player=${t.players[0]?.id ?? ''}`]);
});

/** An event's latest round with its first `done` tables won by their first seat. */
function partlyPlayed(players: number, rounds: number, done: number): Tournament {
  const t = event(players, rounds, true);
  const round = t.pods[0]?.rounds.at(-1);
  if (round) {
    round.matches = round.matches.map((m, i) => (i < done ? { ...m, outcome: 'p1' } : m));
  }
  return t;
}

test('while a round plays, its tables in progress lead under their heading and the finished follow', async ({
  page
}) => {
  await mockConsole(page, partlyPlayed(8, 1, 1), settingsOf({}));
  const box = page.locator('.tm-matches');
  await expect(box.locator('.tm-group-row')).toHaveText(['In progress · 3', 'Done · 1']);
  const rows = box.locator('tbody tr:not(.tm-group-row)');
  await expect(rows.first().locator('.tm-result-label')).toHaveText('In progress');
  await expect(rows.last().locator('.tm-result-label')).toHaveText('1–0');
  const show = page.getByRole('radiogroup', { name: 'Show' });
  await expect(show.getByRole('radio', { name: /In progress/ })).toHaveText('In progress3');
  await show.getByRole('radio', { name: /In progress/ }).click();
  await expect(rows).toHaveCount(3);
  await expect(box.locator('.tm-group-row')).toHaveCount(0);
  // One choice of two: only the chosen one is a tab stop, and the arrows choose the other.
  await expect(show.getByRole('radio', { name: 'All tables' })).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowLeft');
  await expect(show.getByRole('radio', { name: 'All tables' })).toBeFocused();
  await expect(show.getByRole('radio', { name: 'All tables' })).toHaveAttribute('aria-checked', 'true');
  await expect(rows).toHaveCount(4);
});

test('the round stepper walks the rounds either side of the picker, and the clock runs from the head', async ({
  page
}) => {
  await mockConsole(page, partlyPlayed(8, 2, 0), settingsOf({}));
  const round = page.getByRole('combobox', { name: 'Round' });
  await expect(round).toHaveValue('3');
  await expect(page.getByRole('button', { name: 'Next round' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(round).toHaveValue('2');
  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(round).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Previous round' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next round' }).click();
  await expect(round).toHaveValue('2');
  await expect(page.locator('.tm-console-hero').getByRole('group', { name: 'Round clock' })).toBeVisible();
  await expect(page.locator('.tm-box').getByRole('group', { name: 'Round clock' })).toHaveCount(0);
  await expect(page.locator('.tm-meta-lead')).toContainText('Round 3 of 3 in progress');
});

test('900px and under a table opens a sheet of its results, and a press there records at once', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  const t = partlyPlayed(8, 0, 0);
  const sent = await mockConsole(page, t, settingsOf({}));
  const table = t.pods[0]?.rounds[0]?.matches[0];
  const rows = page.locator('.tm-matches tbody tr:not(.tm-group-row)');
  await expect(rows.first().getByRole('button', { name: 'Tie' })).toBeHidden();
  await expect(page.getByText('Press a player to report their win')).toHaveCount(0);
  await rows.first().click();
  const sheet = page.getByRole('dialog', { name: `Result, table ${table?.table}` });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button')).toHaveText(['...', / wins$/, / wins$/, 'Tie', 'Double loss', 'Cancel']);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  const chevron = rows.first().getByRole('button', { name: `Enter the result of table ${table?.table}` });
  await chevron.click();
  await expect(sheet).toBeFocused();
  // Only the sheet, and the scrim that closes it, can be reached while it is open.
  await expect(page.locator('.site-head')).toHaveJSProperty('inert', true);
  expect(await chevron.evaluate(el => el.closest('[inert]') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(chevron).toBeFocused();
  await chevron.click();
  await page.locator('.tm-result-scrim').click({ position: { x: 10, y: 10 } });
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.site-head')).toHaveJSProperty('inert', false);
  await chevron.click();
  await sheet.getByRole('button', { name: 'Tie' }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ type: 'reportResult', table: table?.table, outcome: 'tie' });
});

test('on a phone the tabs sit along the bottom, and the round and its clock stay pinned @mobileOnly', async ({
  page
}) => {
  await mockConsole(page, partlyPlayed(8, 0, 2), settingsOf({}));
  await expect(page.locator('.tm-console > .tabs')).toBeHidden();
  const bar = page.getByRole('navigation', { name: 'Event sections' });
  await expect(bar.getByRole('button', { name: 'Pairings' })).toHaveAttribute('aria-current', 'page');
  const pin = page.locator('.tm-round-pin');
  await expect(pin.getByRole('combobox', { name: 'Round' })).toBeVisible();
  await expect(pin.getByRole('group', { name: 'Round clock' })).toBeVisible();
  await expect(page.locator('.tm-console-hero').getByRole('group', { name: 'Round clock' })).toBeHidden();
  await expect(page.locator('.tm-matches td.tm-table-col').first()).toHaveText(/\d/);
  await bar.getByRole('button', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/tab=standings/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('the console leads back to the dashboard’s Organizing tab, above the event’s name @mobile', async ({ page }) => {
  await mockConsole(page, event(8, 0, true), settingsOf({}));
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(trail.getByRole('link', { name: 'Your events' })).toHaveAttribute('href', '/?tab=organizing');
  await expect(trail.locator('[aria-current="page"]')).toHaveText(
    await page.locator('.tm-console-hero h1').innerText()
  );
});

test('result options stay behind the menu and preserve manual confirmation', async ({ page }) => {
  const sent = await mockConsole(page, event(4, 0, true), settingsOf({}));
  const more = page.getByRole('button', { name: 'More for table 1', exact: true });
  const menu = page.getByRole('group', { name: 'More for table 1', exact: true });
  await expect(page.getByRole('button', { name: 'Tie', exact: true })).toHaveCount(0);
  await more.click();
  await expect(menu.getByRole('button', { name: 'Tie', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  for (const [label, outcome] of [
    ['Tie', 'tie'],
    ['Double loss', 'double-loss']
  ]) {
    await more.click();
    await menu.getByRole('button', { name: label, exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator('.tm-result.is-asking')).toBeVisible();
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'reportResult', table: 1, outcome });
  }
});

test('organizer pairing rows stay compact and keep separate yellow player hover in both themes', async ({ page }) => {
  await mockConsole(page, event(8, 1, true), settingsOf({}));
  const winner = page.getByRole('button', { name: /^Report Player/ }).first();
  const row = page.locator('.tm-matches tbody tr', { has: winner });
  for (const mode of ['light', 'dark']) {
    await page.locator('body').evaluate((el, value) => el.setAttribute('data-mode', value), mode);
    await expect(winner).toHaveCSS('font-size', '14px');
    const geometry = await winner.evaluate(el => {
      const name = el.querySelector('.tm-name')?.getBoundingClientRect();
      const record = el.querySelector('.tm-record')?.getBoundingClientRect();
      return {
        height: el.closest('tr')?.getBoundingClientRect().height ?? 0,
        alignment: name && record ? Math.abs(name.top + name.height / 2 - record.top - record.height / 2) : Infinity
      };
    });
    expect(geometry.height).toBeLessThanOrEqual(54);
    expect(geometry.alignment).toBeLessThan(1);
    await winner.click();
    await winner.hover();
    const playerFill = await winner.evaluate(el => getComputedStyle(el).backgroundColor);
    const rowFill = await row
      .locator('td')
      .first()
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(playerFill).not.toBe(rowFill);
    await expect(row.locator('.tm-result.is-asking')).toHaveCSS('background-color', 'rgb(255, 219, 88)');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});

test('first-name predictions fill the selected profile without registering it @mobile', async ({ page }) => {
  const sent = await mockConsole(page, event(0, 0, false), settingsOf({ sanctioned: true }));
  await page.route(`**/api/tournaments/${CODE}/players?*`, route =>
    route.fulfill({
      json: {
        players: [{ firstName: 'Alex', lastName: 'Morgan', popId: '1234567', birthYear: 1998 }]
      }
    })
  );
  const first = page.getByRole('combobox', { name: 'First name', exact: true });
  await first.fill('Al');
  const option = page.getByRole('option', { name: 'Alex Morgan 1234567' });
  await expect(option).toBeVisible();
  await first.press('ArrowDown');
  await first.press('Enter');
  await expect(first).toHaveValue('Alex');
  await expect(page.getByLabel('Last name', { exact: true })).toHaveValue('Morgan');
  await expect(page.getByLabel('Player ID', { exact: true })).toHaveValue('1234567');
  await expect(page.getByLabel('Birth year', { exact: true })).toHaveValue('1998');
  expect(sent).toHaveLength(0);
  await expect(option).toHaveCount(0);
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  await expect
    .poll(() => sent[0])
    .toMatchObject({
      type: 'addPlayer',
      player: {
        firstName: 'Alex',
        lastName: 'Morgan',
        id: '1234567',
        birthDate: '02/27/1998'
      }
    });
  await expect(first).toBeFocused();
  await expect(first).toHaveValue('');
});

test('predictions allow pointer selection and Escape keeps a new player’s typed name @mobile', async ({ page }) => {
  const sent = await mockConsole(page, event(0, 0, false), settingsOf({}));
  await page.route(`**/api/tournaments/${CODE}/players?*`, route =>
    route.fulfill({
      json: {
        players: [{ firstName: 'Alex', lastName: 'Morgan', popId: '', birthYear: null }]
      }
    })
  );
  const first = page.getByRole('combobox', { name: 'First name', exact: true });
  await first.fill('Al');
  await page.getByRole('option', { name: 'Alex Morgan', exact: true }).click();
  await expect(first).toHaveValue('Alex');
  await expect(page.getByLabel('Last name', { exact: true })).toHaveValue('Morgan');
  await first.fill('Alfred');
  await expect(page.getByRole('listbox', { name: 'Returning players' })).toBeVisible();
  await first.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Returning players' })).toHaveCount(0);
  await expect(first).toHaveValue('Alfred');
  await page.getByLabel('Last name', { exact: true }).fill('Newplayer');
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  await expect
    .poll(() => sent[0])
    .toMatchObject({ type: 'addPlayer', player: { firstName: 'Alfred', lastName: 'Newplayer' } });
});

test('failed predictions still allow manual registration', async ({ page }) => {
  const sent = await mockConsole(page, event(0, 0, false), settingsOf({}));
  await page.route(`**/api/tournaments/${CODE}/players?*`, route =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } })
  );
  await page.getByRole('combobox', { name: 'First name', exact: true }).fill('New');
  await expect(page.getByText('Player suggestions unavailable')).toBeVisible();
  await page.getByLabel('Last name', { exact: true }).fill('Player');
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  await expect
    .poll(() => sent[0])
    .toMatchObject({ type: 'addPlayer', player: { firstName: 'New', lastName: 'Player' } });
});
async function openExtension(page: Page, table: number) {
  if ((page.viewportSize()?.width ?? 1000) <= 900) {
    await page
      .locator('.tm-matches tbody tr:not(.tm-group-row)')
      .filter({ has: page.locator('.tm-table-num', { hasText: String(table) }) })
      .first()
      .click();
  }
  await page.getByRole('button', { name: `More for table ${table}`, exact: true }).click();
  await page.getByRole('button', { name: 'Time extension', exact: true }).click();
  return page.getByRole('dialog', { name: `Time extension, table ${table}`, exact: true });
}

test('table extensions use the match menu and support editing and removal @mobile', async ({ page }) => {
  const t = event(4, 0, true);
  const round = t.pods[0]!.rounds[0]!;
  round.timeLeft = -120;
  round.startTime = '10/10/2026 12:00:00';
  const { table } = round.matches[0]!;
  const sent = await mockConsole(page, t, settingsOf({}), [], true);
  let editor = await openExtension(page, table);
  await editor.getByLabel('Extra minutes').fill('5');
  await editor.getByLabel('Reason', { exact: true }).fill('Judge call');
  await editor.getByRole('button', { name: 'Save extension', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => sent[0])
    .toMatchObject({ type: 'setTimeExtension', table, seconds: 300, reason: 'Judge call' });
  await expect(page.getByRole('timer', { name: `Time left at table ${table}`, exact: true })).toHaveText(' · 3:00');
  const row = page
    .locator('.tm-matches tbody tr')
    .filter({ has: page.getByRole('timer', { name: `Time left at table ${table}`, exact: true }) });
  await expect(row.locator('.tm-extension')).toContainText('+5 min');
  editor = await openExtension(page, table);
  await expect(editor.getByLabel('Extra minutes')).toHaveValue('5');
  await expect(editor.getByLabel('Reason', { exact: true })).toHaveValue('Judge call');
  await editor.getByLabel('Extra minutes').fill('10');
  await editor.getByRole('button', { name: 'Save extension', exact: true }).click();
  await expect.poll(() => sent[1]).toMatchObject({ type: 'setTimeExtension', seconds: 600 });
  await expect(page.getByRole('timer', { name: `Time left at table ${table}`, exact: true })).toHaveText(' · 8:00');
  editor = await openExtension(page, table);
  await editor.getByRole('button', { name: 'Remove extension', exact: true }).click();
  await expect.poll(() => sent[2]).toMatchObject({ type: 'setTimeExtension', seconds: 0, reason: '' });
  await expect(page.locator('.tm-extension')).toHaveCount(0);
  expect(t.pods[0]!.rounds[0]!.timeLeft).toBe(-120);
});

test('canceling or failing an extension keeps the result unchanged @mobile', async ({ page }) => {
  const t = event(4, 0, true);
  const { table } = t.pods[0]!.rounds[0]!.matches[0]!;
  const sent = await mockConsole(page, t, settingsOf({}));
  let editor = await openExtension(page, table);
  await editor.getByLabel('Extra minutes').fill('5');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(sent).toHaveLength(0);
  editor = await openExtension(page, table);
  await page.route(`**/api/tournaments/${CODE}/commands`, route =>
    route.fulfill({ status: 400, json: { error: 'This match has changed; reload the round' } })
  );
  await editor.getByLabel('Extra minutes').fill('5');
  await editor.getByRole('button', { name: 'Save extension', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('alert')).toHaveText('This match has changed; reload the round');
  await expect(page.locator('.tm-extension')).toHaveCount(0);
});

test('a player’s personal clock includes their table extension @mobile', async ({ page }) => {
  const t = event(4, 0, true);
  const round = t.pods[0]!.rounds[0]!;
  round.timeLeft = -120;
  round.startTime = '10/10/2026 12:00:00';
  const match = round.matches[0]!;
  match.timeExtension = { seconds: 300, reason: 'Staff note' };
  const keys = assignKeys(t, {});
  const view: TournamentView = {
    code: CODE,
    mode: 'swiss',
    version: 3,
    updatedAt: 0,
    tournament: publicTournament(t, keys),
    pending: [],
    reports: [],
    divisions: publicDivisions(t, keys, Date.UTC(2026, 9, 10)),
    decks: {},
    settings: settingsOf({}),
    viewer: { role: null, me: keys[match.p1]!, via: 'claim', signedIn: true }
  };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: view });
  });
  await page.goto(`/t/${CODE}`);
  await expect(page.getByRole('timer', { name: 'Time left at your table', exact: true })).toHaveText('3:00');
  await expect(page.getByText('Staff note', { exact: true })).toHaveCount(0);
});

test('Escape closes the extension menu before the mobile result sheet @mobileOnly', async ({ page }) => {
  await mockConsole(page, event(4, 0, true), settingsOf({}));
  await page.locator('.tm-matches tbody tr:not(.tm-group-row)').first().click();
  const sheet = page.getByRole('dialog', { name: 'Result, table 1', exact: true });
  const more = sheet.getByRole('button', { name: 'More for table 1', exact: true });
  await more.click();
  await expect(sheet.getByRole('button', { name: 'Time extension', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeVisible();
  await expect(more).toBeFocused();
  await expect(sheet.getByRole('button', { name: 'Time extension', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

for (const size of [
  { width: 320, height: 480 },
  { width: 750, height: 342 },
  { width: 375, height: 171 }
]) {
  test(`result sheet scrolls its body and keeps table and actions reachable at ${size.width}x${size.height}`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 820, height: 1100 });
    const t = partlyPlayed(8, 0, 0);
    const sent = await mockConsole(page, t, settingsOf({}));
    await page.locator('.tm-matches tbody tr:not(.tm-group-row)').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.evaluate(el => getComputedStyle(el).transform)).toBe('none');
    await page.setViewportSize(size);
    await expect(sheet.getByText('Table 1', { exact: true })).toBeInViewport();
    await expect(sheet.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    const bounds = await sheet.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
    await sheet.getByRole('button', { name: 'Double loss', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    expect(sent.at(-1)).toMatchObject({ type: 'reportResult', outcome: 'double-loss' });
  });
}

test('an event made before time zones picks one and its venue from Settings', async ({ page }) => {
  const sent = await mockConsole(page, event(8, 0, true), settingsOf({}));
  await page.getByRole('tab', { name: 'Settings' }).click();
  const zone = page.getByRole('combobox', { name: 'Time zone' });
  await expect(zone).toHaveValue('');
  await zone.selectOption('America/Chicago');
  await page.getByRole('textbox', { name: 'Venue' }).fill('Test Games');
  const box = page.locator('section', { has: page.getByRole('heading', { name: 'For players' }) });
  await box.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.saved.at(-1)).toEqual({ timeZone: 'America/Chicago', venue: 'Test Games' });
  await expect(zone.locator('option[value=""]')).toHaveCount(0);
});

test('staff see a drop request on the Players tab and confirm it by its ID in one request', async ({ page }) => {
  const t = event(8, 0, true);
  const player = t.players[0]!;
  const asked: PlayerRequest = {
    id: 'request-1',
    player: player.id,
    kind: 'drop',
    at: Date.parse('2026-10-18T17:00:00Z'),
    status: 'open'
  };
  const sent = await mockConsole(page, t, settingsOf({}), [], false, [asked]);
  const tab = page.getByRole('tab', { name: 'Players · 1' });
  await tab.click();
  const requests = page.getByRole('region', { name: 'Player requests' });
  await expect(requests.getByRole('row', { name: new RegExp(player.lastName) })).toContainText('Drop');
  await requests.getByRole('button', { name: 'Confirm drop' }).click();
  await expect.poll(() => sent.answers).toEqual([expect.objectContaining({ id: 'request-1', status: 'accepted' })]);
  // The server drops the player with the answer; the console sends no separate drop to fail halfway.
  expect(sent).toHaveLength(0);
  await expect(requests).toContainText('Confirmed · Organizer');
  await expect(page.getByRole('tab', { name: 'Players', exact: true })).toBeVisible();
});

test('a cold console asks for the event while its own code is on the way, and its Pairings code before the event lands', async ({
  page
}) => {
  await mockConsole(page, event(8, 0, true), settingsOf({}));
  await expect(page.getByRole('button', { name: 'Report Player' }).first()).toBeVisible();
  const asked: string[] = [];
  page.on('request', request => asked.push(new URL(request.url()).pathname));
  const read = `/api/tournaments/${CODE}/manage`;
  const roundPanel = chunkOf('src/pages/tournaments/RoundPanel.tsx');
  // Each held until what must not wait on it is asked for. (Routing turns the browser's cache off.)
  await page.route(`**/${chunkOf('src/pages/tournaments/ManageEvent.tsx')}`, async route => {
    await expect.poll(() => asked.includes(read)).toBe(true);
    await route.continue();
  });
  await page.route(`**${read}`, async route => {
    await expect.poll(() => asked.some(path => path.endsWith(roundPanel))).toBe(true);
    await route.fallback();
  });
  await page.goto(`/host/${CODE}`);
  await expect(page.getByRole('button', { name: 'Report Player' }).first()).toBeVisible();
  expect(asked.filter(path => path === read)).toHaveLength(1);
});

test('a signed-out visitor to a console is offered sign-in, back to the console', async ({ page }) => {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    return url.pathname === '/api/me'
      ? route.fulfill({ json: { user: null, providers: ['google'] } })
      : route.fulfill({ status: 401, json: { error: 'Sign in to run this event' } });
  });
  await page.goto(`/host/${CODE}`);
  const google = page.locator('.tm-sso-google');
  await expect(google).toBeVisible();
  expect(decodeURIComponent((await google.getAttribute('href')) ?? '')).toContain(`/host/${CODE}`);
});

test('an invite link joins the staff before the console reads the event', async ({ page }) => {
  await mockConsole(page, event(8, 0, true), settingsOf({}));
  await expect(page.getByRole('button', { name: 'Report Player' }).first()).toBeVisible();
  const order: string[] = [];
  await page.route('**/api/tournaments/**', route => {
    const step = `${route.request().method()} ${new URL(route.request().url()).pathname}`;
    order.push(step);
    return step === `POST /api/tournaments/${CODE}/staff`
      ? route.fulfill({ json: { role: 'staff' } })
      : route.fallback();
  });
  await page.goto(`/host/${CODE}?invite=staff-token`);
  await expect(page.getByRole('button', { name: 'Report Player' }).first()).toBeVisible();
  await expect
    .poll(() => order.slice(0, 2))
    .toEqual([`POST /api/tournaments/${CODE}/staff`, `GET /api/tournaments/${CODE}/manage`]);
});
