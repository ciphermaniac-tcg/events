/** The desktop app's TOM commands, as the panel and the site call them through Tauri's invoke. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Invoke, tomCommands } from '../../shared/native/tomCommands';

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
  await tom.submit(['21113', '21121']);
  await tom.save();
  assert.deepEqual(calls, [
    ['tom_detect', undefined],
    ['tom_set_path', { path: 'C:\\TOM\\TOM.exe' }],
    ['tom_launch', undefined],
    ['tom_status', undefined],
    ['tom_get_mode', undefined],
    ['tom_set_mode', { mode: 'inside' }],
    ['tom_submit', { codes: ['21113', '21121'] }],
    ['tom_save', undefined]
  ]);
});

test('a submit answers with what the Rust side returned, one result per code', async () => {
  const results = [{ status: 'accepted' }, { status: 'rejected', message: 'Wrong round' }];
  const { tom } = recording(results);
  assert.deepEqual(await tom.submit(['21113', '22113']), results);
});
