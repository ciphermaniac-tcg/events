/**
 * The events site's head: a slim dark bar, as the main site's, with the
 * site's name and who is signed in. Signed out, the way to sign in: on the
 * home page a jump to its sign-in, elsewhere Settings, which offers it and
 * comes back to the page it was asked from; none
 * at the age check, which is the middle of signing up.
 * @module components/SiteHead
 */

import { A, useLocation } from '@solidjs/router';
import { Show } from 'solid-js';
import { t } from '../lib/i18n';
import { latestValue } from '../lib/resource';
import { AccountMenu } from '../pages/tournaments/AccountMenu';
import { pendingApplications } from '../pages/tournaments/pendingApplications';
import { session } from '../pages/tournaments/session';

export function SiteHead() {
  const location = useLocation();
  const answer = () => latestValue(session);
  return (
    <header class='site-head head-bar'>
      <div class='site-head-row'>
        <A href='/' class='site-head-name'>
          <img src='/logo.svg' alt='' width='20' height='24' />
          <span>
            Ciphermaniac <small>Events</small>
          </span>
        </A>
        <Show when={location.pathname !== '/welcome' && answer()}>
          {read => (
            <Show
              when={read().user}
              fallback={
                <Show
                  when={location.pathname === '/'}
                  fallback={
                    <A
                      class='btn btn-primary site-head-signin'
                      href={`/settings?${new URLSearchParams({ next: `${location.pathname}${location.search}` })}`}
                    >
                      {t('Sign in')}
                    </A>
                  }
                >
                  {/* The browser's own jump: the router ignores a second click on the same hash. */}
                  <a class='btn btn-primary site-head-signin' href='#sign-in' rel='external'>
                    {t('Sign in')}
                  </a>
                </Show>
              }
            >
              {user => <AccountMenu user={user()} pending={pendingApplications()} />}
            </Show>
          )}
        </Show>
      </div>
    </header>
  );
}
