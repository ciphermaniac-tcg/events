#!/usr/bin/env python3
"""Mac feel audit driver (native/mac-feel-audit only, never merged).

Launches the app over and over and reads what it reports (feel.rs and
feel_probe.js), with real input from feelhid. Writes results-<mode>.json,
screenshots, short screen recordings and each launch's log under <out>.

Usage: feel-mac.py <app> <out> live <event code>
       feel-mac.py <app> <out> local <small code> <big code>
"""

import json
import os
import plistlib
import re
import shutil
import socket
import statistics
import subprocess
import sys
import time
import traceback
from pathlib import Path

APP = Path(sys.argv[1]).resolve()
OUT = Path(sys.argv[2])
MODE = sys.argv[3]
CODES = sys.argv[4:]
HID = os.environ["FEELHID"]
BUNDLE = "com.ciphermaniac.events"
SITE = "https://events.ciphermaniac.com"
HOME = Path.home()
LIB = HOME / "Library"
DATA = LIB / "Application Support" / BUNDLE
STORES = [
    DATA,
    LIB / "WebKit" / BUNDLE,
    LIB / "Caches" / BUNDLE,
    LIB / "HTTPStorages" / BUNDLE,
    LIB / "HTTPStorages" / f"{BUNDLE}.binarycookies",
    LIB / "Saved Application State" / f"{BUNDLE}.savedState",
]
EXE = plistlib.loads((APP / "Contents" / "Info.plist").read_bytes())["CFBundleExecutable"]
BIN = APP / "Contents" / "MacOS" / EXE
CMD = OUT / "cmd.js"
KEYS = {"r": 15, "w": 13, "f": 3, "comma": 43, "lbracket": 33, "rbracket": 30, "equal": 24, "minus": 27, "zero": 29, "h": 4, "esc": 53, "tab": 48}

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "logs").mkdir(exist_ok=True)
(OUT / "shots").mkdir(exist_ok=True)
(OUT / "video").mkdir(exist_ok=True)
RESULTS = {}
RESULT_FILE = OUT / f"results-{MODE}.json"


def now():
    return time.time() * 1000


def save():
    RESULT_FILE.write_text(json.dumps(RESULTS, indent=1))


def say(*parts):
    print(f"[{time.strftime('%H:%M:%S')}]", *parts, flush=True)


def sh(*args, timeout=30, check=False):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=check).stdout.strip()
    except subprocess.TimeoutExpired:
        return ""


def hid(*args, timeout=30):
    return sh(HID, *map(str, args), timeout=timeout)


def osa(*lines, timeout=15):
    args = ["osascript"]
    for line in lines:
        args += ["-e", line]
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def wipe():
    for path in STORES:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        elif path.exists():
            path.unlink()


def store_sizes():
    out = {}
    for path in STORES:
        if path.exists():
            out[path.name] = int(sh("du", "-sk", str(path)).split()[0] or 0)
    return out


def set_last_page(path):
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "last-page").write_text(SITE + path)


class App:
    """One launch of the app and its log."""

    count = 0

    def __init__(self, label, path=None, env=None, video=0, film=True):
        App.count += 1
        self.label = label
        if path is not None:
            set_last_page(path)
        self.log = OUT / "logs" / f"{App.count:02d}-{label}.log"
        CMD.write_text("")
        self.rec = None
        if video:
            self.mov = OUT / "video" / f"{label}.mov"
            self.rec = subprocess.Popen(["screencapture", "-v", "-V", str(video), "-x", str(self.mov)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.rec_at = now()
            time.sleep(1.0)
        full_env = dict(os.environ, FEEL_CMD=str(CMD), **(env or {}))
        self.load = sh("sysctl", "-n", "vm.loadavg")
        self.t0 = now()
        self.proc = subprocess.Popen([str(BIN)], stdout=open(self.log, "w"), stderr=subprocess.STDOUT, env=full_env)
        self.pid = self.proc.pid
        self.watch = subprocess.Popen([HID, "waitwin", str(self.pid), "25000"], stdout=subprocess.PIPE, text=True)
        self.pix = subprocess.Popen([HID, "pixwatch", str(self.pid), "9000"], stdout=subprocess.PIPE, text=True) if film else None
        self.tag = 0

    def lines(self):
        out = []
        for line in self.log.read_text(errors="replace").splitlines():
            m = re.match(r"FEEL (\d+\.\d) (\w+) (\S+) ?(.*)", line)
            if m:
                out.append((float(m[1]), m[2], m[3], m[4]))
        return out

    def page(self, tag, after=0.0):
        for at, source, name, detail in self.lines():
            if source == "page" and name == tag and at >= after:
                try:
                    return at, json.loads(detail)
                except json.JSONDecodeError:
                    return at, {"raw": detail[:300]}
        return None

    def wait_page(self, tag, timeout=20, after=0.0):
        end = time.time() + timeout
        while time.time() < end:
            found = self.page(tag, after)
            if found:
                return found
            if self.proc.poll() is not None:
                return None
            time.sleep(0.05)
        return None

    def native(self, name, nth=0):
        hits = [at for at, source, n, _ in self.lines() if source == "native" and n == name]
        return hits[nth] if len(hits) > nth else None

    def js(self, code, timeout=15):
        """Runs `code` (a function body) in the page; returns what it returns."""
        self.tag += 1
        tag = f"js{self.tag}"
        sent = now()
        CMD.write_text(f"window.__feel && window.__feel.run({json.dumps(tag)}, async () => {{ {code} }});")
        found = self.wait_page(tag, timeout, after=sent - 5)
        return found[1] if found else None

    def window(self):
        parts = hid("win", self.pid).split()
        if len(parts) != 5:
            return None
        return dict(zip(["id", "x", "y", "w", "h"], map(int, parts)))

    def film(self):
        """The window's look over the launch: (ms from launch, brightness, spread)."""
        if not self.pix:
            return None
        try:
            out, _ = self.pix.communicate(timeout=12)
        except subprocess.TimeoutExpired:
            self.pix.kill()
            out, _ = self.pix.communicate()
        rows = []
        for line in out.splitlines():
            parts = line.split()
            if len(parts) == 3:
                rows.append((round(float(parts[0]) - self.t0), int(parts[1]), int(parts[2])))
            elif parts[:1] == ["window"] and len(parts) == 2:
                rows.append((round(float(parts[1]) - self.t0), "window", 0))
        return rows

    def shown_at(self, timeout=25):
        try:
            out, _ = self.watch.communicate(timeout=timeout)
            return float(out.split()[0]) if out.strip() else None
        except subprocess.TimeoutExpired:
            return None

    def shot(self, name, whole=False):
        path = OUT / "shots" / f"{MODE}-{name}.png"
        win = self.window()
        if win and not whole:
            sh("screencapture", "-x", "-o", "-l", str(win["id"]), str(path))
        else:
            sh("screencapture", "-x", str(path))
        return path.name

    def point(self, rect):
        win = self.window()
        return win["x"] + rect["x"] + rect["w"] / 2, win["y"] + rect["y"] + rect["h"] / 2

    def rect(self, selector, index=0):
        return self.js(f"return window.__feel.rect({json.dumps(selector)}, {index});")

    def click(self, selector, index=0, how="click"):
        rect = self.rect(selector, index)
        if not rect:
            return None, None
        x, y = self.point(rect)
        time.sleep(0.15)
        out = hid(how, round(x), round(y))
        return (float(out.split()[0]) if out else None), rect

    def key(self, name, *mods):
        out = hid("key", KEYS[name], *mods)
        return float(out.split()[0]) if out else None

    def memory(self):
        pids = [str(self.pid)] + sh("pgrep", "-f", "com.apple.WebKit").split()
        rows = sh("ps", "-o", "pid=,rss=,comm=", "-p", ",".join(pids))
        procs = []
        for row in rows.splitlines():
            pid, rss, comm = row.split(None, 2)
            foot = sh("footprint", "-p", pid, timeout=20)
            m = re.search(r"Footprint:\s*([\d.]+)\s*(KB|MB|GB)", foot)
            mb = None
            if m:
                mb = float(m[1]) * {"KB": 1 / 1024, "MB": 1, "GB": 1024}[m[2]]
            procs.append({"pid": int(pid), "rss_mb": round(int(rss) / 1024, 1), "footprint_mb": mb and round(mb, 1), "name": comm.split("/")[-1]})
        return {"procs": procs, "rss_total_mb": round(sum(p["rss_mb"] for p in procs), 1), "footprint_total_mb": round(sum(p["footprint_mb"] or 0 for p in procs), 1)}

    def quit(self, graceful=True):
        how = "kill"
        if graceful and self.proc.poll() is None:
            osa(f'tell application id "{BUNDLE}" to quit', timeout=8)
            try:
                self.proc.wait(8)
                how = "quit"
            except subprocess.TimeoutExpired:
                pass
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait(5)
        if self.rec:
            try:
                self.rec.wait(15)
            except subprocess.TimeoutExpired:
                self.rec.kill()
        self.watch.kill()
        self.film_rows = self.film()
        time.sleep(3.0)
        return how


def rel(value, t0):
    return round(value - t0) if value else None


def launch_summary(app, load):
    t0 = app.t0
    shown = app.shown_at()
    marks = (load or {}).get("marks", {})
    nav = (load or {}).get("nav") or {}
    res = (load or {}).get("resources", [])
    usable = marks.get("usable")
    return {
        "label": app.label,
        "run": rel(app.native("run"), t0),
        "window_built": rel(app.native("window-built"), t0),
        "page_started": rel(app.native("page-started"), t0),
        "html_first_byte": rel(nav.get("responseStart"), t0),
        "html_end": rel(nav.get("responseEnd"), t0),
        "dcl": rel(nav.get("domContentLoadedEventEnd"), t0),
        "page_finished": rel(app.native("page-finished"), t0),
        "show_called": rel(app.native("show"), t0),
        "on_screen": rel(shown, t0),
        "fcp": rel(marks.get("fcp"), t0),
        "first_text": rel(marks.get("mainText"), t0),
        "skeleton": rel(marks.get("skeleton"), t0),
        "usable": rel(usable, t0),
        "usable_seen": rel(max(usable, shown), t0) if usable and shown else None,
        "html_protocol": nav.get("protocol"),
        "html_transfer": nav.get("transfer"),
        "requests": len(res),
        "transfer": sum(r.get("transfer") or 0 for r in res) + (nav.get("transfer") or 0),
        "from_cache": sum(1 for r in res if not r.get("transfer") and r.get("body")),
        "api": [{"name": r["name"], "start": rel(r["start"], t0), "end": rel(r["end"], t0)} for r in res if "/api/" in r["name"]][:8],
        "loadavg": app.load,
        "url": (load or {}).get("url"),
        "mode": (load or {}).get("mode"),
        "loaded": bool(load),
    }


def medians(rows):
    keys = ["run", "window_built", "page_started", "html_first_byte", "html_end", "page_finished", "on_screen", "fcp", "skeleton", "usable", "usable_seen"]
    out = {}
    for key in keys:
        vals = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
        if vals:
            out[key] = {"median": round(statistics.median(vals)), "min": min(vals), "max": max(vals), "n": len(vals)}
    return out


def launch_once(label, path, video=0, env=None, wait=20, keep=False):
    app = App(label, path, env=env, video=video, film=not video and not keep)
    found = app.wait_page("load", wait)
    summary = launch_summary(app, found[1] if found else None)
    say(label, {k: summary[k] for k in ("on_screen", "html_end", "page_finished", "fcp", "usable", "usable_seen")})
    if keep:
        return app, summary
    summary["quit"] = app.quit()
    summary["film"] = app.film_rows
    return None, summary


def launches(label, path, n, video_first=False, env=None, wait=20):
    rows = []
    for i in range(n):
        _, row = launch_once(f"{label}-{i}", path, video=10 if video_first and i == 0 else 0, env=env, wait=wait)
        if not (video_first and i == 0):
            rows.append(row)
        else:
            RESULTS.setdefault("videos", {})[label] = row
    RESULTS[label] = {"runs": rows, "summary": medians(rows)}
    save()


def alternate(label_a, label_b, path, n, env_b, env_a=None):
    """Launches A and B in turn, n each, so both see the same machine."""
    rows = {label_a: [], label_b: []}
    for i in range(n):
        for label, env in ((label_a, env_a), (label_b, env_b)):
            rows[label].append(launch_once(f"{label}-{i}", path, env=env)[1])
    for label, block in rows.items():
        RESULTS[label] = {"runs": block, "summary": medians(block)}
    save()


def activate():
    osa(f'tell application id "{BUNDLE}" to activate')
    time.sleep(0.6)


def step(name, fn, *args):
    say("step", name)
    try:
        RESULTS[name] = fn(*args)
    except Exception as err:  # keep going: one broken step shouldn't lose the rest
        RESULTS[name] = {"error": repr(err), "trace": traceback.format_exc()[-1500:]}
        say("step failed", name, repr(err))
    save()


def taps(app, targets, settle=1.4):
    """Real clicks on each (selector, index); what the page did after each."""
    activate()
    out = []
    for selector, index in targets:
        down, rect = app.click(selector, index)
        if not down:
            out.append({"target": selector, "missing": True})
            continue
        time.sleep(settle)
        if selector == ".tm-seat-link":
            app.key("esc")
        out.append({"target": rect.get("text"), "selector": selector, "click": down})
    time.sleep(0.6)
    record = app.js("return { taps: window.__feel.taps, routes: window.__feel.routes };") or {}
    for row in out:
        down = row.get("click")
        if not down:
            continue
        tap = next((t for t in record.get("taps", []) if t["kind"] in ("pointerdown", "mousedown") and t["at"] >= down - 5), None)
        route = next((r for r in record.get("routes", []) if r["at"] >= down - 5), None)
        if tap:
            row["input_ms"] = round(tap["at"] - down, 1)
            row["handled_ms"] = round(tap["handled"] - down, 1)
            row["next_frame_ms"] = round(tap.get("nextFrame", 0) - down, 1) if tap.get("nextFrame") else None
            row["changed_ms"] = round(tap["firstFrame"] - down, 1) if tap.get("firstFrame") else None
            row["settled_ms"] = round(tap["lastFrame"] - down, 1) if tap.get("lastFrame") else None
            row["usable_ms"] = round(tap["usable"] - down, 1) if tap.get("usable") else None
            row["skeleton"] = tap.get("skeleton", False)
        if route:
            row["route"] = route.get("path")
    return out


def frames_during(app, ms, action):
    app.tag += 1
    tag = f"frames{app.tag}"
    sent = now()
    CMD.write_text(f"window.__feel.run({json.dumps(tag)}, () => window.__feel.frames({ms}));")
    time.sleep(0.15)
    detail = action()
    found = app.wait_page(tag, ms / 1000 + 8, after=sent - 5)
    return {"frames": found[1] if found else None, "action": detail}


def scroll_test(app, label):
    win = app.window()
    x, y = win["x"] + win["w"] / 2, win["y"] + win["h"] / 2
    app.js("document.scrollingElement.scrollTop = 0; return true;")
    time.sleep(0.5)
    down = frames_during(app, 1600, lambda: hid("scroll", round(x), round(y), -40, 60, 16))
    time.sleep(0.4)
    up = frames_during(app, 1000, lambda: hid("scroll", round(x), round(y), 400, 20, 16))
    app.shot(f"{label}-after-scroll")
    return {"down": down, "up": up}


def resize_test(app, label, video=False):
    win = app.window()
    corner = (win["x"] + win["w"] - 4, win["y"] + win["h"] - 4)
    app.js("window.__feel.resizes.length = 0; return true;")
    rec = None
    if video:
        rec = subprocess.Popen(["screencapture", "-v", "-V", "6", "-x", str(OUT / "video" / f"{label}-resize.mov")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.0)
    shrink = frames_during(app, 1600, lambda: hid("drag", corner[0], corner[1], corner[0] - 320, corner[1] - 180, 60, 16))
    after = app.window()
    grow = frames_during(app, 1600, lambda: hid("drag", corner[0] - 320, corner[1] - 180, corner[0], corner[1], 60, 16))
    resizes = app.js("return window.__feel.resizes;") or []
    if rec:
        rec.wait(20)
    lags = [r["frame"] - r["at"] for r in resizes]
    return {
        "before": win,
        "shrunk": after,
        "end": app.window(),
        "shrink": shrink,
        "grow": grow,
        "resize_events": len(resizes),
        "resize_to_frame_p50": statistics.median(lags) if lags else None,
        "resize_to_frame_max": max(lags) if lags else None,
    }


def theme_test(app, label):
    app.js("window.__feel.theme.length = 0; return true;")
    rec = subprocess.Popen(["screencapture", "-v", "-V", "7", "-x", str(OUT / "video" / f"{label}-theme.mov")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    results = []
    for dark in ("true", "false"):
        before = now()
        osa(f'tell application "System Events" to tell appearance preferences to set dark mode to {dark}')
        after = now()
        time.sleep(1.8)
        app.shot(f"{label}-theme-{'dark' if dark == 'true' else 'light'}")
        results.append({"dark": dark, "osa_start": before, "osa_end": after})
    rec.wait(20)
    seen = app.js("return window.__feel.theme;") or []
    for row, change in zip(results, seen):
        row["media_ms"] = round(change["at"] - row["osa_start"])
        row["frame_ms"] = round(change["frame"] - row["osa_start"])
        row["mode"] = change.get("mode")
    return results


def tells(app, label):
    """The web's tells, read from the page: cursors, selection, overscroll."""
    styles = app.js(
        """
        const pick = s => document.querySelector(s);
        const css = (s, p) => { const el = pick(s); return el ? getComputedStyle(el).getPropertyValue(p) : null; };
        const targets = { link: 'main a', heading: 'main h1', tab: '[role="tab"]', button: 'main button', cell: 'main td', seat: '.tm-seat-link', meta: '.hero-meta', paragraph: 'main p' };
        const out = {};
        for (const [k, s] of Object.entries(targets)) {
          out[k] = { cursor: css(s, 'cursor'), select: css(s, '-webkit-user-select'), font: css(s, 'font-family')?.slice(0, 50) };
        }
        out.root = { overscroll: css('html', 'overscroll-behavior-y'), bodyOverscroll: css('body', 'overscroll-behavior-y'), smoothing: css('body', '-webkit-font-smoothing'), scheme: css('html', 'color-scheme') };
        out.ua = navigator.userAgent;
        out.sw = 'serviceWorker' in navigator;
        out.dpr = devicePixelRatio;
        out.vw = innerWidth; out.vh = innerHeight;
        out.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        out.accent = getComputedStyle(document.body).getPropertyValue('accent-color');
        return out;
        """
    )
    found = {"styles": styles}
    # Double-click a heading and a tab: what a Mac app would or wouldn't select.
    for name, selector in (("heading", "main h1"), ("tab", '[role="tab"]'), ("cell", "main td")):
        down, rect = app.click(selector, 0, "dblclick")
        time.sleep(0.4)
        found[f"select_{name}"] = app.js("return getSelection().toString().slice(0, 60);")
        if name == "heading":
            app.shot(f"{label}-select-heading")
        app.js("getSelection().removeAllRanges(); return true;")
    # Focus after a click, then after Tab.
    app.click('[role="tab"]', 1)
    time.sleep(0.5)
    focus_js = "const el = document.activeElement; return { tag: el?.tagName, text: el?.textContent?.trim().slice(0, 30), visible: el?.matches(':focus-visible'), outline: el ? getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth : null };"
    found["focus_after_click"] = app.js(focus_js)
    app.key("tab")
    time.sleep(0.4)
    found["focus_after_tab"] = app.js(focus_js)
    app.shot(f"{label}-focus-after-tab")
    # Context menus.
    for name, selector in (("text", "main h1"), ("link", "main a")):
        rect = app.rect(selector)
        if rect:
            x, y = app.point(rect)
            hid("click", round(x), round(y), "right")
            time.sleep(0.9)
            found[f"context_{name}"] = app.shot(f"{label}-context-{name}", whole=True)
            app.key("esc")
            time.sleep(0.4)
    return found


def keys_test(app, label):
    activate()
    out = {}
    # Cmd-F: is there a find bar?
    out["cmd_f_key"] = app.key("f", "cmd")
    time.sleep(0.9)
    out["cmd_f_shot"] = app.shot(f"{label}-cmd-f", whole=True)
    app.key("esc")
    time.sleep(0.4)
    # Cmd-comma: Settings.
    before = now()
    app.key("comma", "cmd")
    time.sleep(1.5)
    out["cmd_comma"] = app.js("return { path: location.pathname, routes: window.__feel.routes.slice(-2) };")
    out["cmd_comma_shot"] = app.shot(f"{label}-settings")
    # Cmd-[ back.
    app.key("lbracket", "cmd")
    time.sleep(1.2)
    out["cmd_back"] = app.js("return location.pathname + location.search;")
    # Zoom.
    out["zoom_before"] = app.js("return innerWidth;")
    app.key("equal", "cmd")
    time.sleep(0.6)
    out["zoom_in"] = app.js("return innerWidth;")
    app.key("zero", "cmd")
    time.sleep(0.6)
    # Cmd-R: a full reload.
    rec = subprocess.Popen(["screencapture", "-v", "-V", "6", "-x", str(OUT / "video" / f"{label}-reload.mov")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    pressed = app.key("r", "cmd")
    found = app.wait_page("load", 20, after=pressed)
    if found:
        load = found[1]
        marks = load.get("marks", {})
        nav = load.get("nav") or {}
        out["reload"] = {
            "origin_ms": rel(load.get("origin"), pressed),
            "html_end_ms": rel(nav.get("responseEnd"), pressed),
            "fcp_ms": rel(marks.get("fcp"), pressed),
            "skeleton_ms": rel(marks.get("skeleton"), pressed),
            "usable_ms": rel(marks.get("usable"), pressed),
        }
    rec.wait(20)
    return out


def hot_reopen(app, n=5):
    activate()
    rows = []
    for _ in range(n):
        app.key("w", "cmd")
        time.sleep(1.2)
        hidden = app.window() is None
        start = now()
        subprocess.run(["open", str(APP)], timeout=20)
        seen = None
        while now() - start < 8000:
            if app.window():
                seen = now()
                break
            time.sleep(0.01)
        rows.append({"hidden_after_cmd_w": hidden, "reopen_ms": rel(seen, start)})
        time.sleep(1.0)
    return rows


def full_screen(app, label):
    app.key("f", "cmd", "ctrl")
    time.sleep(2.5)
    out = {"window": app.window(), "page": app.js("return { vw: innerWidth, vh: innerHeight, head: document.querySelector('.site-head')?.getBoundingClientRect().height, padLeft: getComputedStyle(document.querySelector('.site-head-row') || document.body).paddingLeft };")}
    out["shot"] = app.shot(f"{label}-fullscreen", whole=True)
    app.key("f", "cmd", "ctrl")
    time.sleep(2.5)
    return out


def restore_test(label, path):
    app = App(f"{label}-restore-a", path)
    app.wait_page("load", 20)
    app.shown_at()
    osa(
        f"tell application \"System Events\" to tell (first process whose unix id is {app.pid})",
        "set position of window 1 to {70, 60}",
        "set size of window 1 to {860, 620}",
        "end tell",
    )
    time.sleep(1.0)
    moved = app.window()
    how = app.quit()
    app = App(f"{label}-restore-b", path)
    app.wait_page("load", 20)
    app.shown_at()
    time.sleep(0.5)
    back = app.window()
    app.quit()
    return {"moved_to": moved, "quit": how, "relaunched_at": back}


def pf(rules):
    path = OUT / "pf.rules"
    path.write_text(rules)
    sh("sudo", "pfctl", "-f", "/etc/pf.conf", timeout=10)
    sh("sudo", "pfctl", "-E", timeout=10)
    return sh("sudo", "pfctl", "-a", "com.apple/feel", "-f", str(path), timeout=10)


def pf_clear():
    sh("sudo", "pfctl", "-a", "com.apple/feel", "-F", "all", timeout=10)
    sh("sudo", "dnctl", "-q", "flush", timeout=10)


def offline_test(label, path):
    pf("block drop out quick to events.ciphermaniac.com\n")
    app = App(f"{label}-offline", path, video=14)
    shots = {}
    for at in (1.5, 3.5, 6.0, 10.0):
        while now() - app.t0 < at * 1000:
            time.sleep(0.02)
        shots[str(at)] = app.shot(f"{label}-offline-{at}s", whole=True)
    shown = app.shown_at(2)
    events = [(rel(at, app.t0), n, d[:120]) for at, s, n, d in app.lines() if s == "native"]
    pf_clear()
    back = now()
    found = app.wait_page("load", 25, after=back)
    recovered = app.shot(f"{label}-offline-after-25s", whole=True)
    app.quit()
    return {"on_screen": rel(shown, app.t0), "native": events, "shots": shots, "recovered_load": bool(found), "recovered_ms": rel(found[0], back) if found else None, "recovered_shot": recovered}


def slow_test(label, path, n=3):
    sh("sudo", "dnctl", "pipe", "1", "config", "delay", "150", "bw", "1600Kbit/s", timeout=10)
    sh("sudo", "dnctl", "pipe", "2", "config", "delay", "150", "bw", "1600Kbit/s", timeout=10)
    pf(
        "dummynet out quick proto { tcp udp } to events.ciphermaniac.com pipe 1\n"
        "dummynet in quick proto { tcp udp } from events.ciphermaniac.com pipe 2\n"
    )
    ping = sh("curl", "-s", "-o", "/dev/null", "-w", "%{time_connect} %{time_starttransfer} %{time_total}", SITE + "/", timeout=30)
    rows = []
    for i in range(n):
        rows.append(launch_once(f"{label}-slow-{i}", path, video=12 if i == 0 else 0, wait=40)[1])
    wipe()
    rows.append(launch_once(f"{label}-slow-first", path, wait=60)[1])
    simulated = [launch_once(f"{label}-slow-simulated-{i}", path, env=fetch_shell_env(), wait=40, video=12 if i == 0 else 0)[1] for i in range(3)]
    pf_clear()
    return {"curl": ping, "runs": rows, "summary": medians(rows[:-1]), "simulated": simulated, "simulated_summary": medians(simulated)}


def fetch_shell_env():
    return {"FEEL_SIMULATE": str(OUT / "shell.html")}


def fetch_shell():
    """Keeps a copy of the site's page and its policy, for the simulated launch."""
    shell = OUT / "shell.html"
    headers = OUT / "shell.headers"
    args = ["curl", "-s", "-D", str(headers), "-o", str(shell), SITE + "/"]
    if MODE == "local":
        args[1:1] = ["--cacert", os.path.join(os.environ["FEEL_STATE"], "ca.crt")]
    subprocess.run(args, timeout=30, check=False)
    csp = next((line.split(":", 1)[1].strip() for line in headers.read_text().splitlines() if line.lower().startswith("content-security-policy:")), "")
    Path(f"{shell}.csp").write_text(csp)
    return {"FEEL_SIMULATE": str(shell)}


def env_info():
    info = {
        "sw_vers": sh("sw_vers"),
        "safari": sh("defaults", "read", "/Applications/Safari.app/Contents/Info", "CFBundleShortVersionString"),
        "webkit": sh("defaults", "read", "/System/Library/Frameworks/WebKit.framework/Resources/Info", "CFBundleVersion"),
        "model": sh("sysctl", "-n", "hw.model"),
        "cpus": sh("sysctl", "-n", "hw.ncpu"),
        "mem_gb": round(int(sh("sysctl", "-n", "hw.memsize") or 0) / 2**30, 1),
        "display": sh("system_profiler", "SPDisplaysDataType", timeout=60)[-600:],
        "trust": hid("trust"),
        "exe": EXE,
    }
    return info


def live():
    code = CODES[0]
    event = f"/t/{code}"
    step("env", env_info)
    wipe()
    _, first = launch_once("first-launch", None)
    first["stores_kb"] = store_sizes()
    RESULTS["first_launch"] = first
    save()
    launches("relaunch-home", "/", 6)
    simulate = fetch_shell()
    alternate("relaunch-event", "simulated-relaunch-event", event, 6, simulate)
    launches("simulated-relaunch-home", "/", 4, env=simulate)
    app, _ = launch_once("simulated-check", event, env=simulate, keep=True)
    step("simulated_check", app.js, "return { origin: location.origin, ipc: Boolean(window.__TAURI_INTERNALS__), cookieOk: navigator.cookieEnabled, csp: (() => { try { new Function('1'); return 'eval allowed'; } catch (e) { return 'eval blocked'; } })() };")
    app.quit()
    app, _ = launch_once("inapp-event", event, keep=True)
    step("event_taps", taps, app, [('[role="tab"]', 1), ('[role="tab"]', 0), ('[role="tab"]', 1), ('[role="tab"]', 0), (".tm-seat-link", 0), (".tm-seat-link", 3)])
    step("event_memory", app.memory)
    step("event_scroll", scroll_test, app, "live-event")
    step("event_resize", resize_test, app, "live-event", True)
    step("hot_reopen", hot_reopen, app)
    step("event_keys", keys_test, app, "live-event")
    app.quit()
    step("restore", restore_test, "live", event)
    step("offline", offline_test, "live", event)
    step("slow", slow_test, "live", event)
    for label, path, env in (("video-relaunch-home", "/", None), ("video-relaunch-event", event, None), ("video-simulated-event", event, simulate)):
        RESULTS.setdefault("videos", {})[label] = launch_once(label, path, video=9, env=env)[1]
    wipe()
    RESULTS["videos"]["video-first-launch"] = launch_once("video-first-launch", None, video=10)[1]
    save()


def local():
    small, big = CODES
    resolved = socket.gethostbyname("events.ciphermaniac.com")
    if resolved != "127.0.0.1" or not small or not big:
        raise SystemExit(f"the runner's site isn't in place ({resolved}, {CODES}); nothing measured")
    step("env", env_info)
    wipe()
    app, signin = launch_once("sign-in", None, env={"FEEL_URL": f"{SITE}/api/auth/login/dev?name=Reese"}, keep=True)
    time.sleep(2)
    RESULTS["sign_in"] = signin
    app.quit()
    launches("relaunch-dashboard", "/", 5)
    alternate("relaunch-console", "simulated-relaunch-console", f"/host/{big}", 5, fetch_shell())
    launches("relaunch-public-big", f"/t/{big}", 4)
    app, _ = launch_once("inapp-console", f"/host/{big}", keep=True)
    tabs = [('[role="tab"]', i) for i in (1, 2, 0, 1, 2, 3, 4, 0)]
    step("console_taps", taps, app, tabs)
    step("console_taps_again", taps, app, tabs)
    step("console_memory", app.memory)
    app.click('[role="tab"]', 1)
    time.sleep(1.2)
    step("console_scroll_players", scroll_test, app, "local-players")
    step("console_resize", resize_test, app, "local-console", True)
    step("console_theme", theme_test, app, "local-console")
    step("console_tells", tells, app, "local-console")
    step("console_fullscreen", full_screen, app, "local-console")
    step("console_keys", keys_test, app, "local-console")
    app.quit()
    app, _ = launch_once("inapp-public", f"/t/{big}", keep=True)
    step("public_taps", taps, app, [('[role="tab"]', 1), ('[role="tab"]', 0), (".tm-seat-link", 0), (".tm-seat-link", 5), ('[role="tab"]', 1)])
    step("public_tells", tells, app, "local-public")
    step("public_memory", app.memory)
    app.quit()
    # The prototype shell cache: register the app-only service worker, then
    # launch on the console again.
    app, _ = launch_once("sw-register", f"/host/{big}", keep=True)
    step(
        "sw_register",
        app.js,
        "const reg = await navigator.serviceWorker.register('/feel-sw.js'); await navigator.serviceWorker.ready; return { scope: reg.scope, active: Boolean(reg.active) };",
        20,
    )
    time.sleep(2)
    app.quit()
    launches("sw-relaunch-console", f"/host/{big}", 6)
    launches("sw-relaunch-dashboard", "/", 4)
    app, _ = launch_once("sw-check", f"/host/{big}", keep=True)
    step("sw_controlled", app.js, "return { controlled: Boolean(navigator.serviceWorker.controller), caches: await caches.keys(), entries: (await (await caches.open('feel-shell-v1')).keys()).length };")
    app.quit()
    # The site down: with the prototype, then without it.
    step("server_down_sw", server_down, f"/host/{big}", "sw")
    wipe_sw = App("sw-unregister", f"/host/{big}")
    wipe_sw.wait_page("load", 20)
    step("sw_unregister", wipe_sw.js, "for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); return true;")
    wipe_sw.quit()
    step("server_down_plain", server_down, f"/host/{big}", "plain")
    RESULTS.setdefault("videos", {})["video-console"] = launch_once("video-console", f"/host/{big}", video=9)[1]
    save()


def server_down(path, label):
    sh("native/screens/feel-mac-site.sh", "stop", timeout=60)
    app = App(f"down-{label}", path, video=10)
    for at in (2.0, 6.0):
        while now() - app.t0 < at * 1000:
            time.sleep(0.02)
        app.shot(f"down-{label}-{at}s", whole=True)
    found = app.page("load")
    shown = app.shown_at(1)
    events = [(rel(at, app.t0), n, d[:120]) for at, s, n, d in app.lines() if s == "native"]
    load = found[1] if found else None
    app.quit()
    sh("native/screens/feel-mac-site.sh", "start", timeout=150)
    return {"on_screen": rel(shown, app.t0), "load": load and {"marks": {k: rel(v, app.t0) for k, v in load.get("marks", {}).items()}, "state": load.get("state"), "title": load.get("title")}, "native": events}


if __name__ == "__main__":
    try:
        live() if MODE == "live" else local()
    finally:
        save()
        say("done", RESULT_FILE)
