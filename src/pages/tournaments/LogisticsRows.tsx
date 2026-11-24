/**
 * Where and when players gather, as settings rows: the event's own time
 * zone, which its start and check-in are read in, check-in, and the venue.
 * Settings shows them; setup asks only the venue (PlaceRows), and neither
 * asks it of a store's event, which is played at the store. With a start and no
 * check-in, one press sets check-in half an hour before the start, and a
 * check-in set that way moves with the start until it is typed over. One
 * after the start is refused (see checkInAfterStart).
 */

import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { isWallClock } from '../../../shared/tournament/timeZone';
import { SETTINGS_LIMITS, type TournamentSettings } from '../../../shared/tournament/view';
import { currencySymbol } from '../../lib/events/format';
import { intlLocale, t } from '../../lib/i18n';
import { checkInAfterStart, wallClockBefore } from './checkInTime';
import { ErrorLine } from './Field';
import { SettingRow } from './SettingControls';
import '../../styles/pages/tournament-store-forms.css';

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

/** A number field's value as a setting: blank is 0, and so is anything the field could not read. */
export const fieldNumber = (input: HTMLInputElement) =>
  Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;

/** The entry fee, behind the symbol of the currency the event's country uses. */
export function FeeField(props: {
  id: string;
  country: string;
  value: number;
  /** Out of its range, as the form that holds it found it. */
  invalid?: boolean;
  onChange: (value: number) => void;
}) {
  const symbol = () => currencySymbol(props.country) ?? '$';
  return (
    <span class='tm-night-fee'>
      <span class='tm-fee-symbol' aria-hidden='true'>
        {symbol()}
      </span>
      <input
        id={props.id}
        class='tm-input tm-set-minutes'
        style={{ 'padding-left': `calc(14px + ${symbol().length}ch)` }}
        type='number'
        inputMode='decimal'
        min={0}
        step={0.01}
        max={SETTINGS_LIMITS.entryFee}
        aria-invalid={props.invalid || undefined}
        value={props.value || ''}
        onInput={e => props.onChange(fieldNumber(e.currentTarget))}
      />
    </span>
  );
}

/** The zone this browser is in, which a new event starts in unless its store says otherwise. */
export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Every zone this browser knows, read once: the list is fixed for the session and the picker's options are many. */
let knownZones: string[] | null = null;

/** Every zone this browser knows, with the chosen one even where the list leaves it out. */
function zones(chosen: string): string[] {
  knownZones ??= Intl.supportedValuesOf('timeZone');
  return chosen && !knownZones.includes(chosen) ? [chosen, ...knownZones] : knownZones;
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
  /** After a press sets check-in, which no field's change event says. */
  onFill?: () => void;
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
                  props.onFill?.();
                }}
              >
                {t('Use {time}, {minutes} minutes before', { minutes: CHECK_IN_LEAD_MINUTES, time: hourOf(at()) })}
              </button>
            </span>
          )}
        </Show>
        <ErrorLine message={late() ? t('Check-in is after the start.') : null} />
      </SettingRow>
      <Show when={props.place ?? true}>
        <PlaceRows
          id={props.id}
          venue={props.value.venue}
          address={props.value.address}
          onChange={(key, value) => props.onChange(key, value)}
        />
      </Show>
    </>
  );
}

/** Where the event is played, both optional: the venue's name and its street address. */
export function PlaceRows(props: {
  id: string;
  venue: string;
  address: string;
  onChange: (key: 'venue' | 'address', value: string) => void;
}) {
  return (
    <>
      <SettingRow label={t('Venue')} for={`${props.id}-venue`}>
        <input
          id={`${props.id}-venue`}
          class='tm-input'
          maxLength={SETTINGS_LIMITS.venue}
          value={props.venue}
          onInput={e => props.onChange('venue', e.currentTarget.value)}
        />
      </SettingRow>
      <SettingRow label={t('Address')} for={`${props.id}-address`}>
        <input
          id={`${props.id}-address`}
          class='tm-input'
          maxLength={SETTINGS_LIMITS.address}
          value={props.address}
          onInput={e => props.onChange('address', e.currentTarget.value)}
        />
      </SettingRow>
    </>
  );
}
