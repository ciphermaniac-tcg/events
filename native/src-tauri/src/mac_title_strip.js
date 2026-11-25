// The title strip's page side (mac_title_strip.rs), called with the strip's
// height, the room the window's buttons take at its left, and the app's
// invoke. A press on the strip, not on one of its controls, moves the window,
// and a double click acts as a title bar's. The window draws over the page
// only while nothing but backgrounds sits where its buttons go.
((height, room, invoke) => {
  const CONTROLS =
    'a, button, input, select, textarea, label, summary, [role], ' +
    '[tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';
  const onStrip = event => {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    const head = target.closest('.site-head');
    if (head) {
      const control = target.closest(CONTROLS);
      return !control || !head.contains(control);
    }
    return target.tagName === 'DIALOG' && event.clientY < height;
  };
  const content = element =>
    element.matches(`img, svg, canvas, video, iframe, picture, ${CONTROLS}`) ||
    element.closest('svg') !== null ||
    [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');
  // The head bar, there to be the strip, and nothing of the page's in the buttons' room.
  const clear = () => {
    if (!document.querySelector('.site-head')) return false;
    for (let x = 1; x < room; x += 5) {
      for (let y = 1; y < height; y += 5) {
        const element = document.elementFromPoint(x, y);
        if (element && content(element)) return false;
      }
    }
    return true;
  };
  let pressed = null;
  document.addEventListener('mousedown', event => {
    if (event.button !== 0 || !onStrip(event)) return;
    if (event.detail === 2) {
      pressed = [event.clientX, event.clientY];
      return;
    }
    if (event.detail !== 1) return;
    event.preventDefault();
    invoke('plugin:window|start_dragging');
  });
  document.addEventListener('mouseup', event => {
    const at = pressed;
    pressed = null;
    if (event.button !== 0 || event.detail !== 2 || !at || !onStrip(event)) return;
    if (at[0] === event.clientX && at[1] === event.clientY) invoke('title_strip_double_click');
  });
  let shown = false;
  let queued = false;
  const check = () => {
    queued = false;
    const now = clear();
    if (now !== shown) {
      shown = now;
      invoke('title_strip', { on: now });
    }
  };
  const soon = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(check);
    }
  };
  const start = () => {
    soon();
    new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
    addEventListener('resize', soon);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
  return { onStrip, clear };
})
