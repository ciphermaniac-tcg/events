/**
 * Deck checks, for the event's staff only (see shared/tournament/deckChecks.ts
 * and, for the routes every staff record answers on, lib/tournaments/staffRecords.ts).
 *
 * GET — every entry, with the staff accounts a check may name as its checker.
 * POST — records a check: { playerId, round, checkerId | checkerName, result,
 * notes?, replaces? }.
 * DELETE ?id=<entry> — removes a check.
 */

import { personOfRow, recordRoutes } from '../../../lib/tournaments/staffRecords.js';
import { type DeckCheckEntry, readDeckCheck } from '../../../../shared/tournament/deckChecks.js';
import { msg } from '../../../../shared/i18n.js';

export const { onRequestGet, onRequestPost, onRequestDelete } = recordRoutes({
  table: 'deck_checks',
  person: 'checker',
  verdict: 'result',
  staffKey: 'checkers',
  read: readDeckCheck,
  personOf: input => input.checker,
  verdictOf: input => input.result,
  entry: (row): DeckCheckEntry => ({
    id: row.id,
    playerId: row.player_id,
    playerName: row.player_name,
    round: row.round,
    checker: personOfRow(row),
    result: row.verdict as DeckCheckEntry['result'],
    notes: row.notes,
    recordedBy: row.recorder,
    recordedAt: row.recorded_at,
    replaces: row.replaces,
    removed: row.removed === 1
  }),
  words: {
    changed: msg('Someone changed this deck check meanwhile. Look again and try once more.'),
    missing: msg('No such deck check'),
    notStaff: msg('The checker must be on this event’s staff')
  }
});
