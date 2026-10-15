/**
 * What a console's retry of a failed result finds once it reads the event
 * again: the result already stands, the table has been paired anew, or the
 * result is still to send.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import type { Match, Tournament } from '../../shared/tournament/types.ts';
import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import type { Manage } from '../../src/lib/tournament/api.ts';
import type { ManageState } from '../../src/pages/tournaments/manageState.ts';
import { createResultEntry, type EnteredResult, reconcileResult } from '../../src/pages/tournaments/resultEntry.ts';

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command, {
      now: 0,
      localTime: '10/10/2026 10:00:00',
      season: 2027,
      random: seededRandom(3)
    });
    assert.ok(result.ok, result.ok ? '' : result.error);
    return result.tournament;
  }, tournament);
}

const players: Command[] = Array.from({ length: 4 }, (_, i) => ({
  type: 'addPlayer',
  player: { firstName: `P${i + 1}`, lastName: 'Test' }
}));
const paired = run(emptyTournament({ name: 'Night' }), ...players, { type: 'pairRound', pod: 'masters' });
const table = paired.pods[0]!.rounds[0]!.matches[0] as Match;
const entered: EnteredResult = { pod: 'masters', round: 1, ...table, outcome: 'p1' };
const report = (t: Tournament, outcome: Match['outcome']): Tournament =>
  run(t, { type: 'reportResult', pod: 'masters', round: 1, ...table, outcome });

test('a result the server took after all is not sent again', () => {
  assert.equal(reconcileResult({ tournament: report(paired, 'p1'), pending: [] }, entered), 'saved');
  assert.equal(reconcileResult({ tournament: paired, pending: [{ ...entered, at: 0 }] }, entered), 'saved');
  assert.equal(
    reconcileResult({ tournament: report(paired, 'p1'), pending: [] }, { ...entered, outcome: 'pending' }),
    'send'
  );
});

test('a result still to send, or one that differs from what stands, is sent', () => {
  assert.equal(reconcileResult({ tournament: paired, pending: [] }, entered), 'send');
  assert.equal(reconcileResult({ tournament: report(paired, 'p2'), pending: [] }, entered), 'send');
});

test('a table paired anew, or a round since, is not the match the result was for', () => {
  assert.equal(reconcileResult({ tournament: paired, pending: [] }, { ...entered, p2: 'someone else' }), 'changed');
  assert.equal(reconcileResult({ tournament: paired, pending: [] }, { ...entered, round: 2 }), 'changed');
  assert.equal(reconcileResult({ tournament: paired, pending: [] }, { ...entered, pod: 'junior' }), 'changed');
});

/** A console whose sends and reads answer only when the test says, recording what it sent and said. */
function fakeConsole(manage: () => Pick<Manage, 'tournament' | 'pending'>) {
  const sends: { command: Command; answer: (ok: boolean) => void }[] = [];
  const reads: ((ok: boolean) => void)[] = [];
  const said: string[] = [];
  let cleared = 0;
  const state = {
    send: (command: Command) =>
      new Promise<boolean>(answer => {
        sends.push({ command, answer });
      }),
    load: () =>
      new Promise<boolean>(answer => {
        reads.push(answer);
      }),
    data: () => manage(),
    fail: (message: string) => said.push(message),
    clearError: () => (cleared += 1)
  } as unknown as ManageState;
  return { state, sends, reads, said, cleared: () => cleared };
}

const settle = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });
const pod = paired.pods[0]!;
const round = pod.rounds[0]!;

const outcomes = (fake: ReturnType<typeof fakeConsole>) =>
  fake.sends.map(s => (s.command as { outcome: string }).outcome);

test('results for one match reach the server in the order entered, the later only once the earlier is answered', async () => {
  const fake = fakeConsole(() => ({ tournament: paired, pending: [] }));
  const entry = createResultEntry(
    () => fake.state,
    () => pod
  );
  entry.send(round, table, 'p1');
  await settle();
  entry.send(round, table, 'p2');
  await settle();
  assert.deepEqual(outcomes(fake), ['p1'], 'the second waits on the first');
  assert.equal(entry.sentFor(round, table), 'p2');
  fake.sends[0]!.answer(true);
  await settle();
  assert.deepEqual(outcomes(fake), ['p1', 'p2']);
  fake.sends[1]!.answer(true);
  await settle();
  assert.equal(entry.sentFor(round, table), undefined);
});

test('a result overtaken before its turn is not sent, and an older failure leaves a newer result alone', async () => {
  const fake = fakeConsole(() => ({ tournament: paired, pending: [] }));
  const entry = createResultEntry(
    () => fake.state,
    () => pod
  );
  entry.send(round, table, 'p1');
  await settle();
  entry.send(round, table, 'p2');
  entry.send(round, table, 'pending');
  fake.sends[0]!.answer(false);
  await settle();
  assert.equal(entry.failedFor(round, table), undefined, 'the first result is not offered again');
  assert.deepEqual(outcomes(fake), ['p1', 'pending'], 'p2 never went');
  fake.sends[1]!.answer(true);
  await settle();
  assert.equal(entry.sentFor(round, table), undefined);
});

test('a failed result stays with the pairing it was entered for, not whoever sits at the table after a re-pair', async () => {
  const fake = fakeConsole(() => ({ tournament: paired, pending: [] }));
  const entry = createResultEntry(
    () => fake.state,
    () => pod
  );
  entry.send(round, table, 'p1');
  await settle();
  fake.sends[0]!.answer(false);
  await settle();
  const repaired: Match = { ...table, p2: 'someone else' };
  assert.equal(entry.failedFor(round, table), 'p1');
  assert.equal(entry.failedFor(round, repaired), undefined);
  assert.equal(entry.sentFor(round, repaired), undefined);
  await entry.retry(round, repaired);
  assert.equal(fake.reads.length, 0, 'nothing to retry for the new pairing');
  assert.equal(fake.sends.length, 1);
});

test('a failed result stays until retried, and a retry overtaken by a newer result sends nothing', async () => {
  const fake = fakeConsole(() => ({ tournament: paired, pending: [] }));
  const entry = createResultEntry(
    () => fake.state,
    () => pod
  );
  entry.send(round, table, 'p1');
  await settle();
  fake.sends[0]!.answer(false);
  await settle();
  assert.equal(entry.failedFor(round, table), 'p1');
  const retried = entry.retry(round, table);
  assert.equal(entry.sentFor(round, table), 'p1', 'shown as sent while the event is read');
  entry.send(round, table, 'p2');
  fake.reads[0]!(true);
  await retried;
  await settle();
  assert.deepEqual(
    fake.sends.map(s => (s.command as { outcome: string }).outcome),
    ['p1', 'p2']
  );
});

test('a retry that finds the result saved sends nothing and clears the error', async () => {
  const fake = fakeConsole(() => ({ tournament: report(paired, 'p1'), pending: [] }));
  const entry = createResultEntry(
    () => fake.state,
    () => pod
  );
  entry.send(round, table, 'p1');
  await settle();
  fake.sends[0]!.answer(false);
  await settle();
  const retried = entry.retry(round, table);
  fake.reads[0]!(true);
  await retried;
  assert.equal(fake.sends.length, 1);
  assert.equal(fake.cleared(), 1);
  assert.equal(entry.failedFor(round, table), undefined);
});

test('a retry whose read fails keeps the result as not saved, and one paired anew says so', async () => {
  const fake = fakeConsole(() => ({ tournament: { ...paired, pods: [] }, pending: [] }));
  const entry = createResultEntry(
    () => fake.state,
    () => pod
  );
  entry.send(round, table, 'p1');
  await settle();
  fake.sends[0]!.answer(false);
  await settle();
  const unread = entry.retry(round, table);
  fake.reads[0]!(false);
  await unread;
  assert.equal(entry.failedFor(round, table), 'p1');
  const changed = entry.retry(round, table);
  fake.reads[1]!(true);
  await changed;
  assert.equal(entry.failedFor(round, table), undefined);
  assert.match(fake.said[0] ?? '', /has changed since/);
});
