/**
 * Where and when players gather, as settings rows: the event's own time
 * zone, which its start and check-in are read in, check-in, and the venue.
 * Setup and the console's Event tab share them; setup leaves the venue out
 * for a store's event, which is played at the store. With a start and no
 * check-in, one press sets check-in half an hour before the start, and a
 * check-in set that way moves with the start until it is typed over. One
 * after the start is refused (see checkInAfterStart).
 */

import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { isWallClock } from '../../../shared/tournament/timeZone';
import { SETTINGS_LIMITS, type TournamentSettings } from '../../../shared/tournament/view';
import { intlLocale, t } from '../../lib/i18n';
import { checkInAfterStart, wallClockBefore } from './checkInTime';
import { ErrorLine } from './Field';
import { SettingRow } from './SettingControls';

/** How long before the start check-in opens, when the organizer takes the usual. */
const CHECK_IN_LEAD_MINUTES = 30;

/** A wall-clock time's hour and minute, as the reader's language writes them. */
const hourOf = (local: string) =>
  new Date(Date.parse(`${local}:00Z`)).toLocaleTimeString(intlLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC'
  });

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
  /** The start as typed, which check-in is set from and checked against. */
  startsAt: string;
  onChange: (key: keyof Logistics, value: string) => void;
}) {
  /** Check-in was set from the start by a press, not typed, so it moves with the start. */
  const [follows, setFollows] = createSignal(false);
  const suggested = () => (isWallClock(props.startsAt) ? wallClockBefore(props.startsAt, CHECK_IN_LEAD_MINUTES) : null);
  // A memo, so only a new start moves it: the form's other edits redraw the props without changing the start.
  const start = createMemo(() => props.startsAt);
  createEffect(
    on(
      start,
      () => {
        const at = suggested();
        if (follows() && at) {
          props.onChange('checkInAt', at);
        }
      },
      { defer: true }
    )
  );
  const late = () => checkInAfterStart(props.value.checkInAt, props.startsAt);
  return (
    <>
      <SettingRow label={t('Time zone')} for={`${props.id}-zone`}>
        <select
          id={`${props.id}-zone`}
          class='tm-input'
          value={props.value.timeZone}
          onChange={e => props.onChange('timeZone', e.currentTarget.value)}
        >
          {/* An event made before it had a zone shows its times as written until one is chosen. */}
          <Show when={!props.value.timeZone}>
            <option value=''>{t('Not set')}</option>
          </Show>
          <For each={zones(props.value.timeZone)}>
            {zone => <option value={zone}>{zone.replaceAll('_', ' ')}</option>}
          </For>
        </select>
      </SettingRow>
      <SettingRow label={t('Check-in')} for={`${props.id}-check-in`}>
        <input
          id={`${props.id}-check-in`}
          class='tm-input'
          type='datetime-local'
          aria-invalid={late() || undefined}
          value={props.value.checkInAt}
          onInput={e => {
            setFollows(false);
            props.onChange('checkInAt', e.currentTarget.value);
          }}
        />
        <Show when={!props.value.checkInAt && suggested()}>
          {at => (
            <span class='tm-check-in-fill'>
              <button
                type='button'
                class='btn btn-ghost tm-small'
                onClick={() => {
                  setFollows(true);
                  props.onChange('checkInAt', at());
                }}
              >
                {t('{minutes} minutes before · {time}', { minutes: CHECK_IN_LEAD_MINUTES, time: hourOf(at()) })}
              </button>
            </span>
          )}
        </Show>
        <ErrorLine message={late() ? t('Check-in is after the start.') : null} />
      </SettingRow>
      <Show when={props.place ?? true}>
        <SettingRow label={t('Venue')} for={`${props.id}-venue`}>
          <input
            id={`${props.id}-venue`}
            class='tm-input'
            maxLength={SETTINGS_LIMITS.venue}
            value={props.value.venue}
            onInput={e => props.onChange('venue', e.currentTarget.value)}
          />
        </SettingRow>
        <SettingRow label={t('Address')} for={`${props.id}-address`}>
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
