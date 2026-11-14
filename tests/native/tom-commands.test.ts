/** The desktop app's TOM commands, as the panel and the site call them through Tauri's invoke. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Invoke, startRoundTrouble, tomCommands } from '../../shared/native/tomCommands';

const ENTRY = { pod: 2, flight: null, round: 1, table: 1, outcome: 1 as const, code: '21113' };

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
  await tom.detect();
  await tom.setPath('C:\\TOM\\TOM.exe');
  await tom.launch();
  await tom.status();
  await tom.getMode();
  await tom.setMode('inside');
  await tom.submit([ENTRY]);
  await tom.save();
  await tom.startRound(2);
  await tom.startRound();
  await tom.openPanel();
  assert.deepEqual(calls, [
    ['tom_detect', undefined],
    ['tom_set_path', { path: 'C:\\TOM\\TOM.exe' }],
    ['tom_launch', undefined],
    ['tom_status', undefined],
    ['tom_get_mode', undefined],
    ['tom_set_mode', { mode: 'inside' }],
    ['tom_submit', { entries: [ENTRY] }],
    ['tom_save', undefined],
    ['tom_start_round', { pod: 2 }],
    ['tom_start_round', {}],
    ['tom_open_panel', undefined]
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
