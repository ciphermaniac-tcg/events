/**
 * The console's unsaved settings: only the fields staff changed are kept, an
 * untouched field follows the event, and saving drops just what it sent.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { settingsDraft } from '../../src/pages/tournaments/settingsDrafts.ts';

interface Fields {
  details: string;
  playerReporting: boolean;
}

test('an edit is kept for its event and box, and an untouched field follows the event', () => {
  const draft = settingsDraft<Fields>('DRAFT1', 'players');
  const saved: Fields = { details: '', playerReporting: false };
  draft.set('details', 'Doors at nine', saved);
  assert.equal(settingsDraft<Fields>('DRAFT1', 'players'), draft, 'the same draft when asked again');
  assert.notEqual(settingsDraft<Fields>('DRAFT2', 'players'), draft, 'another event has its own');
  const colleague: Fields = { ...saved, playerReporting: true };
  assert.equal(draft.value('playerReporting', colleague), true);
  assert.equal(draft.value('details', colleague), 'Doors at nine');
  assert.deepEqual(draft.changes(colleague), { details: 'Doors at nine' });
});

test('an edit back to the event’s value, or one the event now has, is no change', () => {
  const draft = settingsDraft<Fields>('DRAFT3', 'players');
  const saved: Fields = { details: 'Old', playerReporting: false };
  draft.set('details', 'New', saved);
  draft.set('details', 'Old', saved);
  assert.deepEqual(draft.changes(saved), {});
  draft.set('playerReporting', true, saved);
  assert.deepEqual(draft.changes({ ...saved, playerReporting: true }), {});
});

test('saving forgets what it sent and keeps an edit made while it was on its way', () => {
  const draft = settingsDraft<Fields>('DRAFT4', 'players');
  const saved: Fields = { details: '', playerReporting: false };
  draft.set('details', 'First', saved);
  const sent = draft.changes(saved);
  draft.set('playerReporting', true, saved);
  draft.forget(sent);
  assert.deepEqual(draft.changes(saved), { playerReporting: true });
  draft.set('details', 'Second', saved);
  draft.forget(sent);
  assert.deepEqual(draft.changes(saved), { details: 'Second', playerReporting: true });
});
