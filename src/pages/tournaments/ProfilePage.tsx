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
import { createShownCount, HistoryList } from './HistoryList';
import { pageTitle } from '../../lib/title';
import { ErrorState } from '../../components/ErrorState';

const eventCount = (n: number) => `${n} event${n === 1 ? '' : 's'}`;

const missing = (error: unknown) => error instanceof ApiError && error.status === 404;

export function ProfilePage(props: { handle: string }) {
  const [profile, { refetch }] = createResource(() => props.handle, fetchProfile);
  const shown = () => resolved(profile);
  const count = createShownCount();
  createEffect(() => {
    const name = shown()?.name;
    if (name) {
      document.title = pageTitle(name);
    }
  });
  return (
    <div class='tm-page'>
      <Show
        when={!missing(profile.error)}
        fallback={
          <ErrorState
            code={`@${props.handle}`}
            title='Profile not found'
            line={`No one here goes by @${props.handle}, or their profile is private.`}
          >
            <A href='/' class='btn btn-primary'>
              Go home
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
                title='Couldn’t load this profile'
                line='Something went wrong on our side or with your connection. Try again in a moment.'
              >
                <button type='button' class='btn btn-primary' onClick={() => void refetch()}>
                  Try again
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
                  <h1>{p().name}</h1>
                  <p class='tm-status muted'>
                    <Show when={p().name !== p().handle}>
                      {p().handle}
                      <span class='dot' aria-hidden='true'>
                        {' · '}
                      </span>
                    </Show>
                    {eventCount(count.shown(p().entries))}
                  </p>
                  <Badges badges={p().badges ?? []} />
                </div>
              </section>
              <Show when={p().entries.length > 0} fallback={<p class='muted tm-empty'>No events yet</p>}>
                <HistoryList entries={p().entries} onGone={count.onGone} />
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
