import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PENALTIES,
  PENALTY_LABELS,
  type PenaltyNoteEntry,
  readPenaltyNote,
  standingNotes
} from '../../shared/tournament/penaltyNotes.ts';

const entry = (id: string, at: number, change: Partial<PenaltyNoteEntry> = {}): PenaltyNoteEntry => ({
  id,
  playerId: 'p1',
  playerName: 'Nia Okafor',
  round: 1,
  judge: { id: 'u1', name: 'Dana Kim' },
  penalty: 'warning',
  notes: '',
  recordedBy: 'Dana Kim',
  recordedAt: at,
  replaces: null,
  removed: false,
  ...change
});

test('a penalty note reads from a body, by judge account or typed name', () => {
  const body = { playerId: ' p1 ', round: 2, judgeId: 'u1', penalty: 'game-loss', notes: ' Drew two extra ' };
  assert.deepEqual(readPenaltyNote(body), {
    playerId: 'p1',
    round: 2,
    judge: { id: 'u1' },
    penalty: 'game-loss',
    notes: 'Drew two extra',
    replaces: null
  });
  const typed = readPenaltyNote({ ...body, judgeId: '', judgeName: 'Sam', replaces: 'n1' });
  assert.deepEqual(typeof typed === 'string' ? typed : [typed.judge, typed.replaces], [{ name: 'Sam' }, 'n1']);
});

test('a penalty note missing a field says which', () => {
  const body = { playerId: 'p1', round: 1, judgeId: 'u1', penalty: 'caution' };
  assert.equal(readPenaltyNote({ ...body, playerId: '' }), 'Say whose penalty it is');
  assert.equal(readPenaltyNote({ ...body, round: 0 }), 'Say which round');
  assert.equal(readPenaltyNote({ ...body, penalty: 'Caution' }), 'Choose a penalty');
  assert.equal(readPenaltyNote({ ...body, penalty: undefined }), 'Choose a penalty');
  assert.equal(readPenaltyNote({ ...body, judgeId: undefined }), 'Say which judge gave it');
  assert.equal(readPenaltyNote({ ...body, judgeId: undefined, judgeName: 'x'.repeat(61) }), 'Say which judge gave it');
  assert.equal(readPenaltyNote({ ...body, notes: 'x'.repeat(1001) }), 'Keep the notes under 1000 characters');
  assert.equal(readPenaltyNote({ ...body, replaces: 4 }), 'Not a penalty note to edit');
});

test('every penalty has its Penalty Guidelines name, least to most severe', () => {
  assert.deepEqual(
    PENALTIES.map(penalty => PENALTY_LABELS[penalty]),
    ['Caution', 'Warning', 'Double Prize Card', 'Quadruple Prize Card', 'Game Loss', 'Match Loss', 'Disqualification']
  );
});

test('notes stand at their latest entry, with what they replaced, and removed ones drop out', () => {
  const standing = standingNotes([
    entry('a', 1),
    entry('b', 2, { playerId: 'p2' }),
    entry('a2', 3, { replaces: 'a', penalty: 'game-loss' }),
    entry('b2', 4, { playerId: 'p2', replaces: 'b', removed: true })
  ]);
  assert.deepEqual(
    standing.map(note => [note.id, note.penalty, note.earlier.map(earlier => earlier.id)]),
    [['a2', 'game-loss', ['a']]]
  );
});
