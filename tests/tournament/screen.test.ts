/** Which layout the big screen picks as an event moves along. */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import type { PendingResult } from '../../shared/tournament/view.ts';
import { screenPhase } from '../../src/lib/tournament/screen.ts';
import { commandRunner, freshContext } from '../__utils__/commands.ts';

const run = commandRunner(freshContext(3, '10/10/2026 10:00:00'));

const adds: Command[] = ['Ada', 'Ben', 'Cy', 'Dee'].map(firstName => ({
  type: 'addPlayer',
  player: { firstName, lastName: 'Test', birthDate: '02/27/1990' }
}));

const registered = run(emptyTournament({ name: 'Friday League' }), ...adds);
const paired = run(registered, { type: 'pairRound', pod: 'masters' });

const reports = (t: Tournament): Command[] =>
  (latestRound(t.pods[0])?.matches ?? []).map(m => ({
    type: 'reportResult',
    pod: 'masters',
    round: 1,
    table: m.table,
    p1: m.p1,
    p2: m.p2,
    outcome: 'p1'
  }));

const phase = (t: Tournament, pending: PendingResult[] = [], finished = false) =>
  screenPhase(t.pods, pending, finished);

test('lists the room before round 1, even once the event is marked over', () => {
  assert.equal(phase(registered), 'roster');
  assert.equal(phase(registered, [], true), 'roster');
});

test('shows the tables once paired, and the clock once it starts, stopped or not', () => {
  assert.equal(phase(paired), 'paired');
  const started = run(paired, { type: 'startClock', pod: 'masters' });
  assert.equal(phase(started), 'clock');
  assert.equal(phase(run(started, { type: 'stopClock', pod: 'masters' })), 'clock');
});

test('shows the results once every table has one, counting results entered on the site', () => {
  const started = run(paired, { type: 'startClock', pod: 'masters' });
  const [first, ...rest] = reports(started);
  assert.equal(phase(run(started, first as Command)), 'clock');
  assert.equal(phase(run(started, first as Command, ...rest)), 'results');
  const pending = latestRound(started.pods[0])?.matches.map(m => ({
    pod: 'masters',
    round: 1,
    table: m.table,
    p1: m.p1,
    p2: m.p2,
    outcome: 'p2',
    at: 0
  })) as PendingResult[];
  assert.equal(phase(started, pending), 'results');
});

test('shows the standings once the event ends', () => {
  assert.equal(phase(paired, [], true), 'standings');
});
