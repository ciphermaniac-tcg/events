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
  sleep 2
  shoot home
  check "home keeps the logo in the bar" \
    "$(page "!document.documentElement.classList.contains('app-up') && getComputedStyle(document.querySelector('.site-head-name')).display !== 'none'")" true

  # A site link while the app runs loads in it, and Back returns to the page before.
  view "/host/$code"
  until_true "location.pathname === '/host/$code' && document.querySelector('.tm-tabbar, .tabs')"
  sleep 2
  shoot console
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
}

offline() {
  theme=light
  set_theme light
  "$here/m3-site.sh" stop
  go "/history"
  sleep 4
  shoot offline
  check "the offline page stands in" "$(page "Boolean(document.getElementById('retry'))")" true
  "$here/m3-site.sh" start >/dev/null
  page "document.getElementById('retry')?.click()" >/dev/null
  until_true "location.pathname === '/history' && !document.getElementById('retry')" ||
    note "FAIL light: Retry did not bring the page back"
  sleep 2
  shoot offline-back
  check "Retry brings the page back" "$(path)" "/history"
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
