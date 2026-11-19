/**
 * The console's unsaved settings: only the fields staff changed are kept, an
 * untouched field follows the event, saving drops just what it sent, an edit
 * made while a save is on its way is measured against that save, and an edit
 * a colleague overtook is dropped rather than sent.
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
  draft.sending(sent);
  draft.set('playerReporting', true, saved);
  draft.settle(sent, true);
  const after = { ...saved, details: 'First' };
  assert.deepEqual(draft.changes(after), { playerReporting: true });
  draft.set('details', 'Second', after);
  draft.sending({ details: 'First' });
  draft.settle({ details: 'First' }, true);
  assert.deepEqual(draft.changes(after), { details: 'Second', playerReporting: true });
});

test('a setting switched back while its save is on its way is still sent back', () => {
  const draft = settingsDraft<Fields>('DRAFT5', 'players');
  const saved: Fields = { details: '', playerReporting: false };
  draft.set('playerReporting', true, saved);
  const sent = draft.changes(saved);
  draft.sending(sent);
  // Back to the event's value as last read, but not to what is on its way.
  draft.set('playerReporting', false, saved);
  assert.equal(draft.value('playerReporting', saved), false);
  draft.settle(sent, true);
  const after = { ...saved, playerReporting: true };
  assert.equal(draft.overtaken(after), false, 'its own save is no colleague');
  assert.deepEqual(draft.changes(after), { playerReporting: false });
});

test('a refused save keeps its edits to try again', () => {
  const draft = settingsDraft<Fields>('DRAFT6', 'players');
  const saved: Fields = { details: '', playerReporting: false };
  draft.set('details', 'Doors at nine', saved);
  const sent = draft.changes(saved);
  draft.sending(sent);
  draft.settle(sent, false);
  assert.deepEqual(draft.changes(saved), { details: 'Doors at nine' });
});

test('an edit a colleague overtook is dropped, and the field shows theirs', () => {
  const draft = settingsDraft<Fields>('DRAFT7', 'players');
  const saved: Fields = { details: 'Old', playerReporting: false };
  draft.set('details', 'Mine', saved);
  draft.set('playerReporting', true, saved);
  const colleague = { ...saved, details: 'Theirs' };
  assert.deepEqual(draft.changes(colleague), { playerReporting: true }, 'never sent over theirs');
  assert.equal(draft.overtaken(colleague), true);
  assert.equal(draft.value('details', colleague), 'Theirs');
  assert.deepEqual(draft.changes(colleague), { playerReporting: true });
  // One the colleague saved the same as typed goes quietly.
  draft.set('details', 'Same', colleague);
  assert.equal(draft.overtaken({ ...colleague, details: 'Same' }), false);
});
