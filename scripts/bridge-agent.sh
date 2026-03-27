#!/bin/bash
# Bridge Agent — a living AI that listens to Telegram and responds via Claude CLI.
# No API key needed — uses `claude` directly.
#
# Usage:
#   ./scripts/bridge-agent.sh
#
# Requires: claude CLI installed, bridge session active

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_BASE="https://palindrome-exercise.vercel.app"

# Session
SESSION="${BRIDGE_SESSION:-}"
[ -z "$SESSION" ] && [ -f "$HOME/.bridge/session" ] && SESSION=$(cat "$HOME/.bridge/session")
[ -z "$SESSION" ] && [ -f "$HOME/.bridge-session" ] && SESSION=$(cat "$HOME/.bridge-session")

if [ -z "$SESSION" ]; then
  echo "No session. Set BRIDGE_SESSION or run bridge-daemon.sh start"
  exit 1
fi

echo "Bridge Agent starting..."
echo "Session: ${SESSION:0:8}..."
echo "Using: claude CLI (--dangerously-skip-permissions)"

SEEN_FILE=$(mktemp)
INITIALIZED=false

# Build project context for claude
PROJECT_CONTEXT=$(head -100 "$PROJECT_ROOT/CLAUDE.md" 2>/dev/null)
RECENT_COMMITS=$(cd "$PROJECT_ROOT" && git log --oneline -10 2>/dev/null)

send_bridge() {
  local action="$1"
  local message="$2"
  # Use python to safely JSON-encode the message
  python3 -c "
import json, sys, urllib.request
data = json.dumps({
    'sessionId': sys.argv[1],
    'action': sys.argv[2],
    'message': sys.argv[3]
}).encode()
req = urllib.request.Request(sys.argv[4] + '/api/bridge/agent', data=data,
    headers={'Content-Type': 'application/json'})
try: urllib.request.urlopen(req)
except: pass
" "$SESSION" "$action" "$message" "$API_BASE" 2>/dev/null
}

ask_claude() {
  local user_message="$1"
  claude --dangerously-skip-permissions --output-format text --model sonnet -p \
    "You are Bridge Agent, an enthusiastic AI assistant living inside the Bridge project. You communicate with users via Telegram.

Keep responses SHORT (under 400 chars). Be enthusiastic but concise. Do not use Markdown formatting.

Recent commits:
$RECENT_COMMITS

The user sent this message via Telegram. Respond naturally:
$user_message" 2>/dev/null
}

startup_greeting() {
  local greeting
  greeting=$(claude --dangerously-skip-permissions --output-format text --model sonnet -p \
    "You are Bridge Agent. You just came online in the Bridge project (desktop-to-phone AI communication system).

Recent commits:
$RECENT_COMMITS

Project summary:
$PROJECT_CONTEXT

Introduce yourself in under 500 chars. Mention what was recently shipped and suggest what to build next. Be enthusiastic. Do not use Markdown formatting." 2>/dev/null)
  if [ -n "$greeting" ]; then
    echo "[agent] $greeting"
    send_bridge "notify" "$greeting"
  else
    echo "[agent] greeting failed"
  fi
}

# Process messages from the API, piping curl directly to python
poll_and_respond() {
  curl -s "$API_BASE/api/bridge/messages?session=$SESSION" 2>/dev/null | \
    python3 -c "
import json, sys, os

seen_file = '$SEEN_FILE'
initialized = '$INITIALIZED'

try:
    data = json.load(sys.stdin)
except:
    sys.exit(0)

msgs = data.get('messages', [])
if not msgs:
    sys.exit(0)

try:
    with open(seen_file) as f:
        seen = set(f.read().splitlines())
except:
    seen = set()

new_msgs = []
for msg in msgs:
    key = (msg.get('timestamp','') + ':' + msg.get('content',''))[:200]
    if key in seen:
        continue
    seen.add(key)
    if msg.get('from') in ('agent', 'system'):
        continue
    if initialized == 'true':
        new_msgs.append(msg)

with open(seen_file, 'w') as f:
    f.write('\n'.join(seen))

for msg in new_msgs:
    print(json.dumps(msg))
" 2>/dev/null | while IFS= read -r line; do
    FROM=$(echo "$line" | python3 -c "import sys,json;print(json.load(sys.stdin).get('from','user'))" 2>/dev/null)
    CONTENT=$(echo "$line" | python3 -c "import sys,json;print(json.load(sys.stdin).get('content',''))" 2>/dev/null)

    if [ -n "$CONTENT" ]; then
      echo "[$FROM] $CONTENT"
      RESPONSE=$(ask_claude "$FROM says: $CONTENT")
      if [ -n "$RESPONSE" ]; then
        echo "[agent] $RESPONSE"
        send_bridge "notify" "$RESPONSE"
      fi
    fi
  done
}

echo "Listening for messages..."

while true; do
  poll_and_respond

  if [ "$INITIALIZED" = "false" ]; then
    INITIALIZED=true
    echo "Initialized. Sending startup greeting..."
    startup_greeting &
  fi

  sleep 2
done
