#!/usr/bin/env bash
# Checks the Android app's native behaviour on the running emulator against
# the local site (m3-site.sh), in light and dark: system bars and insets, a
# site link opening the app warm and cold, Back and the predictive back
# gesture on a sheet, Back on a menu and a dialog, the page held still under
# a dialog, the keyboard over a field, and the offline page coming back on
# Retry. Screenshots are m3-<theme>-<step>.png; results.txt says what held.
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

# Taps the centre of the first element the selector finds, in screen pixels.
tap_el() {
  local rect top
  rect=$(page "(() => { const r = document.querySelector('$1')?.getBoundingClientRect(); \
return r ? [r.x + r.width / 2, r.y + r.height / 2, devicePixelRatio].join(' ') : '' })()")
  top=$(webview_top)
  [ -n "$rect" ] || return 1
  read -r x y dpr <<<"$rect"
  adb shell input tap "$(node -e "console.log(Math.round($x * $dpr))")" \
    "$(node -e "console.log(Math.round($y * $dpr + $top))")"
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

  # A site link while the app runs loads in it, and Back returns to the page before.
  view "/host/$code"
  until_true "location.pathname === '/host/$code' && document.querySelector('.tm-tabbar, .tabs')"
  sleep 2
  shoot console
  check "warm link opens the console" "$(path)" "/host/$code"
  adb shell input keyevent KEYCODE_BACK
  sleep 2
  check "Back after a warm link" "$(path)" "/"

  # A link that launches the app is the page it opens on.
  adb shell am force-stop "$package"
  view "/t/$code"
  until_true "location.pathname === '/t/$code' && document.body.innerText.includes('Avery')"
  check "cold link opens the event" "$(path)" "/t/$code"
  check "cold link loads once" "$(page 'history.length')" "1"
  sleep 2
  shoot public

  # The player sheet: the gesture shrinks it, letting go restores it, finishing closes it.
  page "[...document.querySelectorAll('button, a')].find(b => /^Avery/.test(b.textContent.trim()))?.click()" >/dev/null
  until_true "document.querySelector('.tm-sheet')" || note "FAIL $theme: the player sheet did not open"
  sleep 1
  shoot sheet
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
  check "a finished gesture closes the sheet" "$(page "Boolean(document.querySelector('.tm-sheet'))")" false
  check "and stays on the event" "$(path)" "/t/$code"
  shoot sheet-closed

  # Back closes the account menu before it leaves the page.
  page "document.querySelector('.site-head .tm-acct-button')?.click()" >/dev/null
  until_true "document.querySelector('.tm-acct-menu')"
  sleep 0.5
  shoot menu
  adb shell input keyevent KEYCODE_BACK
  sleep 1.5
  check "Back closes the account menu" "$(page "Boolean(document.querySelector('.tm-acct-menu'))")" false
  check "and stays on the event" "$(path)" "/t/$code"

  # A dialog holds the page still, and Back closes it.
  go "/settings?section=data"
  until_true "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Export data')"
  page "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export data').click()" >/dev/null
  until_true "document.querySelector('dialog:modal')"
  sleep 1
  shoot dialog
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
grep -c '^FAIL' "$results" | xargs echo "failures:" | tee -a "$results"
