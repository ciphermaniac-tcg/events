/** The desktop app's TOM commands, as the site calls them through Tauri's invoke. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Invoke, startRoundTrouble, tomCommands } from '../../shared/native/tomCommands';

const ENTRY = { pod: 2, flight: null, round: 1, table: 1, outcome: 1 as const, code: '21113', p1: '1', p2: '2' };

function recording(answer: unknown = null) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    calls.push([command, args]);
    return answer;
  }) as Invoke;
  return { calls, tom: tomCommands(invoke) };
}

test('each command goes to the Rust command of its name, with its arguments named as Tauri expects', async () => {
  const { calls, tom } = recording();
  await tom.state();
  await tom.read(0, 1);
  await tom.confirmEvent(1);
  await tom.turnOn();
  await tom.turnOff();
  await tom.show();
  await tom.retry();
  await tom.badge(2);
  await tom.submit([ENTRY], { name: 'Spring Cup', sanctionId: '26-10-000001' });
  await tom.startRound(2, { name: 'Spring Cup', sanctionId: '' }, 3);
  await tom.startRound();
  assert.deepEqual(calls, [
    ['tom_state', undefined],
    ['tom_read', { since: 0, source: 1 }],
    ['tom_confirm_event', { source: 1 }],
    ['tom_turn_on', undefined],
    ['tom_turn_off', undefined],
    ['tom_show', undefined],
    ['tom_retry', undefined],
    ['tom_badge', { count: 2 }],
    ['tom_submit', { entries: [ENTRY], tournament: 'Spring Cup', tournamentId: '26-10-000001', source: undefined }],
    ['tom_start_round', { pod: 2, round: 3, tournament: 'Spring Cup', tournamentId: undefined, source: undefined }],
    [
      'tom_start_round',
      { pod: undefined, round: undefined, tournament: undefined, tournamentId: undefined, source: undefined }
    ]
  ]);
});

test('a submit answers with what the Rust side returned, one result per entry', async () => {
  const results = [
    { result: 'accepted', code: '21113' },
    { result: 'rejected', code: '21212', message: 'Wrong round' }
  ];
  const { tom } = recording(results);
  assert.deepEqual(await tom.submit([ENTRY, { ...ENTRY, table: 2, code: '21212' }]), results);
});

test('a round TOM started, or had already started, is no trouble; one not started says why', () => {
  assert.equal(startRoundTrouble({ result: 'started' }), null);
  assert.equal(startRoundTrouble({ result: 'already_started' }), null);
  assert.equal(
    startRoundTrouble({ result: 'not_ready', reason: 'TOM said: The round must be paired first.' }),
    'TOM said: The round must be paired first.'
  );
});
