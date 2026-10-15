/**
 * Keeping Tab inside a modal layer (a sheet or dialog marked aria-modal):
 * focus wraps from the last control to the first and back, and a Tab from
 * anywhere outside it, or from the layer itself, comes back in.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.hasAttribute('disabled'));
}

/** Handles a Tab keydown so focus stays within `root`; other keys pass through. */
export function keepTabIn(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') {
    return;
  }
  const nodes = focusableIn(root);
  const first = nodes[0];
  const last = nodes.at(-1);
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = !root.contains(active);
  if (event.shiftKey && (outside || active === first || active === root)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (outside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Makes the page outside a modal layer inert while it is open, so assistive
 * tech and pointers reach only the layer, as a native modal dialog's page
 * is; what the page adds beside it meanwhile goes inert too. `root` and its
 * ancestors stay live, as do `keep` (a scrim that closes the layer when
 * pressed). Answers the way to undo it, which leaves anything that was
 * already inert as it was.
 */
export function inertOutside(root: HTMLElement, keep: readonly Element[] = []): () => void {
  const path: Element[] = [];
  // Up to the body: its parent's children (the head among them) are left be.
  for (let node: HTMLElement = root; node.parentElement?.parentElement; node = node.parentElement) {
    path.push(node);
  }
  const parents = path.map(node => node.parentElement as HTMLElement);
  const made: HTMLElement[] = [];
  const hold = (node: Node) => {
    const element = node as HTMLElement;
    if (node.nodeType === Node.ELEMENT_NODE && !path.includes(element) && !keep.includes(element) && !element.inert) {
      element.inert = true;
      made.push(element);
    }
  };
  for (const parent of parents) {
    Array.from(parent.children).forEach(hold);
  }
  const added = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(hold)));
  parents.forEach(parent => added.observe(parent, { childList: true }));
  return () => {
    added.disconnect();
    for (const element of made) {
      element.inert = false;
    }
  };
}
