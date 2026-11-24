/**
 * Where and when, for players: the venue, linked to its store's page when a
 * store runs the event, and check-in and the start in the
 * event's own zone, with the viewer's time under any that reads differently
 * where they are.
 */

import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { eventTimes } from '../../../shared/tournament/eventTime';
import { isWallClock } from '../../../shared/tournament/timeZone';
import type { TournamentSettings, TournamentView } from '../../../shared/tournament/view';
import { eventDay } from '../../lib/tournament/history';
import { firstRoundTime } from '../../lib/tournament/present';
import { intlLocale, t } from '../../lib/i18n';

type Shown = Pick<TournamentSettings, 'timeZone' | 'checkInAt' | 'startsAt' | 'venue' | 'address' | 'finished'>;

/** `store`: the store that runs the event, whose page the venue links to. */
export function EventLogistics(props: { settings: Shown; store?: string | null }) {
  const time = (label: string, local: string) =>
    local ? [{ label, ...eventTimes(local, props.settings.timeZone, intlLocale()) }] : [];
  // The start is in the page's heading already: it earns a row only where it reads differently here, and only before it is over.
  const times = () => [
    ...time(t('Check-in'), props.settings.checkInAt),
    ...time(t('Starts'), props.settings.finished ? '' : props.settings.startsAt).filter(start => start.yours)
  ];
  const place = () => props.settings.venue || props.settings.address;
  const shown = () => place() || times().length > 0;
  return (
    <Show when={shown()}>
      <table class='tm-logistics'>
        <tbody>
          <Show when={place()}>
            <tr>
              <th scope='row'>{t('Venue')}</th>
              <td>
                <Show when={props.settings.venue && props.store} fallback={props.settings.venue}>
                  {store => <A href={`/stores/${store()}`}>{props.settings.venue}</A>}
                </Show>
                <Show when={props.settings.address}>
                  <small class='muted'>{props.settings.address}</small>
                </Show>
              </td>
            </tr>
          </Show>
          <For each={times()}>
            {time => (
              <tr>
                <th scope='row'>{time.label}</th>
                <td>
                  {time.event}
                  <Show when={time.yours}>
                    {yours => <small class='muted'>{t('Your time: {time}', { time: yours() })}</small>}
                  </Show>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}

/** A time the organizer set (the start, which is when registration changes close, or check-in) as players read it; null when none is set. */
export const timeShown = (local: string, zone: string): string | null =>
  isWallClock(local) ? eventTimes(local, zone, intlLocale()).event : null;

/** Whether the event's own list is at its cap, so the page says so before anyone types. */
export const rosterFull = (view: TournamentView): boolean =>
  view.mode === 'swiss' &&
  view.settings.playerCap > 0 &&
  view.tournament.players.filter(player => player.droppedAfter === null).length >= view.settings.playerCap;

/**
 * One date format across the page: the organizer's start time, in the event's
 * zone where it has one, else TOM's start date (see eventDay).
 */
export function eventDate({ startsAt, timeZone }: TournamentSettings, startDate: string): string {
  if (startsAt && timeZone) {
    return eventTimes(startsAt, timeZone, intlLocale()).event;
  }
  const day = eventDay(startsAt, startDate);
  return startsAt ? `${day} · ${firstRoundTime(startsAt) ?? ''}` : day;
}
