import { For, type JSX } from 'solid-js';
import { rovingIndex } from './roving';

interface SegmentedProps<T extends string> {
  options: { value: T; label: JSX.Element }[];
  selected: T;
  onSelect: (value: T) => void;
  ariaLabel?: string;
  /** Another class beside `segmented`, for where it sits. */
  class?: string;
}

/**
 * Segmented control — for short toggles (e.g., slice = all/phase2/topcut).
 *
 * One choice of several, so a radio group: only the chosen option is in the
 * page's tab order, and the arrow keys, Home and End choose another.
 */
export function Segmented<T extends string>(props: SegmentedProps<T>) {
  let group: HTMLDivElement | undefined;
  // With nothing chosen, the first option takes focus so the group can be reached.
  const reachable = (value: T) =>
    props.options.some(opt => opt.value === props.selected)
      ? props.selected === value
      : props.options[0]?.value === value;
  function key(event: KeyboardEvent) {
    const radios = [...(group?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
    const from = radios.findIndex(radio => radio === document.activeElement);
    const to = rovingIndex(event.key, from, radios.length);
    const option = to === null ? undefined : props.options[to];
    if (from < 0 || to === null || !option) {
      return;
    }
    event.preventDefault();
    props.onSelect(option.value);
    radios[to]?.focus();
  }
  return (
    <div
      ref={group}
      class={props.class ? `segmented ${props.class}` : 'segmented'}
      role='radiogroup'
      aria-label={props.ariaLabel}
      onKeyDown={key}
    >
      <For each={props.options}>
        {opt => (
          <button
            type='button'
            role='radio'
            class={props.selected === opt.value ? 'active' : ''}
            data-value={opt.value}
            aria-checked={props.selected === opt.value ? 'true' : 'false'}
            tabIndex={reachable(opt.value) ? 0 : -1}
            onClick={() => props.onSelect(opt.value)}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  );
}
