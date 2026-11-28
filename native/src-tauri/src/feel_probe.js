// Audit probe (native/mac-feel-audit only, never merged): records when the
// page first shows content and when it is usable, its requests, taps,
// route changes, frames and theme changes, and reports them to feel.rs.
(() => {
  if (window.top !== window || window.__feel) {
    return;
  }
  const origin = performance.timeOrigin;
  const epoch = at => Math.round((origin + at) * 10) / 10;
  const send = (tag, value) => {
    try {
      window.__TAURI_INTERNALS__.invoke('feel_note', { line: `${tag} ${JSON.stringify(value)}` });
    } catch (err) {
      setTimeout(() => send(tag, value), 50);
    }
  };
  const feel = (window.__feel = { marks: {}, taps: [], routes: [], theme: [], resizes: [], send });
  const mark = (name, at) => {
    if (!(name in feel.marks)) {
      feel.marks[name] = epoch(at);
    }
  };
  let lastChange = 0;
  const state = () => {
    const main = document.querySelector('main.page');
    if (!main) {
      return { main: false };
    }
    const heading = main.querySelector('h1, h2');
    return {
      main: true,
      skeleton: Boolean(main.querySelector('.skeleton')),
      text: main.innerText.trim().length > 0,
      heading: Boolean(heading && heading.textContent.trim())
    };
  };
  const check = at => {
    lastChange = at;
    if (document.getElementById('root')?.childElementCount) {
      mark('root', at);
    }
    const s = state();
    if (!s.main) {
      return;
    }
    if (s.skeleton) {
      mark('skeleton', at);
    }
    if (s.text) {
      mark('mainText', at);
    }
    if (s.heading && !s.skeleton) {
      mark('usable', at);
    }
    for (const list of [feel.taps, feel.routes]) {
      const open = list[list.length - 1];
      if (open && !open.done) {
        open.firstFrame ??= epoch(at);
        open.lastFrame = epoch(at);
        if (s.skeleton) {
          open.skeleton = true;
        }
        if (s.heading && !s.skeleton) {
          open.usable ??= epoch(at);
        }
      }
    }
  };
  let queued = false;
  new MutationObserver(() => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(at => {
        queued = false;
        check(at);
      });
    }
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.name === 'first-contentful-paint') {
          feel.marks.fcp = epoch(e.startTime);
        }
      }
    }).observe({ type: 'paint', buffered: true });
  } catch (err) {
    feel.noPaint = String(err);
  }
  const close = (list, tag) => {
    const open = list[list.length - 1];
    if (open && !open.done) {
      open.done = true;
      send(tag, open);
    }
  };
  for (const name of ['pointerdown', 'mousedown', 'keydown']) {
    addEventListener(
      name,
      e => {
        if (name === 'mousedown' && feel.taps.length && !feel.taps[feel.taps.length - 1].done && feel.taps[feel.taps.length - 1].kind === 'pointerdown') {
          return;
        }
        close(feel.taps, 'tap');
        feel.taps.push({ kind: name, key: e.key, at: epoch(e.timeStamp), handled: epoch(performance.now()), target: e.target?.closest?.('[role], a, button')?.textContent?.trim().slice(0, 40) });
        requestAnimationFrame(at => {
          const open = feel.taps[feel.taps.length - 1];
          open.nextFrame ??= epoch(at);
        });
      },
      { capture: true, passive: true }
    );
  }
  const routeChange = kind => {
    close(feel.routes, 'route');
    feel.routes.push({ kind, at: epoch(performance.now()), path: location.pathname + location.search });
  };
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name].bind(history);
    history[name] = (...args) => {
      const before = location.href;
      const result = original(...args);
      if (location.href !== before) {
        routeChange(name);
      }
      return result;
    };
  }
  addEventListener('popstate', () => routeChange('popstate'));
  const dark = matchMedia('(prefers-color-scheme: dark)');
  dark.addEventListener('change', () => {
    const at = performance.now();
    requestAnimationFrame(frame => feel.theme.push({ media: dark.matches, at: epoch(at), frame: epoch(frame), mode: document.body?.dataset.mode }));
  });
  addEventListener('resize', () => {
    const at = performance.now();
    requestAnimationFrame(frame => feel.resizes.push({ w: innerWidth, h: innerHeight, at: epoch(at), frame: epoch(frame) }));
  });
  // Settles a tap or route: done once nothing has changed for 400 ms.
  setInterval(() => {
    const quiet = performance.now() - lastChange > 400;
    for (const [list, tag] of [[feel.taps, 'tap'], [feel.routes, 'route']]) {
      const open = list[list.length - 1];
      if (open && !open.done && quiet && performance.now() - (open.at - origin) > 600) {
        close(list, tag);
      }
    }
  }, 100);
  const navigation = () => {
    const n = performance.getEntriesByType('navigation')[0];
    if (!n) {
      return null;
    }
    const keys = ['fetchStart', 'domainLookupStart', 'domainLookupEnd', 'connectStart', 'secureConnectionStart', 'connectEnd', 'requestStart', 'responseStart', 'responseEnd', 'domInteractive', 'domContentLoadedEventEnd', 'loadEventEnd'];
    const out = { type: n.type, protocol: n.nextHopProtocol, transfer: n.transferSize, body: n.encodedBodySize };
    for (const key of keys) {
      out[key] = n[key] ? epoch(n[key]) : 0;
    }
    return out;
  };
  const resources = () =>
    performance.getEntriesByType('resource').map(r => ({
      name: r.name.replace(location.origin, '').slice(0, 90),
      type: r.initiatorType,
      start: epoch(r.startTime),
      end: epoch(r.responseEnd),
      transfer: r.transferSize,
      body: r.encodedBodySize,
      protocol: r.nextHopProtocol
    }));
  feel.report = () => ({
    url: location.pathname + location.search,
    origin: epoch(0),
    marks: feel.marks,
    nav: navigation(),
    resources: resources(),
    state: state(),
    title: document.title,
    mode: document.body?.dataset.mode,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    noPaint: feel.noPaint
  });
  // The load report: 1.5 s after the page is usable, or at 15 s.
  const started = performance.now();
  const timer = setInterval(() => {
    const usable = feel.marks.usable;
    if ((usable && Date.now() - usable > 1500) || performance.now() - started > 15000) {
      clearInterval(timer);
      send('load', feel.report());
    }
  }, 100);
  // Element geometry, for the driver's real clicks.
  feel.rect = (selector, index = 0) => {
    const el = [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length)[index];
    if (!el) {
      return null;
    }
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, text: el.textContent.trim().slice(0, 40), vw: innerWidth, vh: innerHeight };
  };
  // Frames for `ms`: the gaps between animation frames and the scroll position.
  feel.frames = ms =>
    new Promise(resolve => {
      const times = [];
      const scrolls = [];
      const begin = performance.now();
      const step = at => {
        times.push(at);
        scrolls.push(Math.round(document.scrollingElement.scrollTop));
        if (at - begin < ms) {
          requestAnimationFrame(step);
        } else {
          const gaps = times.slice(1).map((t, i) => t - times[i]);
          gaps.sort((a, b) => a - b);
          resolve({
            frames: times.length,
            p50: gaps[Math.floor(gaps.length / 2)],
            p95: gaps[Math.floor(gaps.length * 0.95)],
            max: gaps[gaps.length - 1],
            over25: gaps.filter(g => g > 25).length,
            over50: gaps.filter(g => g > 50).length,
            start: epoch(times[0]),
            scrollFrom: scrolls[0],
            scrollTo: scrolls[scrolls.length - 1],
            scrollChanges: scrolls.filter((s, i) => i && s !== scrolls[i - 1]).length
          });
        }
      };
      requestAnimationFrame(step);
    });
  // Runs `fn` and reports what it returns (or throws) under `tag`.
  feel.run = (tag, fn) => {
    Promise.resolve()
      .then(fn)
      .then(
        value => send(tag, value ?? null),
        err => send(tag, { error: String(err) })
      );
  };
})();
