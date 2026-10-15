/**
 * Deck checks in the console's Decklists tab, against mocked functions that
 * keep the record as the real ones do: append-only, an edit or removal a new
 * entry replacing the one before. Once round 1 is paired the lists are
 * locked, and an opened list records, edits and removes its player's checks.
 */

import { expect, type Page, test } from '@playwright/test';

import { applyCommand, type Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import type { DeckCheckEntry } from '../../shared/tournament/deckChecks';
import { seededRandom } from '../../shared/tournament/random';
import type { Tournament } from '../../shared/tournament/types';
import { DEFAULT_SETTINGS } from '../../shared/tournament/view';

const CODE = 'CHECK1';

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

/** Four players at an unsanctioned event, round 1 paired, and the first one's list in. */
function pairedEvent(): Tournament {
  const adds: Command[] = Array.from({ length: 4 }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: `Player${i + 1}`, lastName: 'Test' }
  }));
  return run(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
}

const LIST = {
  popId: '',
  firstName: 'Player1',
  lastName: 'Test',
  birthDate: '',
  deck: '4 Iono PAL 185\n56 Basic {G} Energy SVE 1',
  archetype: null,
  submittedAt: 0,
  problems: [],
  registered: true,
  fromList: false,
  locked: true
};

const CHECKERS = [
  { id: 'u1', name: 'Organizer' },
  { id: 'u2', name: 'Dana Kim' }
];

type Body = Record<string, unknown>;

/** The console's API, with a deck check record kept as the functions keep it; every write is recorded. */
async function mockConsole(page: Page, tournament: Tournament) {
  const entries: DeckCheckEntry[] = [];
  const writes: { method: string; body: Body | null; id: string | null }[] = [];
  const manage = {
    code: CODE,
    mode: 'swiss',
    version: 3,
    updatedAt: 0,
    tournament,
    pending: [],
    reports: [],
    settings: { ...DEFAULT_SETTINGS, sanctioned: false, decklists: 'open' },
    decks: {},
    role: 'owner',
    staffToken: 'invite',
    store: 'store-1'
  };
  const append = (entry: Omit<DeckCheckEntry, 'id' | 'recordedBy' | 'recordedAt'>) =>
    entries.push({ ...entry, id: `e${entries.length + 1}`, recordedBy: 'Organizer', recordedAt: Date.now() });
  const record = () => ({ json: { entries, checkers: CHECKERS } });
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/me') {
      const user = { id: 'u1', name: 'Organizer', avatar: null, popId: null, firstName: null, lastName: null };
      const account = {
        ...user,
        birthDate: null,
        role: 'community',
        stores: [],
        handle: 'organizer',
        providers: ['dev']
      };
      return route.fulfill({ json: { user: account, providers: ['dev'] } });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/decklists`) {
      return route.fulfill({ json: { decklists: [LIST], mine: null } });
    }
    if (url.pathname !== `/api/tournaments/${CODE}/deck-checks`) {
      return route.fulfill({ status: 404, json: { error: 'Not found' } });
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Body;
      writes.push({ method: 'POST', body, id: null });
      const checker = CHECKERS.find(c => c.id === body.checkerId);
      append({
        playerId: body.playerId as string,
        playerName: 'Player1 Test',
        round: body.round as number,
        checker: checker ?? { id: null, name: body.checkerName as string },
        result: body.result as DeckCheckEntry['result'],
        notes: body.notes as string,
        replaces: (body.replaces as string | null) ?? null,
        removed: false
      });
    }
    if (request.method() === 'DELETE') {
      const id = url.searchParams.get('id');
      writes.push({ method: 'DELETE', body: null, id });
      const target = entries.find(entry => entry.id === id);
      if (target) {
        append({ ...target, replaces: target.id, removed: true });
      }
    }
    return route.fulfill(record());
  });
  await page.goto(`/host/${CODE}`);
  return writes;
}

test('an opened list records, edits and removes its player’s deck checks once round 1 is paired', async ({ page }) => {
  const t = pairedEvent();
  const playerId = t.players.find(player => player.firstName === 'Player1')?.id;
  const writes = await mockConsole(page, t);
  await page.getByRole('tab', { name: 'Decklists' }).click();
  await expect(page.getByText('Locked after round 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close submission' })).toHaveCount(0);
  const row = page.locator('.tm-lists tbody tr').first();
  await expect(row).toContainText('Not checked');

  await row.getByRole('button', { name: 'View' }).click();
  const side = page.locator('.tm-check-side');
  await expect(side).toContainText('No deck checks yet.');
  await expect(side.getByLabel('Round')).toHaveValue('1');
  await expect(side.getByLabel('Deck checker')).toHaveValue('u1');
  await side.getByRole('button', { name: 'Save check' }).click();
  await expect(side.getByRole('alert')).toHaveText('Choose Pass or Fail');
  await side.getByRole('button', { name: 'Fail' }).click();
  await side.getByLabel('Notes').fill('Four Iono in the deck, three on the list.');
  await side.getByRole('button', { name: 'Save check' }).click();
  await expect(side.locator('.tm-check-list')).toContainText('R1 · Fail · checked by Organizer');
  await expect(side.locator('.tm-check-list')).toContainText('Recorded by Organizer at');
  await expect(row).toContainText('R1 Fail');
  expect(writes[0]?.body).toEqual({
    playerId,
    round: 1,
    result: 'fail',
    notes: 'Four Iono in the deck, three on the list.',
    replaces: null,
    checkerId: 'u1'
  });

  await side.getByRole('button', { name: 'Edit' }).click();
  await side.getByLabel('Deck checker').selectOption({ label: 'Someone else' });
  await side.getByLabel('Name').fill('Head Judge Sam');
  await side.getByRole('button', { name: 'Pass' }).click();
  await side.getByRole('button', { name: 'Save edit' }).click();
  await expect(side.locator('.tm-check-list')).toContainText('R1 · Pass · checked by Head Judge Sam');
  expect(writes[1]?.body).toMatchObject({ replaces: 'e1', checkerName: 'Head Judge Sam', result: 'pass' });
  await side.getByRole('button', { name: 'Show 1 earlier version' }).click();
  await expect(side.locator('.tm-check-earlier')).toContainText('R1 · Fail · Organizer');

  await side.getByRole('button', { name: 'Remove' }).click();
  await side.getByRole('group', { name: 'Remove this deck check?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(side).toContainText('No deck checks yet.');
  expect(writes[2]).toMatchObject({ method: 'DELETE', id: 'e2' });
  await expect(row).toContainText('Not checked');
});
