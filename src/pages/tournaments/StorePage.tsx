/**
 * /stores/:id: what anyone sees of a store. Its name and league over a map
 * of where it is, beside its address, its links and its own words; its
 * weekly league nights with the dates coming up that differ; then its events
 * on the site that have not ended, and those that have by month. Its Managers also get the way to its
 * settings.
 */

import { byMonth, playersWord } from './storeHistory';
import { A } from '@solidjs/router';
import { createEffect, createResource, For, Show } from 'solid-js';
import { addressOf, dateIn, managesStore, readDiscordInvite } from '../../../shared/accounts/stores';
import type { PastEvent, PublicStore, StoreEvent } from '../../../shared/accounts/types';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { errorText } from '../../lib/tournament/api';
import { msg, t } from '../../lib/i18n';
import {
  bareLink,
  byWeek,
  clock,
  exceptionChange,
  fetchStore,
  shortDay,
  storeEventWhen,
  weekdayPlural,
  zoneName
} from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { TournamentHero } from './Hero';
import { StoreMap } from './StoreMap';
import '../../styles/pages/tournament-store-page.css';
import { pageTitle } from '../../lib/title';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';

/** Third-party links from store-entered data: no referrer, no endorsement. */
const STORE_LINK_REL = 'noopener noreferrer nofollow ugc';

const STATUS_WORDS: Record<StoreEvent['status'], string> = {
  upcoming: msg('Registration'),
  live: msg('Running'),
  finished: msg('Finished')
};

function Where(props: { store: PublicStore }) {
  const links = () =>
    [
      { href: props.store.website, label: bareLink(props.store.website) },
      { href: readDiscordInvite(props.store.discord) ?? '', label: 'Discord' }
    ].filter(link => link.href);
  return (
    <div class='tm-storepage-where'>
      <address class='tm-storepage-address'>
        <span>{props.store.address}</span>
        <span>{addressOf({ ...props.store, address: '' })}</span>
      </address>
      <Show when={links().length > 0}>
        <p class='tm-storepage-links'>
          <For each={links()}>
            {link => (
              <a href={link.href} target='_blank' rel={STORE_LINK_REL}>
                {link.label}
              </a>
            )}
          </For>
        </p>
      </Show>
      <Show when={props.store.details}>
        <p class='tm-storepage-about'>{props.store.details}</p>
      </Show>
    </div>
  );
}

function Nights(props: { store: PublicStore }) {
  const today = () => dateIn(props.store.timeZone, Date.now());
  const ahead = () => props.store.exceptions.filter(item => item.date >= today());
  return (
    <section class='tm-storepage-nights' aria-labelledby='storepage-nights'>
      <h2 class='tm-subhead tm-box-head' id='storepage-nights'>
        {t('League nights')}
      </h2>
      <Show when={props.store.nights.length > 0} fallback={<p class='muted tm-storepage-none'>{t('None listed')}</p>}>
        <ul class='tm-storepage-list'>
          <For each={byWeek(props.store.nights)}>
            {night => (
              <li>
                <strong>{weekdayPlural(night.weekday)}</strong>
                <span class='tm-num'>{clock(night.time)}</span>
                <span class='muted tm-storepage-night-name'>{night.name}</span>
                <span class='muted tm-num'>{night.fee}</span>
              </li>
            )}
          </For>
        </ul>
        <p class='muted tm-storepage-zone'>{zoneName(props.store.timeZone)}</p>
      </Show>
      <Show when={ahead().length > 0}>
        <ul class='tm-storepage-list tm-storepage-changes'>
          <For each={ahead()}>
            {item => (
              <li>
                <strong class='tm-num'>{shortDay(item.date)}</strong>
                <span>{exceptionChange(item)}</span>
                <span class='muted tm-storepage-night-name'>{item.note}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function Events(props: { events: readonly StoreEvent[] }) {
  return (
    <section class='tm-storepage-events' aria-labelledby='storepage-events'>
      <h2 class='tm-subhead tm-box-head' id='storepage-events'>
        {t('Upcoming events')}
      </h2>
      <Show
        when={props.events.length > 0}
        fallback={<p class='muted tm-storepage-none'>{t('None on Ciphermaniac')}</p>}
      >
        <ul class='tm-storepage-history'>
          <For each={props.events}>
            {event => (
              <li>
                <span class='tm-num'>{storeEventWhen(event.startDate, event.startsAt)}</span>
                <EventName code={event.code} name={event.name} sanctioned={event.sanctioned} />
                <span class='muted'>{t(STATUS_WORDS[event.status])}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function EventName(props: { code: string; name: string; sanctioned: boolean }) {
  return (
    <span class='tm-storepage-event'>
      <A href={`/t/${props.code}`}>{props.name || props.code}</A>
      <Show when={props.sanctioned}>
        <span class='tm-flag'>{t('Sanctioned')}</span>
      </Show>
    </span>
  );
}

function Past(props: { events: readonly PastEvent[] }) {
  return (
    <Show when={props.events.length > 0}>
      <section class='tm-storepage-events' aria-labelledby='storepage-past'>
        <h2 class='tm-subhead tm-box-head' id='storepage-past'>
          {t('Past events')}
        </h2>
        <For each={byMonth(props.events)}>
          {month => (
            <>
              <h3 class='muted tm-storepage-month'>{month.label}</h3>
              <ul class='tm-storepage-history is-past'>
                <For each={month.events}>
                  {event => (
                    <li>
                      <span class='tm-num'>{shortDay(event.date)}</span>
                      <EventName code={event.code} name={event.name} sanctioned={event.sanctioned} />
                      <span class='muted tm-num'>{playersWord(event.players)}</span>
                      <span class='tm-storepage-winner'>{event.winners.join(', ')}</span>
                    </li>
                  )}
                </For>
              </ul>
            </>
          )}
        </For>
      </section>
    </Show>
  );
}

/** The store's league, or that it has none yet. */
function LeagueLine(props: { leagueId: string | null }) {
  return (
    <Show when={props.leagueId} fallback={<span>{t('Unsanctioned store')}</span>}>
      {id => <span class='tm-num'>{t('League {id}', { id: id() })}</span>}
    </Show>
  );
}

export function StorePage(props: { id: string }) {
  const [read] = createResource(() => props.id, fetchStore);
  const current = () => latestValue(read);
  createEffect(() => {
    document.title = pageTitle(current()?.store.name ?? t('Store'));
  });
  return (
    <div class='tm-page tm-storepage'>
      <Show
        when={current()}
        fallback={
          <Show when={read.error} fallback={<Skeleton height='320px' />}>
            <ErrorState code={t('Store')} title={t('Couldn’t load this store')} line={errorText(read.error)}>
              <A href='/' class='btn btn-primary'>
                {t('Go home')}
              </A>
            </ErrorState>
          </Show>
        }
      >
        {answer => (
          <>
            <TournamentHero
              title={answer().store.name}
              meta={<LeagueLine leagueId={answer().store.leagueId} />}
              action={
                <Show when={managesStore(answer().role)}>
                  <A class='btn btn-secondary' href={`/stores/${answer().store.id}/settings`}>
                    {t('Store settings')}
                  </A>
                </Show>
              }
            />
            <div class='tm-storepage-top' classList={{ 'has-map': answer().store.lat !== null }}>
              <Show when={answer().store.lat !== null && answer().store.lon !== null}>
                <StoreMap lat={answer().store.lat ?? 0} lon={answer().store.lon ?? 0} label={answer().store.name} />
              </Show>
              <div class='tm-storepage-side'>
                <Where store={answer().store} />
                <Nights store={answer().store} />
              </div>
            </div>
            <Events events={answer().store.events} />
            <Past events={answer().store.past} />
          </>
        )}
      </Show>
    </div>
  );
}
