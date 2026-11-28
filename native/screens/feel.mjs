// The feel audit's driver (native/android-feel-audit only, never merged).
// Measures the Android app on a running emulator: cold, warm and hot starts,
// taps to the next screen, Back, full reloads, scrolling, input timing, the
// webview's tells (selection, zoom, focus, keyboard, pickers, overscroll),
// state after the process is killed, offline and throttled loads, and what
// each launch downloads. The page side is the probe at the top of
// res/raw/app_bridge.js; the activity logs "Feel" lines (MainActivity.kt).
// Usage: node feel.mjs local <out> <small-code> <big-code>
//        node feel.mjs live <out> <event-code>
// Writes <out>/feel-<mode>.json, screenshots and screen recordings.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [mode, out, ...codes] = process.argv.slice(2);
const local = mode === 'local';
const site = process.env.FEEL_SITE ?? (local ? 'http://localhost:4600' : 'https://events.ciphermaniac.com');
const pkg = 'com.ciphermaniac.events.debug';
const activity = `${pkg}/com.ciphermaniac.events.MainActivity`;
const port = 9223;
mkdirSync(out, { recursive: true });

const results = { mode, site, runs: {}, errors: [] };
const save = () => writeFileSync(`${out}/feel-${mode}.json`, JSON.stringify(results, null, 1));
const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 90000 });
const shell = command => adb('shell', command);
const tryShell = command => {
  try {
    return shell(command);
  } catch (err) {
    return `ERR ${err.message}`;
  }
};
/** The device's clock in epoch ms from a `date +%s%N` line, or the runner's when the device can't say. */
const epoch = line => {
  const ms = Number(line.trim()) / 1e6;
  if (Number.isFinite(ms) && ms > 1e12) {
    return ms;
  }
  results.errors.push(`device clock unreadable: ${line}`);
  return Date.now();
};
const shot = name =>
  writeFileSync(
    `${out}/feel-${mode}-${name}.png`,
    execFileSync('adb', ['exec-out', 'screencap', '-p'], { timeout: 30000 })
  );

/** Starts a screen recording; the returned function stops it and pulls the file. */
async function record(name, seconds) {
  const file = `/sdcard/feel-${name}.mp4`;
  const child = spawn('adb', ['shell', 'screenrecord', '--time-limit', String(seconds), '--bit-rate', '8000000', file]);
  await sleep(900);
  return async () => {
    await Promise.race([
      new Promise(resolve => {
        child.on('exit', resolve);
      }),
      sleep((seconds + 10) * 1000)
    ]);
    await sleep(500);
    try {
      adb('pull', file, `${out}/feel-${mode}-${name}.mp4`);
    } catch (err) {
      results.errors.push(`record ${name}: ${err.message}`);
    }
  };
}

// ---------------------------------------------------------------- DevTools

let socket = null;
let nextId = 1;
const waiting = new Map();

function close() {
  try {
    socket?.close();
  } catch {
    /* gone already */
  }
  socket = null;
}

function pid() {
  return tryShell(`pidof ${pkg}`).trim();
}

/** Opens a DevTools socket; a socket that closes later forgets itself only if it is still the current one. */
async function open(url) {
  const ws = new WebSocket(url);
  await Promise.race([
    new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('socket error')), { once: true });
    }),
    sleep(5000).then(() => {
      throw new Error('socket did not open');
    })
  ]);
  ws.addEventListener('message', message => {
    const data = JSON.parse(String(message.data));
    if (data.id && waiting.has(data.id)) {
      waiting.get(data.id)(data);
      waiting.delete(data.id);
    }
  });
  ws.addEventListener('close', () => {
    if (socket === ws) {
      socket = null;
    }
  });
  return ws;
}

async function connect(limitMs = 30000) {
  close();
  const deadline = Date.now() + limitMs;
  let why = 'no process';
  while (Date.now() < deadline) {
    const id = pid();
    if (id && !id.startsWith('ERR') && tryShell('cat /proc/net/unix').includes(`webview_devtools_remote_${id}`)) {
      try {
        try {
          adb('forward', '--remove', `tcp:${port}`);
        } catch {
          /* none yet */
        }
        adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${id}`);
        const pages = await (
          await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })
        ).json();
        const target = pages.find(item => item.type === 'page' && /^(https?|data):/.test(item.url));
        if (target) {
          socket = await open(target.webSocketDebuggerUrl);
          log('connected', id, target.url.slice(0, 80));
          return true;
        }
        why = `targets ${JSON.stringify(pages.map(item => [item.type, item.url.slice(0, 50)]))}`;
      } catch (err) {
        why = err.message;
        close();
      }
    }
    await sleep(150);
  }
  throw new Error(`no DevTools connection: ${why}`);
}

function send(method, params = {}, limitMs = 8000) {
  if (!socket) {
    return Promise.reject(new Error('not connected'));
  }
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return Promise.race([
    new Promise(resolve => {
      waiting.set(id, resolve);
    }),
    sleep(limitMs).then(() => {
      throw new Error(`${method} timed out`);
    })
  ]);
}

async function evaluate(expression) {
  const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (answer.result?.exceptionDetails) {
    throw new Error(answer.result.exceptionDetails.exception?.description ?? 'page error');
  }
  return answer.result?.result?.value;
}

/**
 * Evaluates, retrying while a page loads, on the same connection so that
 * network emulation stays on; reconnects only when the socket is gone.
 */
async function page(expression, limitMs = 20000) {
  const deadline = Date.now() + limitMs;
  let last = null;
  let timeouts = 0;
  while (Date.now() < deadline) {
    try {
      if (!socket) {
        await connect(Math.max(1000, deadline - Date.now()));
      }
      return await evaluate(expression);
    } catch (err) {
      last = err;
      // A socket that stops answering is dead: a fresh one finds the live page.
      if (/timed out/.test(err.message) && ++timeouts >= 2) {
        log('page: no answer, reconnecting');
        close();
        timeouts = 0;
      }
      await sleep(150);
    }
  }
  throw last ?? new Error('page: out of time');
}

async function until(expression, limitMs = 30000) {
  const end = Date.now() + limitMs;
  while (Date.now() < end) {
    try {
      if (await page(`Boolean(${expression})`, Math.max(500, end - Date.now()))) {
        return true;
      }
    } catch {
      /* page still loading */
    }
    await sleep(100);
  }
  return false;
}

// ---------------------------------------------------------------- Readings

const READ = `(() => {
  const f = window.__feel || {};
  const nav = performance.getEntriesByType('navigation')[0];
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, p.startTime]));
  const res = performance.getEntriesByType('resource').map(r => ({
    n: r.name.replace(location.origin, ''), t: r.initiatorType, start: Math.round(r.startTime),
    end: Math.round(r.responseEnd), tx: r.transferSize, enc: r.encodedBodySize, dec: r.decodedBodySize
  }));
  return {
    url: location.href, origin: performance.timeOrigin, now: performance.now(),
    nav: nav && { type: nav.type, redirectEnd: nav.redirectEnd, dns: nav.domainLookupEnd - nav.domainLookupStart,
      connect: nav.connectEnd - nav.connectStart, requestStart: nav.requestStart, responseStart: nav.responseStart,
      responseEnd: nav.responseEnd, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, tx: nav.transferSize,
      enc: nav.encodedBodySize },
    paint, lcp: f.lcp, marks: f.marks, seenSkeleton: f.seenSkeleton,
    cls: (f.shifts || []).filter(s => !s.input).reduce((a, s) => a + s.value, 0), shifts: f.shifts,
    long: f.long, fonts: f.fonts, events: f.events, res,
    sw: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
    font: getComputedStyle(document.body).fontFamily, fontsLoaded: [...document.fonts].filter(x => x.status === 'loaded').map(x => x.family + ' ' + x.weight),
    imgs: [...document.images].map(i => ({ src: i.currentSrc.slice(-60), w: i.getAttribute('width'), h: i.getAttribute('height'), done: i.complete })),
    scrollY, ua: navigator.userAgent
  };
})()`;

/** The activity's own timing lines since the log was cleared, as epoch ms by name. */
function feelLog() {
  const lines = tryShell('logcat -d -s Feel:I');
  const marks = {};
  for (const match of lines.matchAll(/Feel\s*:\s*(\w+) (\d+)/g)) {
    marks[match[1]] ??= Number(match[2]);
  }
  return marks;
}

/** The app process's start, in epoch ms (10 ms steps). */
function processStart() {
  const id = pid();
  const answer = tryShell(`cat /proc/${id}/stat; cat /proc/uptime; date +%s%N`).trim().split('\n');
  const start = Number(answer[0].split(') ')[1].split(' ')[19]);
  const uptime = Number(answer[1].split(' ')[0]);
  const now = epoch(answer[2]);
  return now - uptime * 1000 + start * 10;
}

function amTimes(text) {
  const pick = key => Number(new RegExp(`${key}: (\\d+)`).exec(text)?.[1] ?? NaN);
  return { state: /LaunchState: (\w+)/.exec(text)?.[1], total: pick('TotalTime'), wait: pick('WaitTime') };
}

/** Starts the app (cold when `stop`), then waits until the page is usable and reads it. */
/**
 * Ends the app as a person's phone would: it leaves the screen first (so its
 * cookies are written, MainActivity.onStop), then its process is stopped.
 */
async function stopApp() {
  if (pid()) {
    shell('input keyevent KEYCODE_HOME');
    await sleep(1200);
  }
  shell(`am force-stop ${pkg}`);
  await sleep(500);
}

async function launch({ stop = true, link = null, wait = 'window.__feel?.marks?.usable', prepared = false } = {}) {
  if (stop && !prepared) {
    await stopApp();
  }
  shell('logcat -c');
  const target = link ? `-a android.intent.action.VIEW -d ${site}${link} ` : '';
  const answer = shell(`date +%s%N; am start -W ${target}-n ${activity}`);
  const t0 = epoch(answer.split('\n')[0]);
  const am = amTimes(answer);
  let proc = null;
  try {
    proc = processStart() - t0;
  } catch {
    /* no process */
  }
  await connect();
  const ok = await until(wait, 20000);
  log('launch', link ?? '', am.state, am.total, ok ? 'usable' : 'not usable');
  await sleep(1200);
  const read = await page(READ);
  const native = Object.fromEntries(Object.entries(feelLog()).map(([k, v]) => [k, Math.round(v - t0)]));
  const fromTap = at => (at == null ? null : Math.round(read.origin + at - t0));
  return {
    ok,
    am,
    proc: proc == null ? null : Math.round(proc),
    native,
    navStart: Math.round(read.origin - t0),
    htmlStart: fromTap(read.nav?.responseStart),
    htmlEnd: fromTap(read.nav?.responseEnd),
    fcp: fromTap(read.paint['first-contentful-paint']),
    lcp: fromTap(read.lcp || null),
    mainText: fromTap(read.marks?.mainText),
    usable: fromTap(read.marks?.usable),
    dcl: fromTap(read.nav?.dcl),
    read
  };
}

const median = list => {
  const sorted = list.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};

function summary(trials, keys = ['proc', 'navStart', 'htmlEnd', 'fcp', 'mainText', 'usable', 'lcp']) {
  const out = { n: trials.length, am: median(trials.map(t => t.am.total)) };
  for (const key of keys) {
    out[key] = median(trials.map(t => t[key]));
  }
  for (const key of ['create', 'webView', 'pageStarted', 'pageFinished', 'shown']) {
    out[key] = median(trials.map(t => t.native?.[key]));
  }
  return out;
}

function payload(read) {
  const list = read.res;
  const sum = (items, key) => items.reduce((a, r) => a + (r[key] || 0), 0);
  const cached = list.filter(r => r.tx === 0 && r.dec > 0);
  return {
    html: read.nav?.tx,
    count: list.length,
    transfer: sum(list, 'tx'),
    encoded: sum(list, 'enc'),
    decoded: sum(list, 'dec'),
    cachedCount: cached.length,
    fromNetwork: list.filter(r => r.tx > 0).length,
    byType: Object.entries(Object.groupBy(list, r => r.t)).map(([t, items]) => ({
      t,
      n: items.length,
      tx: sum(items, 'tx'),
      enc: sum(items, 'enc')
    })),
    list
  };
}

// ---------------------------------------------------------------- Taps

async function webviewTop() {
  const xml = tryShell('uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml');
  const match = /class="android\.webkit\.WebView"[^>]*bounds="\[\d+,(\d+)\]/.exec(xml);
  return match ? Number(match[1]) : 0;
}

let top = null;
async function point(selectorOrExpr) {
  const expr = selectorOrExpr.startsWith('(')
    ? selectorOrExpr
    : `document.querySelector(${JSON.stringify(selectorOrExpr)})`;
  const rect = await page(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, devicePixelRatio]; })()`);
  if (!rect) {
    throw new Error(`nothing at ${selectorOrExpr}`);
  }
  top ??= await webviewTop();
  return [Math.round(rect[0] * rect[2]), Math.round(rect[1] * rect[2] + top)];
}

async function tap(selector) {
  const [x, y] = await point(selector);
  shell(`input tap ${x} ${y}`);
}

/** Watches each frame for `pred`, from now; `done` is the first frame it holds. */
const WATCH =
  pred => `(() => { const w = window.__feelW = { start: performance.now(), done: null, skeleton: false, blankMain: false };
  const pred = () => { try { return Boolean(${pred}); } catch { return false; } };
  const tick = at => { const main = document.querySelector('main.page');
    if (main?.querySelector('.skeleton')) w.skeleton = true;
    if (main && !main.innerText.trim()) w.blankMain = true;
    if (pred()) { w.done = at; return; }
    if (at - w.start < 20000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick); return true; })()`;

/** Taps `selector` and times the pointerdown to the first frame where `pred` holds. */
async function timedTap(selector, pred) {
  await page(WATCH(pred));
  await tap(selector);
  await until('window.__feelW?.done', 20000);
  const w =
    await page(`(() => { const w = window.__feelW; const down = (window.__feel.taps || []).find(t => t.name === 'pointerdown' && t.at >= w.start);
    const up = (window.__feel.taps || []).find(t => t.name === 'pointerup' && t.at >= w.start);
    const click = (window.__feel.taps || []).find(t => t.name === 'click' && t.at >= w.start);
    const ev = (window.__feel.events || []).filter(e => e.at >= w.start - 1);
    return { ms: down && w.done ? w.done - down.at : null, upToClick: up && click ? click.at - up.at : null,
      skeleton: w.skeleton, blankMain: w.blankMain, events: ev, path: location.pathname + location.search }; })()`);
  return w;
}

/** Presses Back and times the page's first sight of it to the first frame where `pred` holds. */
async function timedBack(pred) {
  await page(
    `(() => { const o = window.__cmBack; if (!o.__feel) { window.__cmBack = () => { window.__feel.backAt = performance.now(); return o(); }; window.__cmBack.__feel = true; } window.__feel.backAt = null; return true; })()`
  );
  await page(WATCH(pred));
  shell('input keyevent KEYCODE_BACK');
  await until('window.__feelW?.done', 20000);
  return page(`(() => { const w = window.__feelW; return { ms: w.done && window.__feel.backAt ? w.done - window.__feel.backAt : null,
    popstateAfterBack: window.__feel.popstate && window.__feel.backAt ? window.__feel.popstate - window.__feel.backAt : null,
    skeleton: w.skeleton, blankMain: w.blankMain, path: location.pathname + location.search }; })()`);
}

/** A full page load started from the page (reload or address), timed from the call to usable in the new page. */
async function timedLoad(start, name) {
  const stop = name ? await record(name, 6) : null;
  const t0 = await page(
    `(() => { const t = performance.timeOrigin + performance.now(); setTimeout(() => { ${start} }, 0); return t; })()`
  );
  await sleep(300);
  await until(`window.__feel?.marks?.usable && performance.timeOrigin > ${t0}`, 60000);
  await sleep(800);
  const read = await page(READ);
  await stop?.();
  const rel = at => (at == null ? null : Math.round(read.origin + at - t0));
  return {
    unload: Math.round(read.origin - t0),
    htmlEnd: rel(read.nav?.responseEnd),
    fcp: rel(read.paint['first-contentful-paint']),
    usable: rel(read.marks?.usable),
    skeleton: read.seenSkeleton,
    cls: read.cls,
    payload: payload(read)
  };
}

// ---------------------------------------------------------------- Scenarios

async function step(name, run, limitMs = 360000) {
  log('step', name);
  try {
    results.runs[name] = await Promise.race([
      run(),
      sleep(limitMs).then(() => {
        throw new Error(`${name} ran out of time`);
      })
    ]);
  } catch (err) {
    results.errors.push(`${name}: ${err.stack || err.message}`);
    log('FAILED', name, err.message);
  }
  save();
}

const usableAt = path =>
  `location.pathname + location.search === ${JSON.stringify(path)} && window.__feel?.marks?.usable`;
const noSkeleton = `!document.querySelector('main.page .skeleton')`;
const rows = `document.querySelectorAll('main.page tbody tr, main.page [role=row]').length > 5`;
const tabByText = text =>
  `([...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === ${JSON.stringify(text)} && t.getClientRects().length))`;

async function starts(prefix, link) {
  // The page to reopen: launch on it once, so every cold start after opens there.
  await launch({ link });
  const cold = [];
  for (let i = 0; i < 5; i++) {
    cold.push(await launch());
    await sleep(1000);
  }
  results.runs[`${prefix}cold`] = {
    summary: summary(cold),
    trials: cold.map(({ read, ...rest }) => ({ ...rest, payload: payload(read) }))
  };
  save();
  const hot = [];
  for (let i = 0; i < 3; i++) {
    shell('input keyevent KEYCODE_HOME');
    await sleep(1500);
    const answer = shell(`am start -W -n ${activity}`);
    hot.push(amTimes(answer));
    await sleep(1000);
  }
  results.runs[`${prefix}hot`] = hot;
  save();
}

async function firstLaunch(link) {
  shell(`am force-stop ${pkg}`);
  shell(`pm clear ${pkg}`);
  const stop = await record('first-launch', 14);
  const first = await launch({
    prepared: true,
    link,
    wait: local ? `document.body?.innerText.includes('Willow Creek Cup')` : 'window.__feel?.marks?.usable'
  });
  await stop();
  return {
    ...first,
    read: undefined,
    payload: payload(first.read),
    font: first.read.font,
    fontsLoaded: first.read.fontsLoaded,
    ua: first.read.ua
  };
}

/** Flings down and up the screen, and reads `app`'s frame times for it from gfxinfo. */
async function flings(app, name) {
  shell(`dumpsys gfxinfo ${app} reset`);
  for (const [from, to, ms, pause] of [
    ...Array(4).fill([1900, 700, 120, 1100]),
    ...Array(2).fill([1600, 900, 700, 500]),
    ...Array(4).fill([700, 1900, 120, 1100])
  ]) {
    shell(`input swipe 540 ${from} 540 ${to} ${ms}`);
    await sleep(pause);
  }
  const gfx = shell(`dumpsys gfxinfo ${app}`);
  writeFileSync(`${out}/feel-${mode}-gfxinfo-${name}.txt`, gfx);
  const grab = key => new RegExp(`${key}: ([^\\n]+)`).exec(gfx)?.[1]?.trim();
  const keys = {
    total: 'Total frames rendered',
    janky: 'Janky frames',
    p50: '50th percentile',
    p90: '90th percentile',
    p95: '95th percentile',
    p99: '99th percentile',
    missedVsync: 'Number Missed Vsync',
    slowUi: 'Number Slow UI thread',
    slowDraw: 'Number Slow issue draw commands'
  };
  return Object.fromEntries(Object.entries(keys).map(([key, label]) => [key, grab(label)]));
}

async function scroll(name) {
  await page(`(() => { window.scrollTo(0, 0); const f = window.__feelFrames = []; const end = performance.now() + 14000;
    const tick = at => { f.push(at); if (at < end) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`);
  const gfx = await flings(pkg, name);
  const raf = await page(`(() => { const f = window.__feelFrames; const d = f.slice(1).map((t, i) => t - f[i]);
    return { frames: f.length, over20: d.filter(x => x > 20).length, over34: d.filter(x => x > 34).length, worst: Math.max(...d) }; })()`);
  return { ...gfx, raf };
}

async function longPress(selector, name) {
  const [x, y] = await point(selector);
  shell(`input swipe ${x} ${y} ${x} ${y} 900`);
  await sleep(1300);
  shot(name);
  const selected = await page('String(getSelection())');
  await page('getSelection().removeAllRanges(), true');
  await sleep(400);
  return { selected };
}

async function keyboard() {
  await page(`(() => { const field = document.querySelector('#add-first'); field.scrollIntoView({ block: 'center' });
    const s = window.__feelKb = { samples: [], resizes: [] }; addEventListener('resize', () => s.resizes.push(performance.now()));
    const end = performance.now() + 3000;
    const tick = at => { const r = field.getBoundingClientRect(); s.samples.push([Math.round(at), innerHeight, Math.round(visualViewport.height), Math.round(r.top), Math.round(scrollY)]);
      if (at < end) requestAnimationFrame(tick); };
    requestAnimationFrame(tick); return true; })()`);
  const stop = await record('keyboard', 5);
  await tap('#add-first');
  await sleep(3200);
  shot('keyboard');
  await stop();
  const kb = await page('window.__feelKb');
  const changes = kb.samples.filter(
    (s, i) => i === 0 || s[1] !== kb.samples[i - 1][1] || s[3] !== kb.samples[i - 1][3]
  );
  shell('input keyevent KEYCODE_BACK');
  await sleep(800);
  return { changes, resizes: kb.resizes.length, imeShown: /mInputShown=true/.test(tryShell('dumpsys input_method')) };
}

async function tells() {
  const css = await page(`(() => { const cs = el => el && getComputedStyle(el);
    const td = document.querySelector('main.page tbody td'); const tab = document.querySelector('[role=tab]');
    return { viewport: document.querySelector('meta[name=viewport]')?.content,
      rootTapHighlight: cs(document.documentElement).webkitTapHighlightColor, bodySelect: cs(document.body).userSelect,
      cellSelect: cs(td)?.userSelect, tabSelect: cs(tab)?.userSelect, touchCallout: cs(document.querySelector('a'))?.webkitTouchCallout,
      overscrollRoot: cs(document.documentElement).overscrollBehaviorY, overscrollBody: cs(document.body).overscrollBehaviorY,
      touchAction: cs(document.documentElement).touchAction, fontFamily: cs(document.body).fontFamily,
      inApp: document.documentElement.classList.contains('in-app'), scale: visualViewport.scale,
      viewTransitions: typeof document.startViewTransition === 'function',
      speculation: HTMLScriptElement.supports?.('speculationrules') ?? false, navigationApi: 'navigation' in window }; })()`);
  const out2 = { css };
  out2.pressHeading = await longPress('main.page h1', 'longpress-heading');
  out2.pressCell = await longPress('main.page tbody td:nth-child(2)', 'longpress-cell');
  out2.pressTab = await longPress(tabByText('Pairings'), 'longpress-tab');
  out2.pressLink = await longPress('a[href="/"]', 'longpress-link');
  // Zoom: a double tap and a pinch.
  const [cx, cy] = await page(
    `(() => { const r = document.querySelector('main.page h1').getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`
  );
  out2.doubleTap = await send('Input.synthesizeTapGesture', {
    x: cx,
    y: cy,
    tapCount: 2,
    gestureSourceType: 'touch'
  }).then(
    r => r.error?.message ?? 'sent',
    e => e.message
  );
  await sleep(800);
  out2.scaleAfterDoubleTap = await page('visualViewport.scale');
  out2.pinch = await send('Input.synthesizePinchGesture', {
    x: 200,
    y: 400,
    scaleFactor: 2,
    relativeSpeed: 600,
    gestureSourceType: 'touch'
  }).then(
    r => r.error?.message ?? 'sent',
    e => e.message
  );
  await sleep(800);
  out2.scaleAfterPinch = await page('visualViewport.scale');
  shot('pinch');
  await timedLoad('location.reload()', null);
  await sleep(800);
  // Overscroll at the top, as a pull to refresh would start.
  await page('window.scrollTo(0, 0), true');
  await sleep(400);
  shell('input motionevent DOWN 540 700');
  for (const dy of [100, 250, 400, 550]) {
    shell(`input motionevent MOVE 540 ${700 + dy}`);
  }
  await sleep(300);
  shot('overscroll-top');
  shell('input motionevent UP 540 1250');
  await sleep(600);
  out2.afterPull = await page('location.pathname + location.search');
  return out2;
}

async function focusRing() {
  await tap(tabByText('Standings'));
  await sleep(700);
  shot('focus-after-tap');
  return page(`(() => { const a = document.activeElement; const cs = getComputedStyle(a);
    return { tag: a.tagName, role: a.getAttribute('role'), focusVisible: a.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth }; })()`);
}

async function pickers(small) {
  await page(`location.assign('/host/${small}?tab=event'), true`);
  await until(`document.querySelector('main.page select, main.page input[type=datetime-local]')`, 20000);
  await sleep(1200);
  const found = {};
  for (const [name, selector] of [
    ['select', 'main.page select'],
    ['datetime', 'main.page input[type=datetime-local]'],
    ['date', 'main.page input[type=date]']
  ]) {
    if (await page(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) {
      try {
        await tap(selector);
        await sleep(1500);
        shot(`picker-${name}`);
        found[name] = true;
        shell('input keyevent KEYCODE_BACK');
        await sleep(1000);
      } catch (err) {
        found[name] = err.message;
      }
    } else {
      found[name] = false;
    }
  }
  return found;
}

async function restoration(big) {
  await ensureSignedIn();
  await page(`location.assign('/'), true`);
  await until(usableAt('/'));
  await sleep(800);
  await timedTap(`a[href="/host/${big}"]`, `location.pathname === '/host/${big}'`);
  await sleep(1500);
  await tap('#console-bar-standings');
  await sleep(1500);
  await page('window.scrollTo(0, 1400), true');
  await sleep(600);
  const before = await page('({ path: location.pathname + location.search, y: scrollY })');
  shell('input keyevent KEYCODE_HOME');
  await sleep(1500);
  shell(`am kill ${pkg}`);
  await sleep(1500);
  const killed = !pid();
  const after = await launch({ stop: false });
  return {
    before,
    killed,
    after: {
      path: new URL(after.read.url).pathname + new URL(after.read.url).search,
      y: after.read.scrollY,
      usable: after.usable,
      am: after.am
    }
  };
}

async function throttled(big) {
  const presets = {
    '3g': { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 },
    'slow-3g': { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 }
  };
  const result = {};
  if (local) {
    await ensureSignedIn();
  }
  await page(`location.assign('/'), true`);
  await until(usableAt('/'));
  await sleep(1000);
  await send('Network.enable');
  for (const [name, conditions] of Object.entries(presets)) {
    await send('Network.emulateNetworkConditions', conditions);
    await send('Network.setCacheDisabled', { cacheDisabled: false });
    result[`${name}-cached-reload`] = await timedLoad('location.reload()', name === '3g' ? `reload-${name}` : null);
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', conditions);
    if (local) {
      result[`${name}-tap-to-console`] = await timedTap(
        `a[href="/host/${big}"]`,
        `location.pathname === '/host/${big}' && ${rows} && ${noSkeleton}`
      );
      await page(`history.back(), true`);
      await until(usableAt('/'));
      await sleep(800);
    }
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    result[`${name}-empty-cache-reload`] = await timedLoad('location.reload()', null);
    await send('Network.enable');
  }
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1
  });
  await send('Network.setCacheDisabled', { cacheDisabled: false });
  return result;
}

async function offlineLaunch(off, on) {
  await stopApp();
  off();
  await sleep(1500);
  const stop = await record('offline-launch', 10);
  shell('logcat -c');
  const answer = shell(`date +%s%N; am start -W -n ${activity}`);
  const t0 = epoch(answer.split('\n')[0]);
  let shownAt = null;
  try {
    await connect(20000);
    const end = Date.now() + 15000;
    while (Date.now() < end && shownAt == null) {
      try {
        if (await evaluate(`Boolean(document.getElementById('retry'))`)) {
          shownAt = Math.round((await evaluate('performance.timeOrigin + performance.now()')) - t0);
        }
      } catch {
        await connect(5000).catch(() => undefined);
      }
      await sleep(100);
    }
  } catch (err) {
    results.errors.push(`offline: ${err.message}`);
  }
  await sleep(1500);
  shot('offline-launch');
  await stop();
  on();
  await sleep(2000);
  const back = shownAt == null ? null : await until(`!document.getElementById('retry')`, 20000);
  return { am: amTimes(answer), offlinePageAt: shownAt, cameBackByItself: back, native: feelLog() };
}

const SIGNED_IN = `fetch('/api/me').then(r => r.json()).then(d => Boolean(d.user))`;

/** Signs in through the dev login when the session is gone; true when it had to. */
async function ensureSignedIn() {
  if (await page(SIGNED_IN)) {
    return false;
  }
  await page(`location.assign('/api/auth/login/dev?name=Reese'), true`);
  await sleep(1500);
  await until(`location.pathname === '/' && window.__feel?.marks?.usable`);
  return true;
}

/**
 * Whether a sign-in survives the app leaving the screen and then being
 * stopped, `waitMs` after signing in (MainActivity.onStop writes cookies).
 */
async function sessionSurvives(waitMs) {
  await ensureSignedIn();
  await page(`location.assign('/api/auth/login/dev?name=Reese'), true`);
  await sleep(1500);
  await until(`location.pathname === '/' && window.__feel?.marks?.usable`);
  await sleep(waitMs);
  await launch({ link: '/' });
  return page(SIGNED_IN);
}

async function linkCold(code) {
  const trials = [];
  for (let i = 0; i < 3; i++) {
    trials.push(await launch({ link: `/t/${code}` }));
  }
  return { summary: summary(trials), trials: trials.map(({ read, ...rest }) => ({ ...rest, payload: payload(read) })) };
}

async function scrollAt(path, name) {
  await page(`location.assign(${JSON.stringify(path)}), true`);
  await until(rows);
  await sleep(1500);
  shot(`scroll-${name}`);
  return scroll(name);
}

async function runLocal(small, big) {
  const siteScript = new URL('./m3-site.sh', import.meta.url).pathname;
  results.device = {
    webview: tryShell('dumpsys webviewupdate | grep -i "current webview package"').trim(),
    size: tryShell('wm size').trim(),
    density: tryShell('wm density').trim(),
    sdk: tryShell('getprop ro.build.version.sdk').trim()
  };
  shell('cmd uimode night no');
  await step('firstLaunch', () => firstLaunch(null));
  await step('session', async () => ({
    after2s: await sessionSurvives(2000),
    after10s: await sessionSurvives(10000),
    after40s: await sessionSurvives(40000)
  }));
  await step('signIn', async () => {
    const had = await ensureSignedIn();
    await sleep(40000);
    return { hadTo: had };
  });
  await step('starts', () => starts('', '/'));
  await step('signedInAfterStarts', ensureSignedIn);
  await step('linkCold', () => linkCold(big));
  await step('coldRecordLight', async () => {
    await stopApp();
    const stop = await record('cold-light', 9);
    const t = await launch({ link: '/', prepared: true });
    await stop();
    return { ...t, read: undefined };
  });
  await step('coldRecordDark', async () => {
    shell('cmd uimode night yes');
    await sleep(1500);
    await stopApp();
    const stop = await record('cold-dark', 9);
    const t = await launch({ link: '/', prepared: true });
    await stop();
    shell('cmd uimode night no');
    await sleep(1500);
    return { ...t, read: undefined };
  });
  await step('navigation', async () => {
    await launch({ link: '/' });
    await sleep(1500);
    if (await ensureSignedIn()) {
      results.errors.push('navigation: had to sign in again');
    }
    const nav = { homeToConsole: [], tabs: [], back: [], publicTab: [], sheet: [] };
    for (let i = 0; i < 3; i++) {
      nav.homeToConsole.push(
        await timedTap(`a[href="/host/${big}"]`, `location.pathname === '/host/${big}' && ${rows} && ${noSkeleton}`)
      );
      await sleep(1500);
      nav.tabs.push(
        await timedTap(
          '#console-bar-players',
          `document.getElementById('console-bar-players')?.getAttribute('aria-selected') === 'true' && ${rows}`
        )
      );
      await sleep(1000);
      nav.tabs.push(
        await timedTap(
          '#console-bar-standings',
          `document.getElementById('console-bar-standings')?.getAttribute('aria-selected') === 'true' && ${rows}`
        )
      );
      await sleep(1000);
      await page(`history.go(-2), true`);
      await sleep(1500);
      nav.back.push(
        await timedBack(
          `location.pathname === '/' && ${noSkeleton} && document.querySelector('a[href="/host/${big}"]')`
        )
      );
      await sleep(1500);
    }
    await page(`location.assign('/t/${big}'), true`);
    await until(usableAt(`/t/${big}`));
    await sleep(1500);
    for (let i = 0; i < 3; i++) {
      nav.publicTab.push(
        await timedTap(
          tabByText('Standings'),
          `${tabByText('Standings')}?.getAttribute('aria-selected') === 'true' && ${rows}`
        )
      );
      await sleep(1000);
      nav.publicTab.push(
        await timedTap(
          tabByText('Pairings'),
          `${tabByText('Pairings')}?.getAttribute('aria-selected') === 'true' && ${rows}`
        )
      );
      await sleep(1000);
      nav.sheet.push(await timedTap('.tm-seat-link', `document.querySelector('.tm-sheet')`));
      await sleep(1200);
      if (i === 0) {
        shot('sheet');
      }
      shell('input keyevent KEYCODE_BACK');
      await sleep(1200);
    }
    return nav;
  });
  await step('reloads', async () => {
    const list = [];
    for (let i = 0; i < 3; i++) {
      list.push(await timedLoad('location.reload()', i === 0 ? 'reload' : null));
      await sleep(1000);
    }
    return list;
  });
  await step('warmLink', async () => {
    const list = [];
    for (let i = 0; i < 3; i++) {
      await page(`location.assign('/'), true`);
      await until(usableAt('/'));
      await sleep(1000);
      const stop = i === 0 ? await record('warm-link', 6) : null;
      shell('logcat -c');
      const answer = shell(
        `date +%s%N; am start -W -a android.intent.action.VIEW -d ${site}/t/${small} -n ${activity}`
      );
      const t0 = epoch(answer.split('\n')[0]);
      await sleep(300);
      await connect();
      await until(`location.pathname === '/t/${small}' && window.__feel?.marks?.usable`);
      await sleep(800);
      const read = await page(READ);
      await stop?.();
      list.push({
        am: amTimes(answer),
        navStart: Math.round(read.origin - t0),
        fcp: Math.round(read.origin + read.paint['first-contentful-paint'] - t0),
        usable: Math.round(read.origin + read.marks.usable - t0),
        navType: read.nav?.type
      });
    }
    return list;
  });
  await step('scrollStandings', () => scrollAt(`/t/${big}?tab=standings`, 'standings'));
  await step('scrollPairings', () => scrollAt(`/t/${big}?tab=pairings`, 'pairings'));
  await step('scrollConsolePlayers', () => scrollAt(`/host/${big}?tab=players`, 'console-players'));
  await step('scrollNativeControl', async () => {
    shell('am start -W -n com.android.settings/.Settings');
    await sleep(2500);
    const gfx = await flings('com.android.settings', 'settings');
    shell(`am start -n ${activity}`);
    await sleep(2000);
    await connect();
    return gfx;
  });

  await step('memory', () =>
    tryShell(`dumpsys meminfo ${pkg} | grep -E "TOTAL PSS|TOTAL RSS|WebView|Native Heap|Graphics"`)
  );
  await step('tells', async () => {
    await page(`location.assign('/t/${big}?tab=standings'), true`);
    await until(`${rows}`);
    await sleep(1500);
    return tells();
  });
  await step('focus', focusRing);
  await step('keyboard', async () => {
    await page(`location.assign('/host/${small}?tab=players'), true`);
    await until(`document.querySelector('#add-first')`);
    await sleep(1500);
    return keyboard();
  });
  await step('pickers', () => pickers(small));
  await step('restoration', () => restoration(big));
  await step('throttled', () => throttled(big));
  await step('offline', () =>
    offlineLaunch(
      () => execFileSync(siteScript, ['stop'], { stdio: 'inherit' }),
      () => execFileSync(siteScript, ['start'], { stdio: 'inherit' })
    )
  );
}

async function runLive(code) {
  results.device = { webview: tryShell('dumpsys webviewupdate | grep -i "current webview package"').trim() };
  shell('cmd uimode night no');
  await step('firstLaunch', () => firstLaunch(null));
  await step('starts', () => starts('', '/'));
  await step('linkCold', () => linkCold(code));
  await step('publicTab', async () => {
    const list = [];
    for (let i = 0; i < 3; i++) {
      list.push(
        await timedTap(
          tabByText('Standings'),
          `${tabByText('Standings')}?.getAttribute('aria-selected') === 'true' && ${rows}`
        )
      );
      await sleep(1000);
      list.push(
        await timedTap(
          tabByText('Pairings'),
          `${tabByText('Pairings')}?.getAttribute('aria-selected') === 'true' && ${rows}`
        )
      );
      await sleep(1000);
    }
    return list;
  });
  await step('reloads', async () => {
    const list = [];
    for (let i = 0; i < 3; i++) {
      list.push(await timedLoad('location.reload()', null));
      await sleep(1000);
    }
    return list;
  });
  await step('coldRecordLight', async () => {
    await stopApp();
    const stop = await record('cold-light', 9);
    const t = await launch({ link: '/', prepared: true });
    await stop();
    return { ...t, read: undefined };
  });
  await step('throttled', () => throttled(code));
  await step('emulatedNetworkCold', async () => {
    const set = [adbEmu('network delay 150'), adbEmu('network speed 750:1600')];
    try {
      await stopApp();
      const stop = await record('cold-3g', 15);
      const t = await launch({ link: '/', prepared: true });
      await stop();
      return { set, ...t, read: undefined, payload: payload(t.read) };
    } finally {
      adbEmu('network delay none');
      adbEmu('network speed full');
    }
  });
  await step('offline', () =>
    offlineLaunch(
      () => shell('cmd connectivity airplane-mode enable'),
      () => shell('cmd connectivity airplane-mode disable')
    )
  );
}

function adbEmu(command) {
  try {
    return execFileSync('adb', ['emu', ...command.split(' ')], { encoding: 'utf8' }).trim();
  } catch (err) {
    return `ERR ${err.message}`;
  }
}

try {
  if (local) {
    await runLocal(codes[0], codes[1]);
  } else {
    await runLive(codes[0]);
  }
} finally {
  save();
  close();
  log('errors', results.errors.length);
}
process.exit(0);
