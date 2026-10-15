/**
 * Where and when, for players: the venue, and check-in and the start in the
 * event's own zone, with the viewer's time under any that reads differently
 * where they are.
 */

import { For, Show } from 'solid-js';
import { eventTimes } from '../../../shared/tournament/eventTime';
import type { TournamentSettings } from '../../../shared/tournament/view';

type Shown = Pick<TournamentSettings, 'timeZone' | 'checkInAt' | 'startsAt' | 'venue' | 'address'>;

export function EventLogistics(props: { settings: Shown }) {
  const times = () =>
    (
      [
        ['Check-in', props.settings.checkInAt],
        ['Starts', props.settings.startsAt]
      ] as const
    ).flatMap(([label, local]) => (local ? [{ label, ...eventTimes(local, props.settings.timeZone) }] : []));
  const place = () => props.settings.venue || props.settings.address;
  // The start alone is in the page's heading already; it earns a row where it reads differently here.
  const shown = () => place() || props.settings.checkInAt || times().some(time => time.yours);
  return (
    <Show when={shown()}>
      <table class='tm-logistics'>
        <tbody>
          <Show when={place()}>
            <tr>
              <th scope='row'>Venue</th>
              <td>
                {props.settings.venue}
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
                  <Show when={time.yours}>{yours => <small class='muted'>Your time: {yours()}</small>}</Show>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}
