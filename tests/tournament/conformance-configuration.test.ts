import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import type { LifecycleOperation } from '../../shared/tournament/lifecycleTypes.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { context, generatedEvent, operated } from './conformance-generated.ts';

test('division cut choices follow their own attendance and odd single-division pods allot whole tables', () => {
  const ctx = context(97);
  const base = generatedEvent(42, ctx, { mixed: true, type: 3, cut: 8, additionalRounds: 0 });
  const players = base.players.map((p, i) => ({
    ...p,
    birthDate: i < 12 ? '02/27/2016' : i < 21 ? '02/27/2012' : '02/27/1995'
  }));
  const configured = operated(
    { ...base, players },
    {
      type: 'configure',
      eventType: 3,
      cut: 8,
      flights: 1,
      lessSwiss: false,
      additionalRounds: 0,
      thirdPlace: false,
      manualTables: false,
      blockedRanges: [],
      roundMinutes: 30,
      finalMinutes: 75
    },
    ctx
  );
  assert.deepEqual(
    configured.pods.map(p => p.category),
    ['junior', 'senior', 'masters']
  );
  assert.deepEqual(
    configured.pods.map(p => p.cut),
    [4, 4, 8]
  );
  assert.deepEqual(
    configured.pods.map(p => p.startingTable),
    [1, 7, 11]
  );
  assert.equal(configured.settings!.overflowTableStart, 30);
});

function configuredRoster(
  years: readonly number[],
  wizard: boolean,
  options: { eventType?: 2 | 3; cut?: number; divisionCuts?: Record<string, number> } = {}
) {
  const ctx = context(31);
  const base = generatedEvent(years.length, ctx, { type: options.eventType ?? 2 });
  const players = base.players.map((p, i) => ({ ...p, birthDate: `02/27/${years[i]}` }));
  return operated(
    { ...base, players },
    {
      type: 'configure',
      eventType: options.eventType ?? 2,
      cut: options.cut ?? 0,
      divisionCuts: options.divisionCuts,
      flights: 1,
      lessSwiss: false,
      additionalRounds: 0,
      thirdPlace: false,
      manualTables: false,
      blockedRanges: [],
      roundMinutes: 30,
      finalMinutes: 75,
      wizard
    },
    ctx
  );
}

const roster = (juniors: number, seniors: number, masters: number) => [
  ...Array<number>(juniors).fill(2016),
  ...Array<number>(seniors).fill(2012),
  ...Array<number>(masters).fill(1995)
];

test('the wizard rounds a combined pod Seniors row up where the direct operation halves the whole pod', () => {
  const direct = configuredRoster(roster(2, 13, 8), false);
  const wizard = configuredRoster(roster(2, 13, 8), true);
  assert.deepEqual(
    direct.pods.map(p => [p.category, p.startingTable]),
    [
      ['junior-senior', 1],
      ['masters', 8]
    ]
  );
  assert.equal(direct.settings!.overflowTableStart, 21);
  assert.deepEqual(
    wizard.pods.map(p => p.startingTable),
    [1, 9]
  );
  assert.equal(wizard.settings!.overflowTableStart, 22);
  assert.equal(wizard.settings!.autoTables, true);
  const started = operated(wizard, { type: 'start' }, context(32));
  assert.deepEqual(
    started.pods.map(p => [p.startingTable, Math.min(...p.rounds[0]!.matches.filter(m => m.p2).map(m => m.table))]),
    [
      [1, 1],
      [9, 9]
    ]
  );
});

test('the wizard saves a single pod with manual numbering and no overflow start', () => {
  const wizard = configuredRoster(roster(0, 0, 13), true);
  assert.equal(wizard.settings!.autoTables, false);
  assert.equal(wizard.settings!.overflowTableStart, 0);
  assert.equal(configuredRoster(roster(0, 0, 13), false).settings!.autoTables, true);
});

test('Verify raises a declined or unavailable division cut to its largest offered size', () => {
  const options = { eventType: 3 as const, cut: 8 };
  const unavailable = configuredRoster(roster(9, 12, 12), true, options);
  assert.deepEqual(
    unavailable.pods.map(p => p.cut),
    [4, 4, 4]
  );
  assert.deepEqual(
    configuredRoster(roster(9, 12, 12), false, options).pods.map(p => p.cut),
    [0, 0, 0]
  );
  const declined = configuredRoster(roster(8, 13, 12), true, { eventType: 3, cut: 4, divisionCuts: { senior: 0 } });
  assert.deepEqual(
    declined.pods.map(p => p.cut),
    [0, 4, 4]
  );
});

test('V17-2: an already selected cut preserves the wizard control’s initial open state', () => {
  const ctx = context(17);
  const operation = {
    type: 'configure' as const,
    eventType: 3 as const,
    cut: 4,
    flights: 1,
    lessSwiss: false,
    additionalRounds: 0,
    thirdPlace: true,
    manualTables: false,
    blockedRanges: [],
    roundMinutes: 30,
    finalMinutes: 75,
    wizard: true
  };
  const savedCut = generatedEvent(12, ctx, { type: 3, cut: 4 });
  assert.equal(operated(savedCut, operation, ctx).pods[0]!.playoff3rd4th, false);
  const elimination = generatedEvent(12, ctx, { type: 1 });
  const preset = { ...elimination, settings: { ...elimination.settings!, mode: 'TCG1DAY' as const } };
  assert.equal(operated(preset, operation, ctx).pods[0]!.playoff3rd4th, true);
});

const configuration: Extract<LifecycleOperation, { type: 'configure' }> = {
  type: 'configure',
  eventType: 2,
  cut: 0,
  flights: 1,
  lessSwiss: false,
  additionalRounds: 0,
  thirdPlace: false,
  manualTables: false,
  blockedRanges: [],
  roundMinutes: 30,
  finalMinutes: 75
};

function refusal(t: Tournament, op: LifecycleOperation): string | undefined {
  const result = applyLifecycleOperation(t, op, context(23));
  assert.equal(result.ok, false);
  assert.equal(result.tournament, t);
  return result.error;
}

const configured = () => generatedEvent(8, context(23));
const started = () => operated(configured(), { type: 'start' }, context(23));

test('configuration refuses round times that are not whole minutes', () => {
  assert.equal(refusal(configured(), { ...configuration, roundMinutes: 1.5 }), 'Round times are whole minutes');
});

test('configuration is refused once the event has started', () => {
  assert.equal(refusal(started(), configuration), 'Configure the event before starting');
});

test('configuration refuses more than one additional Swiss round', () => {
  assert.equal(
    refusal(configured(), { ...configuration, additionalRounds: 2 }),
    'Only zero or one additional Swiss round is available'
  );
});

test('flights cannot be set once the event has started', () => {
  assert.equal(refusal(started(), { type: 'setFlights', count: 1 }), 'Set flights before starting');
});

test('a started event cannot be started again', () => {
  assert.equal(refusal(started(), { type: 'start' }), 'The tournament has already started');
});

test('registering after configuration clears the pods, so the event cannot start until configured again', () => {
  const ctx = context(23);
  const player = { id: '99', firstName: 'Late', lastName: 'Registrant', birthDate: '02/27/1995' };
  const registered = operated(configured(), { type: 'register', players: [player] }, ctx);
  assert.equal(refusal(registered, { type: 'start' }), 'Configure pods before starting the tournament');
});
