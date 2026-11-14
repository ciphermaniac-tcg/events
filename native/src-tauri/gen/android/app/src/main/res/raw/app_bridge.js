// The site's side of the Android app (PageBridge.kt). It runs first on each
// of the site's pages, where `cmNative`, the channel to the activity, exists.
(() => {
  const channel = window.cmNative;
  if (window.top !== window || !channel || window.__cmBack) {
    return;
  }

  // Back closes these before it leaves the page: the site's dialogs, sheets
  // and popover menus, each of which closes on Escape.
  const LAYERS = 'dialog[open], [role="dialog"][aria-modal="true"], .tm-acct-menu, .tm-badge-list, .tm-menu-fixed';
  const last = list => list[list.length - 1];
  // A modal dialog sits above everything else; otherwise the latest layer is on top.
  const MODAL = CSS.supports('selector(:modal)') ? 'dialog:modal' : 'dialog[open]';
  const topLayer = () => last(document.querySelectorAll(MODAL)) ?? last(document.querySelectorAll(LAYERS));

  // Tells the activity whether back has something to do here.
  let sent = '';
  const report = () => {
    const state = JSON.stringify({ type: 'state', layer: Boolean(topLayer()), back: Boolean(window.navigation?.canGoBack) });
    if (state !== sent) {
      sent = state;
      channel.postMessage(state);
    }
  };
  let queued = false;
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        report();
      });
    }
  };

  // A dialog takes requestClose, as Escape would. The rest hear Escape where
  // focus is when it is in the layer, else at the layer, since a tap on plain
  // text leaves focus on the body.
  const close = layer => {
    if (layer instanceof HTMLDialogElement) {
      if (typeof layer.requestClose === 'function') {
        layer.requestClose();
      } else {
        layer.close();
      }
      return;
    }
    const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    const focused = document.activeElement;
    (focused && layer.contains(focused) ? focused : layer).dispatchEvent(escape);
  };

  // Closes the top layer; false when there was none, or nothing on the page changed.
  window.__cmBack = () => {
    const layer = topLayer();
    if (!layer) {
      return false;
    }
    const watch = new MutationObserver(() => undefined);
    watch.observe(document, { subtree: true, childList: true, attributes: true });
    close(layer);
    const changed = watch.takeRecords().length > 0;
    watch.disconnect();
    queue();
    return changed;
  };

  new MutationObserver(queue).observe(document, {
    subtree: true,
    childList: true,
    attributeFilter: ['open', 'role', 'aria-modal', 'class']
  });
  window.navigation?.addEventListener('currententrychange', queue);
  window.addEventListener('popstate', queue);
  window.addEventListener('pageshow', report);
  document.addEventListener('DOMContentLoaded', report);
})();
