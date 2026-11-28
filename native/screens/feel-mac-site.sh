#!/usr/bin/env bash
# The site for the Mac feel audit (feel-mac.py), never merged: dist/ under
# wrangler over HTTPS as events.ciphermaniac.com itself, with a local D1 and
# the dev login, so the unchanged app runs against it with the live origin,
# its Secure cookies and its capabilities. A throwaway CA signs the
# certificate and the system keychain trusts it; /etc/hosts points the name
# here. Run from the repo root after a build.
# Usage: feel-mac-site.sh cert|start|stop|hosts-on|hosts-off|seed
set -euo pipefail

port=${FEEL_PORT:-443}
host=events.ciphermaniac.com
base=https://$host
[ "$port" = 443 ] || base=$base:$port
state=${FEEL_STATE:-${RUNNER_TEMP:-$HOME/.cache}/feel-site}
mkdir -p "$state"
# --resolve keeps every request here, never on the live site.
c() { curl -s --cacert "$state/ca.crt" --resolve "$host:$port:127.0.0.1" "$@"; }

up() {
  for _ in $(seq 1 90); do
    c -o /dev/null --max-time 2 "$base/" && return
    sleep 1
  done
  cat "$state/site.log"
  return 1
}

flush() {
  sudo dscacheutil -flushcache 2>/dev/null || true
  sudo killall -HUP mDNSResponder 2>/dev/null || true
}

case $1 in
cert)
  cd "$state"
  # Homebrew's OpenSSL 3 where there is one: the system's LibreSSL writes a
  # certificate macOS refuses.
  ssl=openssl
  for candidate in /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
    [ -x "$candidate" ] && ssl=$candidate && break
  done
  printf '[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=Feel Audit CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n' >ca.cnf
  printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nauthorityKeyIdentifier=keyid\nsubjectKeyIdentifier=hash\n' "$host" >ext.cnf
  "$ssl" req -x509 -newkey rsa:2048 -nodes -days 7 -config ca.cnf -extensions ca -keyout ca.key -out ca.crt 2>/dev/null
  "$ssl" req -newkey rsa:2048 -nodes -subj "/CN=$host" -keyout site.key -out site.csr 2>/dev/null
  "$ssl" x509 -req -in site.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 7 -extfile ext.cnf -out site.crt 2>/dev/null
  "$ssl" x509 -in site.crt -noout -text | grep -A1 -E "X509v3|Issuer" || true
  if [ "$(uname)" = Darwin ]; then
    sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt
    security verify-cert -c site.crt -p ssl -s "$host" || echo "verify-cert did not pass; the app's own load decides"
  fi
  ;;
start)
  if [ ! -d "$state/d1" ]; then
    npx wrangler d1 execute ciphermaniac-tournaments --local --persist-to "$state/d1" \
      --file config/d1/tournaments.sql >/dev/null
  fi
  args=(pages dev dist --ip 127.0.0.1 --port "$port" --persist-to "$state/d1"
    --local-protocol https --https-key-path "$state/site.key" --https-cert-path "$state/site.crt"
    --binding DEV_LOGIN=true --binding ENVIRONMENT=development)
  # macOS lets any user listen on 443, so wrangler runs unprivileged and
  # its D1 files stay writable by the seed.
  npx wrangler "${args[@]}" >"$state/site.log" 2>&1 &
  echo $! >"$state/site.pid"
  up
  ;;
stop)
  sudo pkill -f 'wrangler pages dev' 2>/dev/null || pkill -f 'wrangler pages dev' || true
  sudo pkill -f workerd 2>/dev/null || pkill -f workerd || true
  sleep 2
  ;;
hosts-on)
  echo "127.0.0.1 $host # feel" | sudo tee -a /etc/hosts >/dev/null
  flush
  ;;
hosts-off)
  sudo sed -i '' '/# feel$/d' /etc/hosts
  flush
  ;;
seed)
  jar=$state/jar.txt
  role() {
    npx wrangler d1 execute ciphermaniac-tournaments --local --persist-to "$state/d1" \
      --command "UPDATE users SET role='$1'" >/dev/null
  }
  c -c "$jar" -b "$jar" -o /dev/null "$base/api/auth/login/dev?name=Reese"
  post() { c -f -b "$jar" -H 'content-type: application/json' -H "origin: $base" -d "$2" "$base$1"; }
  code_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).code))'; }
  role admin
  small=$(post /api/tournaments '{"mode":"swiss","name":"Willow Creek Cup","roundTime":50,"settings":{}}' | code_of)
  for name in "Avery Lindqvist" "Blake Okafor" "Casey Marlowe" "Devon Ashby" \
    "Emery Quill" "Harper Vance" "Jordan Pike" "Morgan Teller"; do
    post "/api/tournaments/$small/commands" \
      "{\"command\":{\"type\":\"addPlayer\",\"player\":{\"firstName\":\"${name% *}\",\"lastName\":\"${name#* }\"}}}" >/dev/null
  done
  post "/api/tournaments/$small/commands" '{"command":{"type":"pairRound","pod":"masters"}}' >/dev/null
  post "/api/tournaments/$small/commands" '{"command":{"type":"startClock","pod":"masters"}}' >/dev/null
  big=$(post /api/tournaments '{"mode":"swiss","name":"Larkspur Open","roundTime":50,"settings":{}}' | code_of)
  firsts=(Avery Blake Casey Devon Emery Finley Gray Harper Indigo Jordan Kai Logan Morgan Noel Oakley Parker)
  lasts=(Ashby Brightwater Calloway Dunmore Everly Fairbanks Greenleaf Holloway)
  for first in "${firsts[@]}"; do
    for last in "${lasts[@]}"; do
      post "/api/tournaments/$big/commands" \
        "{\"command\":{\"type\":\"addPlayer\",\"player\":{\"firstName\":\"$first\",\"lastName\":\"$last\"}}}" >/dev/null
    done
  done
  post "/api/tournaments/$big/commands" '{"command":{"type":"pairRound","pod":"masters"}}' >/dev/null
  post "/api/tournaments/$big/commands" '{"command":{"type":"startClock","pod":"masters"}}' >/dev/null
  role community
  echo "$small $big"
  ;;
esac
