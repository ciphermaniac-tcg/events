/**
 * A page's tabs as one tab list: a phone's bar along the bottom of the
 * screen (`tm-tabbar`, the dashboard's and the console's, each tab over its
 * icon), or the dashboard's strip beside its heading. Only the open tab is
 * in the page's tab order; the arrow keys, Home and End move between tabs and
 * open each as they reach it, except a locked one, which says why when
 * pressed, as the package's Tabs do. Whatever follows the tabs (`children`,
 * the dashboard's Admin link) sits in the same row, outside the list.
 */

import { Index, type JSX, Show } from 'solid-js';
import { LockedTab } from '@ciphermaniac/design/components/Tabs';
import { rovingIndex } from '@ciphermaniac/design/lib/roving';
import '../../styles/pages/tournament-tabbar.css';

export interface BarTab<T extends string> {
  value: T;
  label: string;
  /** Shown after the label, as the dashboard counts what is running. */
  count?: number;
  /** Why the tab cannot be opened yet. */
  locked?: string;
}

interface TabBarProps<T extends string> {
  /** Starts each tab's id; unique on the page. */
  id: string;
  /** The id of the panel the tabs open. */
  panel: string;
  label: string;
  class: string;
  tabs: BarTab<T>[];
  selected: T;
  onSelect: (value: T) => void;
  icon?: (value: T) => JSX.Element;
  children?: JSX.Element;
}

export function TabBar<T extends string>(props: TabBarProps<T>) {
  let list: HTMLDivElement | undefined;
  function key(event: KeyboardEvent) {
    const tabs = [...(list?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const from = tabs.findIndex(tab => tab === document.activeElement);
    const to = rovingIndex(event.key, from, tabs.length);
    if (from < 0 || to === null) {
      return;
    }
    event.preventDefault();
    tabs[to]?.focus();
    const next = props.tabs[to];
    if (next && !next.locked) {
      props.onSelect(next.value);
    }
  }
  return (
    <div class={props.class}>
      <div ref={list} class='tm-tablist' role='tablist' aria-label={props.label} onKeyDown={key}>
        {/* By place, so a tab's button outlives a new count and keeps its focus. */}
        <Index each={props.tabs}>{tab => <BarTabButton bar={props} tab={tab()} />}</Index>
      </div>
      {props.children}
    </div>
  );
}

function BarTabButton<T extends string>(props: { bar: TabBarProps<T>; tab: BarTab<T> }) {
  const id = () => `${props.bar.id}-${props.tab.value}`;
  const open = () => props.tab.value === props.bar.selected;
  const face = () => (
    <>
      {props.bar.icon?.(props.tab.value)}
      <span>
        {props.tab.label}
        <Show when={props.tab.count}>{count => <span class='tm-dash-count'>{count()}</span>}</Show>
      </span>
    </>
  );
  return (
    <Show
      when={props.tab.locked}
      fallback={
        <button
          type='button'
          role='tab'
          id={id()}
          aria-selected={open()}
          aria-controls={props.bar.panel}
          tabIndex={open() ? 0 : -1}
          onClick={() => props.bar.onSelect(props.tab.value)}
        >
          {face()}
        </button>
      }
    >
      {hint => (
        <LockedTab hint={hint()} role='tab' id={id()} value={props.tab.value}>
          {face()}
        </LockedTab>
      )}
    </Show>
  );
}
