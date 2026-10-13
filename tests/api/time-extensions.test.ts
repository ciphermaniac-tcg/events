import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as sync from '../../functions/api/tournaments/[code]/sync.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { loadTournament } from '../../functions/lib/tournaments/store.ts';
import { revisionOf } from '../../shared/tournament/revision.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { ExtensionCommand } from '../../shared/tournament/timeExtensions.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let db: ReturnType<typeof sqliteD1>;
let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newEvent, send, addPlayers, view, settle } = eventCalls(hit);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
});

function extension(t: Tournament): ExtensionCommand {
  const pod = t.pods[0]!;
  const round = pod.rounds.at(-1)!;
  const { table, p1, p2 } = round.matches.find(m => m.p2 !== null && m.outcome === 'pending')!;
  return {
    type: 'setTimeExtension',
    pod: pod.category,
    round: round.number,
    table,
    p1,
    p2: p2!,
    seconds: 300,
    reason: 'Judge call'
  };
}
async function current(code: string) {
  return (await loadTournament(db, code))!.tournament;
}
function selected(t: Tournament, command: ExtensionCommand) {
  return t.pods
    .find(p => p.category === command.pod)!
    .rounds.find(r => r.number === command.round)!
    .matches.find(m => m.table === command.table)!;
}

test('authorized staff persist, edit and clear table time without changing the round clock', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newEvent(owner);
  await addPlayers(code, owner, 4);
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const before = await current(code);
  const command = extension(before);
  assert.equal((await send(code, owner, command)).status, 200);
  const saved = await current(code);
  assert.deepEqual(selected(saved, command).timeExtension, { seconds: 300, reason: 'Judge call' });
  assert.equal(saved.pods[0]?.rounds[0]?.timeLeft, before.pods[0]?.rounds[0]?.timeLeft);
  assert.equal(JSON.stringify(await view(code)).includes('Judge call'), false);
  assert.equal((await send(code, owner, { ...command, seconds: 600 })).status, 200);
  assert.equal(selected(await current(code), command).timeExtension?.seconds, 600);
  assert.equal((await send(code, owner, { ...command, seconds: 0 })).status, 200);
  assert.equal(selected(await current(code), command).timeExtension, undefined);
});

test('unauthorized, malformed, completed and finished-event extensions are refused', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newEvent(owner);
  await addPlayers(code, owner, 4);
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const command = extension(await current(code));
  assert.equal((await send(code, '', command)).status, 401);
  assert.equal((await send(code, await signIn('Other'), command)).status, 403);
  assert.equal((await send(code, owner, { ...command, seconds: 3601 })).status, 400);
  assert.equal((await send(code, owner, { ...command, p1: '999' })).status, 400);
  await settle(code, owner, { finished: true });
  assert.equal((await send(code, owner, command)).status, 400);
  await settle(code, owner, { finished: false });
  await send(code, owner, { ...command, type: 'reportResult', outcome: 'p1' });
  assert.equal((await send(code, owner, command)).status, 400);
});

test('TOM extensions survive file updates without changing revision or leaking pending results', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const file = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const code = await newEvent(owner, { mode: 'tom', tournament: file });
  const before = await current(code);
  const command = extension(before);
  const revision = await revisionOf(before);
  assert.equal((await send(code, owner, command)).status, 200);
  const saved = await current(code);
  assert.equal(await revisionOf(saved), revision);
  assert.deepEqual(selected(saved, command).timeExtension, { seconds: 300, reason: 'Judge call' });
  file.info.name = 'Updated in TOM';
  const synced = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    cookie: owner,
    method: 'PUT',
    body: { tournament: file, base: revision }
  });
  assert.equal(synced.status, 200);
  assert.deepEqual(selected(await current(code), command).timeExtension, selected(saved, command).timeExtension);
  await send(code, owner, { ...command, type: 'reportResult', outcome: 'p1' });
  assert.equal((await send(code, owner, command)).status, 400);
  assert.equal(selected(await current(code), command).outcome, 'pending');
  const console = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
  assert.equal(console.json.pending.length, 1);
});
