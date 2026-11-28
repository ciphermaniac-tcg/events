// Audit probe (native/android-feel-audit only, never merged): records when
// the page first shows content and when it is usable, layout shifts, long
// tasks, input timing and font loads, for native/screens/feel.mjs to read.
(() => {
  if (window.top !== window || window.__feel) {
    return;
  }
  const feel = (window.__feel = { origin: performance.timeOrigin, marks: {}, shifts: [], long: [], events: [], fonts: [], lcp: 0, seenSkeleton: false, taps: [] });
  const mark = (name, at) => {
    if (!(name in feel.marks)) {
      feel.marks[name] = at;
    }
  };
  const check = at => {
    const main = document.querySelector('main.page');
    if (document.getElementById('root')?.childElementCount) {
      mark('root', at);
    }
    if (!main) {
      return;
    }
    if (main.querySelector('.skeleton')) {
      feel.seenSkeleton = true;
      mark('skeleton', at);
    }
    if (main.innerText.trim().length > 0) {
      mark('mainText', at);
    }
    const heading = main.querySelector('h1, h2');
    if (heading && heading.textContent.trim() && !main.querySelector('.skeleton')) {
      mark('usable', at);
    }
  };
  let queued = false;
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(at => {
        queued = false;
        check(at);
      });
    }
  };
  new MutationObserver(queue).observe(document, { subtree: true, childList: true, characterData: true });
  const observe = (type, take, extra = {}) => {
    try {
      new PerformanceObserver(list => list.getEntries().forEach(take)).observe({ type, buffered: true, ...extra });
    } catch (err) {
      feel[`no_${type}`] = String(err);
    }
  };
  observe('layout-shift', e => feel.shifts.push({ at: e.startTime, value: e.value, input: e.hadRecentInput }));
  observe('longtask', e => feel.long.push({ at: e.startTime, ms: e.duration }));
  observe('largest-contentful-paint', e => (feel.lcp = e.startTime));
  observe(
    'event',
    e =>
      feel.events.push({
        name: e.name,
        at: e.startTime,
        delay: e.processingStart - e.startTime,
        processing: e.processingEnd - e.processingStart,
        duration: e.duration
      }),
    { durationThreshold: 16 }
  );
  for (const name of ['pointerdown', 'pointerup', 'click', 'touchstart']) {
    addEventListener(name, e => feel.taps.push({ name, at: e.timeStamp }), { capture: true, passive: true });
  }
  addEventListener('popstate', e => (feel.popstate = e.timeStamp));
  document.fonts?.addEventListener('loadingdone', e =>
    feel.fonts.push({ at: performance.now(), faces: e.fontfaces.map(f => `${f.family} ${f.weight}`) })
  );
})();

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

  // Tells the activity whether back has something to do here, and the page's
  // address, tab included, to open again after Android ends the app.
  let sent = '';
  const report = () => {
    const state = JSON.stringify({
      type: 'state',
      layer: Boolean(topLayer()),
      back: Boolean(window.navigation?.canGoBack),
      url: location.href
    });
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
    document.documentElement?.classList.toggle('app-up', Boolean(row && here));
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

  // The page's scroll, kept as the app leaves the screen, comes back when the
  // same page opens again, as after Android ended the app, once the page is
  // tall enough and unless it has been touched first.
  const SCROLL_KEY = 'cm-app:scroll';
  let restoreTo = null;
  const keepScroll = () => {
    try {
      localStorage.setItem(SCROLL_KEY, JSON.stringify({ url: location.href, y: Math.round(scrollY) }));
    } catch {}
  };
  const restoreScroll = () => {
    if (restoreTo !== null && document.documentElement.scrollHeight - innerHeight >= restoreTo) {
      scrollTo(0, restoreTo);
      restoreTo = null;
    }
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && keepScroll());
  try {
    const kept = JSON.parse(localStorage.getItem(SCROLL_KEY) ?? 'null');
    restoreTo = kept?.url === location.href && kept.y > 0 ? kept.y : null;
  } catch {}
  for (const name of ['touchstart', 'wheel', 'keydown']) {
    addEventListener(name, () => (restoreTo = null), { capture: true, passive: true, once: true });
  }
  setTimeout(() => (restoreTo = null), 10000);

  let queued = false;
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        bar();
        report();
        showWhenReady();
        restoreScroll();
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

  // A link to the site while the app runs (MainActivity): the page's router
  // takes it as it takes a link in the page, with no new load; false when
  // this page isn't the site's app, such as the offline page.
  window.__cmOpen = href => {
    const url = new URL(href);
    if (url.origin !== location.origin || !document.getElementById('root')?.childElementCount) {
      return false;
    }
    const link = document.createElement('a');
    link.href = url.href;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    return true;
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
    restore();
    queue();
    return changed;
  };

  // The bar changes with the page, before it draws, so the trail and title
  // never draw a frame apart; the rest waits for the next frame.
  new MutationObserver(() => {
    bar();
    queue();
  }).observe(document, {
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

  // Dropdowns and date and time fields open Material 3 pickers (Pickers.kt)
  // in place of the webview's own old dialogs: the webview's is refused, as
  // a dropdown opens on the press and a date on the click, and the field's
  // choices go to the activity. The pick comes back as a person's would.
  const PICKED = 'select, input[type="date"], input[type="time"], input[type="datetime-local"]';
  let picking = null;
  const pickable = event => {
    const field = event.target instanceof Element ? event.target.closest(PICKED) : null;
    return field && !field.disabled && !field.matches('[readonly], [multiple]') ? field : null;
  };
  const ask = field => {
    picking = field;
    const options = field instanceof HTMLSelectElement ? [...field.options].filter(o => !o.disabled && !o.hidden) : [];
    post({
      type: 'pick',
      kind: field instanceof HTMLSelectElement ? 'select' : field.type,
      title: (field.labels?.[0]?.textContent ?? field.getAttribute('aria-label') ?? '').trim(),
      value: field.value,
      optional: !field.required,
      min: field.min ?? '',
      max: field.max ?? '',
      options: options.map(o => o.label),
      values: options.map(o => o.value),
      selected: options.findIndex(o => o.selected)
    });
  };
  document.addEventListener('mousedown', event => pickable(event) && event.preventDefault(), true);
  document.addEventListener(
    'click',
    event => {
      const field = pickable(event);
      if (field) {
        event.preventDefault();
        ask(field);
      }
    },
    true
  );
  window.__cmPicked = value => {
    const field = picking;
    picking = null;
    if (field && field.value !== value) {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

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
