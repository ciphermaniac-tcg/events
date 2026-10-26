/**
 * Penalty notes, for the event's staff only (see shared/tournament/penaltyNotes.ts
 * and, for the routes every staff record answers on, lib/tournaments/staffRecords.ts).
 * A note changes nothing about the event: no result, drop or standing.
 *
 * GET — every entry, with the staff accounts a note may name as its judge.
 * POST — records a note: { playerId, round, judgeId | judgeName, penalty,
 * notes?, replaces? }.
 * DELETE ?id=<entry> — removes a note.
 */

import { personOfRow, recordOfRow, recordRoutes } from '../../../lib/tournaments/staffRecords.js';
import { type PenaltyNoteEntry, readPenaltyNote } from '../../../../shared/tournament/penaltyNotes.js';
import { msg } from '../../../../shared/i18n.js';

export const { onRequestGet, onRequestPost, onRequestDelete } = recordRoutes({
  table: 'penalty_notes',
  person: 'judge',
  verdict: 'penalty',
  staffKey: 'judges',
  read: readPenaltyNote,
  personOf: input => input.judge,
  verdictOf: input => input.penalty,
  entry: (row): PenaltyNoteEntry => ({
    ...recordOfRow(row),
    judge: personOfRow(row),
    penalty: row.verdict as PenaltyNoteEntry['penalty']
  }),
  words: {
    changed: msg('Someone changed this penalty note meanwhile. Look again and try once more.'),
    missing: msg('No such penalty note'),
    notStaff: msg('The judge must be on this event’s staff')
  }
});
