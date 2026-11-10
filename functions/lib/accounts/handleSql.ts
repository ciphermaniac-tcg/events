/**
 * Username checks written in SQL, shared by renames (handles.ts) and a new
 * account's first username (lib/auth/session.ts), so both hold a username to
 * the same rule: no other account holds it, counting usernames that differ
 * only in separators as the same, or let it go within the day.
 */

import { DAY_MS } from '../../../shared/accounts/handle.js';

/** `handleKey` in SQL, written as the users_by_handle_key index is, so a lookup by key uses it. */
export const handleKeySql = (column: string) => `replace(replace(replace(${column}, '.', ''), '-', ''), '_', '')`;

/**
 * True in SQL when the username in `handle` is free for the account in
 * `self` (NULL for one not made yet), as of `now` in milliseconds.
 */
export const handleFreeSql = (handle: string, self: string, now: string) =>
  `NOT EXISTS (SELECT 1 FROM users WHERE ${handleKeySql('handle')} = ${handleKeySql(handle)} AND id IS NOT ${self}) ` +
  `AND NOT EXISTS (SELECT 1 FROM handle_changes WHERE old_key = ${handleKeySql(handle)} ` +
  `AND at > ${now} - ${DAY_MS} AND user_id IS NOT ${self})`;
