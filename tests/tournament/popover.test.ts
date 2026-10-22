/**
 * One focus behaviour for every hand-built popover (src/pages/tournaments/popover.ts):
 * focus goes in on open, a press or focus outside closes, Escape closes and
 * hands focus back, and Escape in a dialog opened from the popover is the dialog's.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { holdPopover } from '../../src/pages/tournaments/popover.ts';

type Listener = (event: unknown) => void;

/** Something listeners hang on, whose listeners a test can call by type. */
function target<T extends object>(extra: T) {
  const listeners = new Map<string, Set<Listener>>();
  return Object.assign(extra, {
    listeners,
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
    fire: (type: string, event: object) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    }
  });
}

function setup(firstControl: boolean) {
  const focused: string[] = [];
  const control = { focus: () => focused.push('control') };
  const panel = {
    focus: () => focused.push('panel'),
    querySelector: () => (firstControl ? control : null)
  };
  const inside = { closest: () => null };
  const dialog = { closest: (selector: string) => (selector === 'dialog' ? {} : null) };
  const root = target({ contains: (node: unknown) => node === inside || node === dialog });
  const trigger = { focus: () => focused.push('trigger') };
  const doc = target({});
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  let closed = 0;
  const release = holdPopover({
    close: () => closed++,
    root: () => root as unknown as HTMLElement,
    trigger: () => trigger as unknown as HTMLElement,
    panel: () => panel as unknown as HTMLElement
  });
  return { focused, root, doc, inside, dialog, release, closed: () => closed };
}

const settle = () => Promise.resolve();

test('focus moves to the first control on open, or to the panel when it has none', async () => {
  try {
    const withControl = setup(true);
    await settle();
    assert.deepEqual(withControl.focused, ['control']);
    withControl.release();
    const bare = setup(false);
    await settle();
    assert.deepEqual(bare.focused, ['panel']);
    bare.release();
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
  }
});

test('a press outside closes it, and one inside does not', () => {
  try {
    const popover = setup(true);
    popover.doc.fire('pointerdown', { target: popover.inside });
    assert.equal(popover.closed(), 0);
    popover.doc.fire('pointerdown', { target: {} });
    assert.equal(popover.closed(), 1);
    popover.release();
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
  }
});

test('focus leaving for something outside closes it; focus going nowhere or inside does not', () => {
  try {
    const popover = setup(true);
    popover.root.fire('focusout', { relatedTarget: popover.inside });
    popover.root.fire('focusout', { relatedTarget: null });
    assert.equal(popover.closed(), 0);
    popover.root.fire('focusout', { relatedTarget: {} });
    assert.equal(popover.closed(), 1);
    popover.release();
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
  }
});

test('Escape closes it and hands focus back, except from a dialog opened inside it', async () => {
  try {
    const popover = setup(true);
    await settle();
    popover.doc.fire('keydown', { key: 'Enter', target: popover.inside });
    popover.doc.fire('keydown', { key: 'Escape', target: popover.dialog });
    assert.equal(popover.closed(), 0);
    popover.doc.fire('keydown', { key: 'Escape', target: popover.inside });
    assert.equal(popover.closed(), 1);
    assert.deepEqual(popover.focused, ['control', 'trigger']);
    popover.release();
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
  }
});

test('letting go removes every listener it added', () => {
  try {
    const popover = setup(true);
    popover.release();
    for (const listeners of [...popover.doc.listeners.values(), ...popover.root.listeners.values()]) {
      assert.equal(listeners.size, 0);
    }
    popover.doc.fire('pointerdown', { target: {} });
    assert.equal(popover.closed(), 0);
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
  }
});
