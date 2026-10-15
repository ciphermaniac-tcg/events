/**
 * The page outside a modal layer goes inert while it is open
 * (src/lib/focusTrap.ts): every branch beside the layer's path up to the
 * body, and whatever is added there meanwhile, but not the layer, its
 * ancestors, a scrim kept live, or the head; undoing it leaves alone what was
 * already inert and stops watching. Tab wraps inside the layer.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { inertOutside, keepTabIn } from '../../src/lib/focusTrap.ts';

interface Fake {
  name: string;
  nodeType: number;
  inert: boolean;
  parentElement: Fake | null;
  children: Fake[];
}

const ELEMENT = 1;

function tree(name: string, ...children: Fake[]): Fake {
  const made: Fake = { name, nodeType: ELEMENT, inert: false, parentElement: null, children };
  for (const child of children) {
    child.parentElement = made;
  }
  return made;
}

/** A stand-in for the browser's MutationObserver: `add` puts a node under a watched parent. */
let watchers: { callback: (records: { addedNodes: Fake[] }[]) => void; watched: Fake[]; live: boolean }[];
const globals = globalThis as { MutationObserver?: unknown; Node?: unknown };
const before = { MutationObserver: globals.MutationObserver, Node: globals.Node };

beforeEach(() => {
  watchers = [];
  globals.Node = { ELEMENT_NODE: ELEMENT };
  globals.MutationObserver = class {
    entry: (typeof watchers)[number];
    constructor(callback: (typeof watchers)[number]['callback']) {
      this.entry = { callback, watched: [], live: true };
      watchers.push(this.entry);
    }
    observe(target: Fake) {
      this.entry.watched.push(target);
    }
    disconnect() {
      this.entry.live = false;
    }
  };
});

afterEach(() => {
  Object.assign(globals, before);
});

function add(parent: Fake, child: Fake) {
  parent.children.push({ ...child, parentElement: parent });
  for (const watcher of watchers.filter(w => w.live && w.watched.includes(parent))) {
    watcher.callback([{ addedNodes: [parent.children.at(-1) as Fake] }]);
  }
}

function page() {
  const sheet = tree('sheet');
  const scrim = tree('scrim');
  const table = tree('table');
  const section = tree('section', table, scrim, sheet);
  const head = tree('site-head');
  const main = tree('main', tree('hero'), section);
  const body = tree('body', head, main, tree('footer'));
  const html = tree('html', tree('head'), body);
  return { html, body, main, section, sheet, scrim, table, head };
}

const inert = (root: Fake): string[] => [
  ...(root.inert ? [root.name] : []),
  ...root.children.flatMap(child => inert(child))
];

test('everything outside the layer goes inert but its own path, the kept scrim and the head', () => {
  const { html, sheet, scrim } = page();
  const undo = inertOutside(sheet as unknown as HTMLElement, [scrim as unknown as Element]);
  assert.deepEqual(inert(html).sort(), ['footer', 'hero', 'site-head', 'table']);
  undo();
  assert.deepEqual(inert(html), []);
});

test('what the page adds beside the layer while it is open goes inert too, until it closes', () => {
  const { html, main, section, sheet } = page();
  const undo = inertOutside(sheet as unknown as HTMLElement);
  add(main, tree('your-match'));
  add(section, { ...tree('text'), nodeType: 3 });
  assert.ok(inert(html).includes('your-match'));
  assert.ok(!inert(html).includes('text'), 'only elements');
  undo();
  add(main, tree('later'));
  assert.deepEqual(inert(html), [], 'nothing held once closed');
});

test('undoing leaves what was already inert as it was', () => {
  const { html, sheet, head } = page();
  head.inert = true;
  const undo = inertOutside(sheet as unknown as HTMLElement);
  assert.ok(inert(html).includes('scrim'), 'with nothing kept, the scrim goes too');
  undo();
  assert.deepEqual(inert(html), ['site-head']);
});

test('Tab wraps inside the layer, and Shift+Tab from the layer itself goes to its last control', () => {
  const focused: string[] = [];
  const control = (name: string) => ({ name, hasAttribute: () => false, focus: () => focused.push(name) });
  const [first, middle, last] = [control('first'), control('middle'), control('last')];
  const root = {
    name: 'sheet',
    querySelectorAll: () => [first, middle, last],
    contains: (node: unknown) => [first, middle, last, root].includes(node as typeof first)
  };
  const press = (shiftKey: boolean, active: unknown) => {
    (globalThis as { document?: unknown }).document = { activeElement: active };
    let prevented = false;
    keepTabIn(
      root as unknown as HTMLElement,
      {
        key: 'Tab',
        shiftKey,
        preventDefault: () => (prevented = true)
      } as unknown as KeyboardEvent
    );
    return prevented;
  };
  try {
    assert.equal(press(true, root), true);
    assert.equal(press(false, last), true);
    assert.equal(press(true, first), true);
    assert.equal(press(false, middle), false, 'between controls the browser moves focus');
    assert.deepEqual(focused, ['last', 'first', 'last']);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});
