import type { ProfilePreferences } from '../../../shared/accounts/profile.js';
import type { D1Like } from '../types.js';

/** The links of the account a live session belongs to; null when no account is signed in. */
export async function profilePreferences(db: D1Like, hash: string, now: number): Promise<ProfilePreferences | null> {
  const row = await db
    .prepare(
      'SELECT p.links AS links FROM sessions s JOIN users u ON u.id = s.user_id ' +
        'LEFT JOIN profile_preferences p ON p.user_id = s.user_id ' +
        'WHERE s.token_hash = ? AND s.expires_at > ? AND u.age_checked_at IS NOT NULL'
    )
    .bind(hash, now)
    .first<{ links: string | null }>();
  return row ? { links: JSON.parse(row.links ?? '{}') as ProfilePreferences['links'] } : null;
}

export async function saveProfileLinks(db: D1Like, userId: string, links: ProfilePreferences['links']): Promise<void> {
  await db
    .prepare(
      'INSERT INTO profile_preferences (user_id, links) VALUES (?, ?) ' +
        'ON CONFLICT (user_id) DO UPDATE SET links = excluded.links'
    )
    .bind(userId, JSON.stringify(links))
    .run();
}
