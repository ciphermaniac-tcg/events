/**
 * The event's format: the Tier List Maker's formats (current, then past, from
 * the same live list so the two never drift), then the formats the site has no
 * data for. Stored as the label, which is what the event page shows.
 */

import { For, onMount, Show } from 'solid-js';
import { loadTierFormats, tierFormats } from '../../lib/data/formats';
import { msg, t } from '../../lib/i18n';

/** Kept as the label in English; only `Other` reads differently in another language. */
const OTHER_FORMATS = ['Gym Leader Challenge', 'Eternal', msg('Other')];

const GROUPS = [
  {
    label: msg('Current formats'),
    options: () =>
      tierFormats()
        .filter(f => f.group === 'current')
        .map(f => f.label)
  },
  {
    label: msg('Past formats'),
    options: () =>
      tierFormats()
        .filter(f => f.group === 'past')
        .map(f => f.label)
  },
  { label: msg('Other formats'), options: () => OTHER_FORMATS }
];

export function FormatSelect(props: { id: string; value: string; onChange: (label: string) => void }) {
  onMount(() => void loadTierFormats().catch(() => undefined));
  const known = () => GROUPS.some(group => group.options().includes(props.value));
  return (
    <select id={props.id} class='tm-select tm-select-full' onChange={e => props.onChange(e.currentTarget.value)}>
      {/* A format typed before this list existed stays selectable rather than silently changing. */}
      <Show when={props.value && !known()}>
        <option value={props.value} selected>
          {props.value}
        </option>
      </Show>
      <For each={GROUPS}>
        {group => (
          <optgroup label={t(group.label)}>
            <For each={group.options()}>
              {label => (
                <option value={label} selected={label === props.value}>
                  {t(label)}
                </option>
              )}
            </For>
          </optgroup>
        )}
      </For>
    </select>
  );
}
