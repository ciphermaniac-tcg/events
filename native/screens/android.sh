#!/usr/bin/env bash
# Installs the APK on the running emulator and screenshots the app in light
# and dark: the first seconds of a cold launch, home, sign-in, home again
# after Back, the keyboard up on the event code field, and the event page that
# code opens. Taps what uiautomator finds on screen and reads the page over
# the DevTools protocol (cdp.mjs) to know when it has loaded. Writes
# android-<theme>-<step>.png, the launch recordings, the webview's console
# and timings.txt, plus logcat and any ANR traces.
# Usage: android.sh <apk> <out-dir>; EVENT_CODE is typed into the code field.
set -euo pipefail

apk=$1
out=$2
event_code=${EVENT_CODE:-ZZZZZZ}
package=com.ciphermaniac.events
activity=$package/.MainActivity
port=9222
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
mkdir -p "$out"
timings="$out/timings.txt"
: >"$timings"

now_ms() { date +%s%3N; }
log() { echo "$*" | tee -a "$timings"; }

shoot() { adb exec-out screencap -p >"$out/android-$theme-$1.png"; }

# Points the DevTools port at the app's webview, once it has one.
connect() {
  local pid
  adb forward --remove "tcp:$port" 2>/dev/null || true
  for _ in $(seq 1 100); do
    pid=$(adb shell pidof "$package" | tr -d '\r')
    if [ -n "$pid" ] && adb shell cat /proc/net/unix | grep -q "webview_devtools_remote_$pid"; then
      adb forward "tcp:$port" "localabstract:webview_devtools_remote_$pid" >/dev/null
      return
    fi
    sleep 0.2
  done
  log "$theme: the webview never opened DevTools"
}

page() { timeout 20 node "$here/cdp.mjs" "$port" eval "$1" 2>/dev/null; }

# Waits up to 30 s for the page to show this text, printing how long it took
# since now or the time given.
wait_for_text() {
  local since=${2:-$(now_ms)} needle
  needle=$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1")
  until [ "$(page "document.body?.innerText.includes($needle) ?? false")" = true ]; do
    if [ $(($(now_ms) - since)) -gt 30000 ]; then
      echo never
      return 1
    fi
    sleep 0.2
  done
  echo $(($(now_ms) - since))
}

# The centre of the first node uiautomator finds, retried for up to 20 s:
# it cannot dump while the screen is animating, as home's sample event is.
find_node() {
  local since
  since=$(now_ms)
  while [ $(($(now_ms) - since)) -lt 20000 ]; do
    if adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 &&
      adb shell cat /sdcard/ui.xml >"$work/ui.xml" 2>/dev/null &&
      python3 -I "$here/ui.py" "$work/ui.xml" "$@"; then
      return
    fi
    sleep 0.5
  done
  return 1
}

tap() {
  local point
  point=$(find_node "$@") || {
    log "$theme: nothing to tap for $*"
    return 1
  }
  # shellcheck disable=SC2086 # the point is "x y"
  adb shell input tap $point
}

keyboard_shown() { adb shell dumpsys input_method | grep -q 'mInputShown=true'; }

set_theme() {
  theme=$1
  local night=no
  [ "$theme" = dark ] && night=yes
  adb shell cmd uimode night "$night"
}

# Frames of the launch's screen recording about 300 ms, 1 s and 2 s in;
# screencap is too slow on the emulator to take them as it goes.
shoot_cold() {
  local video="$out/android-$theme-cold.mp4" at offset frame
  adb pull /sdcard/cold.mp4 "$video" >/dev/null
  for at in 300 1000 2000; do
    offset=$(((start - recording + at) / 1000)).$(printf '%03d' $(((start - recording + at) % 1000)))
    frame="$out/android-$theme-cold-$(printf '%04d' "$at")ms.png"
    ffmpeg -loglevel error -y -ss "$offset" -i "$video" -frames:v 1 "$frame"
    # The recording stops at the last change, so a still screen is its last frame.
    [ -s "$frame" ] || ffmpeg -loglevel error -y -sseof -0.2 -i "$video" -frames:v 1 "$frame"
  done
}

launch_fresh() {
  adb shell am force-stop "$package"
  adb shell pm clear "$package" >/dev/null
  adb shell screenrecord --time-limit 15 /sdcard/cold.mp4 &
  local recorder=$!
  recording=$(now_ms)
  sleep 1
  start=$(now_ms)
  adb shell am start -W -n "$activity" >"$work/start.txt"
  log "$theme first frame (am start -W): $(grep -E 'TotalTime|WaitTime' "$work/start.txt" | tr -d '\r' | xargs)"
  connect
  log "$theme home: launch to page content $(wait_for_text 'Run an event' "$start") ms"
  wait "$recorder" || true
  shoot_cold
}

in_app() { adb shell dumpsys activity activities | grep -q "ResumedActivity.*$package"; }

run_theme() {
  set_theme "$1"
  launch_fresh
  sleep 2
  shoot home
  timeout 60 node "$here/cdp.mjs" "$port" report "$out/android-$theme-webview.json" >/dev/null ||
    log "$theme: could not read the webview's console"
  wait_for_text 'Run an event' >/dev/null || true
  tap text 'or sign in' || true
  log "$theme sign-in: $(wait_for_text 'Sign in with Discord') ms"
  sleep 2
  shoot sign-in
  adb shell input keyevent KEYCODE_BACK
  sleep 2
  shoot back
  in_app || log "$theme: Back left the app"
  in_app || launch_fresh
  tap class android.widget.EditText || true
  sleep 3
  # A first tap can focus the field without the keyboard; a second brings it up.
  keyboard_shown || tap class android.widget.EditText || true
  sleep 3
  keyboard_shown || log "$theme: the keyboard did not come up"
  shoot keyboard
  adb shell input text "$event_code"
  adb shell input keyevent KEYCODE_ENTER
  log "$theme event: $(wait_for_text "$event_code") ms"
  sleep 2
  shoot event
}

save_logs() {
  adb logcat -d >"$out/logcat.txt" 2>&1 || true
  if adb root >/dev/null 2>&1; then
    sleep 2
    adb pull /data/anr "$out/anr" >/dev/null 2>&1 || true
  fi
}
trap save_logs EXIT

adb install -r "$apk"
adb logcat -c
adb shell wm size | tee -a "$timings"
adb shell wm density | tee -a "$timings"
adb shell dumpsys package com.google.android.webview | grep -m 1 versionName | tee -a "$timings" || true
run_theme light
run_theme dark
