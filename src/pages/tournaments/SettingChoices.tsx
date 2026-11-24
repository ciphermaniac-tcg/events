/**
 * The settings choices beyond a switch that the new event setup and the
 * console's Event tab share: the kind of event, whether it takes decklists,
 * and how many Swiss rounds it plans. Apart from SettingControls, which ships
 * with the first page, so these load with the pages that use them.
 */

import { For, Show } from 'solid-js';
import { EVENT_TYPE_LABELS, EVENT_TYPES, type EventType } from '../../../shared/tournament/types';
import { type DecklistMode, SETTINGS_LIMITS } from '../../../shared/tournament/view';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { msg, t, tn } from '../../lib/i18n';

/** The kinds that are always sanctioned, so whether they are is never asked. */
export const ALWAYS_SANCTIONED: readonly EventType[] = ['cup', 'challenge'];

const CAPS = Array.from({ length: SETTINGS_LIMITS.roundCap }, (_, i) => i + 1);

const DECKLIST_OPTIONS: { value: DecklistMode; label: string }[] = [
  { value: 'off', label: msg('Off') },
  { value: 'closed', label: msg('Closed') },
  { value: 'open', label: msg('Open') }
];

/**
 * The event kind, which sets its mode and initial round structure, and beside
 * it whether the event is sanctioned (`sanctioned`, left out where it is not
 * asked). A League Cup or Challenge always is, so it is not asked of either.
 */
export function EventTypeSelect(props: {
  value: EventType;
  types?: readonly EventType[] | undefined;
  sanctioned?: boolean | undefined;
  onChange: (value: EventType) => void;
  onSanctioned?: (value: boolean) => void;
}) {
  return (
    <span class='tm-set-inline'>
      <select
        class='tm-select'
        aria-label={t('Event type')}
        value={props.value}
        onChange={e => props.onChange(e.currentTarget.value as EventType)}
      >
        <For each={props.types ?? EVENT_TYPES}>
          {value => <option value={value}>{t(EVENT_TYPE_LABELS[value])}</option>}
        </For>
      </select>
      <Show when={props.sanctioned !== undefined && !ALWAYS_SANCTIONED.includes(props.value)}>
        <label class='tm-check'>
          <input
            type='checkbox'
            checked={props.sanctioned}
            onChange={e => props.onSanctioned?.(e.currentTarget.checked)}
          />
          {t('Sanctioned')}
        </label>
      </Show>
    </span>
  );
}

/** Whether the event takes decklists, and if it does, whether players can send one now. */
export function DecklistsSwitch(props: { value: DecklistMode; onChange: (value: DecklistMode) => void }) {
  return (
    <Segmented
      options={DECKLIST_OPTIONS.map(option => ({ ...option, label: t(option.label) }))}
      selected={props.value}
      onSelect={props.onChange}
      ariaLabel={t('Decklists')}
    />
  );
}

/**
 * How many Swiss rounds to plan: Play! Pokémon's number for the attendance
 * (`recommended`, when there are players to count), or a cap of at least
 * `min` (a sanctioned event plays three).
 */
export function RoundsSelect(props: {
  id: string;
  value: number;
  recommended?: number | undefined;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <select id={props.id} class='tm-select' onChange={e => props.onChange(Number(e.currentTarget.value))}>
      <option value={0} selected={props.value === 0}>
        {props.recommended
          ? t('Recommended ({rounds} for this many players)', { rounds: props.recommended })
          : t('Recommended for attendance')}
      </option>
      {/* A cap stored before the minimum held stays listed, so the select shows what is set. */}
      <For each={CAPS.filter(n => n >= (props.min ?? 1) || n === props.value)}>
        {n => (
          <option value={n} selected={props.value === n}>
            {tn(n, 'Capped at {n} round', 'Capped at {n} rounds')}
          </option>
        )}
      </For>
    </select>
  );
}
