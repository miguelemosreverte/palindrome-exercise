#!/usr/bin/env bash
# Coupon management
# Usage:
#   ./scripts/coupon.sh list                        # list all coupons
#   ./scripts/coupon.sh create CODE 2.00            # create coupon worth $2, unlimited uses
#   ./scripts/coupon.sh create CODE 1.00 50         # create coupon worth $1, max 50 uses
#   ./scripts/coupon.sh disable CODE                # disable a coupon

RTDB="https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app"
COUPONS_PATH="mercadopago-bridge/coupons"

ACTION="${1:-list}"

if [ "$ACTION" = "list" ]; then
  echo "Coupons:"
  curl -s "${RTDB}/${COUPONS_PATH}.json" | node -e "
    const d=require('fs').readFileSync(0,'utf8');
    try {
      const j=JSON.parse(d);
      if (!j) { console.log('  (none)'); process.exit(); }
      Object.entries(j).forEach(([code, c]) => {
        const status = c.disabled ? '\x1b[31mdisabled\x1b[0m' : '\x1b[32mactive\x1b[0m';
        console.log(\`  \x1b[1m\${code}\x1b[0m  \$\${c.amount_usd}  uses:\${c.uses||0}/\${c.max_uses||'∞'}  \${status}\`);
      });
    } catch { console.log(d); }
  "

elif [ "$ACTION" = "create" ]; then
  CODE="$(echo "$2" | tr '[:upper:]' '[:lower:]')"
  AMOUNT="${3:-1}"
  MAX_USES="${4:-0}"
  if [ -z "$CODE" ]; then echo "Usage: coupon.sh create CODE AMOUNT [MAX_USES]"; exit 1; fi
  echo "Creating coupon '$CODE' worth \$${AMOUNT} (max uses: ${MAX_USES:-unlimited})..."
  curl -s -X PUT "${RTDB}/${COUPONS_PATH}/${CODE}.json" \
    -H "Content-Type: application/json" \
    -d "{\"amount_usd\":${AMOUNT},\"max_uses\":${MAX_USES},\"uses\":0,\"created_at\":$(date +%s000)}" | node -e "
    const d=require('fs').readFileSync(0,'utf8');
    console.log('Created:', d);
  "

elif [ "$ACTION" = "disable" ]; then
  CODE="$(echo "$2" | tr '[:upper:]' '[:lower:]')"
  if [ -z "$CODE" ]; then echo "Usage: coupon.sh disable CODE"; exit 1; fi
  curl -s -X PATCH "${RTDB}/${COUPONS_PATH}/${CODE}.json" \
    -H "Content-Type: application/json" \
    -d '{"disabled":true}'
  echo "Disabled: $CODE"

else
  echo "Usage: coupon.sh [list|create|disable]"
fi
