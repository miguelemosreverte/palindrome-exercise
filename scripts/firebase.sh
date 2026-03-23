#!/usr/bin/env bash
# Firebase RTDB inspector
# Usage:
#   ./scripts/firebase.sh                           # list top-level keys under mercadopago-bridge
#   ./scripts/firebase.sh payments                  # list payment records
#   ./scripts/firebase.sh coupons                   # list coupons
#   ./scripts/firebase.sh users                     # list users
#   ./scripts/firebase.sh demo-anonymous            # list anonymous demo sessions
#   ./scripts/firebase.sh path/to/anything          # read any subpath
#   ./scripts/firebase.sh payments --shallow        # shallow read (keys only)

RTDB="https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app"
ROOT="mercadopago-bridge"

SUBPATH="${1:-}"
EXTRA="${2:-}"

if [ -z "$SUBPATH" ]; then
  echo "Top-level keys under /${ROOT}:"
  curl -s "${RTDB}/${ROOT}.json?shallow=true" | node -e "
    const d=require('fs').readFileSync(0,'utf8');
    try { const j=JSON.parse(d); Object.keys(j).forEach(k=>console.log('  '+k)); }
    catch { console.log(d); }
  "
  exit 0
fi

URL="${RTDB}/${ROOT}/${SUBPATH}.json"
if [ "$EXTRA" = "--shallow" ]; then
  URL="${URL}?shallow=true"
fi

curl -s "$URL" | node -e "
  const d=require('fs').readFileSync(0,'utf8');
  try { console.log(JSON.stringify(JSON.parse(d), null, 2)); }
  catch { console.log(d); }
"
