#!/bin/bash
# Bridge CLI — interact with the user's phone from any script or agent
#
# Usage:
#   bridge notify "Build done!"
#   bridge ask "Deploy to prod?"
#   bridge summary "Here's what I did: ..."
#   bridge status "Working on X"
#   bridge send "Any message"
#   bridge read               # Read recent messages from user
#
# Set BRIDGE_SESSION env var or pass --session SESSION_ID

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_BASE="https://palindrome-exercise.vercel.app"

# Try to find session ID
SESSION_ID="${BRIDGE_SESSION:-}"
if [ -z "$SESSION_ID" ] && [ -f "$HOME/.bridge-session" ]; then
  SESSION_ID=$(cat "$HOME/.bridge-session")
fi

ACTION="$1"
shift
MESSAGE="$*"

case "$ACTION" in
  notify|ask|summary|status|error|success)
    curl -s -X POST "$API_BASE/api/bridge/agent" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\":\"$SESSION_ID\",\"action\":\"$ACTION\",\"message\":\"$MESSAGE\"}" | node -e "d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{let j=JSON.parse(d);console.log(j.ok?'✓ Delivered':'✗ '+j.error)}catch{console.log(d)}})" 2>/dev/null || echo "$SESSION_ID"
    ;;
  send)
    curl -s -X POST "$API_BASE/api/bridge/agent" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\":\"$SESSION_ID\",\"action\":\"notify\",\"message\":\"$MESSAGE\"}"
    ;;
  read)
    curl -s "$API_BASE/api/bridge/messages?session=$SESSION_ID" | node -e "
      d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        let j=JSON.parse(d);
        (j.messages||[]).slice(-10).forEach(m=>console.log('['+m.from+'] '+m.content));
      })" 2>/dev/null
    ;;
  *)
    echo "Usage: bridge <notify|ask|summary|status|error|success|send|read> <message>"
    echo "Set BRIDGE_SESSION env var or ~/.bridge-session file"
    ;;
esac
