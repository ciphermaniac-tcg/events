#!/usr/bin/env bash
# The site for the Android check (m3-check.sh): dist/ under wrangler on port
# 4600 with a local D1 and the dev login, seeded with one paired event run by
# "Reese" and eight made-up players. Run from the repo root after a build.
# Usage: m3-site.sh start|stop|seed. Prints the event code on seed.
set -euo pipefail

port=${M3_PORT:-4600}
base=http://127.0.0.1:$port
state=${M3_STATE:-${RUNNER_TEMP:-/tmp}/m3-site}
mkdir -p "$state"

up() {
  for _ in $(seq 1 120); do
    curl -sf -o /dev/null "$base/" && return
    sleep 1
  done
  cat "$state/site.log"
  return 1
}

case $1 in
start)
  if [ ! -d "$state/d1" ]; then
    npx wrangler d1 execute ciphermaniac-tournaments --local --persist-to "$state/d1" \
      --file config/d1/tournaments.sql >/dev/null
  fi
  setsid npx wrangler pages dev dist --ip 127.0.0.1 --port "$port" --persist-to "$state/d1" \
    --binding DEV_LOGIN=true --binding ENVIRONMENT=development >"$state/site.log" 2>&1 &
  echo $! >"$state/site.pid"
  up
  ;;
stop)
  kill -- -"$(cat "$state/site.pid")" 2>/dev/null || true
  for _ in $(seq 1 30); do
    curl -sf -o /dev/null "$base/" || exit 0
    sleep 1
  done
  ;;
seed)
  jar=$state/jar.txt
  curl -s -c "$jar" -b "$jar" -o /dev/null "$base/api/auth/login/dev?name=Reese"
  npx wrangler d1 execute ciphermaniac-tournaments --local --persist-to "$state/d1" \
    --command "UPDATE users SET role='community'" >/dev/null
  post() { curl -sf -b "$jar" -H 'content-type: application/json' -H "origin: $base" -d "$2" "$base$1"; }
  code=$(post /api/tournaments '{"mode":"swiss","name":"Willow Creek Cup","roundTime":50,"settings":{}}' |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).code))')
  for name in "Avery Lindqvist" "Blake Okafor" "Casey Marlowe" "Devon Ashby" \
    "Emery Quill" "Harper Vance" "Jordan Pike" "Morgan Teller"; do
    post "/api/tournaments/$code/commands" \
      "{\"command\":{\"type\":\"addPlayer\",\"player\":{\"firstName\":\"${name% *}\",\"lastName\":\"${name#* }\"}}}" >/dev/null
  done
  post "/api/tournaments/$code/commands" '{"command":{"type":"pairRound","pod":"masters"}}' >/dev/null
  post "/api/tournaments/$code/commands" '{"command":{"type":"startClock","pod":"masters"}}' >/dev/null
  echo "$code"
  ;;
esac
