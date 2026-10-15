import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { sqliteD1 } from '../__utils__/sqliteD1.ts';

const preflight = readFileSync(new URL('../../config/d1/check-tournaments.sql', import.meta.url), 'utf8');

/** Each schema object a route reads or writes, and the statement that takes it away. */
const required: [name: string, drop: string][] = [
  ['display_presets', 'DROP TABLE display_presets'],
  ['head_judge', 'ALTER TABLE tournaments RENAME COLUMN head_judge TO gone'],
  ['paired_through', 'ALTER TABLE tournaments RENAME COLUMN paired_through TO gone'],
  ['deck_checks', 'DROP TABLE deck_checks'],
  ['deck_checks_replaced', 'DROP INDEX deck_checks_replaced'],
  ['penalty_notes', 'DROP TABLE penalty_notes'],
  ['penalty_notes_replaced', 'DROP INDEX penalty_notes_replaced'],
  ['result_corrections', 'DROP TABLE result_corrections'],
  ['clerk_sessions_used', 'DROP TABLE clerk_sessions_used'],
  ['clerk_password_cutoffs', 'DROP TABLE clerk_password_cutoffs'],
  ['auth_at', 'ALTER TABLE sessions RENAME COLUMN auth_at TO gone'],
  ['password_resets', 'DROP TABLE password_resets'],
  ['claimed_at', 'ALTER TABLE password_resets RENAME COLUMN claimed_at TO gone'],
  ['reset_reservations', 'DROP TABLE reset_reservations'],
  ['reset_reservations_by_key', 'DROP INDEX reset_reservations_by_key'],
  ['clerk_sessions_used_by_time', 'DROP INDEX clerk_sessions_used_by_time'],
  ['password_resets_by_expiry', 'DROP INDEX password_resets_by_expiry'],
  ['reset_reservations_by_time', 'DROP INDEX reset_reservations_by_time']
];

test('deployment preflight accepts the full schema', () => {
  assert.doesNotThrow(() => sqliteD1('tournaments.sql').raw.exec(preflight));
});

for (const [name, drop] of required) {
  test(`deployment preflight stops when ${name} is missing`, () => {
    const { raw } = sqliteD1('tournaments.sql');
    raw.exec(drop);
    assert.throws(() => raw.exec(preflight), new RegExp(name));
  });
}
