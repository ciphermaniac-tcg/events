import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { rovingIndex } from './roving';

interface TabsProps<T extends string> {
  /** Names the tabs and their panel (`TabPanel`), unique on the page. */
  id: string;
  /** `locked`: why the tab cannot be opened yet, shown when it is pressed or hovered. */
  options: { value: T; label: string; locked?: string }[];
  selected: T;
  onSelect: (value: T) => void;
  ariaLabel?: string;
}

export const tabId = (tabs: string, value: string) => `${tabs}-tab-${value}`;
const panelId = (tabs: string) => `${tabs}-panel`;

/**
 * Scrolls the strip sideways just enough to show a clipped tab clear of its
 * edge (its scroll padding, as scrollIntoView would); the page's own scroll is
 * left alone.
 */
function revealTab(nav: HTMLElement, tab: HTMLElement) {
  const strip = nav.getBoundingClientRect();
  const box = tab.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(nav).scrollPaddingInlineStart) || 0;
  const offset = Math.min(0, box.left - strip.left - pad) || Math.max(0, box.right - strip.right + pad);
  if (offset) {
    nav.scrollBy({ left: offset, behavior: 'smooth' });
  }
}

/** The content the selected tab shows, named by that tab. */
export function TabPanel(props: { tabs: string; selected: string; children: JSX.Element }) {
  return (
    <div role='tabpanel' id={panelId(props.tabs)} aria-labelledby={tabId(props.tabs, props.selected)}>
      {props.children}
    </div>
  );
}

/**
 * Underline tabs — for big in-page section navigation.
 *
 * Only the selected tab is in the page's tab order; the arrow keys, Home and
 * End move between tabs and open each as they reach it, except a locked one.
 *
 * On narrow screens the strip scrolls horizontally. Edge-fade classes
 * (`fade-l` / `fade-r`) signal hidden tabs — without them, clipped tabs like
 * "Matchups" were simply undiscoverable on phones — and the active tab is
 * kept scrolled into view within the strip.
 */
export function Tabs<T extends string>(props: TabsProps<T>) {
  let nav: HTMLElement | undefined;

  function updateFades() {
    if (!nav) {
      return;
    }
    const maxScroll = nav.scrollWidth - nav.clientWidth;
    nav.classList.toggle('fade-l', maxScroll > 1 && nav.scrollLeft > 1);
    nav.classList.toggle('fade-r', maxScroll > 1 && nav.scrollLeft < maxScroll - 1);
  }

  onMount(() => {
    updateFades();
    nav?.addEventListener('scroll', updateFades, { passive: true });
    const ro = new ResizeObserver(updateFades);
    if (nav) {
      ro.observe(nav);
    }
    onCleanup(() => {
      nav?.removeEventListener('scroll', updateFades);
      ro.disconnect();
    });
  });

  function key(event: KeyboardEvent) {
    const tabs = [...(nav?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const from = tabs.findIndex(tab => tab === document.activeElement);
    const to = rovingIndex(event.key, from, tabs.length);
    if (from < 0 || to === null) {
      return;
    }
    event.preventDefault();
    tabs[to]?.focus();
    const option = props.options[to];
    if (option && !option.locked) {
      props.onSelect(option.value);
    }
  }

  // A memo, so the strip moves only when the selection does: an event's update re-reads `selected` unchanged.
  const selected = createMemo(() => props.selected);
  createEffect(() => {
    const active = nav?.querySelector<HTMLElement>(`[data-value="${selected()}"]`);
    if (nav && active) {
      revealTab(nav, active);
    }
  });

  return (
    <nav ref={nav} class='tabs' role='tablist' aria-label={props.ariaLabel ?? 'Section'} onKeyDown={key}>
      <For each={props.options}>
        {opt => (
          <Show
            when={opt.locked}
            fallback={
              <button
                type='button'
                role='tab'
                id={tabId(props.id, opt.value)}
                data-value={opt.value}
                class={props.selected === opt.value ? 'active' : ''}
                aria-selected={props.selected === opt.value ? 'true' : 'false'}
                aria-controls={panelId(props.id)}
                tabIndex={props.selected === opt.value ? 0 : -1}
                onClick={() => props.onSelect(opt.value)}
              >
                {opt.label}
              </button>
            }
          >
            {hint => (
              <LockedTab hint={hint()} role='tab' id={tabId(props.id, opt.value)} value={opt.value}>
                {opt.label}
              </LockedTab>
            )}
          </Show>
        )}
      </For>
    </nav>
  );
}

/**
 * A tab that cannot be opened yet: dimmed, and pressing or hovering it says
 * why in the site's info bubble (see InfoTip). Pressing it again, or moving
 * focus away, closes the bubble.
 */
export function LockedTab(props: { hint: string; children: JSX.Element; role?: 'tab'; id?: string; value?: string }) {
  const [open, setOpen] = createSignal(false);
  return (
    <span class='info-tip tab-locked' classList={{ open: open() }}>
      <button
        type='button'
        role={props.role}
        id={props.id}
        data-value={props.value}
        tabIndex={props.role ? -1 : undefined}
        aria-disabled='true'
        aria-selected={props.role ? 'false' : undefined}
        aria-description={props.hint}
        onClick={() => setOpen(!open())}
        onBlur={() => setOpen(false)}
      >
        {props.children}
      </button>
      {/* A tab list holds only tabs, so there the hint is the tab's description alone. */}
      <span
        class='info-tip-bubble'
        role={props.role ? undefined : 'tooltip'}
        aria-hidden={props.role ? 'true' : undefined}
      >
        {props.hint}
      </span>
    </span>
  );
}
