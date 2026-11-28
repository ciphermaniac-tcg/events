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

  // No pinch-zoom, as on an app's screen (MainActivity turns the webview's
  // off too), and so no zoom carried into the next load.
  document.addEventListener('DOMContentLoaded', () => {
    const viewport = document.querySelector('meta[name="viewport"]');
    viewport?.setAttribute('content', `${viewport.content}, maximum-scale=1, user-scalable=no`);
  });

  // Tells the activity whether back has something to do here.
  let sent = '';
  const report = () => {
    const state = JSON.stringify({ type: 'state', layer: Boolean(topLayer()), back: Boolean(window.navigation?.canGoBack) });
    if (state !== sent) {
      sent = state;
      channel.postMessage(state);
    }
  };
  // The head bar as a Material top app bar (material.rs): on a page with a
  // way back, its trail, a back arrow and the page's title. The arrow goes
  // where Back goes, and to the trail's page when there is no history, as a
  // page opened from a link has, rather than out of the app.
  const canGoBack = () => window.navigation?.canGoBack ?? history.length > 1;
  const up = () => {
    if (canGoBack()) {
      history.back();
    } else {
      document.querySelector('.tm-trail a')?.click();
    }
  };
  const barPart = (row, tag, className, before) => {
    let part = row.querySelector(`:scope > .${className}`);
    if (!part) {
      part = document.createElement(tag);
      part.className = className;
      row.insertBefore(part, before);
    }
    return part;
  };
  const bar = () => {
    const row = document.querySelector('.site-head-row');
    const here = document.querySelector('.tm-trail-here')?.textContent.trim();
    document.documentElement.classList.toggle('app-up', Boolean(row && here));
    if (!row || !here) {
      return;
    }
    const back = barPart(row, 'button', 'app-bar-back', row.firstChild);
    if (!back.firstChild) {
      back.type = 'button';
      back.setAttribute('aria-label', 'Back');
      back.innerHTML =
        '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
      back.addEventListener('click', up);
    }
    const title = barPart(row, 'span', 'app-bar-title', back.nextSibling);
    if (title.textContent !== here) {
      title.textContent = here;
    }
  };

  // The splash screen stays until the page has drawn real content, a heading
  // in the page and no skeleton (MainActivity): told once that has been
  // drawn, two frames on.
  let shown = false;
  const showWhenReady = () => {
    const main = document.querySelector('main.page');
    if (shown || !main?.querySelector('h1, h2')?.textContent.trim() || main.querySelector('.skeleton')) {
      return;
    }
    shown = true;
    requestAnimationFrame(() => requestAnimationFrame(() => channel.postMessage('{"type":"shown"}')));
  };

  let queued = false;
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        bar();
        report();
        showWhenReady();
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

  // Predictive back (BackNavigation.kt): as the gesture runs, the top sheet
  // or dialog shrinks toward the edge it rests on, as Material's do, and it
  // takes its size back when the gesture is let go or it closes.
  let shrunk = null;
  const restore = () => {
    shrunk?.style.removeProperty('scale');
    shrunk?.style.removeProperty('transform-origin');
    shrunk = null;
  };
  const edge = box =>
    box.top > 0 && box.bottom >= innerHeight - 1 ? 'bottom' : box.right >= innerWidth - 1 ? 'right' : 'center';
  window.__cmBackProgress = progress => {
    const layer = topLayer();
    const target = layer?.matches('dialog, [role="dialog"]') ? layer : null;
    if (shrunk !== target || progress <= 0) {
      restore();
    }
    if (target && progress > 0) {
      shrunk = target;
      target.style.transformOrigin = edge(target.getBoundingClientRect());
      target.style.scale = String(1 - 0.1 * Math.min(progress, 1));
    }
  };

  // A sheet from the bottom follows a drag down from its head, where its
  // handle is, and closes when let go past a quarter of its height or
  // flicked down; short of that it settles back.
  let drag = null;
  const slide = (sheet, from, to) =>
    sheet.animate([{ translate: `0 ${from}px` }, { translate: to }], {
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'forwards'
    });
  const release = event => {
    const { sheet, dy, at } = drag;
    drag = null;
    sheet.style.removeProperty('translate');
    if (dy === 0) {
      return;
    }
    const flicked = dy > 24 && dy / Math.max(1, event.timeStamp - at) > 0.5;
    if (event.type !== 'touchend' || (!flicked && dy < sheet.offsetHeight / 4)) {
      slide(sheet, dy, '0 0').finished.then(run => run.cancel(), () => undefined);
      return;
    }
    const away = slide(sheet, dy, '0 100%');
    void away.finished.then(() => {
      close(sheet);
      requestAnimationFrame(() => sheet.isConnected && away.cancel());
    });
  };
  document.addEventListener(
    'touchstart',
    event => {
      const head = event.target instanceof Element ? event.target.closest('.tm-sheet-head') : null;
      drag =
        head && innerWidth <= 640 && event.touches.length === 1
          ? { sheet: head.parentElement, y: event.touches[0].clientY, at: event.timeStamp, dy: 0 }
          : null;
    },
    { passive: true }
  );
  document.addEventListener(
    'touchmove',
    event => {
      if (drag) {
        drag.dy = Math.max(0, event.touches[0].clientY - drag.y);
        drag.sheet.style.translate = `0 ${drag.dy}px`;
      }
    },
    { passive: true }
  );
  document.addEventListener('touchend', event => drag && release(event));
  document.addEventListener('touchcancel', event => drag && release(event));

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
    restore();
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
  window.addEventListener('pageshow', queue);
  document.addEventListener('DOMContentLoaded', queue);

  // Files. A webview has neither Web Share nor downloads, so both go to the
  // activity, which opens the share sheet or the system's save dialog.
  const post = message => channel.postMessage(JSON.stringify(message));

  // A sign-in or sign-out the page makes with a call of its own rather than
  // a page load: the activity writes the cookies it set to disk at once.
  const fetchFirst = window.fetch;
  const isSignIn = input => {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      return url.origin === location.origin && url.pathname.startsWith('/api/auth/');
    } catch {
      return false;
    }
  };
  window.fetch = (input, init) => {
    const answer = fetchFirst.call(window, input, init);
    if (isSignIn(input)) {
      void answer.then(() => post({ type: 'cookies' }), () => undefined);
    }
    return answer;
  };
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
