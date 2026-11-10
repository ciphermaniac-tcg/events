/**
 * The home page's recent events: the newest finished event of each store and
 * organizer (functions/api/recent-events.ts), so a visitor sees events really
 * run here. Each row opens the event's public page. Only finished events are
 * listed, so nothing here can still be joined. The section shows once the list
 * arrives, below the first screen, and is left out with nothing to show or no
 * answer. It draws no skeleton: one in the page holds back the footer.
 */

import { createResource, For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Icon } from '@ciphermaniac/design/components/Icon';
import { call } from '../../lib/tournament/api';
import { eventDay } from '../../lib/tournament/history';
import { t } from '../../lib/i18n';

/** A finished event the list holds (functions/api/recent-events.ts). */
interface RecentEvent {
  code: string;
  name: string;
  /** The store and its town; '' when the event names neither. */
  place: string;
  /** Local start time (YYYY-MM-DDTHH:MM); '' for none. */
  startsAt: string;
  /** TOM's start date, for an event that set no start time; '' for none. */
  startDate: string;
  players: number;
}

const fetchRecentEvents = () => call<{ events: RecentEvent[] }>('/api/recent-events').then(answer => answer.events);

const pageOf = (event: RecentEvent) => `/t/${event.code}`;

function Row(props: { event: RecentEvent }) {
  const navigate = useNavigate();
  return (
    // The name is the link; the rest of the row follows it for a pointer, leaving the link's own clicks to it.
    <tr
      class='tm-home-recent-row'
      onClick={click => {
        const own = click.target instanceof Element && click.target.closest('a');
        if (!own && !click.metaKey && !click.ctrlKey && !click.shiftKey) {
          navigate(pageOf(props.event));
        }
      }}
    >
      <td>
        <A href={pageOf(props.event)}>{props.event.name}</A>
        <Show when={props.event.place}>
          <span class='tm-home-recent-place'>{props.event.place}</span>
        </Show>
      </td>
      <td class='tm-home-recent-day'>{eventDay(props.event.startsAt, props.event.startDate)}</td>
      <td class='num'>{props.event.players}</td>
      <td class='tm-home-recent-go' aria-hidden='true'>
        <Icon name='chevron-right' />
      </td>
    </tr>
  );
}

export function RecentEvents() {
  const [events] = createResource(() => fetchRecentEvents().catch(() => [] as RecentEvent[]));
  return (
    <Show when={(events()?.length ?? 0) > 0}>
      <section class='tm-home-lede tm-home-recent' aria-label={t('Recent events')}>
        <p>{t('See recent events run with Ciphermaniac Events.')}</p>
        <div class='tm-home-recent-table'>
          <table class='data'>
            <thead>
              <tr>
                <th>{t('Event')}</th>
                <th class='tm-home-recent-day'>{t('Date')}</th>
                <th class='num'>{t('Players')}</th>
                <th aria-hidden='true' />
              </tr>
            </thead>
            <tbody>
              <For each={events()}>{event => <Row event={event} />}</For>
            </tbody>
          </table>
        </div>
      </section>
    </Show>
  );
}
