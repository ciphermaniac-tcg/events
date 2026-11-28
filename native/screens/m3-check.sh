#!/usr/bin/env bash
# Checks the Android app's native behaviour on the running emulator against
# the local site (m3-site.sh), in light and dark: system bars and insets, a
# site link opening the app warm and cold, Back and the predictive back
# gesture on a sheet, Back on a menu and a dialog, the page held still under
# a dialog, the keyboard over a field, the Material top app bar's title and
# back arrow, the Material navigation bar and its
# rail when wider, the sheet's handle and drag, and the offline page coming
# back on Retry. Screenshots are m3-<theme>-<step>.png; results.txt says what held.
# Usage: m3-check.sh <apk> <out-dir> <event-code>. Run from the repo root.
set -uo pipefail

apk=$1
out=$2
code=$3
package=com.ciphermaniac.events.debug
activity=$package/com.ciphermaniac.events.MainActivity
site=http://localhost:4600
port=9222
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
results=$out/results.txt
: >"$results"

note() { echo "$*" | tee -a "$results"; }
check() {
  if [ "$2" = "$3" ]; then note "PASS $theme $1"; else note "FAIL $theme $1: got '$2', wanted '$3'"; fi
}
shoot() { adb exec-out screencap -p >"$out/m3-$theme-$1.png"; }

connect() {
  local pid
  adb forward --remove "tcp:$port" 2>/dev/null || true
  for _ in $(seq 1 150); do
    pid=$(adb shell pidof "$package" | tr -d '\r')
    if [ -n "$pid" ] && adb shell cat /proc/net/unix | grep -q "webview_devtools_remote_$pid"; then
      adb forward "tcp:$port" "localabstract:webview_devtools_remote_$pid" >/dev/null
      return
    fi
    sleep 0.2
  done
  note "FAIL $theme: the webview never opened DevTools"
}

page() { timeout 20 node "$here/cdp.mjs" "$port" eval "$1" 2>/dev/null; }

# Waits up to 30 s for an expression to be true.
until_true() {
  for _ in $(seq 1 60); do
    [ "$(page "Boolean($1)")" = true ] && return 0
    sleep 0.5
  done
  return 1
}

# The centre of the first element the selector finds, in screen pixels.
point() {
  local rect top
  rect=$(page "(() => { const r = document.querySelector('$1')?.getBoundingClientRect(); \
return r ? [r.x + r.width / 2, r.y + r.height / 2, devicePixelRatio].join(' ') : '' })()")
  top=$(webview_top)
  [ -n "$rect" ] || return 1
  read -r x y dpr <<<"$rect"
  echo "$(node -e "console.log(Math.round($x * $dpr))") $(node -e "console.log(Math.round($y * $dpr + $top))")"
}

tap_el() {
  local at
  at=$(point "$1") || return 1
  # shellcheck disable=SC2086 # the point is "x y"
  adb shell input tap $at
}

# Whether a tab's pill in the navigation bar is filled.
pill() { page "getComputedStyle(document.querySelector('.tm-tabbar $1'), '::before').backgroundColor !== 'rgba(0, 0, 0, 0)'"; }

# Whether the console's sections are a rail at the left, with its tabs along the top gone.
rail() {
  page "(() => { const bar = document.querySelector('.tm-console > .tm-tabbar'); \
const tabs = document.querySelector('.tm-console > .tabs'); \
return getComputedStyle(bar).flexDirection === 'column' && getComputedStyle(tabs).display === 'none' \
&& document.querySelector('main.page').getBoundingClientRect().left >= 80 })()"
}

in_app() { adb shell dumpsys activity activities | grep -q "ResumedActivity.*$package"; }

# The page has drawn real content: a heading in it and no skeleton.
USABLE="Boolean(document.querySelector('main.page')?.querySelector('h1, h2')?.textContent.trim()) && !document.querySelector('main.page .skeleton')"

# The longest run, in ms, of a screen recording's frames whose content area
# (under the head bar, clear of the screen's edge) is one flat colour: a
# blank page. screenrecord writes a frame only on a change.
longest_flat() {
  ffprobe -v error -f lavfi -i "movie=$1,crop=1040:1700:20:380,signalstats" \
    -show_entries frame=pts_time:frame_tags=lavfi.signalstats.YMIN,lavfi.signalstats.YMAX,lavfi.signalstats.YAVG \
    -of default=nw=1 | awk -F= '
    /pts_time/ { t = $2 }
    /YMIN/ { lo = $2 } /YMAX/ { hi = $2 }
    /YAVG|YMAX|YMIN/ { seen++ }
    seen == 3 { seen = 0; flat = (hi - lo < 14)
      if (flat && !on) { from = t; on = 1 }
      if (!flat && on) { d = (t - from) * 1000; if (d > most) most = d; on = 0 } }
    END { printf "%d", most }'
}

# Taps the first node uiautomator finds with this text.
tap_text() {
  local at
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml >"$out/ui.xml"
  at=$(python3 -I "$here/ui.py" "$out/ui.xml" text "$1") || return 1
  # shellcheck disable=SC2086 # the point is "x y"
  adb shell input tap $at
}

sheet_open() { page "Boolean(document.querySelector('.tm-sheet'))"; }

open_sheet() {
  page "document.querySelector('.tm-seat-link')?.click()" >/dev/null
  until_true "document.querySelector('.tm-sheet')" || note "FAIL $theme: the player sheet did not open"
  sleep 1.5
}

webview_top() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml | python3 -I -c '
import re, sys, xml.etree.ElementTree as ET
for node in ET.parse(sys.stdin).iter("node"):
    if node.get("class") == "android.webkit.WebView":
        print(re.findall(r"\d+", node.get("bounds"))[1]); break
else:
    print(0)'
}

go() { page "location.assign('$1')" >/dev/null; sleep 1; }
path() { page "location.pathname + location.search"; }
launch() { adb shell am start -W "$@" >/dev/null; connect; }
view() { launch -a android.intent.action.VIEW -d "$site$1" -n "$activity"; }

set_theme() {
  theme=$1
  local night=no
  [ "$theme" = dark ] && night=yes
  adb shell cmd uimode night "$night"
}

# A back swipe from the left edge at y, held at x = $2 until the caller lets go.
swipe_hold() {
  local y=$1 hold=$2
  adb shell input motionevent DOWN 3 "$y"
  for x in 40 90 150 220 "$hold"; do adb shell input motionevent MOVE "$x" "$y"; done
  sleep 0.6
}

run_theme() {
  set_theme "$1"
  adb shell am force-stop "$package"
  adb shell pm clear "$package" >/dev/null
  launch -n "$activity"
  until_true "document.body?.innerText.includes('Willow Creek Cup')" || note "FAIL $theme: home never showed the event"

  # Signed in by that first launch 3 s ago, the app is stopped without leaving
  # the screen first, and still signed in when it starts again. The splash
  # lasts until the page shows content.
  sleep 3
  adb shell am force-stop "$package"
  adb shell screenrecord --time-limit 15 /sdcard/launch.mp4 &
  local recorder=$! started blank reason
  sleep 1
  adb logcat -c
  started=$(adb shell am start -W -n "$activity" | tr -d '\r' | grep -E 'TotalTime' | xargs)
  connect
  note "INFO $theme cold start: $started"
  until_true "$USABLE"
  sleep 3
  adb shell pkill -INT screenrecord || true
  wait "$recorder" || true
  sleep 1
  adb pull /sdcard/launch.mp4 "$out/m3-$theme-launch.mp4" >/dev/null
  blank=$(longest_flat "$out/m3-$theme-launch.mp4")
  # The test build logs when the page said it had content and when the
  # splash went (Feel); a splash that gave up at its limit leaves on a
  # skeleton by design.
  reason=$(adb logcat -d -s Feel:I | awk '/ shown / { s = $NF } / revealed / { r = $NF } END { print (s && s <= r) ? "content" : "limit" }')
  note "INFO $theme longest blank on the launch film: $blank ms; the splash left on $reason"
  if [ "$reason" = content ]; then
    check "no blank page between the splash and the content" "$([ "${blank:-9999}" -lt 150 ] && echo none || echo "$blank ms")" none
  fi
  shoot launch
  check "a stop 3 s after signing in keeps the sign-in" "$(page "Boolean(document.querySelector('.tm-acct-button'))")" true
  sleep 1
  shoot home

  # No pinch-zoom.
  node "$here/cdp.mjs" "$port" pinch >/dev/null 2>&1
  sleep 1
  check "a pinch doesn't zoom" "$(page 'visualViewport.scale')" 1
  check "home keeps the logo in the bar" \
    "$(page "!document.documentElement.classList.contains('app-up') && getComputedStyle(document.querySelector('.site-head-name')).display !== 'none'")" true

  # A site link while the app runs opens in it with no reload, and Back returns to the page before.
  page "window.__m3Stay = 1" >/dev/null
  view "/host/$code"
  until_true "location.pathname === '/host/$code' && document.querySelector('.tm-tabbar, .tabs')"
  sleep 2
  shoot console
  check "a link while the app runs doesn't reload the page" "$(page "window.__m3Stay")" 1
  check "warm link opens the console" "$(path)" "/host/$code"

  # The Material navigation bar: 80 dp, the open tab's pill filled, and a tap moves it.
  check "the navigation bar is 80 dp" "$(page "Math.round(document.querySelector('.tm-tabbar').getBoundingClientRect().height) >= 80")" true
  check "the open tab's pill is filled" "$(pill "[aria-selected=true]")" true
  check "a closed tab's pill is empty" "$(pill '#console-bar-players')" false
  tap_el '#console-bar-players'
  sleep 2
  check "a tap opens that tab" "$(page "document.getElementById('console-bar-players').getAttribute('aria-selected')")" true
  check "and fills its pill" "$(pill '#console-bar-players')" true
  check "and empties the last one's" "$(pill '#console-bar-round')" false
  shoot nav-players
  tap_el '#console-bar-round'
  sleep 1.5
  adb shell input keyevent KEYCODE_BACK
  sleep 2
  check "Back after a warm link" "$(path)" "/"

  # The top app bar: the page's title, and a back arrow that goes where Back goes.
  view "/host/$code"
  until_true "location.pathname === '/host/$code' && document.querySelector('.app-bar-title')"
  sleep 1
  check "the bar's title is the page's" "$(page "document.querySelector('.app-bar-title').textContent")" "Willow Creek Cup"
  check "and the page's heading gives way to it" "$(page "getComputedStyle(document.querySelector('.tm-hero-text > h1')).display")" none
  check "the bar is 64 dp" "$(page "Math.round(document.querySelector('.site-head').getBoundingClientRect().height) >= 64")" true
  shoot bar
  tap_el '.app-bar-back'
  sleep 2
  check "the arrow goes where Back goes" "$(path)" "/"

  # A link that launches the app is the page it opens on, still signed in
  # after the app left the screen and was stopped.
  adb shell input keyevent KEYCODE_HOME
  sleep 5
  adb shell am force-stop "$package"
  view "/t/$code"
  until_true "location.pathname === '/t/$code' && document.body.innerText.includes('Avery')"
  check "cold link opens the event" "$(path)" "/t/$code"
  check "cold link loads once" "$(page 'history.length')" "1"
  check "still signed in after a stop" "$(page "Boolean(document.querySelector('.tm-acct-button'))")" true
  sleep 2
  shoot public

  # The player sheet: the gesture shrinks it, letting go restores it, finishing closes it.
  open_sheet
  shoot sheet
  check "the sheet has 28 dp corners" "$(page "getComputedStyle(document.querySelector('.tm-sheet')).borderTopLeftRadius")" 28px
  check "a handle stands in for Close" "$(page "document.querySelector('.tm-sheet-head > .btn').getBoundingClientRect().width")" 1
  swipe_hold 1500 320
  shoot sheet-gesture
  local scale
  scale=$(page "getComputedStyle(document.querySelector('.tm-sheet')).scale")
  note "INFO $theme sheet scale while held: $scale"
  [ "$scale" != none ] && [ "$scale" != 1 ] && note "PASS $theme the gesture shrinks the sheet" ||
    note "FAIL $theme the gesture shrinks the sheet"
  adb shell input motionevent MOVE 20 1500
  sleep 0.3
  adb shell input motionevent UP 5 1500
  sleep 1.5
  check "a let-go gesture keeps the sheet" "$(page "Boolean(document.querySelector('.tm-sheet'))")" true
  check "and gives it its size back" "$(page "getComputedStyle(document.querySelector('.tm-sheet')).scale")" none
  swipe_hold 1500 600
  adb shell input motionevent UP 600 1500
  sleep 1.5
  check "a finished gesture closes the sheet" "$(sheet_open)" false
  check "and stays on the event" "$(path)" "/t/$code"
  shoot sheet-closed

  # Back closes the sheet, and so does a drag down by its handle; a short drag doesn't.
  open_sheet
  adb shell input keyevent KEYCODE_BACK
  sleep 1.5
  check "Back closes the sheet" "$(sheet_open)" false
  check "and stays on the event" "$(path)" "/t/$code"
  open_sheet
  local x y
  read -r x y <<<"$(point '.tm-sheet-head h2')"
  adb shell input swipe "$x" "$y" "$x" "$((y + 40))" 600
  sleep 1.5
  check "a short drag keeps the sheet" "$(sheet_open)" true
  adb shell input motionevent DOWN "$x" "$y"
  for d in 100 200 300 400; do adb shell input motionevent MOVE "$x" "$((y + d))"; done
  sleep 0.5
  shoot sheet-drag
  adb shell input motionevent MOVE "$x" "$((y + 600))"
  adb shell input motionevent UP "$x" "$((y + 600))"
  sleep 1.5
  check "a drag down by the handle closes the sheet" "$(sheet_open)" false
  check "and stays on the event" "$(path)" "/t/$code"

  # Back closes the account menu before it leaves the page.
  page "document.querySelector('.site-head .tm-acct-button')?.click()" >/dev/null
  until_true "document.querySelector('.tm-acct-menu')"
  sleep 0.5
  shoot menu
  adb shell input keyevent KEYCODE_BACK
  sleep 1.5
  check "Back closes the account menu" "$(page "Boolean(document.querySelector('.tm-acct-menu'))")" false
  check "and stays on the event" "$(path)" "/t/$code"

  # Opened from a link, with nothing to go back to, the arrow goes to Your events, in the app.
  check "the event's title is in the bar" "$(page "document.querySelector('.app-bar-title').textContent")" "Willow Creek Cup"
  tap_el '.app-bar-back'
  sleep 2
  check "with no history, the arrow goes to Your events" "$(page "location.pathname")" "/"
  if in_app; then note "PASS $theme and stays in the app"; else note "FAIL $theme and stays in the app"; fi

  # A dialog holds the page still, and Back closes it.
  go "/settings?section=data"
  until_true "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Export data')"
  page "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export data').click()" >/dev/null
  until_true "document.querySelector('dialog:modal')"
  sleep 1
  shoot dialog
  check "the bar's title says Settings" "$(page "document.querySelector('.app-bar-title').textContent")" Settings
  check "the dialog has 28 dp corners" "$(page "getComputedStyle(document.querySelector('dialog:modal')).borderTopLeftRadius")" 28px
  check "the page behind a dialog holds still" "$(page "getComputedStyle(document.documentElement).overflow")" hidden
  adb shell input keyevent KEYCODE_BACK
  sleep 1.5
  check "Back closes the dialog" "$(page "Boolean(document.querySelector('dialog:modal'))")" false
  check "and stays in Settings" "$(path)" "/settings?section=data"

  # The keyboard comes up over the console's add form, and the field stays in view.
  go "/host/$code?tab=players"
  until_true "document.querySelector('#add-first')"
  sleep 1
  tap_el '#add-first'
  sleep 3
  adb shell dumpsys input_method | grep -q 'mInputShown=true' || { tap_el '#add-first'; sleep 3; }
  shoot keyboard
  check "the focused field stays above the keyboard" \
    "$(page "(() => { const r = document.querySelector('#add-first').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })()")" true
  adb shell input keyevent KEYCODE_BACK
  sleep 1

  # Dropdowns and date and time fields open Material pickers.
  go "/host/$code?tab=event"
  until_true "document.querySelector('#set-start')"
  sleep 1
  local sel opt
  sel=$(page "(() => { const s = [...document.querySelectorAll('main select')].find(s => s.id && s.options.length > 1); return s ? s.id : ''; })()")
  if [ -n "$sel" ]; then
    opt=$(page "(() => { const s = document.getElementById('$sel'); const o = s.options[s.selectedIndex + 1] ?? s.options[s.selectedIndex - 1]; return o.label + '|' + o.value; })()")
    tap_el "#$sel"
    sleep 2.5
    shoot picker-select
    tap_text "${opt%%|*}" || note "FAIL $theme: the dropdown's Material list did not show ${opt%%|*}"
    sleep 1.5
    check "a dropdown takes the pick from its Material list" "$(page "document.getElementById('$sel').value")" "${opt#*|}"
  else
    note "INFO $theme: no dropdown with a choice in the event's settings"
  fi
  tap_el '#set-start'
  sleep 2.5
  shoot picker-date
  tap_text OK || note "FAIL $theme: no Material date picker"
  sleep 2
  shoot picker-time
  tap_text OK || note "FAIL $theme: no Material time picker"
  sleep 1.5
  check "a date and time field takes the Material pickers' answer" \
    "$(page "/^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d$/.test(document.getElementById('set-start').value)")" true
  # Anything a failed step left open closes before the next.
  adb shell dumpsys window | grep -q 'mCurrentFocus=.*MainActivity' || adb shell input keyevent KEYCODE_BACK

  # Wider than a phone, the console's sections are a rail at the left.
  go "/host/$code"
  until_true "document.querySelector('.tm-console > .tm-tabbar')"
  adb shell settings put system accelerometer_rotation 0
  adb shell settings put system user_rotation 1
  sleep 3
  check "held sideways, the sections are a rail" "$(rail)" true
  check "with every tab in view" \
    "$(page "[...document.querySelectorAll('.tm-console > .tm-tabbar [role=tab]')].every(t => t.getBoundingClientRect().bottom <= innerHeight)")" true
  shoot rail-sideways
  adb shell settings put system user_rotation 0
  sleep 2
  adb shell wm size 1800x2400
  sleep 3
  check "on a small tablet, the sections are a rail" "$(rail)" true
  shoot rail-tablet
  adb shell wm size reset
  sleep 3
  check "on a phone, the bar is back" "$(page "getComputedStyle(document.querySelector('.tm-console > .tm-tabbar')).flexDirection")" row

  # After Android ends the app in the background, its page, tab and scroll come back.
  go "/host/$code?tab=players"
  until_true "document.querySelector('#add-first')"
  sleep 1
  local y
  y=$(page "(() => { scrollTo(0, Math.min(250, document.documentElement.scrollHeight - innerHeight)); return Math.round(scrollY); })()")
  sleep 1
  adb shell input keyevent KEYCODE_HOME
  sleep 3
  adb shell am kill "$package"
  sleep 1
  [ -z "$(adb shell pidof "$package" | tr -d '\r')" ] || adb shell am force-stop "$package"
  launch -n "$activity"
  until_true "location.search === '?tab=players' && document.querySelector('#add-first')"
  sleep 2
  check "after Android ends the app, the tab comes back" "$(path)" "/host/$code?tab=players"
  check "and the scroll, $y px" "$(page "Math.abs(Math.round(scrollY) - $y) <= 4")" true
  shoot restored
}

# The app's own copy of the site (SiteCache.kt): it opens offline on the last
# data it read, a deploy reaches it within one launch, and signing out drops
# every read it kept, so nothing of the account shows offline after.
kept_sessions() { adb shell "run-as $package ls files/site/data 2>/dev/null" | tr -d '\r' | grep -vc '^anon$' || true; }

offline() {
  theme=light
  set_theme light
  go "/"
  until_true "document.body.innerText.includes('Willow Creek Cup')"
  sleep 2
  adb shell cmd connectivity airplane-mode enable
  "$here/m3-site.sh" stop
  sleep 3
  adb shell am force-stop "$package"
  launch -n "$activity"
  until_true "$USABLE"
  sleep 2
  shoot offline
  check "offline, the app opens on its own copy, not the offline page" "$(page "Boolean(document.querySelector('main.page')) && !document.getElementById('retry')")" true
  check "with the last data it read" "$(page "document.body.innerText.includes('Willow Creek Cup')")" true

  adb shell cmd connectivity airplane-mode disable
  sleep 5

  # A deploy: the page names a new built file. Within one launch the app runs it.
  printf 'window.__m3Deploy = 1;\n' >dist/assets/m3-deploy.js
  sed -i 's|</head>|<script type="module" src="/assets/m3-deploy.js"></script></head>|' dist/index.html
  "$here/m3-site.sh" start >/dev/null
  adb shell am force-stop "$package"
  launch -n "$activity"
  until_true "$USABLE"
  sleep 6
  note "INFO light the deploy's first launch runs it already: $(page "window.__m3Deploy === 1")"
  adb shell am force-stop "$package"
  launch -n "$activity"
  until_true "$USABLE"
  check "a new deploy reaches the app within one launch" "$(page "window.__m3Deploy === 1")" true

  # Signing out drops every kept read; offline after it, nothing of the account shows.
  note "INFO light kept sessions before signing out: $(kept_sessions)"
  page "document.querySelector('.site-head .tm-acct-button')?.click()" >/dev/null
  until_true "document.querySelector('.tm-acct-menu')"
  page "[...document.querySelectorAll('.tm-acct-menu button, .tm-acct-menu a')].find(b => b.textContent.trim() === 'Sign out')?.click()" >/dev/null
  sleep 3
  check "signing out drops every kept read" "$(kept_sessions)" 0
  adb shell cmd connectivity airplane-mode enable
  "$here/m3-site.sh" stop
  sleep 3
  adb shell am force-stop "$package"
  launch -n "$activity"
  sleep 6
  shoot offline-signed-out
  check "offline after signing out, nothing of the account shows" "$(page "document.body.innerText.includes('Willow Creek Cup')")" false
  adb shell cmd connectivity airplane-mode disable
  "$here/m3-site.sh" start >/dev/null
}

save_logs() { adb logcat -d >"$out/logcat.txt" 2>&1 || true; }
trap save_logs EXIT

adb reverse tcp:4600 tcp:4600
adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural || true
adb install -r "$apk"
adb logcat -c
adb shell wm size | tee -a "$results"
adb shell getprop ro.build.version.sdk | tee -a "$results"
run_theme light
run_theme dark
offline
failures=$(grep -c '^FAIL' "$results" || true)
echo "failures: $failures" | tee -a "$results"
[ "$failures" = 0 ]
