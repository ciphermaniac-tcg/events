/**
 * The home page's player profile: Reese's own, as /u/rosematcha shows it,
 * with their badges named on hover. Its first row is the sample event as it
 * plays, so the place and record move with it.
 */

import { createSignal, For, Show } from 'solid-js';
import type { Badge } from '../../../shared/accounts/achievements';
import { ordinal } from '../../lib/format';
import { dayLabel, eventDay } from '../../lib/tournament/history';
import { t } from '../../lib/i18n';
import { Badges } from './Badges';
import { SampleDeck } from './SampleDeck';
import { recordOf, SAMPLE_FOCUS, type SampleRun } from './sampleRun';

/** Reese's Discord avatar, kept here so the page asks nobody else for it. */
const AVATAR = '/img/rosematcha.webp';

const BADGES: Badge[] = [
  { key: 'creator' },
  { key: 'beta' },
  { key: 'played', count: 2, tier: 1 },
  { key: 'organized', count: 3, tier: 1 }
];

/** Reese's own events, as their profile lists them. */
const PLAYED: { name: string; startsAt: string }[] = [
  { name: 'D2G TCG League Cup (November 2026)', startsAt: '2026-11-07T14:00' },
  { name: 'Combat Power Locals', startsAt: '2026-10-07T19:30' },
  { name: 'Combat Power Locals', startsAt: '2026-09-30T19:35' }
];

function Avatar() {
  const [failed, setFailed] = createSignal(false);
  return (
    <Show when={!failed()} fallback={<span class='tm-hpr-avatar'>R</span>}>
      <img class='tm-hpr-avatar' src={AVATAR} alt='' width='72' height='72' onError={() => setFailed(true)} />
    </Show>
  );
}

function LiveRow(props: { run: SampleRun }) {
  const mine = () => props.run.standingOf(SAMPLE_FOCUS);
  return (
    <tr>
      <td>
        <b>Friday League</b>
        <span class='tm-hpr-tag'>{props.run.finished() ? t('Final') : t('In progress')}</span>
        <span class='tm-hpr-day'>
          {dayLabel(new Date())} · {t('Standard')}
        </span>
      </td>
      <td class='tm-hpr-wide'>
        <SampleDeck player={SAMPLE_FOCUS} named />
      </td>
      <td class='num tm-hpr-wide'>{ordinal((mine()?.place ?? 0) + 1)}</td>
      <td class='num'>{recordOf(mine()?.line)}</td>
    </tr>
  );
}

export function HomeProfile(props: { run: SampleRun }) {
  return (
    <section class='tm-hpr' aria-label={t('A player profile')}>
      <div class='tm-hpr-top'>
        <Avatar />
        <div>
          <p class='tm-hpr-name'>
            Reese Lundquist <small>@rosematcha</small>
          </p>
          <Badges badges={BADGES} />
        </div>
      </div>
      <div class='tm-hpr-tabs'>
        <span class='is-on'>{t('Playing · {n}', { n: PLAYED.length + 1 })}</span>
        <span>{t('Organizing · {n}', { n: 3 })}</span>
      </div>
      <table class='tm-hpr-table'>
        <thead>
          <tr>
            <th>{t('Event')}</th>
            <th class='tm-hpr-wide'>{t('Deck')}</th>
            <th class='num tm-hpr-wide'>{t('Place')}</th>
            <th class='num'>{t('Record')}</th>
          </tr>
        </thead>
        <tbody>
          <LiveRow run={props.run} />
          <For each={PLAYED}>
            {event => (
              <tr>
                <td>
                  <b>{event.name}</b>
                  <Show when={new Date(event.startsAt).getTime() > Date.now()}>
                    <span class='tm-hpr-tag'>{t('Upcoming')}</span>
                  </Show>
                  <span class='tm-hpr-day'>
                    {eventDay(event.startsAt, '')} · {t('Standard')}
                  </span>
                </td>
                <td class='tm-hpr-wide' />
                <td class='tm-hpr-wide' />
                <td />
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </section>
  );
}
