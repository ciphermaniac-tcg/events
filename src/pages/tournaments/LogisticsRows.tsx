/**
 * Where and when players gather, as settings rows: the event's own time
 * zone, which its start and check-in are read in, check-in, and the venue.
 * Setup and the console's Event tab share them; setup leaves the venue out
 * for a store's event, which is played at the store.
 */

import { For, Show } from 'solid-js';
import { SETTINGS_LIMITS, type TournamentSettings } from '../../../shared/tournament/view';
import { SettingRow } from './SettingControls';

export type Logistics = Pick<TournamentSettings, 'timeZone' | 'checkInAt' | 'venue' | 'address'>;

/** The zone this browser is in, which a new event starts in unless its store says otherwise. */
export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Every zone this browser knows, with the chosen one even where the list leaves it out. */
function zones(chosen: string): string[] {
  const known = Intl.supportedValuesOf('timeZone');
  return chosen && !known.includes(chosen) ? [chosen, ...known] : known;
}

export function LogisticsRows(props: {
  /** The prefix of the rows' control ids. */
  id: string;
  value: Logistics;
  /** Whether to ask for the venue and its address. */
  place?: boolean;
  onChange: (key: keyof Logistics, value: string) => void;
}) {
  return (
    <>
      <SettingRow label='Time zone' for={`${props.id}-zone`}>
        <select
          id={`${props.id}-zone`}
          class='tm-input'
          value={props.value.timeZone}
          onChange={e => props.onChange('timeZone', e.currentTarget.value)}
        >
          {/* An event made before it had a zone shows its times as written until one is chosen. */}
          <Show when={!props.value.timeZone}>
            <option value=''>Not set</option>
          </Show>
          <For each={zones(props.value.timeZone)}>
            {zone => <option value={zone}>{zone.replaceAll('_', ' ')}</option>}
          </For>
        </select>
      </SettingRow>
      <SettingRow label='Check-in' for={`${props.id}-check-in`}>
        <input
          id={`${props.id}-check-in`}
          class='tm-input'
          type='datetime-local'
          value={props.value.checkInAt}
          onInput={e => props.onChange('checkInAt', e.currentTarget.value)}
        />
      </SettingRow>
      <Show when={props.place ?? true}>
        <SettingRow label='Venue' for={`${props.id}-venue`}>
          <input
            id={`${props.id}-venue`}
            class='tm-input'
            maxLength={SETTINGS_LIMITS.venue}
            value={props.value.venue}
            onInput={e => props.onChange('venue', e.currentTarget.value)}
          />
        </SettingRow>
        <SettingRow label='Address' for={`${props.id}-address`}>
          <input
            id={`${props.id}-address`}
            class='tm-input'
            maxLength={SETTINGS_LIMITS.address}
            value={props.value.address}
            onInput={e => props.onChange('address', e.currentTarget.value)}
          />
        </SettingRow>
      </Show>
    </>
  );
}
