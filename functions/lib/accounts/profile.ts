import type { ProfilePreferences } from '../../../shared/accounts/profile.js';
import type { D1Like } from '../types.js';

export async function profilePreferences(db: D1Like, userId: string): Promise<ProfilePreferences> {
  const row = await db
    .prepare('SELECT links FROM profile_preferences WHERE user_id = ?')
    .bind(userId)
    .first<{ links: string }>();
  return { links: JSON.parse(row?.links ?? '{}') as ProfilePreferences['links'] };
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
