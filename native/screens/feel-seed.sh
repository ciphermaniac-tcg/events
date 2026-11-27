#!/usr/bin/env bash
# A second, larger event for the feel audit (feel.mjs): 128 made-up players
# with round 1 paired, so the pairings, standings and players tables are long.
# Run after `m3-site.sh seed`, whose signed-in cookie jar it reuses. Prints the code.
set -euo pipefail

port=${M3_PORT:-4600}
base=http://127.0.0.1:$port
state=${M3_STATE:-${RUNNER_TEMP:-/tmp}/m3-site}
jar=$state/jar.txt

role() {
  npx wrangler d1 execute ciphermaniac-tournaments --local --persist-to "$state/d1" \
    --command "UPDATE users SET role='$1'" >/dev/null
}
post() { curl -sf -b "$jar" -H 'content-type: application/json' -H "origin: $base" -d "$2" "$base$1"; }
# A Community organizer runs one event a day, so this one goes in as an Admin's.
role admin
code=$(post /api/tournaments '{"mode":"swiss","name":"Larkspur Open","roundTime":50,"settings":{}}' |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).code))')
firsts=(Avery Blake Casey Devon Emery Finley Gray Harper Indigo Jordan Kai Logan Morgan Noel Oakley Parker)
lasts=(Ashby Brightwater Calloway Dunmore Everly Fairbanks Greenleaf Holloway)
for first in "${firsts[@]}"; do
  for last in "${lasts[@]}"; do
    post "/api/tournaments/$code/commands" \
      "{\"command\":{\"type\":\"addPlayer\",\"player\":{\"firstName\":\"$first\",\"lastName\":\"$last\"}}}" >/dev/null
  done
done
post "/api/tournaments/$code/commands" '{"command":{"type":"pairRound","pod":"masters"}}' >/dev/null
post "/api/tournaments/$code/commands" '{"command":{"type":"startClock","pod":"masters"}}' >/dev/null
role community
echo "$code"
