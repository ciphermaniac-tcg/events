/**
 * What a console's retry of a failed result finds once it reads the event
 * again: the result already stands, the table has been paired anew, or the
 * result is still to send.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyTournament } from '../../shared/tournament/create.ts';
import type { Match, Tournament } from '../../shared/tournament/types.ts';
import type { Command } from '../../shared/tournament/commands.ts';
import type { Manage } from '../../src/lib/tournament/api.ts';
import type { ManageState } from '../../src/pages/tournaments/manageState.ts';
import { createResultEntry, type EnteredResult, reconcileResult } from '../../src/pages/tournaments/resultEntry.ts';
import { commandRunner, freshContext } from '../__utils__/commands.ts';

const run = commandRunner(freshContext(3, '10/10/2026 10:00:00'));

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
  assert.equal(fake.reads.length, 1, 'only the read after the failure: nothing to retry for the new pairing');
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
  fake.reads[1]!(true);
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
  fake.reads[1]!(true);
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
  fake.reads[1]!(false);
  await unread;
  assert.equal(entry.failedFor(round, table), 'p1');
  const changed = entry.retry(round, table);
  fake.reads[2]!(true);
  await changed;
  assert.equal(entry.failedFor(round, table), undefined);
  assert.match(fake.said[0] ?? '', /has changed since/);
});

const expected = (fake: ReturnType<typeof fakeConsole>) =>
  fake.sends.map(s => (s.command as { expected?: string }).expected);

test('each result expects what stood when it was entered, or the result sent before it once that lands', async () => {
  let shown = paired;
  const fake = fakeConsole(() => ({ tournament: shown, pending: [] }));
  const entry = createResultEntry(
    () => fake.state,
    () => pod
  );
  entry.send(round, table, 'p1');
  await settle();
  entry.send(round, table, 'p2');
  fake.sends[0]!.answer(true);
  shown = report(paired, 'p1');
  await settle();
  entry.send(round, table, 'tie');
  fake.sends[1]!.answer(false);
  await settle();
  fake.sends[2]?.answer(true);
  await settle();
  assert.deepEqual(outcomes(fake), ['p1', 'p2', 'tie']);
  assert.deepEqual(expected(fake), ['pending', 'p1', 'p1'], 'p2 never landed, so the tie expects p1');
});

test('a result refused because another device changed it says what stands, and a retry replaces it on purpose', async () => {
  let shown = paired;
  const fake = fakeConsole(() => ({ tournament: shown, pending: [] }));
  const entry = createResultEntry(
    () => fake.state,
    () => pod
  );
  entry.send(round, table, 'p1');
  await settle();
  assert.equal(entry.conflictFor(round, table), undefined, 'nothing failed');
  // Another judge entered p2 first: the server refuses p1, and the read after it shows p2.
  shown = report(paired, 'p2');
  fake.sends[0]!.answer(false);
  await settle();
  assert.equal(fake.reads.length, 1, 'the event is read again at once');
  fake.reads[0]!(true);
  assert.equal(entry.failedFor(round, table), 'p1');
  assert.equal(entry.conflictFor(round, table), 'p2');
  const retried = entry.retry(round, table);
  fake.reads[1]!(true);
  await retried;
  await settle();
  assert.deepEqual(expected(fake), ['pending', 'p2']);
});

test('a result landed earlier is forgotten once answered, so a change after another device’s expects that one, and Use mine replaces it', async () => {
  let shown = paired;
  const fake = fakeConsole(() => ({ tournament: shown, pending: [] }));
  const entry = createResultEntry(
    () => fake.state,
    () => pod
  );
  entry.send(round, table, 'p1');
  await settle();
  fake.sends[0]!.answer(true);
  shown = report(paired, 'p1');
  await settle();
  // Another device changes the result to p2, and this console reads it.
  shown = report(paired, 'p2');
  entry.send(round, table, 'tie');
  await settle();
  assert.deepEqual(expected(fake), ['pending', 'p2'], 'the tie expects the p2 this console shows, not its own p1');
  // A third device enters a double loss before the tie arrives: the tie is refused and the row names it.
  shown = report(paired, 'double-loss');
  fake.sends[1]!.answer(false);
  await settle();
  fake.reads[0]!(true);
  assert.equal(entry.conflictFor(round, table), 'double-loss');
  const retried = entry.retry(round, table);
  fake.reads[1]!(true);
  await retried;
  await settle();
  assert.deepEqual(expected(fake), ['pending', 'p2', 'double-loss'], 'Use mine sends against what stands now');
  fake.sends[2]!.answer(true);
  shown = report(paired, 'tie');
  await settle();
  assert.equal(entry.failedFor(round, table), undefined);
  assert.equal(entry.sentFor(round, table), undefined, 'Use mine saved the tie');
});

test('a result that failed with nothing changed since is no conflict', async () => {
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
  assert.equal(entry.conflictFor(round, table), undefined);
});

test('a result that expected an earlier one from this console is no conflict when that one stands', async () => {
  let shown = paired;
  const fake = fakeConsole(() => ({ tournament: shown, pending: [] }));
  const entry = createResultEntry(
    () => fake.state,
    () => pod
  );
  entry.send(round, table, 'p1');
  await settle();
  entry.send(round, table, 'p2');
  fake.sends[0]!.answer(true);
  shown = report(paired, 'p1');
  await settle();
  fake.sends[1]!.answer(false);
  await settle();
  assert.equal(entry.failedFor(round, table), 'p2');
  assert.equal(entry.conflictFor(round, table), undefined, 'p1 is this console’s own');
});
