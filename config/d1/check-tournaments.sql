-- Read-only preflight. Missing columns, tables or indexes stop deployment.
SELECT age_checked_at, handle, profile_name FROM users WHERE 0;
SELECT token_hash, profile, expires_at FROM pending_signups WHERE 0;
SELECT store_id, community_day, last_import_at, requests FROM tournaments INDEXED BY tournaments_one_community_day
 WHERE community_day IS NOT NULL LIMIT 0;
SELECT id FROM stores INDEXED BY stores_by_league WHERE league_id IS NOT NULL LIMIT 0;
SELECT user_id, role FROM store_members WHERE 0;
SELECT user_id FROM store_members INDEXED BY store_members_one_owner WHERE role = 'owner' LIMIT 0;
SELECT token_hash, expires_at FROM store_invites WHERE 0;
SELECT owner, at, id FROM event_creations WHERE 0;
SELECT store FROM applications WHERE 0;
SELECT key FROM proof_deletions WHERE 0;
SELECT subject FROM clerk_deletions WHERE 0;
SELECT user_id, code FROM history_hidden WHERE 0;
SELECT user_id, links, pins FROM profile_preferences WHERE 0;
SELECT code, version, player_id, report, account_id, claimed_at FROM report_history WHERE 0;
SELECT store_id, id, name, options FROM display_presets WHERE 0;
SELECT head_judge, paired_through, checkins FROM tournaments WHERE 0;
SELECT id, player_id, round, checker_id, result, recorded_by, removed FROM deck_checks INDEXED BY deck_checks_replaced
 WHERE replaces IS NOT NULL LIMIT 0;
SELECT id, player_id, round, judge_id, penalty, recorded_by, removed FROM penalty_notes INDEXED BY penalty_notes_replaced
 WHERE replaces IS NOT NULL LIMIT 0;
SELECT code, id, version, pod, round, table_no, approved_by, role, alone, during FROM result_corrections WHERE 0;
SELECT session_id, used_at FROM clerk_sessions_used WHERE 0;
SELECT subject, changed_at FROM clerk_password_cutoffs WHERE 0;
SELECT auth_at FROM sessions WHERE 0;
SELECT token_hash, subject, code_hash, attempts, expires_at, claimed_at FROM password_resets WHERE 0;
SELECT at FROM reset_reservations INDEXED BY reset_reservations_by_key WHERE scope = '' AND key = '' LIMIT 0;
SELECT session_id FROM clerk_sessions_used INDEXED BY clerk_sessions_used_by_time WHERE used_at < 0 LIMIT 0;
SELECT token_hash FROM password_resets INDEXED BY password_resets_by_expiry WHERE expires_at <= 0 LIMIT 0;
SELECT key FROM reset_reservations INDEXED BY reset_reservations_by_time WHERE at <= 0 LIMIT 0;
