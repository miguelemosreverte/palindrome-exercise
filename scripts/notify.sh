#!/bin/bash
# Send a notification to the user's phone via Bridge
# Usage: ./scripts/notify.sh SESSION_ID "message" [action]
#
# Actions: notify, summary, ask, status, error, success
#
# Examples:
#   ./scripts/notify.sh abc123 "Build completed!" success
#   ./scripts/notify.sh abc123 "Should I deploy to prod?" ask
#   ./scripts/notify.sh abc123 "Analyzing logs..." status

SESSION_ID="${1:?Usage: notify.sh SESSION_ID message [action]}"
MESSAGE="${2:?Usage: notify.sh SESSION_ID message [action]}"
ACTION="${3:-notify}"

API_BASE="https://palindrome-exercise.vercel.app"

curl -s -X POST "$API_BASE/api/bridge/agent" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"action\":\"$ACTION\",\"message\":\"$MESSAGE\"}"
