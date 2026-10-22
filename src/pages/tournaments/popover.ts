/**
 * How every hand-built popover behaves while `open` (the account menu, a
 * row's options, the badges past "+N"): focus moves into it, to its first
 * link or button or, with none, to the panel itself; a press outside, or focus
 * moving to something outside, closes it; Escape closes it and hands focus
 * back to its trigger. Escape inside a dialog opened from it is the dialog's
 * own, so the popover stays.
 */

import { createEffect, onCleanup } from 'solid-js';

// Not a field: focusing one would open a phone's keyboard over the menu.
const FOCUSABLE = 'a[href], button:not(:disabled)';

interface PopoverParts {
  close: () => void;
  /** Holds the trigger and the panel: a press or focus inside it keeps the popover open. */
  root: () => HTMLElement | undefined;
  trigger: () => HTMLElement | undefined;
  panel: () => HTMLElement | undefined;
}

/** The panel's first link or button, or the panel itself where it has none. */
function focusInto(panel: HTMLElement | undefined) {
  (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
}

/** Holds an open popover to that behaviour; the answer lets it go. */
export function holdPopover(parts: PopoverParts): () => void {
  const root = parts.root();
  const outside = (node: EventTarget | null) => node !== null && !root?.contains(node as Node);
  const press = (event: Event) => {
    if (outside(event.target)) {
      parts.close();
    }
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || (event.target as Partial<Element> | null)?.closest?.('dialog')) {
      return;
    }
    parts.close();
    parts.trigger()?.focus();
  };
  // Focus going nowhere (a press Safari doesn't focus, a control removed under it) is not leaving.
  const left = (event: FocusEvent) => {
    if (outside(event.relatedTarget)) {
      parts.close();
    }
  };
  document.addEventListener('pointerdown', press);
  document.addEventListener('keydown', key);
  root?.addEventListener('focusout', left);
  queueMicrotask(() => focusInto(parts.panel()));
  return () => {
    document.removeEventListener('pointerdown', press);
    document.removeEventListener('keydown', key);
    root?.removeEventListener('focusout', left);
  };
}

export function createPopover(parts: PopoverParts & { open: () => boolean }) {
  createEffect(() => {
    if (parts.open()) {
      onCleanup(holdPopover(parts));
    }
  });
}
