// The site's side of the Android app (PageBridge.kt). It runs first on each
// of the site's pages, where `cmNative`, the channel to the activity, exists.
(() => {
  const channel = window.cmNative;
  if (window.top !== window || !channel || window.__cmBack) {
    return;
  }

  // Back closes these before it leaves the page: the site's dialogs, sheets,
  // popover menus, info tips and suggestion lists, each of which closes on Escape.
  const LAYERS =
    'dialog[open], [role="dialog"][aria-modal="true"], .tm-acct-menu, .tm-badge-list, .tm-menu-fixed, .info-tip.open, .tl-list[popover]';
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
  // focus is when it is in the layer or is the field whose suggestions the
  // layer is, else at the layer, since a tap on plain text leaves focus on
  // the body.
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
    const owner =
      focused && (layer.contains(focused) || (layer.id && focused.getAttribute('aria-controls') === layer.id));
    (owner ? focused : layer).dispatchEvent(escape);
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

  // Files. A webview has neither Web Share nor downloads, so both go to the
  // activity, which opens the share sheet or the system's save dialog.
  const post = message => channel.postMessage(JSON.stringify(message));
  const encode = blob =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  const file = async (blob, name) => ({ name, mime: blob.type, data: await encode(blob) });

  const shareable = data =>
    Boolean(data) &&
    (data.files?.length > 0
      ? [...data.files].every(item => item instanceof File)
      : typeof data.text === 'string' || typeof data.url === 'string');
  if (typeof navigator.share !== 'function') {
    navigator.canShare = data => shareable(data);
    navigator.share = async (data = {}) => {
      if (!shareable(data)) {
        throw new TypeError('Nothing to share');
      }
      const files = await Promise.all([...(data.files ?? [])].map(item => file(item, item.name)));
      post({ type: 'share', files, title: data.title ?? '', text: [data.text, data.url].filter(Boolean).join('\n') });
    };
  }

  // A download is a link with `download` to a blob the page made, clicked in
  // the page or from script; the blob is kept from when its URL was made.
  const blobs = new Map();
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = object => {
    const url = createObjectURL.call(URL, object);
    if (object instanceof Blob) {
      blobs.set(url, object);
    }
    return url;
  };
  URL.revokeObjectURL = url => {
    blobs.delete(url);
    revokeObjectURL.call(URL, url);
  };
  const downloaded = link => (link.hasAttribute('download') ? blobs.get(link.href) : undefined);
  const save = (link, blob) => {
    void file(blob, link.download || 'download').then(item => post({ type: 'save', ...item }));
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const blob = downloaded(this);
    if (blob) {
      save(this, blob);
    } else {
      click.call(this);
    }
  };
  document.addEventListener(
    'click',
    event => {
      const link = event.target instanceof Element ? event.target.closest('a[download]') : null;
      const blob = link && downloaded(link);
      if (blob) {
        event.preventDefault();
        save(link, blob);
      }
    },
    true
  );
})();
