/**
 * /admin: an Admin's page; for anyone else, signed in or not, it is not
 * found. Its sections are AdminSections; the dashboard links here.
 */

import { createEffect, Show } from 'solid-js';
import { isAdmin } from '../../../shared/accounts/roles';
import { latestValue } from '../../lib/resource';
import { AdminSections } from './AdminSections';
import { TournamentHero } from './Hero';
import { NotFoundPage } from '../NotFoundPage';
import { session } from './session';
import { pageTitle } from '../../lib/title';
import { t } from '../../lib/i18n';
import { SessionGate } from './SessionGate';

export function AdminPage() {
  const current = () => latestValue(session);
  const admin = () => isAdmin(current()?.user?.role ?? null);
  createEffect(() => {
    document.title = pageTitle(current() ? (admin() ? t('Admin') : t('Page not found')) : undefined);
  });
  return (
    <div class='tm-page tm-admin'>
      <SessionGate>
        {() => (
          <Show when={admin()} fallback={<NotFoundPage />}>
            <TournamentHero title={t('Admin')} />
            <AdminSections param='tab' />
          </Show>
        )}
      </SessionGate>
    </div>
  );
}
