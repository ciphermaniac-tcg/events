// The title strip's page side (mac_title_strip.rs), called with the strip's
// height and the app's invoke. A press on the strip, not on one of its
// controls, moves the window, and a double click acts as a title bar's.
((height, invoke) => {
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
  return { onStrip };
})
