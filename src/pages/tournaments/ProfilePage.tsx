/**
 * /u/:handle: an account's public profile, for anyone with the link: the
 * name it chose to show, its username and picture, then its History as the account sees it (see HistoryList),
 * read-only. A profile turned off and an address that never was one look
 * the same: not found.
 */

import { A } from '@solidjs/router';
import { createEffect, createResource, Show } from 'solid-js';
import { Skeleton } from '../../components/Skeleton';
import { ApiError, fetchProfile } from '../../lib/tournament/api';
import { resolved } from '../../lib/resource';
import { Avatar } from './Avatar';
import { Badges } from './Badges';
import { Trail } from './Trail';
import { ProfileHistory } from './ProfileHistory';
import { ProfileLinks } from './ProfileLinks';
import { pageTitle } from '../../lib/title';
import { t } from '../../lib/i18n';
import { ErrorState } from '../../components/ErrorState';

const missing = (error: unknown) => error instanceof ApiError && error.status === 404;

export function ProfilePage(props: { handle: string }) {
  const [profile, { refetch }] = createResource(() => props.handle, fetchProfile);
  const shown = () => resolved(profile);
  createEffect(() => {
    const name = shown()?.name;
    if (name) {
      document.title = pageTitle(name);
    }
  });
  return (
    <div class='tm-page tm-profile-page'>
      <Show
        when={!missing(profile.error)}
        fallback={
          <ErrorState
            code={`@${props.handle}`}
            title={t('Profile not found')}
            line={t('No one here goes by @{handle}, or their profile is private.', { handle: props.handle })}
          >
            <A href='/' class='btn btn-primary'>
              {t('Go home')}
            </A>
          </ErrorState>
        }
      >
        <Show
          when={shown()}
          fallback={
            <Show when={profile.error} fallback={<Skeleton width='280px' height='28px' />}>
              <ErrorState
                code={`@${props.handle}`}
                title={t('Couldn’t load this profile')}
                line={t('Something went wrong on our side or with your connection. Try again in a moment.')}
              >
                <button type='button' class='btn btn-primary' onClick={() => void refetch()}>
                  {t('Try again')}
                </button>
              </ErrorState>
            </Show>
          }
        >
          {p => (
            <>
              <Trail here={p().name} />
              <section class='tm-hero tm-profile-hero'>
                <Avatar name={p().name} src={p().avatar} />
                <div class='tm-hero-text'>
                  <div class='tm-profile-name'>
                    <h1>{p().name}</h1>
                    <p class='tm-status muted'>@{p().handle}</p>
                  </div>
                  <Badges badges={p().badges ?? []} />
                  <ProfileLinks links={p().links ?? {}} />
                </div>
              </section>
              <ProfileHistory entries={p().entries} activity={p().activity} />
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
