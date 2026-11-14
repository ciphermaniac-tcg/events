#!/usr/bin/env bash
# Launches the Mac app from its DMG and screenshots it in light and dark:
# the first seconds of a cold launch, home, the Go menu, sign-in and an event
# page. Each page is its own launch, opened on that page through the app's
# last-page file (src-tauri/src/last_page.rs), whose rewrite on each page load
# also times the launch. Writes macos-<theme>-<step>.png (the window) and
# macos-<theme>-<step>-screen.png (the whole screen) plus timings.txt.
# Usage: macos.sh <dmg> <out-dir>; EVENT_CODE names the event page.
set -euo pipefail

dmg=$1
out=$2
event_code=${EVENT_CODE:-ZZZZZZ}
site=https://events.ciphermaniac.com
data="$HOME/Library/Application Support/com.ciphermaniac.events"
last_page="$data/last-page"
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
mkdir -p "$out"
timings="$out/timings.txt"
: >"$timings"

now_ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'; }
log() { echo "$*" | tee -a "$timings"; }

install_app() {
  local mount="$work/mount"
  mkdir -p "$mount"
  hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" >/dev/null
  cp -R "$(find "$mount" -maxdepth 1 -name '*.app' | head -n 1)" "$work/"
  hdiutil detach "$mount" >/dev/null
  app=$(find "$work" -maxdepth 1 -name '*.app' | head -n 1)
  bin="$app/Contents/MacOS/$(defaults read "$app/Contents/Info" CFBundleExecutable)"
  swiftc -O -o "$work/window" "$here/window.swift"
}

set_theme() {
  local dark=false
  [ "$1" = dark ] && dark=true
  if ! osascript -e "tell application \"System Events\" to tell appearance preferences to set dark mode to $dark"; then
    echo "System Events refused the appearance; writing the default instead"
    if [ "$dark" = true ]; then
      defaults write -g AppleInterfaceStyle Dark
    else
      defaults delete -g AppleInterfaceStyle 2>/dev/null || true
    fi
  fi
  echo "appearance: $(defaults read -g AppleInterfaceStyle 2>/dev/null || echo Light)"
}

# Opens the next launch on `path`, or on home with no saved state at all.
open_on() {
  if [ -z "$1" ]; then
    rm -rf "$data" "$HOME/Library/WebKit/com.ciphermaniac.events" "$HOME/Library/Caches/com.ciphermaniac.events"
    return
  fi
  mkdir -p "$data"
  printf '%s%s' "$site" "$1" >"$last_page"
  touch -t 200001010000 "$last_page"
}

page_loaded() {
  [ -f "$last_page" ] && [ "$(stat -f %m "$last_page")" -gt 946771200 ]
}

window_id() { "$work/window" "$pid"; }

shoot_screen() { screencapture -x "$out/macos-$theme-$1.png"; }

shoot() {
  local id
  id=$(window_id)
  shoot_screen "$1-screen"
  if [ -n "$id" ]; then
    screencapture -x -o -l "$id" "$out/macos-$theme-$1.png"
  else
    echo "no window on screen for $1"
  fi
}

# Screenshots the screen about 300 ms, 1 s and 2 s after launch.
shoot_cold() {
  local at
  for at in 300 1000 2000; do
    while [ $(($(now_ms) - start)) -lt "$at" ]; do sleep 0.02; done
    shoot_screen "cold-$(printf '%04d' "$at")ms"
    log "$theme cold $at ms shot taken at $(($(now_ms) - start)) ms, window: $(window_id || true)"
  done
}

# Waits for the window to show and the page to load, noting how long each took.
wait_for_load() {
  local shown='' loaded='' elapsed=0
  while [ "$elapsed" -lt 30000 ] && { [ -z "$shown" ] || [ -z "$loaded" ]; }; do
    elapsed=$(($(now_ms) - start))
    [ -z "$shown" ] && [ -n "$(window_id)" ] && shown=$elapsed
    [ -z "$loaded" ] && page_loaded && loaded=$elapsed
    sleep 0.05
  done
  log "$theme $1: launch to window ${shown:-never} ms, to page load ${loaded:-never} ms"
  sleep 2
}

launch() {
  start=$(now_ms)
  "$bin" >>"$out/app.log" 2>&1 &
  pid=$!
}

quit() {
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  sleep 1
}

# Opens the Go menu by System Events, which needs Accessibility for the
# runner's shell; says so and moves on when it is refused.
shoot_menu() {
  osascript -e "tell application \"System Events\" to tell (first process whose unix id is $pid)" \
    -e 'set frontmost to true' -e 'click menu bar item "Go" of menu bar 1' -e 'end tell' &
  local clicker=$!
  sleep 2
  shoot_screen menu-go
  osascript -e 'tell application "System Events" to key code 53' || echo "could not press Escape"
  sleep 0.5
  kill "$clicker" 2>/dev/null || true
  wait "$clicker" 2>/dev/null || log "$theme menu: System Events could not open the Go menu"
}

run_theme() {
  theme=$1
  set_theme "$theme"
  open_on ''
  launch
  shoot_cold
  wait_for_load home
  shoot home
  shoot_menu
  quit
  open_on /sign-in
  launch
  wait_for_load sign-in
  shoot sign-in
  quit
  open_on "/t/$event_code"
  launch
  wait_for_load event
  shoot event
  quit
}

install_app
system_profiler SPDisplaysDataType | grep -i resolution | tee -a "$timings" || true
run_theme light
run_theme dark
set_theme light
