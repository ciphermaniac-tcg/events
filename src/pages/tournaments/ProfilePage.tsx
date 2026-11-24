/**
 * /u/:handle: an account's public profile, for anyone with the link: the
 * name it chose to show, its username and picture, then its History as the account sees it (see HistoryList),
 * read-only. A profile turned off and an address that never was one look
 * the same: not found.
 */

import { A } from '@solidjs/router';
import { createEffect, createResource, Show } from 'solid-js';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { ApiError, fetchProfile } from '../../lib/tournament/api';
import { latestValue, resolved } from '../../lib/resource';
import { session } from './session';
import { Avatar } from './Avatar';
import { ReportProblem } from '../../components/ReportProblem';
import { Badges } from './Badges';
import { Trail } from './Trail';
import { ProfileHistory } from './ProfileHistory';
import { ProfileLinks } from './ProfileLinks';
import { pageTitle } from '../../lib/title';
import { t } from '../../lib/i18n';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';

const missing = (error: unknown) => error instanceof ApiError && error.status === 404;

/** The profile's name, or its @username when it shows no real name, so the username never shows twice. */
const heading = (p: { name: string; handle: string }) => (p.name === p.handle ? `@${p.handle}` : p.name);

/** What a profile no one can see is called: private to the account it belongs to, not found to anyone else. */
const unseenTitle = (own: boolean) => (own ? t('Your profile is private') : t('Profile not found'));

export function ProfilePage(props: { handle: string }) {
  const [profile, { refetch }] = createResource(() => props.handle, fetchProfile);
  const shown = () => resolved(profile);
  const own = () => latestValue(session)?.user?.handle.toLowerCase() === props.handle.toLowerCase();
  createEffect(() => {
    const found = shown();
    const name = found && heading(found);
    if (name) {
      document.title = pageTitle(name);
    } else if (profile.error) {
      document.title = pageTitle(missing(profile.error) ? unseenTitle(own()) : t('Couldn’t load this profile'));
    }
  });
  return (
    <div class='tm-page tm-profile-page'>
      <Show
        when={!missing(profile.error)}
        fallback={
          <Show
            when={own()}
            fallback={
              <ErrorState
                code=''
                title={unseenTitle(false)}
                line={t('No public profile for @{handle}.', { handle: props.handle })}
              >
                <A href='/' class='btn btn-primary'>
                  {t('Go home')}
                </A>
              </ErrorState>
            }
          >
            <ErrorState code='' title={unseenTitle(true)} line=''>
              <A href='/settings?section=history' class='btn btn-primary'>
                {t('Make it public')}
              </A>
            </ErrorState>
          </Show>
        }
      >
        <Show
          when={shown()}
          fallback={
            <Show when={profile.error} fallback={<Skeleton width='280px' height='28px' />}>
              <ErrorState
                code=''
                title={t('Couldn’t load this profile')}
                line={t('Something went wrong on our side or with your connection. Try again in a moment.')}
              >
                <button type='button' class='btn btn-primary' onClick={() => void refetch()}>
                  {t('Try again')}
                </button>
                <ReportProblem />
              </ErrorState>
            </Show>
          }
        >
          {p => (
            <>
              <Trail here={heading(p())} />
              <section class='tm-hero tm-profile-hero'>
                <Avatar name={p().name} src={p().avatar} />
                <div class='tm-hero-text'>
                  <div class='tm-profile-name'>
                    <h1>{heading(p())}</h1>
                    <Show when={p().name !== p().handle}>
                      <p class='tm-status muted'>@{p().handle}</p>
                    </Show>
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
