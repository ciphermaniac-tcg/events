#!/usr/bin/env bash
# Runs the feel audit (feel.mjs) on the running emulator: the build on the
# runner's site first, then the build on the live site.
# Usage: feel-run.sh <out-dir> <small-code> <big-code> <live-code>. Run from the repo root.
set -uo pipefail

out=$1
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
adb reverse tcp:4600 tcp:4600
adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural || true
adb shell settings put global stay_on_while_plugged_in 7
adb shell input keyevent KEYCODE_WAKEUP

adb install -r "$RUNNER_TEMP/local.apk"
node "$here/feel.mjs" local "$out" "$2" "$3" 2>&1 | tee "$out/feel-local.log"
adb logcat -d >"$out/logcat-local.txt" 2>&1 || true
adb uninstall com.ciphermaniac.events.debug

adb install -r "$RUNNER_TEMP/live.apk"
node "$here/feel.mjs" live "$out" "$4" 2>&1 | tee "$out/feel-live.log"
adb logcat -d >"$out/logcat-live.txt" 2>&1 || true
exit 0
