/**
 * A Swiss event's console and big screen against mocked functions: a double
 * click on a player records their win at once, the console's head offers the
 * top cut, another round and ending the event once the planned rounds are
 * played, decks are named from Players, the big screen marks each
 * table's winner as results come in, and staff can unlink a player from an
 * account at an unsanctioned event.
 * The event is built with the same shared commands the functions apply.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { chunkOf } from './build-manifest';
import { test } from './network-guard';

import { type CheckIns, type CheckMark, withMark } from '../../shared/tournament/checkins';
import type { Command } from '../../shared/tournament/commands';
import type { PlayerReport } from '../../shared/tournament/reports';
import type { PlayerRequest } from '../../shared/tournament/requests';
import { emptyTournament } from '../../shared/tournament/create';
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
import { manageOf, organizerMe, runCommands } from './console-fixture';
import { droppedBeforeRoundOne, pendingResults } from '../__utils__/commands';

const CODE = 'SWISS2';

/** Every open table of the latest round won by the player at seat one. */
const reportAll = (t: Tournament): Tournament => runCommands(t, ...pendingResults(t.pods[0]!));

/** The first table of the latest round. */
function firstMatch(t: Tournament): Match {
  const match = t.pods[0]?.rounds.at(-1)?.matches[0];
  if (!match) {
    throw new Error('no table');
  }
  return match;
}

/** The latest-round table `id` sits at. */
function seatedAt(t: Tournament, id: string): Match {
  const match = t.pods[0]?.rounds.at(-1)?.matches.find(m => m.p1 === id || m.p2 === id);
  if (!match) {
    throw new Error('no seat');
  }
  return match;
}

/** An unsanctioned event of `players`, with `rounds` played and one more paired when `paired`. */
function event(players: number, rounds: number, paired: boolean): Tournament {
  const adds: Command[] = Array.from({ length: players }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: `Player${i + 1}`, lastName: 'Test' }
  }));
  let t = runCommands(emptyTournament({ name: 'Friday League' }), ...adds);
  for (let r = 0; r < rounds; r += 1) {
    t = reportAll(runCommands(t, { type: 'pairRound', pod: 'masters' }));
  }
  return paired ? runCommands(t, { type: 'pairRound', pod: 'masters' }) : t;
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
  requests: PlayerRequest[] = [],
  role: 'owner' | 'staff' = 'owner'
) {
  const sent: Command[] = [];
  const answers: unknown[] = [];
  const decks: unknown[] = [];
  const saved: Partial<TournamentSettings>[] = [];
  const manage = {
    ...manageOf(CODE, tournament, { settings, role }),
    reports,
    requests,
    decks: {} as Record<string, string>,
    checkins: {} as CheckIns
  };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: organizerMe({ publicProfile: false, profileName: 'real' }) });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/commands`) {
      const { command } = route.request().postDataJSON() as { command: Command };
      sent.push(command);
      if (apply) {
        manage.tournament = runCommands(manage.tournament, command);
        manage.version += 1;
      }
      return route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/checkins`) {
      const check = route.request().postDataJSON() as { playerId: string; mark: CheckMark; on: boolean };
      manage.checkins = withMark(manage.checkins, check.playerId, check.mark, check.on);
      manage.version += 1;
      return route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/corrections`) {
      return route.fulfill({ json: { corrections: [], headJudge: null, approver: 'organizer' } });
    }
    if (url.pathname === `/api/tournaments/${CODE}/decks`) {
      const deck = route.request().postDataJSON() as { playerId: string; archetype: string | null };
      decks.push(deck);
      if (apply && deck.archetype) {
        manage.decks = { ...manage.decks, [deck.playerId]: deck.archetype };
        manage.version += 1;
      }
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

test('a late player added before the round starts is seated by a re-pair, and after it is not offered one', async ({
  page
}) => {
  const paired = runCommands(event(8, 0, true), {
    type: 'addPlayer',
    player: { firstName: 'Late', lastName: 'Arrival' }
  });
  const sent = await mockConsole(page, paired, settingsOf({}));
  await page.getByRole('button', { name: 'Re-pair to seat them' }).click();
  const asking = page.getByRole('group', { name: 'Re-pair the open tables to seat Late Arrival?' });
  await asking.getByRole('button', { name: 'Re-pair' }).click();
  await expect.poll(() => sent.at(-1)).toEqual({ type: 'repairRound', pod: 'masters', keepReported: true });
});

test('on a 320px phone, the re-pair question keeps its two answers on one line under it @mobileOnly', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockConsole(page, event(8, 0, true), settingsOf({}));
  await page.getByRole('button', { name: 'Re-pair round' }).click();
  const asking = page.getByRole('group', { name: 'Re-pair the open tables?' });
  const question = await asking.locator('.tm-confirm-label').boundingBox();
  const answers = await asking
    .getByRole('button')
    .evaluateAll(buttons => buttons.map(b => b.getBoundingClientRect().top));
  expect(answers).toHaveLength(2);
  expect(answers[0]).toBe(answers[1]);
  expect(answers[0]).toBeGreaterThanOrEqual((question?.y ?? 0) + (question?.height ?? 0));
});

test('once a result is in, the round is not offered a re-pair the server would refuse', async ({ page }) => {
  let t = event(8, 0, true);
  const first = t.pods[0]?.rounds[0]?.matches[0];
  t = runCommands(
    t,
    ...(first ? [{ type: 'reportResult', pod: 'masters', round: 1, ...first, outcome: 'p1' } as Command] : []),
    { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Arrival' } }
  );
  await mockConsole(page, t, settingsOf({}));
  await expect(page.locator('.tm-matches')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Re-pair/ })).toHaveCount(0);
  await expect(page.getByText('Not seated this round')).toHaveCount(0);
});

test('a re-pair with nothing reported has no results to keep', async ({ page }) => {
  const sent = await mockConsole(page, event(8, 0, true), settingsOf({}));
  await page.getByRole('button', { name: 'Re-pair round' }).click();
  const asking = page.getByRole('group', { name: 'Re-pair the open tables?' });
  await expect(asking.getByLabel('Keep reported results')).toHaveCount(0);
  await asking.getByRole('button', { name: 'Re-pair' }).click();
  await expect.poll(() => sent.at(-1)).toEqual({ type: 'repairRound', pod: 'masters', keepReported: true });
});

test('the organizer is told what staff can do, and staff that their settings reach everyone', async ({ page }) => {
  await mockConsole(page, event(8, 1, false), settingsOf({}));
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Staff can enter results, manage players and change settings.')).toBeVisible();
  // A store's event: its owner and managers all organize it.
  await expect(page.getByText('Only the store’s owner and managers can invite or remove staff')).toBeVisible();
  await expect(page.getByText('Settings saved here change the event for everyone.')).toHaveCount(0);
  await page.getByRole('button', { name: 'New link' }).click();
  const rotate = page.getByRole('dialog', { name: 'Make a new link and remove current staff?' });
  await expect(rotate).toContainText('Everyone on staff loses access to this event');
  await rotate.getByRole('button', { name: 'Keep' }).click();
  await expect(rotate).toBeHidden();
  await page.unrouteAll();
  await mockConsole(page, event(8, 1, false), settingsOf({}), [], false, [], 'staff');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Settings saved here change the event for everyone.')).toBeVisible();
  await expect(page.getByText('Staff can enter results, manage players and change settings.')).toHaveCount(0);
});

test('once round 1 is paired, settings say when a change takes effect', async ({ page }) => {
  await mockConsole(page, event(8, 0, false), settingsOf({}));
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.tm-event-panel')).toBeVisible();
  await expect(page.getByText('The next step follows the new count.')).toHaveCount(0);
  await page.unrouteAll();
  await mockConsole(page, event(8, 0, true), settingsOf({}));
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  for (const note of [
    'Changes the top cut still to come. Rounds played stay as they are.',
    'The next step follows the new count.',
    'Applies to open tables at once.',
    'Players can’t send lists once round 1 is paired.'
  ]) {
    await expect(page.getByText(note)).toBeVisible();
  }
});

test('staff are offered no archetype choice that shows decks sooner than the event does', async ({ page }) => {
  await mockConsole(page, event(8, 1, false), settingsOf({ deckVisibility: 'after' }), [], false, [], 'staff');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const archetypes = page.locator('#set-decks');
  await expect(archetypes.locator('option[value="always"]')).toBeDisabled();
  await expect(archetypes.locator('option[value="after"]')).toBeEnabled();
  await expect(archetypes.locator('option[value="off"]')).toBeEnabled();
});

test('deleting an event with players counts what goes and waits for its code to be typed', async ({ page }) => {
  await mockConsole(page, event(8, 1, false), settingsOf({}));
  const deletes: string[] = [];
  await page.route(`**/api/tournaments/${CODE}`, route => {
    deletes.push(route.request().method());
    return route.fulfill({ status: 204 });
  });
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Delete event' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Friday League for good?' });
  await expect(dialog).toContainText('8 players, 1 round of results, and any decklists are deleted for good.');
  const remove = dialog.getByRole('button', { name: 'Delete', exact: true });
  await expect(remove).toBeDisabled();
  await dialog.getByLabel('Type SWISS2 to confirm').fill('SWISS');
  await expect(remove).toBeDisabled();
  await dialog.getByLabel('Type SWISS2 to confirm').fill('swiss2');
  await remove.click();
  await expect.poll(() => deletes).toEqual(['DELETE']);
});

test('deleting a TOM event before its file comes in counts the players registered on the site', async ({ page }) => {
  await mockConsole(page, emptyTournament({ name: 'Friday League' }), settingsOf({}));
  const manage = manageOf(CODE, emptyTournament({ name: 'Friday League' }), {
    mode: 'tom',
    requests: [],
    settings: settingsOf({}),
    checkins: {}
  });
  const decklists = Array.from({ length: 3 }, (_, i) => ({
    popId: String(1001 + i),
    firstName: `Player${i + 1}`,
    lastName: 'Test',
    birthDate: '01/01/1990'
  }));
  await page.route(`**/api/tournaments/${CODE}/manage*`, route =>
    new URL(route.request().url()).searchParams.has('since')
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: manage })
  );
  await page.route(`**/api/tournaments/${CODE}/decklists`, route => route.fulfill({ json: { decklists, mine: null } }));
  await page.reload();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Delete event' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Friday League for good?' });
  await expect(dialog).toContainText('3 players and any decklists are deleted for good.');
  await expect(dialog.getByLabel('Type SWISS2 to confirm')).toBeVisible();
});

test('an event nobody has joined is deleted with a question asked in place', async ({ page }) => {
  await mockConsole(page, emptyTournament({ name: 'Friday League' }), settingsOf({}));
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Delete event' }).click();
  await expect(page.getByRole('group', { name: 'Delete Friday League for good?' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
    const tournament = runCommands(t, { type: 'reportResult', pod: 'masters', round: 1, ...table, outcome: 'p1' });
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
const consoleOf = (t: Tournament, version: number) => manageOf(CODE, t, { version, settings: settingsOf({}) });

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
      : route.fulfill({ json: consoleOf(runCommands(t, command), 4) });
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

test('on a 320px phone, a result not saved keeps its words clear of the table number @mobileOnly', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const t = event(8, 0, true);
  const match = firstMatch(t);
  await mockConsole(page, t, settingsOf({}));
  const theirs = runCommands(t, { type: 'reportResult', pod: 'masters', round: 1, ...match, outcome: 'p2' });
  await page.route(`**/api/tournaments/${CODE}/commands`, route =>
    route.fulfill({
      status: 400,
      json: { error: 'This result was changed on another device. Check it and enter yours again.' }
    })
  );
  await page.route(`**/api/tournaments/${CODE}/manage*`, route => route.fulfill({ json: consoleOf(theirs, 4) }));
  await rowOf(page, match).locator('.tm-row-open').click();
  await page.getByRole('button', { name: /wins$/ }).first().click();
  const words = rowOf(page, match).getByRole('group', { name: 'Result not saved' }).locator('.tm-result-label');
  await expect(words).toContainText('another device entered');
  const table = await rowOf(page, match)
    .locator('td.tm-table-col')
    .evaluate(td => {
      const text = document.createRange();
      text.selectNodeContents(td);
      return text.getBoundingClientRect().right;
    });
  const label = await words.boundingBox();
  expect(table).toBeLessThanOrEqual(label?.x ?? 0);
});

test('a retry reads the event first and sends nothing when the result had landed', async ({ page }) => {
  const t = event(8, 0, true);
  const match = firstMatch(t);
  await mockConsole(page, t, settingsOf({}));
  // Loaded first, so the first read is the console's own and not the one below.
  await expect(rowOf(page, match)).toBeVisible();
  const landed = runCommands(t, { type: 'reportResult', pod: 'masters', round: 1, ...match, outcome: 'p1' });
  const tries: Command[] = [];
  let saved = false;
  await page.route(`**/api/tournaments/${CODE}/commands`, route => {
    tries.push((route.request().postDataJSON() as { command: Command }).command);
    // Stored, and the answer lost on its way back.
    saved = true;
    return route.abort('connectionreset');
  });
  await page.route(`**/api/tournaments/${CODE}/manage*`, route =>
    saved ? route.fulfill({ json: consoleOf(landed, 4) }) : route.fulfill({ status: 204 })
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
  const reported = runCommands(t, {
    type: 'reportResult',
    pod: 'masters',
    round: 2,
    ...match,
    outcome: 'p1'
  } as Command);
  await later(reported, 4);
  await look();
  await expect(picker).toHaveValue('1');

  await page.unroute('**/manage?since=*');
  await later(runCommands(reportAll(reported), { type: 'pairRound', pod: 'masters' }), 5);
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
  // Who that takes, and the first left out, before anything starts; no match for third is offered.
  await expect(dialog.locator('.tm-cut-seeds li')).toHaveCount(8);
  await expect(dialog.locator('.tm-cut-preview-head')).toContainText('The 8 in this cut');
  await expect(dialog.locator('.tm-cut-preview-head')).toContainText(/9th .+ \d+-\d+-\d+ is out/);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Start top 8 cut' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => sent.at(-1)).toEqual({ type: 'startTopCut', pod: 'masters', size: 8 });
});

function prerelease(rounds: number): Tournament {
  let t = event(9, 0, false);
  t = { ...t, info: { ...t.info, eventType: 'prerelease', finalsRoundTime: 30 } };
  for (let i = 0; i < rounds; i += 1) {
    t = reportAll(runCommands(t, { type: 'pairRound', pod: 'masters' }));
  }
  return t;
}

test('Prerelease offers per-pod conclusion from round 3, asked in a dialog that says it stays @mobile', async ({
  page
}) => {
  const t = prerelease(3);
  const sent = await mockConsole(page, t, settingsOf({}), [], true);
  const step = page.locator('.tm-split');
  const conclude = async () => {
    await step.getByRole('button', { name: 'Other next steps' }).click();
    await step.getByRole('button', { name: 'Conclude pod', exact: true }).click();
    return page.getByRole('dialog', { name: 'Conclude this pod?' });
  };
  await step.getByRole('button', { name: 'Other next steps' }).click();
  await expect(step.getByRole('button', { name: 'End event', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  let dialog = await conclude();
  await expect(dialog).toContainText('Only ending and reopening the event undoes this.');
  await dialog.getByRole('button', { name: 'Keep running' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toHaveLength(0);
  dialog = await conclude();
  await expect(dialog.getByRole('button', { name: 'Conclude', exact: true })).toHaveClass(/tm-danger/);
  await dialog.getByRole('button', { name: 'Conclude', exact: true }).click();
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
  const t = runCommands(event(4, 0, true), {
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
  const t = runCommands(event(4, 0, true), {
    type: 'reportResult',
    pod: 'masters',
    round: 1,
    ...firstMatch(event(4, 0, true)),
    outcome: 'p1'
  });
  const sent = await mockConsole(page, t, settingsOf({}));
  await page.getByRole('button', { name: 'Clear' }).first().click();
  const asking = page.getByRole('group', { name: 'Confirm result' });
  await expect(asking.locator('.tm-result-label')).toHaveText(/^Clear Player\d Test’s win\?$/);
  await asking.getByRole('button', { name: 'Clear' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'reportResult', outcome: 'pending' });
});

test('changing a result that stands names both players, and a double click there only asks', async ({ page }) => {
  const t = partlyPlayed(8, 0, 1);
  const match = firstMatch(t);
  const sent = await mockConsole(page, t, settingsOf({}));
  // Read once the row is drawn, not while the event is still on its way.
  await expect(rowOf(page, match).locator('.tm-name')).toHaveCount(2);
  const names = (await rowOf(page, match).locator('.tm-name').allTextContents()) as [string, string];
  await rowOf(page, match).locator('.tm-seat-link').nth(1).dblclick();
  const asking = page.getByRole('group', { name: 'Confirm result' });
  await expect(asking.locator('.tm-result-label')).toHaveText(`Change ${names[0]}’s win to ${names[1]}’s?`);
  expect(sent).toHaveLength(0);
  await asking.getByRole('button', { name: 'Change' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'reportResult', outcome: 'p2', expected: 'p1' });
});

test('a result another device changed first is named in its row, and Use mine replaces it', async ({ page }) => {
  const t = event(8, 0, true);
  const match = firstMatch(t);
  await mockConsole(page, t, settingsOf({}));
  await expect(rowOf(page, match)).toBeVisible();
  const theirs = runCommands(t, { type: 'reportResult', pod: 'masters', round: 1, ...match, outcome: 'p2' });
  const tries: Command[] = [];
  await page.route(`**/api/tournaments/${CODE}/commands`, route => {
    const { command } = route.request().postDataJSON() as { command: Command };
    tries.push(command);
    return tries.length === 1
      ? route.fulfill({
          status: 400,
          json: { error: 'This result was changed on another device. Check it and enter yours again.' }
        })
      : route.fulfill({ json: consoleOf(runCommands(theirs, command), 5) });
  });
  await page.route(`**/api/tournaments/${CODE}/manage*`, route => route.fulfill({ json: consoleOf(theirs, 4) }));
  await rowOf(page, match).locator('.tm-seat-link').first().dblclick();
  const unsaved = rowOf(page, match).getByRole('group', { name: 'Result not saved' });
  const other = await rowOf(page, match).locator('.tm-name').nth(1).textContent();
  await expect(unsaved.locator('.tm-result-label')).toHaveText(`Not saved: another device entered ${other}’s win`);
  await unsaved.getByRole('button', { name: 'Use mine' }).click();
  await expect.poll(() => tries.length).toBe(2);
  expect(tries[0]).toMatchObject({ outcome: 'p1', expected: 'pending' });
  expect(tries[1]).toMatchObject({ outcome: 'p1', expected: 'p2' });
  await expect(unsaved).toHaveCount(0);
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

test('before round 1 the console opens on Players, and Pairings says why it is locked without a clipped bubble', async ({
  page
}) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  await expect(page.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
  const pairings = page.getByRole('tab', { name: 'Pairings' });
  await expect(pairings).toHaveAttribute('aria-disabled', 'true');
  await expect(pairings).toHaveAccessibleDescription('Pairings open once round 1 starts.');
  await pairings.hover();
  await expect(page.locator('.tabs .info-tip-bubble').first()).toBeHidden();
  await pairings.click({ force: true });
  await expect(page.locator('.tabs .info-tip-bubble').first()).toBeHidden();
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

test('a focused console tab shows its whole ring, the first one included, though the tabs scroll', async ({ page }) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  const strip = page.locator('.tm-console > .tabs');
  const first = strip.getByRole('tab').first();
  await first.focus();
  await page.keyboard.press('Shift');
  // The ring, as drawn round the tab, against the box the scrolling strip shows.
  const cut = await first.evaluate(tab => {
    const style = getComputedStyle(tab);
    const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
    const ring = tab.getBoundingClientRect();
    const box = (tab.closest('.tabs') as HTMLElement).getBoundingClientRect();
    return [
      box.left - (ring.left - reach),
      box.top - (ring.top - reach),
      ring.right + reach - box.right,
      ring.bottom + reach - box.bottom
    ].filter(over => over > 0.5).length;
  });
  expect(cut).toBe(0);
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

// iOS Safari paints and hit-tests a fixed menu inside the roster's scroller as part of it: a tap on its items went nowhere.
test('a roster row’s menu opens above the page, clear of the table’s scroller, and its items answer @mobile', async ({
  page
}) => {
  const sent = await mockConsole(page, event(2, 0, false), settingsOf({ entryFee: 10 }));
  await page.locator('.table-wrap').getByRole('button', { name: 'More for Player1 Test' }).click();
  const menu = page.getByRole('group', { name: 'More for Player1 Test' });
  expect(await menu.evaluate(el => el.matches(':popover-open'))).toBe(true);
  await menu.getByRole('button', { name: 'Remove' }).click();
  await menu.getByRole('group', { name: 'Remove Player1 Test?' }).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'removePlayer' });
});

test('a fixed table the server refuses goes back to the one saved', async ({ page }) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  await page.route(`**/api/tournaments/${CODE}/commands`, route =>
    route.fulfill({ status: 400, json: { error: 'Table 7 is already fixed for Player2 Test' } })
  );
  await page
    .getByRole('button', { name: /^More for / })
    .first()
    .click();
  const field = page.getByRole('group', { name: /^More for / }).getByRole('textbox', { name: /^Fixed table for / });
  await field.fill('7');
  await field.press('Enter');
  await expect(page.getByText('Table 7 is already fixed for Player2 Test')).toBeVisible();
  await expect(field).toHaveValue('');
});

for (const accepted of [false, true]) {
  test(`a ${accepted ? 'successful' : 'refused'} fixed table save holds the field until it answers`, async ({
    page
  }) => {
    await mockConsole(page, event(4, 0, false), settingsOf({}), [], true);
    let release = () => {};
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route(`**/api/tournaments/${CODE}/commands`, async route => {
      await waiting;
      if (accepted) {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 400, json: { error: 'Table 7 is already fixed for Player2 Test' } });
    });
    const more = page.getByRole('button', { name: /^More for / }).first();
    await more.click();
    const field = page.getByRole('group', { name: /^More for / }).getByRole('textbox', { name: /^Fixed table for / });
    await field.fill('7');
    const sent = page.waitForRequest(`**/api/tournaments/${CODE}/commands`);
    await field.press('Enter');
    await sent;
    await expect(field).toBeDisabled();
    release();
    if (accepted) {
      await expect(field).toHaveCount(0);
      await more.click();
    } else {
      await expect(page.getByText('Table 7 is already fixed for Player2 Test')).toBeVisible();
    }
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue(accepted ? '7' : '');
    await field.fill('8');
    await expect(field).toHaveValue('8');
  });
}

test('reinstating a player asks first, and says when it gives a bye or lifts a disqualification', async ({ page }) => {
  let t = event(8, 1, false);
  const id = t.players.find(p => p.firstName === 'Player1')?.id ?? '';
  t = runCommands(
    t,
    { type: 'disqualifyPlayer', id },
    { type: 'pairRound', pod: 'masters' },
    { type: 'startClock', pod: 'masters' }
  );
  const sent = await mockConsole(page, t, settingsOf({}));
  await page.getByRole('tab', { name: 'Players', exact: true }).click();
  await page.getByRole('button', { name: 'Reinstate', exact: true }).click();
  const asking = page.getByRole('dialog', { name: 'Reinstate Player1 Test?' });
  await expect(asking).toContainText('They get a bye for round 2. This lifts their disqualification.');
  await asking.getByRole('button', { name: 'Keep' }).click();
  expect(sent.filter(command => command.type === 'undropPlayer')).toHaveLength(0);
  await page.getByRole('button', { name: 'Reinstate', exact: true }).click();
  await asking.getByRole('button', { name: 'Reinstate' }).click();
  await expect.poll(() => sent.at(-1)).toEqual({ type: 'undropPlayer', id });
});

test('on a 320px phone a disqualified player’s name reads whole, its flag under it if need be @mobileOnly', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  let t = event(8, 1, false);
  const id = t.players.find(p => p.firstName === 'Player1')?.id ?? '';
  t = runCommands(t, { type: 'disqualifyPlayer', id }, { type: 'pairRound', pod: 'masters' });
  await mockConsole(page, t, settingsOf({}));
  await page.getByRole('tab', { name: 'Players', exact: true }).click();
  const name = page.locator('.tm-roster tr', { hasText: 'Disqualified' }).locator('.tm-name');
  await expect(name).toHaveText('Test, Player1');
  expect(await name.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(
    await name.evaluate(el => el.getBoundingClientRect().height < 2 * parseFloat(getComputedStyle(el).lineHeight))
  ).toBe(true);
  // Dropped under the name, the flag starts where the name does: both read at once, as the panel may still be settling.
  const offset = await name.evaluate(node => {
    const flag = node.closest('.tm-who-name')?.querySelector('.tm-flag');
    return flag ? flag.getBoundingClientRect().left - node.getBoundingClientRect().left : Number.NaN;
  });
  expect(Math.abs(offset)).toBeLessThan(1);
});

test('on a 320px phone a German Reinstate wraps rather than cutting a dropped player’s name short @mobileOnly', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  let t = runCommands(event(7, 0, false), {
    type: 'addPlayer',
    player: { firstName: 'Christopher', lastName: 'Montgomery-Wallace' }
  });
  t = reportAll(runCommands(t, { type: 'pairRound', pod: 'masters' }));
  const id = t.players.find(p => p.firstName === 'Christopher')?.id ?? '';
  t = runCommands(t, { type: 'dropPlayer', id }, { type: 'pairRound', pod: 'masters' });
  await mockConsole(page, t, settingsOf({}));
  await page.goto(`/host/${CODE}?lang=de`);
  await page.getByRole('tab', { name: 'Spieler', exact: true }).click();
  const row = page.locator('.tm-roster tr', { hasText: 'Montgomery' });
  await expect(row.getByRole('button', { name: 'Wieder aufnehmen' })).toBeVisible();
  const name = row.locator('.tm-name');
  expect(await name.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('reinstating someone who dropped after pairing warns about the bye', async ({ page }) => {
  let t = event(8, 1, false);
  const id = t.players.find(p => p.firstName === 'Player1')?.id ?? '';
  t = runCommands(
    t,
    { type: 'pairRound', pod: 'masters' },
    { type: 'dropPlayer', id },
    { type: 'startClock', pod: 'masters' }
  );
  await mockConsole(page, t, settingsOf({}));
  await page.getByRole('tab', { name: 'Players', exact: true }).click();
  await page.getByRole('button', { name: 'Reinstate', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Reinstate Player1 Test?' })).toContainText(
    'They get a bye for round 2.'
  );
});

test('a player who never played is reinstated with a question in place, and no bye', async ({ page }) => {
  let t = event(8, 0, false);
  const id = t.players.find(p => p.firstName === 'Player1')?.id ?? '';
  t = runCommands(
    droppedBeforeRoundOne(t, id),
    { type: 'pairRound', pod: 'masters' },
    { type: 'startClock', pod: 'masters' }
  );
  const sent = await mockConsole(page, t, settingsOf({}));
  await page.getByRole('tab', { name: 'Players', exact: true }).click();
  await page.getByRole('button', { name: 'Reinstate', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('group', { name: 'Reinstate Player1 Test?' }).getByRole('button', { name: 'Reinstate' }).click();
  await expect.poll(() => sent.at(-1)).toEqual({ type: 'undropPlayer', id });
});

test('drop and disqualify each say what follows them', async ({ page }) => {
  const sent = await mockConsole(page, event(4, 1, false), settingsOf({}));
  await page.getByRole('tab', { name: 'Players', exact: true }).click();
  await page.getByRole('button', { name: 'More for Player1 Test' }).click();
  await page.getByRole('button', { name: 'Drop', exact: true }).click();
  const drop = page.getByRole('group', {
    name: 'Drop Player1 Test? You can reinstate them until the next round is paired.'
  });
  await drop.getByRole('button', { name: 'Keep' }).click();
  await page.getByRole('button', { name: 'Disqualify', exact: true }).click();
  const disqualify = page.getByRole('group', {
    name: 'Disqualify Player1 Test? It goes in the event file. Write the penalty note under Penalties.'
  });
  const box = await disqualify.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await disqualify.getByRole('button', { name: 'Disqualify' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'disqualifyPlayer' });
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

test('the console draws the house focus ring: one ring on a field, 2px on a button', async ({ page }) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  const form = page.getByRole('form', { name: 'Add a player' });
  const field = form.getByLabel('First name');
  await field.click();
  // A field's ring is its border and box-shadow, with no outline floating outside it.
  await expect(field).toHaveCSS('outline-style', 'none');
  // Onward by keyboard to the first button.
  for (let presses = 0; presses < 8; presses += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.tagName === 'BUTTON')) {
      break;
    }
  }
  const focused = page.locator('button:focus');
  await expect(focused).toHaveCSS('outline-width', '2px');
  await expect(focused).toHaveCSS('outline-offset', '2px');
});

test('a sanctioned event adds a player only with their Player ID and birth year', async ({ page }) => {
  const sent = await mockConsole(page, event(4, 0, false), settingsOf({ sanctioned: true }));
  const form = page.getByRole('form', { name: 'Add a player' });
  const add = form.getByRole('button', { name: 'Add player' });
  const why = form.getByText('Player ID and birth year are needed at a sanctioned event');
  await expect(why).toHaveCount(0);
  await form.getByLabel('First name').fill('Sam');
  await form.getByLabel('Last name').fill('Lee');
  await form.getByLabel('Birth year').fill('2001');
  await expect(add).toBeDisabled();
  await expect(why).toBeVisible();
  await form.getByLabel('Player ID').fill('4242');
  await form.getByLabel('Birth year').fill('');
  await expect(add).toBeDisabled();
  await form.getByLabel('Birth year').fill('2001');
  await expect(why).toHaveCount(0);
  await add.click();
  await expect
    .poll(() => sent.at(-1))
    .toMatchObject({ type: 'addPlayer', player: { id: '4242', birthDate: '02/27/2001' } });
});

test('an unsaved setting survives a switch to another tab', async ({ page }) => {
  const sent = await mockConsole(page, event(4, 0, true), settingsOf({}));
  await page.getByRole('tab', { name: 'Settings' }).click();
  const saves = page.locator('.tm-set-foot').getByRole('button', { name: 'Save' });
  // A Save is the tab's primary only while its box has something to save.
  await expect(saves.first()).toHaveClass(/btn-secondary/);
  await expect(page.locator('.tm-set-foot .btn-primary')).toHaveCount(0);
  await page.getByLabel('Event description').fill('Doors at nine');
  await expect(page.locator('.tm-set-foot .btn-primary')).toHaveCount(1);
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
  const changed = { ...consoleOf(event(4, 0, true), 9), settings: { ...settings, playerReporting: true } };
  await page.route(`**/api/tournaments/${CODE}/manage*`, route => route.fulfill({ json: changed }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(reporting.getByRole('radio', { name: 'Enabled' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Event description')).toHaveValue('Doors at nine');
  const box = page.locator('section', { has: page.getByRole('heading', { name: 'For players' }) });
  await box.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.saved).toEqual([{ details: 'Doors at nine' }]);
});

test('a sanctioned event downloads its .tdf, named for the version it copies', async ({ page }) => {
  await mockConsole(page, event(4, 1, false), settingsOf({ sanctioned: true }));
  await page.getByRole('tab', { name: 'Settings' }).click();
  const row = page.locator('.tm-set-row', { hasText: 'Play! Pokémon file' });
  await expect(row.getByText('Version 3')).toBeVisible();
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download .tdf' }).click();
  expect((await download).suggestedFilename()).toBe('Friday League v3.tdf');
});

test('an unsanctioned event offers no .tdf', async ({ page }) => {
  await mockConsole(page, event(4, 1, false), settingsOf({ sanctioned: false }));
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Finish' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download .tdf' })).toHaveCount(0);
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

test('a German Clear beside a named deck keeps inside its button, and every row’s picker stays one width', async ({
  page
}) => {
  await mockConsole(page, event(8, 0, true), settingsOf({ deckVisibility: 'always' }), [], true);
  await page.goto(`/host/${CODE}?lang=de`);
  await page.getByRole('tab', { name: 'Spieler', exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'Deck' }).first();
  await picker.fill('Homebrew Box');
  await picker.press('Enter');
  const clear = page.getByRole('button', { name: 'Löschen' });
  await expect(clear).toHaveCount(1);
  expect(await clear.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const widths = await page
    .getByRole('combobox', { name: 'Deck' })
    .evaluateAll(fields => fields.map(field => Math.round(field.getBoundingClientRect().width)));
  expect(new Set(widths).size).toBe(1);
});

test('at 1024px a dropped player’s Reinstate and every row’s menu stay inside the roster beside a named deck', async ({
  page
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  let t = runCommands(event(7, 0, true), {
    type: 'addPlayer',
    player: { firstName: 'Christopher', lastName: 'Montgomery-Wallace' }
  });
  t = reportAll(runCommands(t, { type: 'pairRound', pod: 'masters' }));
  const id = t.players.find(p => p.firstName === 'Christopher')?.id ?? '';
  t = runCommands(t, { type: 'dropPlayer', id }, { type: 'pairRound', pod: 'masters' });
  await mockConsole(page, t, settingsOf({ deckVisibility: 'always' }));
  await page.goto(`/host/${CODE}?lang=de`);
  await page.getByRole('tab', { name: 'Spieler', exact: true }).click();
  const roster = page.locator('.tm-roster');
  await expect(roster.getByRole('button', { name: 'Wieder aufnehmen' })).toBeVisible();
  const box = await roster.evaluate(el => Math.round((el.parentElement ?? el).getBoundingClientRect().right));
  const rights = await roster
    .getByRole('button', { name: /^Weitere Optionen für / })
    .evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().right)));
  expect(rights.length).toBeGreaterThan(0);
  expect(Math.max(...rights)).toBeLessThanOrEqual(box);
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

test('on a 320px phone every deck in the list keeps its name and share inside the list @mobileOnly', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockConsole(page, event(8, 0, true), settingsOf({ deckVisibility: 'always' }));
  await page.getByRole('tab', { name: 'Players' }).click();
  await page.getByRole('combobox', { name: 'Deck' }).last().focus();
  const list = page.getByRole('listbox');
  await expect.poll(() => list.locator('li[role="option"]').count()).toBeGreaterThan(5);
  const spill = await list.evaluate(el => {
    const edge = el.getBoundingClientRect().right;
    return [...el.querySelectorAll('li[role="option"] > *')]
      .filter(part => part.getBoundingClientRect().right > edge)
      .map(part => part.textContent);
  });
  expect(spill).toEqual([]);
});

test('Gym Leader Challenge decks show their type icons, still once a name is typed in beside them', async ({
  page
}) => {
  const t = event(8, 0, true);
  await mockConsole(page, t, settingsOf({ deckVisibility: 'always', format: 'Gym Leader Challenge' }), [], true);
  await page.getByRole('tab', { name: 'Players' }).click();
  const first = page.getByRole('combobox', { name: 'Deck' }).first();
  await first.fill('Mono Mew');
  await first.press('Enter');
  // Twelve decks now, the typed one among them: the types keep their icons, the typed one does not take one.
  const picker = page.getByRole('combobox', { name: 'Deck' }).last();
  await picker.focus();
  const fire = page.getByRole('option', { name: /^Fire/ });
  const icon = fire.locator('img[src$="/type-icons/fire.svg"]');
  await expect(icon).toHaveCount(1);
  // The icon has to decode, not just be named: a missing file comes back as the SPA's HTML.
  await expect.poll(() => icon.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await picker.fill('Mono');
  const typed = page.getByRole('option', { name: /Mono Mew/ });
  await expect(typed).toBeVisible();
  await expect(typed.locator('img[src*="/type-icons/"]')).toHaveCount(0);
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
  t = runCommands(t, { type: 'reportResult', pod: 'masters', round: 1, ...first, outcome: 'p2' });
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
  await page.getByRole('tablist', { name: 'Event sections' }).getByRole('tab', { name: 'Players' }).click();
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
  let t = runCommands(emptyTournament({ name: 'Friday League' }), ...adds);
  for (let pod = t.pods[0]; pod && pod.rounds.length < regularRounds(t, pod); pod = t.pods[0]) {
    t = reportAll(runCommands(t, { type: 'pairRound', pod: 'mixed' }));
  }
  t = runCommands(t, { type: 'startTopCut', pod: 'mixed', size: 4, division: 'senior' });
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

test('a laptop’s pairing rows stand as tall as a wider screen’s, either side of 1100px', async ({ page }) => {
  await mockConsole(page, partlyPlayed(8, 1, 1), settingsOf({}));
  const rows = page.locator('.tm-matches tbody tr:not(.tm-group-row)');
  const heights = async () => rows.evaluateAll(list => list.map(row => Math.round(row.getBoundingClientRect().height)));
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(rows).toHaveCount(4);
  const wide = await heights();
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect.poll(heights).toEqual(wide);
});

test('on a laptop a long name in the pairings wraps rather than losing its end', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const t = runCommands(
    event(7, 0, false),
    { type: 'addPlayer', player: { firstName: 'Maximiliano', lastName: 'Hernández-Villanueva' } },
    { type: 'pairRound', pod: 'masters' }
  );
  await mockConsole(page, t, settingsOf({}));
  const name = page.locator('.tm-matches .tm-name', { hasText: 'Hernández-Villanueva' });
  await expect(name).toBeVisible();
  expect(await name.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

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
  await expect(sheet.getByRole('button')).toHaveText(['', / wins$/, / wins$/, 'Tie', 'Double loss', 'Cancel']);
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

test('900px and under the sheet asks before it changes or clears a result that stands', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  const t = partlyPlayed(8, 0, 1);
  const match = firstMatch(t);
  const sent = await mockConsole(page, t, settingsOf({}));
  await rowOf(page, match).click();
  const sheet = page.getByRole('dialog', { name: `Result, table ${match.table}` });
  await sheet.getByRole('button', { name: 'Tie' }).click();
  const step = sheet.getByRole('group', { name: /^Change .+’s win to a tie\?$/ });
  await expect(step.getByRole('button', { name: 'Change' })).toBeFocused();
  expect(sent).toHaveLength(0);
  await step.getByRole('button', { name: 'Cancel' }).click();
  await sheet.getByRole('button', { name: 'Clear result' }).click();
  await sheet
    .getByRole('group', { name: /^Clear .+’s win\?$/ })
    .getByRole('button', { name: 'Clear' })
    .click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'reportResult', outcome: 'pending', expected: 'p1' });
});

test('on a phone the tabs sit along the bottom, and the round and its clock stay pinned @mobileOnly', async ({
  page
}) => {
  await mockConsole(page, partlyPlayed(8, 0, 2), settingsOf({}));
  await expect(page.locator('.tm-console > .tabs')).toBeHidden();
  // Drawn as the rest of the system is, whatever the bar's own styles say.
  await expect(page.locator('.tm-tabbar svg').first()).toHaveCSS('stroke-width', '1.5px');
  const bar = page.getByRole('tablist', { name: 'Event sections' });
  await expect(bar.getByRole('tab', { name: 'Pairings' })).toHaveAttribute('aria-selected', 'true');
  const pin = page.locator('.tm-round-pin');
  await expect(pin.getByRole('combobox', { name: 'Round' })).toBeVisible();
  await expect(pin.getByRole('group', { name: 'Round clock' })).toBeVisible();
  await expect(page.locator('.tm-console-hero').getByRole('group', { name: 'Round clock' })).toBeHidden();
  await expect(page.locator('.tm-matches td.tm-table-col').first()).toHaveText(/\d/);
  await bar.getByRole('tab', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/tab=standings/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('on a short phone held sideways the round and its clock scroll with the tables rather than leave them a strip @mobileOnly', async ({
  page
}) => {
  await page.setViewportSize({ width: 640, height: 300 });
  await mockConsole(page, partlyPlayed(16, 0, 2), settingsOf({}));
  const pin = page.locator('.tm-round-pin');
  await expect(pin.getByRole('group', { name: 'Round clock' })).toBeVisible();
  await page.locator('.tm-matches tbody tr').last().scrollIntoViewIfNeeded();
  await expect(pin).not.toBeInViewport();
});

test('a phone’s tab bar is one tab list: the arrows move and open, and a locked tab says why @mobileOnly', async ({
  page
}) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  const bar = page.getByRole('tablist', { name: 'Event sections' });
  await expect(bar.getByRole('tab')).toHaveText(['Pairings', 'Players', 'Standings', 'Penalties', 'Settings']);
  const players = bar.getByRole('tab', { name: 'Players' });
  await expect(players).toHaveAttribute('aria-selected', 'true');
  await expect(players).toHaveAttribute('aria-controls', 'console-panel');
  await expect(players).toHaveAttribute('tabindex', '0');
  await expect(bar.getByRole('tab', { name: 'Standings' })).toHaveAttribute('tabindex', '-1');
  await players.focus();
  await page.keyboard.press('ArrowRight');
  const standings = bar.getByRole('tab', { name: 'Standings' });
  await expect(standings).toBeFocused();
  await expect(standings).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/tab=standings/);
  // Locked until round 1: reached, described, never opened.
  await page.keyboard.press('Home');
  const pairings = bar.getByRole('tab', { name: 'Pairings' });
  await expect(pairings).toBeFocused();
  await expect(pairings).toHaveAttribute('aria-disabled', 'true');
  await expect(pairings).toHaveAccessibleDescription('Pairings open once round 1 starts.');
  await expect(standings).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(bar.getByRole('tab', { name: 'Settings' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible();
});

/** Where a thing sits on screen; it must be there. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** The room the page keeps clear at the bottom of the screen, as the browser works it out. */
const reservedBelow = (page: Page) =>
  page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom) || 0);

test('a phone’s tab bar keeps one height and every tab on screen, however long its labels run @mobileOnly', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const t = event(8, 1, true);
  const requests: PlayerRequest[] = t.players.slice(0, 4).map((player, i) => ({
    id: `request-${String(i)}`,
    player: player.id,
    kind: 'drop',
    at: i,
    status: 'open'
  }));
  await mockConsole(page, t, settingsOf({ decklists: 'open' }), [], false, requests);
  await page.goto(`/host/${CODE}?lang=es`);
  const bar = page.locator('.tm-tabbar');
  await expect(bar.getByRole('tab')).toHaveCount(6);
  // Six tabs in Spanish with requests waiting: the bar is as tall as the room the page leaves it.
  const barBox = await boxOf(bar);
  expect(barBox.height).toBe(64);
  expect(await reservedBelow(page)).toBe(64);
  for (const tab of await bar.getByRole('tab').all()) {
    const box = await boxOf(tab);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  // The Players tab shows how many requests wait by its icon, and its name says which.
  const players = page.locator('#console-bar-players');
  await expect(players.locator('.tm-dash-count')).toHaveText('4');
  await expect(players).toHaveAttribute('aria-label', /^\S+ · 4 \S+$/);
  // Scrolled to the end, the site's foot clears the bar.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const foot = await boxOf(page.locator('.site-footer'));
  expect(foot.y + foot.height).toBeLessThanOrEqual(barBox.y);
});

test('a phone’s pairings name each table and a bye in the page’s language @mobileOnly', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await mockConsole(page, event(7, 0, true), settingsOf({}), [], false);
  await page.goto(`/host/${CODE}?lang=de`);
  const tables = page.locator('.tm-matches td.tm-table-col');
  await expect(tables).toHaveCount(4);
  const labels = await tables.evaluateAll(cells =>
    cells.map(cell => `${getComputedStyle(cell, '::before').content} ${(cell as HTMLElement).innerText}`)
  );
  expect(labels.slice(0, 3)).toEqual(['"Tisch " 1', '"Tisch " 2', '"Tisch " 3']);
  expect(labels[3]).toMatch(/^"Freilos "/);
});

/** Where a clock's time and actions sit, and the labels its buttons cut short. */
function clockLayout(clock: Locator) {
  return clock.evaluate(group => {
    const [face, acts] = [group.querySelector('.tm-clock-face'), group.querySelector('.tm-clock-acts')].map(
      part => part?.getBoundingClientRect() ?? new DOMRect()
    ) as [DOMRect, DOMRect];
    const cut = [...group.querySelectorAll('button')]
      .filter(b => b.scrollWidth > b.clientWidth)
      .map(b => b.textContent);
    return { stacked: acts.top >= face.bottom, right: group.getBoundingClientRect().right, cut };
  });
}

test('a 360px phone’s round clock keeps its time and actions on one line @mobileOnly', async ({ page }) => {
  // With +5 beside +1 and −1, a 320px screen puts the actions under the time, as the next test checks.
  await page.setViewportSize({ width: 360, height: 640 });
  await mockConsole(page, partlyPlayed(8, 0, 2), settingsOf({}));
  await page.getByRole('tablist', { name: 'Event sections' }).getByRole('tab', { name: 'Standings' }).click();
  const head = await clockLayout(page.locator('.tm-console-hero').getByRole('group', { name: 'Round clock' }));
  expect(head.cut).toEqual([]);
  expect(head.stacked).toBe(false);
  expect(head.right).toBeLessThanOrEqual(360);
});

test('a round clock too wide for a phone puts its actions under the time, every label whole @mobileOnly', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  // Spanish's "Iniciar cronómetro" cannot sit beside the time on a 320px screen.
  await mockConsole(page, partlyPlayed(8, 0, 2), settingsOf({}));
  await page.goto(`/host/${CODE}?lang=es`);
  const pin = await clockLayout(page.locator('.tm-round-pin [role="group"]'));
  expect(pin.cut).toEqual([]);
  expect(pin.stacked).toBe(true);
  expect(pin.right).toBeLessThanOrEqual(320);
  await page.locator('.tm-tabbar [role="tab"]').nth(2).click();
  const head = await clockLayout(page.locator('.tm-console-hero [role="group"]'));
  expect(head.cut).toEqual([]);
  expect(head.stacked).toBe(true);
  expect(head.right).toBeLessThanOrEqual(320);
});

test('a 320px phone wraps a store event’s four types inside the Event box @mobileOnly', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockConsole(page, partlyPlayed(8, 0, 2), settingsOf({}));
  await page.getByRole('tablist', { name: 'Event sections' }).getByRole('tab', { name: 'Settings' }).click();
  const kinds = page.getByRole('radiogroup', { name: 'Event type', exact: true });
  await expect(kinds.getByRole('radio')).toHaveCount(4);
  const row = await kinds.evaluate(group => group.closest('.tm-set-row')!.getBoundingClientRect().right);
  const rights = await kinds.getByRole('radio').evaluateAll(radios => radios.map(r => r.getBoundingClientRect().right));
  expect(Math.max(...rights)).toBeLessThanOrEqual(row);
});

test('a 320px phone’s penalty form keeps each select inside its half @mobileOnly', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockConsole(page, partlyPlayed(8, 0, 2), settingsOf({}));
  await page.getByRole('tablist', { name: 'Event sections' }).getByRole('tab', { name: 'Penalties' }).click();
  const form = page.locator('.tm-penalty-form');
  await expect(form.locator('select')).toHaveCount(3);
  const spill = await form.locator('label').evaluateAll(labels =>
    labels.flatMap(label => {
      const select = label.querySelector('select');
      return select && select.getBoundingClientRect().right > label.getBoundingClientRect().right + 0.5
        ? [label.firstChild?.textContent ?? '']
        : [];
    })
  );
  expect(spill).toEqual([]);
});

test('the penalty log and decklists that fail to load say so inside their boxes’ padding @mobile', async ({ page }) => {
  await mockConsole(page, partlyPlayed(8, 0, 2), settingsOf({ decklists: 'open' }));
  for (const tab of ['Penalties', 'Decklists']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const retry = page.getByRole('button', { name: 'Try again', exact: true });
    await expect(retry).toBeVisible();
    const box = await boxOf(page.locator('.tm-box').filter({ has: retry }));
    const button = await boxOf(retry);
    expect(button.x - box.x).toBeGreaterThanOrEqual(8);
  }
});

test('a phone’s six tabs show their names whole on a 320px screen @mobileOnly', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockConsole(page, event(8, 1, true), settingsOf({ decklists: 'open' }));
  const bar = page.locator('.tm-tabbar');
  await expect(bar.getByRole('tab')).toHaveCount(6);
  await bar.getByRole('tab', { name: 'Standings' }).click();
  // Every label fits its share of the bar, the open one too, rather than ending on an ellipsis.
  const cut = await bar
    .locator('[role="tab"] > span')
    .evaluateAll(labels =>
      labels.filter(label => label.scrollWidth > label.clientWidth).map(label => label.textContent)
    );
  expect(cut).toEqual([]);
});

test('a phone’s standings show a name longer than its column whole @mobileOnly', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const long = { type: 'addPlayer', player: { firstName: 'Hubert', lastName: 'Wolfeschlegelsteinhausen' } } as const;
  const t = runCommands(
    emptyTournament({ name: 'Friday League' }),
    long,
    ...event(3, 0, false).players.map(
      player => ({ type: 'addPlayer', player: { firstName: player.firstName, lastName: player.lastName } }) as const
    ),
    { type: 'pairRound', pod: 'masters' }
  );
  await mockConsole(page, t, settingsOf({}));
  await page.locator('.tm-tabbar').getByRole('tab', { name: 'Standings' }).click();
  const name = page.locator('.tm-standings .tm-name').filter({ hasText: 'Wolfeschlegel' });
  await expect(name).toBeVisible();
  expect(await name.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('on a phone a Paid check-in and a standings name are each a 44px target @mobileOnly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockConsole(page, event(4, 0, false), settingsOf({ entryFee: 10 }));
  const paid = await page.locator('.tm-check-cell', { has: page.getByLabel('Paid: Player1 Test') }).boundingBox();
  expect(paid?.width).toBeGreaterThanOrEqual(44);
  expect(paid?.height).toBeGreaterThanOrEqual(44);
  await mockConsole(page, event(4, 1, false), settingsOf({}));
  await page.locator('.tm-tabbar').getByRole('tab', { name: 'Standings' }).click();
  const name = await page.locator('.tm-standings .tm-seat-link').first().boundingBox();
  expect(name?.height).toBeGreaterThanOrEqual(44);
});

test('a phone’s locked tab says why above the bar, inside the screen @mobileOnly', async ({ page }) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  const bar = page.locator('.tm-tabbar');
  const locked = bar.locator('.tab-locked').first();
  // aria-disabled, as a locked tab is, but a tap still asks why.
  await locked.getByRole('tab').click({ force: true });
  const hint = locked.locator('.info-tip-bubble');
  await expect(hint).toBeVisible();
  const box = await boxOf(hint);
  const width = page.viewportSize()?.width ?? 0;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual((await boxOf(bar)).y);
});

test('a phone’s tab bar steps aside while a field has the keyboard @mobileOnly', async ({ page }) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  const bar = page.locator('.tm-tabbar');
  await expect(bar).toBeVisible();
  const field = page.locator('#console-panel').getByRole('textbox').first();
  await field.focus();
  await expect(bar).toBeHidden();
  await field.blur();
  await expect(bar).toBeVisible();
});

test('a row’s menu opened just above a phone’s tab bar opens upward, clear of it @mobileOnly', async ({ page }) => {
  await mockConsole(page, event(64, 0, false), settingsOf({}));
  const bar = page.locator('.tm-tabbar');
  const more = page.getByRole('button', { name: /^More for / }).nth(30);
  const group = page.getByRole('group', { name: /^More for / });
  await more.click();
  const { height } = await boxOf(group);
  await page.keyboard.press('Escape');
  // Placed so the menu would fit on screen below its button, but only by running under the bar.
  await more.evaluate((button, below) => {
    window.scrollBy(0, button.getBoundingClientRect().bottom - (innerHeight - below));
  }, height + 40);
  await more.click();
  const menu = await boxOf(group);
  expect(menu.y + menu.height).toBeLessThanOrEqual((await boxOf(bar)).y);
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
  // Focus moving out past the button closes it, as the account menu and the badge list do.
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('button', { name: 'Tie', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(more).toBeFocused();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(menu).toHaveCount(0);
  await expect(more).toHaveAttribute('aria-expanded', 'false');
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
    // The question reads in the fill's own ink in either theme, never the page's light dark-mode text.
    await expect(row.locator('.tm-result.is-asking .tm-result-label')).toHaveCSS('color', 'rgb(33, 27, 11)');
    // Cancel too, with the pointer still on the row whose hover lifts its ghost buttons to page ink.
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCSS('color', 'rgb(33, 27, 11)');
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
  await expect(page.getByRole('timer', { name: `Time left at table ${table}`, exact: true })).toHaveText(
    'Paused · 3:00'
  );
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
  await expect(page.getByRole('timer', { name: `Time left at table ${table}`, exact: true })).toHaveText(
    'Paused · 8:00'
  );
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
  await expect(page.getByRole('timer', { name: 'Time left at your table', exact: true })).toHaveText('Paused · 3:00');
  await expect(page.getByText('Staff note', { exact: true })).toHaveCount(0);
});

test('the mobile result sheet keeps the table’s menu beside its number and the state at the far side @mobileOnly', async ({
  page
}) => {
  await mockConsole(page, event(4, 0, true), settingsOf({}));
  await page.locator('.tm-matches tbody tr:not(.tm-group-row)').first().click();
  const sheet = page.getByRole('dialog', { name: 'Result, table 1', exact: true });
  const title = await boxOf(sheet.locator('.tm-sheet-top strong'));
  const more = await boxOf(sheet.getByRole('button', { name: 'More for table 1', exact: true }));
  const state = await boxOf(sheet.locator('.tm-sheet-top .tm-result-label'));
  const top = await boxOf(sheet.locator('.tm-sheet-top'));
  expect(more.x - (title.x + title.width)).toBeLessThanOrEqual(16);
  expect(Math.abs(state.x + state.width - (top.x + top.width))).toBeLessThanOrEqual(1);
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
  const tab = page.getByRole('tab', { name: 'Players · 1 drop' });
  await tab.click();
  const requests = page.getByRole('region', { name: 'Player requests' });
  const row = requests.getByRole('row', { name: new RegExp(player.lastName) });
  await expect(row).toContainText('Drop');
  // The player's table, so whoever answers can walk straight there.
  const seated = seatedAt(t, player.id);
  await expect(row.getByRole('cell').nth(1)).toHaveText(String(seated.table));
  await requests.getByRole('button', { name: 'Confirm drop' }).click();
  await expect.poll(() => sent.answers).toEqual([expect.objectContaining({ id: 'request-1', status: 'accepted' })]);
  // The server drops the player with the answer; the console sends no separate drop to fail halfway.
  expect(sent).toHaveLength(0);
  await expect(requests).toContainText('Confirmed · Organizer');
  await expect(page.getByRole('tab', { name: 'Players', exact: true })).toBeVisible();
});

test('on a 320px phone a drop request stacks in its box, its table named and its answers in reach @mobileOnly', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const t = event(8, 0, true);
  const player = t.players[0]!;
  const asked: PlayerRequest = { id: 'request-1', player: player.id, kind: 'drop', at: 1, status: 'open' };
  await mockConsole(page, t, settingsOf({}), [], false, [asked]);
  await page.getByRole('tab', { name: 'Players · 1 drop' }).click();
  const requests = page.getByRole('region', { name: 'Player requests' });
  const seat = await requests
    .getByRole('cell')
    .nth(1)
    .evaluate(cell => getComputedStyle(cell, '::before').content);
  expect(seat).toBe('"Table "');
  const box = await requests.evaluate(el => el.getBoundingClientRect().right);
  for (const name of ['Confirm drop', 'Decline']) {
    const right = await requests.getByRole('button', { name }).evaluate(el => el.getBoundingClientRect().right);
    expect(right).toBeLessThanOrEqual(box);
  }
});

test('an open drop request holds the next pairing until it is answered, or paired past on purpose', async ({
  page
}) => {
  const t = event(8, 1, false);
  const player = t.players[0]!;
  const asked: PlayerRequest = { id: 'drop-1', player: player.id, kind: 'drop', at: 1, status: 'open' };
  const sent = await mockConsole(page, t, settingsOf({}), [], false, [asked]);
  await expect(page.getByRole('tab', { name: 'Players · 1 drop' })).toBeVisible();
  await expect(page.locator('.tm-next-reason')).toHaveText('1 drop request waiting');
  await page.getByRole('button', { name: 'Pair round 2' }).click();
  const check = page.getByRole('dialog', { name: 'Drop requests' });
  await expect(check.getByRole('listitem')).toHaveText([new RegExp(`${player.firstName} ${player.lastName}`)]);
  expect(sent).toHaveLength(0);
  await check.getByRole('button', { name: 'Cancel' }).click();
  await expect(check).toHaveCount(0);
  await page.getByRole('button', { name: 'Pair round 2' }).click();
  await check.getByRole('button', { name: 'Pair anyway' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'pairRound' });
});

const dropAsked = (t: Tournament): PlayerRequest => ({
  id: 'drop-1',
  player: t.players[0]!.id,
  kind: 'drop',
  at: 1,
  status: 'open'
});

test('an open drop request holds round 1 until it is answered', async ({ page }) => {
  const t = event(8, 0, false);
  const sent = await mockConsole(page, t, settingsOf({}), [], false, [dropAsked(t)]);
  await expect(page.locator('.tm-next-reason')).toHaveText('1 drop request waiting');
  await page.getByRole('button', { name: 'Pair round 1' }).click();
  const check = page.getByRole('dialog', { name: 'Drop requests' });
  await expect(check.getByRole('listitem')).toHaveCount(1);
  await check.getByRole('button', { name: 'Cancel' }).click();
  expect(sent).toHaveLength(0);
});

test('a top cut is not held by a drop request, but a round paired from the menu is', async ({ page }) => {
  const t = event(16, 5, false);
  const sent = await mockConsole(page, t, settingsOf({}), [], false, [dropAsked(t)]);
  const step = page.locator('.tm-split');
  await expect(step.getByRole('button', { name: 'Start top cut' })).toBeVisible();
  await expect(page.getByText('1 drop request waiting')).toHaveCount(0);
  await step.getByRole('button', { name: 'Other next steps' }).click();
  await step.locator('.tm-menu-item', { hasText: 'Pair round 6' }).click();
  const check = page.getByRole('dialog', { name: 'Drop requests' });
  await expect(check.getByRole('listitem')).toHaveCount(1);
  expect(sent).toHaveLength(0);
  await check.getByRole('button', { name: 'Pair anyway' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'pairRound' });
});

test('a drop confirmed from the pairing check leaves the pairing one press away', async ({ page }) => {
  const t = event(8, 1, false);
  const asked: PlayerRequest = { id: 'drop-1', player: t.players[0]!.id, kind: 'drop', at: 1, status: 'open' };
  const sent = await mockConsole(page, t, settingsOf({}), [], false, [asked]);
  await page.getByRole('button', { name: 'Pair round 2' }).click();
  const check = page.getByRole('dialog', { name: 'Drop requests' });
  await check.getByRole('button', { name: 'Confirm drop' }).click();
  await expect.poll(() => sent.answers).toEqual([expect.objectContaining({ id: 'drop-1', status: 'accepted' })]);
  await expect(check).toContainText('No drop requests waiting.');
  await check.getByRole('button', { name: 'Pair round 2' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'pairRound' });
});

test('a long check-in line is counted, filtered on the roster, and dropped all at once after asking', async ({
  page
}) => {
  const t = event(12, 0, false);
  const sent = await mockConsole(page, t, settingsOf({ entryFee: 10 }));
  const gate = page.locator('.tm-check-gate');
  await expect(gate).toContainText('12 players aren’t checked in.');
  // The roster lists them; the box above it only counts them.
  await expect(gate.getByRole('listitem')).toHaveCount(0);
  const show = page.getByRole('radiogroup', { name: 'Show' });
  await show.getByRole('radio', { name: /Not checked in/ }).click();
  await expect(page).toHaveURL(/show=unchecked/);
  // Clicked, not checked: the row leaves the filter as soon as the tick is saved, so its ticked state may never be seen.
  await page.getByRole('checkbox', { name: 'Paid: Player1 Test' }).click();
  await expect(page.getByRole('checkbox', { name: 'Paid: Player1 Test' })).toHaveCount(0);
  await expect(show.getByRole('radio', { name: /Not checked in/ })).toHaveText('Not checked in11');
  // The first drop waits on its answer while the desk checks a latecomer in.
  let answer = () => undefined as void;
  const held = new Promise<void>(resolve => {
    answer = resolve;
  });
  await page.route(`**/api/tournaments/${CODE}/commands`, async route => {
    await held;
    return route.fallback();
  });
  await gate.getByRole('button', { name: 'Drop all 11' }).click();
  const asking = gate.getByRole('group', { name: 'Drop 11 players who aren’t checked in?' });
  await asking.getByRole('button', { name: 'Drop 11' }).click();
  await expect(gate.getByRole('button', { name: /^Drop all/ })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Paid: Player12 Test' }).click();
  await expect(page.getByRole('checkbox', { name: 'Paid: Player12 Test' })).toHaveCount(0);
  answer();
  const dropped = () => sent.flatMap(command => (command.type === 'dropPlayer' ? [command.id] : []));
  // Everyone listed at the question but the two checked in: Player1 before it, Player12 during it.
  await expect.poll(dropped).toEqual(t.players.slice(1, 11).map(player => player.id));
  await expect(gate.getByRole('button', { name: /^Drop all/ })).toBeEnabled();
});

test('a check-in tick the server refuses goes back to unticked', async ({ page }) => {
  await mockConsole(page, event(3, 0, false), settingsOf({ entryFee: 10 }));
  await page.route(`**/api/tournaments/${CODE}/checkins`, route =>
    route.fulfill({ status: 503, json: { error: 'Try again shortly' } })
  );
  const box = page.getByRole('checkbox', { name: 'Paid: Player1 Test' });
  await box.click();
  await expect(box).toBeEnabled();
  await expect(box).not.toBeChecked();
});

test('a check-in tick waits on its own answer, not every other box on the page', async ({ page }) => {
  await mockConsole(page, event(3, 0, false), settingsOf({ entryFee: 10 }));
  let answer = () => undefined as void;
  const held = new Promise<void>(resolve => {
    answer = resolve;
  });
  await page.route(`**/api/tournaments/${CODE}/checkins`, async route => {
    await held;
    return route.fallback();
  });
  const first = page.getByRole('checkbox', { name: 'Paid: Player1 Test' });
  await first.check();
  await expect(first).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Paid: Player2 Test' })).toBeEnabled();
  const third = page.locator('.tm-check-gate').getByRole('listitem').filter({ hasText: 'Player3 Test' });
  await third.getByRole('button', { name: 'More for Player3 Test' }).click();
  await expect(third.getByRole('button', { name: 'Mark paid' })).toBeEnabled();
  answer();
  await expect(first).toBeEnabled();
});

test('dropping a player from the check-in line asks first', async ({ page }) => {
  const sent = await mockConsole(page, event(3, 0, false), settingsOf({ entryFee: 10 }));
  const row = page.locator('.tm-check-gate').getByRole('listitem').filter({ hasText: 'Player2 Test' });
  await row.getByRole('button', { name: 'More for Player2 Test' }).click();
  await row.getByRole('button', { name: 'Drop' }).click();
  expect(sent).toHaveLength(0);
  await row
    .getByRole('group', { name: 'Drop Player2 Test? You can reinstate them until the next round is paired.' })
    .getByRole('button', { name: 'Drop' })
    .click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'dropPlayer' });
});

test('a staff removal that fails says so in the staff list', async ({ page }) => {
  await mockConsole(page, event(8, 0, true), settingsOf({}));
  await page.route(`**/api/tournaments/${CODE}/staff*`, route =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 503, json: { error: 'Try again shortly' } })
      : route.fulfill({ json: { staff: [{ id: 'u9', name: 'Sam Judge', joinedAt: null }] } })
  );
  await page.getByRole('tab', { name: 'Settings' }).click();
  const list = page.locator('.tm-staff-list');
  await list.getByRole('button', { name: 'Remove' }).click();
  await list
    .getByRole('group', { name: 'Remove Sam Judge from staff?' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(list.getByRole('alert')).toHaveText('Try again shortly');
});

test('the roster filters by status, kept in the address, and lists names by last name', async ({ page }) => {
  const played = event(6, 1, false);
  const gone = played.players[0]!;
  await mockConsole(page, runCommands(played, { type: 'dropPlayer', id: gone.id }), settingsOf({}));
  await page.getByRole('tab', { name: 'Players' }).click();
  const rows = page.locator('.tm-roster tbody tr');
  await expect(rows).toHaveCount(6);
  const show = page.getByRole('radiogroup', { name: 'Show' });
  await show.getByRole('radio', { name: 'Dropped' }).click();
  await expect(page).toHaveURL(/show=dropped/);
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('.tm-name')).toHaveText(`Test, ${gone.firstName}`);
  await expect(page.getByText('1 of 6 players')).toBeVisible();
  await show.getByRole('radio', { name: 'Active' }).click();
  await expect(rows).toHaveCount(5);
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Active' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
});

test('before round 1 Remove waits in the row menu beside Drop', async ({ page }) => {
  const sent = await mockConsole(page, event(4, 0, false), settingsOf({}));
  await expect(page.locator('.tm-roster').getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await page
    .getByRole('button', { name: /^More for / })
    .first()
    .click();
  const menu = page.getByRole('group', { name: /^More for / });
  await menu.getByRole('button', { name: 'Remove' }).click();
  await menu
    .getByRole('group', { name: /^Remove .+\?$/ })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'removePlayer' });
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

test('a tab whose code fails with the Wi-Fi down costs that tab, not the console, and comes back on a retry', async ({
  page
}) => {
  let offline = true;
  const documents: string[] = [];
  page.on('request', request => request.isNavigationRequest() && documents.push(request.url()));
  await page.route(`**/${chunkOf('src/pages/tournaments/StandingsTable.tsx')}`, route =>
    offline ? route.abort('internetdisconnected') : route.continue()
  );
  // What recovery asks before it reloads: whether the site answers at all.
  await page.route(
    url => url.pathname === '/',
    route =>
      offline && !route.request().isNavigationRequest() ? route.abort('internetdisconnected') : route.continue()
  );
  await mockConsole(page, event(8, 1, true), settingsOf({}));
  await expect(page.getByRole('button', { name: 'Report Player' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Standings' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Standings' });
  await expect(panel.getByRole('alert')).toHaveText('Couldn’t load this section.');
  await expect(page.locator('.tm-console-hero h1')).toBeVisible();
  // No reload into the browser's offline page.
  expect(documents).toHaveLength(1);
  offline = false;
  // A browser that keeps the failed import reloads now that the site answers; the tab comes back either way.
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Standings' }).locator('table')).toBeVisible();
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

test('before round 1 staff tick who paid, and the console names who is still open @mobile', async ({ page }) => {
  await mockConsole(page, event(3, 0, false), settingsOf({ entryFee: 10, playerCap: 2 }));
  // Before round 1 the console opens on its players.
  await expect(page.getByRole('tabpanel', { name: 'Players' })).toBeVisible();
  await expect(page.getByText('3 / 2 players · 1 over the cap')).toBeVisible();
  // On a phone a row's menu sits on its name's line rather than one of its own.
  const row = page.locator('.tm-roster tbody tr').first();
  const [who, menu] = await Promise.all(
    ['.tm-who', '.tm-row-actions'].map(sel => row.locator(sel).evaluate(el => el.getBoundingClientRect().top))
  );
  expect(Math.abs((who ?? 0) - (menu ?? 0))).toBeLessThan(24);
  const open = page.locator('.tm-check-gate');
  await expect(open).toContainText('3 players aren’t checked in.');
  await page.getByRole('checkbox', { name: 'Paid: Player1 Test' }).check();
  await expect(open).toContainText('2 players aren’t checked in.');
  // Each still open has what lets them go under their menu, as a roster row does, and the box keeps to its width.
  expect(await open.evaluate(box => box.scrollWidth - box.clientWidth)).toBeLessThanOrEqual(0);
  const first = open.getByRole('listitem').first();
  const [end, dots] = await Promise.all([
    first.evaluate(el => el.getBoundingClientRect().right),
    first.getByRole('button', { name: /^More for / }).evaluate(el => el.getBoundingClientRect().right)
  ]);
  expect(Math.abs(end - dots)).toBeLessThan(2);
  for (const name of ['Player2 Test', 'Player3 Test']) {
    const line = open.getByRole('listitem').filter({ hasText: name });
    await line.getByRole('button', { name: `More for ${name}` }).click();
    await line.getByRole('button', { name: 'Mark paid' }).click();
  }
  await expect(page.getByText('Everyone is checked in.')).toBeVisible();
});

test('the roster’s filter stays inside its box on a narrow phone, a choice to a line @mobileOnly', async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 640 });
  await mockConsole(page, event(3, 0, false), settingsOf({ entryFee: 10 }));
  const show = page.locator('.tm-roster-show');
  await expect(show.getByRole('radio')).toHaveCount(4);
  const [filter, box] = await Promise.all([
    show.evaluate(el => el.getBoundingClientRect().right),
    show.evaluate(el => el.parentElement?.getBoundingClientRect().right ?? 0)
  ]);
  expect(filter).toBeLessThanOrEqual(box);
  // Past the box's width it scrolls, each choice still on one line.
  const [one, long] = await Promise.all(
    [show.getByRole('radio', { name: 'All' }), show.getByRole('radio', { name: /Not checked in/ })].map(radio =>
      radio.evaluate(el => el.getBoundingClientRect().height)
    )
  );
  expect(long).toBe(one);
});

/** The font size of every visible text field on the page, which iOS zooms into below 16px. */
const fieldSizes = (page: Page) =>
  page
    .locator('main :is(input:not([type=checkbox], [type=radio]), select, textarea):visible')
    .evaluateAll(fields => fields.map(field => getComputedStyle(field).fontSize));

test.describe('on a phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('fields stay at 16px, so focusing one doesn’t zoom the page', async ({ page }) => {
    await mockConsole(page, event(8, 1, true), settingsOf({}));
    await expect(page.locator('.tm-matches tbody tr').first()).toBeVisible();
    const sizes = await fieldSizes(page);
    expect(sizes.length).toBeGreaterThan(0);
    expect(new Set(sizes)).toEqual(new Set(['16px']));
  });

  test('the penalty form keeps each select inside its column and the box', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await mockConsole(page, partlyPlayed(8, 0, 2), settingsOf({}));
    await page.getByRole('tab', { name: 'Penalties' }).click();
    const form = page.locator('.tm-penalty-form');
    await expect(form.locator('select')).toHaveCount(3);
    const spill = await form.locator('label').evaluateAll(labels => {
      const box = labels[0]?.closest('.tm-box')?.getBoundingClientRect().right ?? 0;
      return labels.flatMap(label => {
        const select = label.querySelector('select');
        const right = select?.getBoundingClientRect().right ?? 0;
        return right > label.getBoundingClientRect().right + 0.5 || right > box ? [label.firstChild?.textContent] : [];
      });
    });
    expect(spill).toEqual([]);
  });

  test('a table’s result takes only its words’ room, leaving the rest to the names', async ({ page }) => {
    await mockConsole(page, event(8, 1, true), settingsOf({}));
    const row = page.locator('.tm-matches tbody tr:not(.tm-group-row)').first();
    const result = await row.locator('td.tm-extra-col').boundingBox();
    const seat = await row.locator('td.tm-seat').first().boundingBox();
    expect(result?.width ?? 0).toBeLessThan(200);
    expect(seat?.width ?? 0).toBeGreaterThan(400);
  });

  test('a row’s menu with no room below or above shows whole under the page’s head', async ({ page }) => {
    await mockConsole(page, event(8, 0, false), settingsOf({}));
    const more = page.getByRole('button', { name: /^More for / }).first();
    const group = page.getByRole('group', { name: /^More for / });
    // Mid-screen, the menu is taller than the room on either side of its button.
    await more.evaluate(button => {
      window.scrollBy(0, button.getBoundingClientRect().top - innerHeight * 0.45);
    });
    await more.click();
    const head = await boxOf(page.locator('.site-head'));
    expect((await boxOf(group)).y).toBeGreaterThanOrEqual(head.y + head.height);
  });

  test('a dialog taller than the screen keeps its answers in view', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await mockConsole(page, event(4, 0, true), settingsOf({ sanctioned: true }));
    await page.getByRole('tab', { name: 'Players' }).click();
    await page
      .getByRole('button', { name: /^More for / })
      .first()
      .click();
    await page
      .getByRole('group', { name: /^More for / })
      .getByRole('button', { name: 'Edit' })
      .click();
    const dialog = await boxOf(page.getByRole('dialog', { name: 'Edit player' }));
    const save = await boxOf(page.getByRole('button', { name: 'Save' }));
    expect(save.y + save.height).toBeLessThanOrEqual(dialog.y + dialog.height);
  });

  test('a bye starts where the names above it do', async ({ page }) => {
    await mockConsole(page, event(7, 0, true), settingsOf({}), [], false);
    const start = (cell: string) =>
      page.locator(cell).evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return Math.round(range.getBoundingClientRect().left);
      });
    const name = await start('.tm-matches .tm-seat .tm-name >> nth=0');
    expect(await start('.tm-matches td.tm-seat > .muted-cell')).toBe(name);
  });

  test('standings show a long name whole beside the tiebreakers', async ({ page, context }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 47, right: 47, bottom: 21 } });
    const long = { type: 'addPlayer', player: { firstName: 'Hubert', lastName: 'Wolfeschlegelsteinhausen' } } as const;
    const t = runCommands(
      emptyTournament({ name: 'Friday League' }),
      long,
      ...event(7, 0, false).players.map(
        player => ({ type: 'addPlayer', player: { firstName: player.firstName, lastName: player.lastName } }) as const
      ),
      { type: 'pairRound', pod: 'masters' }
    );
    await mockConsole(page, reportAll(t), settingsOf({}));
    await page.getByRole('tab', { name: 'Standings' }).click();
    await expect(page.locator('.tm-standings th', { hasText: 'OOWP' })).toBeVisible();
    const name = page.locator('.tm-standings .tm-name').filter({ hasText: 'Wolfeschlegel' });
    expect(await name.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test('six tabs in Spanish keep one line each and scroll rather than squeeze', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await mockConsole(page, event(8, 1, true), settingsOf({ decklists: 'open' }));
    await page.goto(`/host/${CODE}?lang=es`);
    const tabs = page.locator('.tm-console > .tabs');
    await expect(tabs.getByRole('tab')).toHaveCount(6);
    const squeezed = await tabs
      .getByRole('tab')
      .evaluateAll(all => all.filter(tab => tab.scrollWidth > tab.clientWidth || tab.clientHeight > 44).length);
    expect(squeezed).toBe(0);
    await expect(tabs).toHaveClass(/fade-r/);
  });
});

test.describe('on a 640px phone held sideways', () => {
  test.use({ viewport: { width: 640, height: 360 }, hasTouch: true, isMobile: true });

  test('the tab bar keeps its first and last labels clear of a notch at the side', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 47, right: 47, bottom: 21 } });
    await mockConsole(page, event(8, 1, true), settingsOf({}));
    const labels = page.locator('.tm-tabbar [role="tab"] > span');
    await expect(labels.first()).toBeVisible();
    const edges = await labels.evaluateAll(spans =>
      spans.map(span => {
        const box = span.getBoundingClientRect();
        return Math.min(box.left, innerWidth - box.right);
      })
    );
    expect(Math.min(...edges)).toBeGreaterThanOrEqual(47);
  });
});

test('staff add a minute, or type the time left and see the change before it is sent', async ({ page }) => {
  const sent = await mockConsole(page, partlyPlayed(8, 0, 2), settingsOf({}));
  const clock = page.locator('.tm-console-hero').getByRole('group', { name: 'Round clock' });
  await expect(clock.getByRole('button', { name: 'Add five minutes' })).toHaveCount(0);
  await clock.getByRole('button', { name: 'Add a minute' }).click();
  await expect.poll(() => sent.at(-1)).toEqual({ type: 'adjustClock', pod: 'masters', seconds: 60 });
  await clock.getByRole('button', { name: 'Set the time left' }).click();
  const field = clock.getByRole('textbox', { name: 'Time left' });
  await expect(field).toBeFocused();
  await field.fill('99:59');
  await expect(field).toHaveAccessibleDescription(/^Adds \d+ minutes/);
  await clock.getByRole('button', { name: 'Set', exact: true }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'adjustClock', pod: 'masters' });
  expect((sent.at(-1) as { seconds: number }).seconds).toBeGreaterThan(300);
  await expect(field).toBeHidden();
});

/** The staff records a player's sheet reads, each with one entry about `id`: a list in, a warning and a passed deck check. */
async function mockRecords(page: Page, id: string) {
  const about = { playerId: id, playerName: 'Player1 Test', round: 1, recordedBy: 'Organizer', recordedAt: 0 };
  const entry = { ...about, replaces: null, removed: false };
  const staff = { id: 'u1', name: 'Organizer' };
  const list = { popId: '', firstName: 'Player1', lastName: 'Test', birthDate: '', deck: '', mode: 'paper' };
  await page.route(`**/api/tournaments/${CODE}/decklists`, route =>
    route.fulfill({
      json: {
        decklists: [{ ...list, archetype: null, submittedAt: 0, problems: [], registered: true, fromList: false }],
        mine: null
      }
    })
  );
  await page.route(`**/api/tournaments/${CODE}/penalty-notes`, route =>
    route.fulfill({
      json: {
        entries: [{ ...entry, id: 'n1', judge: staff, penalty: 'warning', notes: 'Shuffled after the cut' }],
        judges: [staff]
      }
    })
  );
  await page.route(`**/api/tournaments/${CODE}/deck-checks`, route =>
    route.fulfill({
      json: { entries: [{ ...entry, id: 'c1', checker: staff, result: 'pass', notes: '' }], checkers: [staff] }
    })
  );
}

test('a player’s sheet opens from standings and the roster, with their table, rounds, list, notes and checks', async ({
  page
}) => {
  const t = event(8, 1, true);
  const player = t.players.find(p => p.firstName === 'Player1')!;
  const seat = seatedAt(t, player.id);
  const opponent = t.players.find(p => p.id === (seat.p1 === player.id ? seat.p2 : seat.p1))!;
  const sent = await mockConsole(page, t, settingsOf({ decklists: 'closed' }));
  await mockRecords(page, player.id);

  await page.getByRole('tab', { name: 'Standings', exact: true }).click();
  const fromStandings = page.getByRole('button', { name: 'Player1 Test', exact: true });
  await fromStandings.click();
  const sheet = page.getByRole('dialog', { name: 'Player1 Test' });
  await expect(sheet.getByRole('heading', { level: 3 })).toHaveText([
    'Now',
    'Rounds',
    'Decklist',
    'Penalties',
    'Deck checks'
  ]);
  const section = (name: string) => sheet.locator('.tm-sheet-section', { has: page.getByRole('heading', { name }) });
  await expect(section('Now')).toContainText(`Table ${seat.table} · Round 2`);
  await expect(section('Now').getByRole('button')).toContainText(`${opponent.firstName} Test`);
  await expect(section('Rounds').getByRole('row')).toHaveCount(3);
  await expect(section('Decklist')).toContainText('In person');
  await expect(section('Penalties')).toContainText('Warning · Round 1 · Organizer');
  await expect(section('Penalties')).toContainText('Shuffled after the cut');
  await expect(section('Deck checks')).toContainText('Pass · Round 1 · Organizer');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(fromStandings).toBeFocused();

  await page.getByRole('tab', { name: 'Players', exact: true }).click();
  await page.getByRole('button', { name: 'Test, Player1', exact: true }).click();
  await expect(sheet).toBeVisible();
  // The roster's actions keep their question; Escape backs out of it, and the menu, before it closes the sheet.
  await sheet.getByRole('button', { name: 'Actions for Player1 Test' }).click();
  await sheet.getByRole('button', { name: 'Drop', exact: true }).click();
  await expect(sheet.getByRole('group', { name: /^Drop Player1 Test\?/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet.getByRole('group', { name: /^Drop Player1 Test\?/ })).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  expect(sent).toHaveLength(0);

  // A row's menu opens it too, and hands focus back to the name it stands for.
  await page.getByRole('button', { name: 'More for Player1 Test' }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Test, Player1', exact: true })).toBeFocused();
});

/** A player's report of table `m`, from `by`. */
const reportOf = (m: Match, by: string, outcome: PlayerReport['outcome']): PlayerReport => ({
  pod: 'masters',
  round: 1,
  table: m.table,
  p1: m.p1,
  p2: m.p2 ?? '',
  by,
  outcome,
  at: 0
});

/** The latest round's first `n` tables. */
function tables(t: Tournament, n: number): (Match & { p2: string })[] {
  const found = (t.pods[0]?.rounds.at(-1)?.matches ?? []).filter((m): m is Match & { p2: string } => m.p2 !== null);
  if (found.length < n) {
    throw new Error('not enough tables');
  }
  return found.slice(0, n);
}

test('on a phone the pinned round bar keeps the room search, a table number finding its table @mobileOnly', async ({
  page
}) => {
  await mockConsole(page, event(16, 0, true), settingsOf({}));
  await page.locator('.tm-round-pin').getByRole('searchbox', { name: 'Find a table or player' }).fill('3');
  await expect(page.locator('.tm-matches tbody tr:not(.tm-group-row) td.tm-table-col')).toHaveText(['3']);
});

test('a narrow console’s table sheet says what each seat reported', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  const t = event(8, 0, true);
  const [m] = tables(t, 1);
  await mockConsole(page, t, settingsOf({ playerReporting: true }), [
    reportOf(m!, m!.p1, 'p1'),
    reportOf(m!, m!.p2, 'p2')
  ]);
  await page
    .locator('.tm-matches tbody tr')
    .filter({ has: page.locator('.tm-result-label.is-problem') })
    .click();
  const sheet = page.getByRole('dialog', { name: `Result, table ${m!.table}` });
  await expect(sheet.locator('.tm-sheet-report')).toHaveText(['Reported: won', 'Reported: won']);
  await expect(sheet.locator('.tm-sheet-report.is-problem')).toHaveCount(2);
});

test('the plain reports are accepted in one go, each table named first, a dispute left in its row', async ({
  page
}) => {
  const t = event(8, 0, true);
  const [a, b, c] = tables(t, 3);
  const sent = await mockConsole(page, t, settingsOf({ playerReporting: true }), [
    reportOf(b!, b!.p2, 'p2'),
    reportOf(a!, a!.p1, 'p1'),
    reportOf(c!, c!.p1, 'p1'),
    reportOf(c!, c!.p2, 'p2')
  ]);
  await page.getByRole('button', { name: 'Accept 2 reports' }).click();
  const dialog = page.getByRole('dialog', { name: 'Accept 2 reported results?' });
  await expect(dialog.locator('.tm-accept-line')).toHaveText([
    new RegExp(`^Table ${a!.table} · .+ wins$`),
    new RegExp(`^Table ${b!.table} · .+ wins$`)
  ]);
  await expect(dialog.getByRole('button')).toHaveText(['Keep', 'Accept 2']);
  await dialog.getByRole('button', { name: 'Accept 2' }).click();
  await expect
    .poll(() =>
      sent.filter(command => command.type === 'reportResult').map(command => [command.table, command.outcome])
    )
    .toEqual([
      [a!.table, 'p1'],
      [b!.table, 'p2']
    ]);
});

test('the head names whose clock it runs only where the event pairs more than one pod', async ({ page }) => {
  const adds: Command[] = Array.from({ length: 12 }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: `Player${i + 1}`, lastName: 'Test', birthDate: i < 6 ? '02/27/2016' : '02/27/1990' }
  }));
  const t = runCommands(emptyTournament({ name: 'Two Pods' }), ...adds, { type: 'pairRound', pod: 'senior-masters' });
  expect(t.pods).toHaveLength(2);
  await mockConsole(page, t, settingsOf({}));
  const caption = page.locator('.tm-console-steps .tm-clock-caption');
  await expect(caption).not.toBeEmpty();
  const name = await caption.textContent();
  await expect(page.locator('.tm-console-steps').getByRole('group', { name: `${name} round clock` })).toBeVisible();
});
