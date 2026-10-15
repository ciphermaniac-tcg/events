import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, mock, test } from 'node:test';
import * as me from '../../functions/api/me.ts';
import { exportMarkdown } from '../../functions/lib/accounts/dataExport.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { REPORT_WINDOW_MS } from '../../shared/tournament/reports.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let db: ReturnType<typeof sqliteD1>;
let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, settle, playerSays, addPlayers } = eventCalls(hit);
beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
  report._resetRateLimitStore();
});

afterEach(() => mock.timers.reset());

[true, false].forEach(sanctioned => {
  test(`fuzzy surname lookup is read-only with reporting off and on (sanctioned=${sanctioned})`, async () => {
    const owner = await signIn('Organizer', 'organizer');
    const code = await newSwiss(owner);
    await settle(code, owner, { sanctioned });
    await send(code, owner, {
      type: 'addPlayer',
      player: {
        id: '1234567',
        firstName: 'Peter',
        lastName: 'Parker',
        birthDate: '01/01/1990'
      }
    });
    await send(code, owner, {
      type: 'addPlayer',
      player: {
        id: '2345678',
        firstName: 'Patricia',
        lastName: 'Parker',
        birthDate: '01/01/1990'
      }
    });
    for (const playerReporting of [false, true]) {
      await settle(code, owner, { playerReporting });
      const before = db.raw.prepare('SELECT version FROM tournaments WHERE code = ?').get(code);
      const answer = await playerSays(code, { lookup: true, lastName: 'Perker' }, { cookie: owner });
      assert.equal(answer.status, 200);
      assert.equal(answer.json.candidates.length, 2, 'ambiguous candidates are all returned');
      assert.deepEqual(Object.keys(answer.json.candidates[0]).sort(), ['firstName', 'key', 'lastName']);
      assert.equal(answer.json.reportToken, undefined);
      assert.equal(answer.json.linked, undefined);
      assert.deepEqual(db.raw.prepare('SELECT version FROM tournaments WHERE code = ?').get(code), before);
      assert.equal(db.raw.prepare('SELECT count(*) AS n FROM report_devices').get()?.n, 0);
      const narrowed = await playerSays(code, { lookup: true, lastName: 'Perker', firstName: 'Piter' });
      assert.equal(narrowed.json.candidates.length, 1);
      assert.equal(narrowed.json.candidates[0].firstName, 'Peter');
      const shown = narrowed.json.view.tournament.players.find(
        (player: { id: string }) => player.id === narrowed.json.candidates[0].key
      );
      assert.equal(narrowed.json.candidates[0].lastName, shown.lastName, 'names as the event publishes them');
      assert.equal(shown.lastName === 'Parker', sanctioned, 'an unsanctioned surname stays shortened');
      assert.equal((await playerSays(code, { lookup: true, lastName: 'Jones' })).json.candidates.length, 0);
    }
    assert.equal((await playerSays(code, { lastName: 'Perker' })).status, 404, 'typos cannot claim a reporting seat');
    assert.equal((await playerSays(code, { lookup: true, lastName: 'Perker', result: 'win' })).status, 400);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM report_devices').get()?.n, 0);
  });
});

[false, true].forEach(signedIn => {
  test(`two attacker-controlled device strings never settle results (signedIn=${signedIn})`, async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const owner = await signIn('Organizer', 'organizer');
    const code = await newSwiss(owner);
    await addPlayers(code, owner, 2);
    await settle(code, owner, { sanctioned: false, playerReporting: true });
    const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
    const match = paired.json.tournament.pods[0].rounds[0].matches[0];
    const claims = [match.p1, match.p2].map((id: string) => ({
      lastName: paired.json.tournament.players.find((p: { id: string }) => p.id === id).lastName
    }));
    const cookies = signedIn ? [await signIn('AttackerA'), await signIn('AttackerB')] : [undefined, undefined];
    for (const [index, result] of ['win', 'loss'].entries()) {
      const answer = await playerSays(
        code,
        { ...claims[index], device: `forged-${index}`, result },
        { cookie: cookies[index] }
      );
      assert.equal(answer.status, 200);
    }
    mock.timers.tick(REPORT_WINDOW_MS * 100);
    await playerSays(code, claims[0]!);
    await hit(event.onRequestGet as Handler, '/event', at(code));
    const staff = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
    assert.equal(staff.json.tournament.pods[0].rounds[0].matches[0].outcome, 'pending');
    assert.equal(staff.json.reports.length, 2);
    assert.notEqual(staff.json.reports[0].device, staff.json.reports[1].device);
    const accepted = await send(code, owner, {
      type: 'reportResult',
      pod: 'masters',
      round: 1,
      table: match.table,
      p1: match.p1,
      p2: match.p2,
      outcome: 'p1'
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.tournament.pods[0].rounds[0].matches[0].outcome, 'p1');
    assert.deepEqual(accepted.json.reports, []);
    await hit(report.onRequestDelete as Handler, `/?player=${match.p1}`, at(code), { method: 'DELETE', cookie: owner });
    const evidence = await hit(report.onRequestGet as Handler, '/report', at(code), { cookie: owner });
    assert.equal(evidence.json.history.length, 2, 'staff acceptance and release retain evidence');
    assert.equal(evidence.json.history[0].report.by, match.p1);
    assert.equal(typeof evidence.json.history[0].report.device, 'string');
    assert.equal(typeof evidence.json.history[0].report.at, 'number');
    assert.equal(typeof evidence.json.history[0].claimedAt, 'number');
    assert.equal(
      evidence.json.history.every((entry: { account: string | null }) => entry.account !== null),
      signedIn
    );
    assert.equal((await hit(report.onRequestGet as Handler, '/report', at(code))).status, 401);
    assert.equal(
      (await hit(report.onRequestGet as Handler, '/report', at(code), { cookie: await signIn('Outsider') })).status,
      403
    );
    const publicView = (await hit(event.onRequestGet as Handler, '/event', at(code))).json;
    assert.equal(JSON.stringify(publicView).includes('claimedAt'), false);
  });
});

test('edits, disabling reports and event deletion retain evidence only until the event is deleted', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  assert.equal((await send(code, owner, { type: 'pairRound', pod: 'masters' })).status, 200);
  await settle(code, owner, { playerReporting: true });
  const filed = await playerSays(code, { popId: '900', device: 'first', result: 'win' });
  assert.equal(filed.status, 200, JSON.stringify(filed.json));
  const edited = await playerSays(code, { popId: '900', device: 'first', result: 'loss' });
  assert.equal(edited.status, 200);
  await settle(code, owner, { playerReporting: false });
  const evidence = await hit(report.onRequestGet as Handler, '/report', at(code), { cookie: owner });
  assert.deepEqual(
    evidence.json.history.map((entry: { report: { outcome: string } }) => entry.report.outcome),
    [filed.json.view.reports[0].outcome, edited.json.view.reports[0].outcome]
  );
  await hit(event.onRequestDelete as Handler, '/event', at(code), { method: 'DELETE', cookie: owner });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM report_history WHERE code = ?').get(code)?.n, 0);
});

test('a replaced seat cannot rewrite the claimant evidence of an authorized filing', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const player = await signIn('Player');
  const { user } = (await hit(me.onRequestGet as Handler, '/me', {}, { cookie: player })).json;
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  await settle(code, owner, { sanctioned: false, playerReporting: true });
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const claimed = await playerSays(code, { lastName: '0', device: 'original' }, { cookie: player });
  assert.equal(claimed.status, 200);
  const original = db.raw.prepare('SELECT claimed_at, device FROM report_devices WHERE code = ?').get(code)!;
  env.TOURNAMENT_DB = racing(db, 'UPDATE tournaments SET', () => {
    db.raw
      .prepare('UPDATE report_devices SET claimed_at = 999, user_id = NULL, device = ? WHERE code = ?')
      .run('replacement', code);
    db.raw.prepare('UPDATE tournaments SET version = version + 1 WHERE code = ?').run(code);
  });
  const filed = await playerSays(
    code,
    { lastName: '0', device: 'original', reportToken: claimed.json.reportToken, result: 'win' },
    { cookie: player }
  );
  assert.equal(filed.status, 200);
  const { history } = (await hit(report.onRequestGet as Handler, '/report', at(code), { cookie: owner })).json;
  assert.equal(history.length, 1, 'a mutation retry appends evidence only for the successful write');
  assert.equal(history[0].account, user.id);
  assert.equal(history[0].claimedAt, original.claimed_at);
  assert.equal(history[0].report.device, original.device);
});

test('report history exports the account’s filings and anonymizes its link on deletion', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const player = await signIn('Player');
  const { user } = (await hit(me.onRequestGet as Handler, '/me', {}, { cookie: player })).json;
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  await settle(code, owner, { sanctioned: false, playerReporting: true });
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  assert.equal(
    (await playerSays(code, { lastName: '0', device: 'original', result: 'win' }, { cookie: player })).status,
    200
  );
  const exported = await exportMarkdown(db, user.id, { parts: ['events'], origin: 'http://localhost' });
  assert.ok(exported);
  assert.match(exported, /Filed player reports/);
  assert.match(exported, /Filed at/);
  const deleted = await hit(
    me.onRequestDelete as Handler,
    '/me',
    {},
    { method: 'DELETE', cookie: player, body: { confirm: user.handle } }
  );
  assert.equal(deleted.status, 204);
  const { history } = (await hit(report.onRequestGet as Handler, '/report', at(code), { cookie: owner })).json;
  assert.equal(history.length, 1);
  assert.equal(history[0].account, null);
  assert.ok(history[0].report.device);
});

test('the history migration retains original filings without attributing them to a replacement seat', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  await settle(code, owner, { playerReporting: true });
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const filed = await playerSays(code, { popId: '900', device: 'original', result: 'win' });
  assert.equal(filed.status, 200);
  db.raw.exec('DROP TABLE report_history');
  db.raw.prepare('UPDATE report_devices SET device = ?, claimed_at = 999 WHERE code = ?').run('replacement', code);
  db.raw.exec(
    readFileSync(new URL('../../config/d1/migrations/tournaments/0024-report-history.sql', import.meta.url), 'utf8')
  );
  const { history } = (await hit(report.onRequestGet as Handler, '/report', at(code), { cookie: owner })).json;
  assert.equal(history.length, 1);
  assert.equal(history[0].account, null);
  assert.equal(history[0].claimedAt, null);
  assert.notEqual(history[0].report.device, 'replacement');
});

[true, false].forEach(sanctioned => {
  test(`a claim for anyone but the looked-up player leaves seat and account untouched (sanctioned=${sanctioned})`, async () => {
    const owner = await signIn('Organizer', 'organizer');
    const player = await signIn('Player');
    const { user } = (await hit(me.onRequestGet as Handler, '/me', {}, { cookie: player })).json;
    const code = await newSwiss(owner);
    await settle(code, owner, { sanctioned, playerReporting: true });
    const peter = { id: '1234567', firstName: 'Peter', lastName: 'Parker', birthDate: '01/01/1990' };
    const other = { id: '7654321', firstName: 'Peter', lastName: 'Perker', birthDate: '01/01/1991' };
    for (const added of [peter, other]) {
      await send(code, owner, { type: 'addPlayer', player: added });
    }
    const looked = await playerSays(code, { lookup: true, lastName: 'Parker', firstName: 'Peter' });
    assert.equal(looked.json.candidates.length, 2, 'the near miss is a candidate too');
    const keys = JSON.parse(
      String(db.raw.prepare('SELECT player_keys FROM tournaments WHERE code = ?').get(code)?.player_keys)
    );
    const expect = keys[peter.id] as string;
    const claimOf = (who: typeof peter) =>
      sanctioned
        ? { popId: who.id, birthYear: who.birthDate.slice(-4) }
        : { lastName: who.lastName, firstName: who.firstName };
    const seats = () =>
      db.raw.prepare('SELECT player_id AS player, user_id AS account FROM report_devices WHERE code = ?').all(code);

    const wrong = await playerSays(code, { ...claimOf(other), device: 'phone', expect }, { cookie: player });
    assert.equal(wrong.status, 404, 'the claim resolves to another registered player, not the one chosen');
    assert.equal(wrong.json.reportToken, undefined);
    assert.deepEqual(seats(), [], 'no seat claimed and no account linked');

    const right = await playerSays(code, { ...claimOf(peter), device: 'phone', expect }, { cookie: player });
    assert.equal(right.status, 200, 'the corrected claim is not refused as linked elsewhere');
    assert.equal(right.json.key, expect);
    // An account links by its Claim at an unsanctioned event; at a sanctioned one only by the POP ID it holds.
    assert.deepEqual(
      seats().map(row => ({ ...row })),
      [{ player: peter.id, account: sanctioned ? null : user.id }]
    );
  });
});
