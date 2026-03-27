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

LAST_TS=""
INITIALIZED=false
SEEN_FILE=$(mktemp)

# Build project context for claude
PROJECT_CONTEXT=$(cat "$PROJECT_ROOT/CLAUDE.md" 2>/dev/null | head -100)
RECENT_COMMITS=$(cd "$PROJECT_ROOT" && git log --oneline -10 2>/dev/null)

send_bridge() {
  local action="$1"
  local message="$2"
  curl -s -X POST "$API_BASE/api/bridge/agent" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json, sys
print(json.dumps({
    'sessionId': '$SESSION',
    'action': '$action',
    'message': sys.stdin.read()
}))" <<< "$message")" > /dev/null 2>&1
}

ask_claude() {
  local user_message="$1"
  # Use claude CLI in non-interactive mode with project context
  local prompt="You are Bridge Agent, an enthusiastic AI assistant living inside the Bridge project. You communicate with users via Telegram.

Keep responses SHORT (under 400 chars). Use Telegram Markdown (*bold*, _italic_, \`code\`). Be enthusiastic but concise.

Recent commits:
$RECENT_COMMITS

The user sent this message via Telegram. Respond naturally:
$user_message"

  claude --dangerously-skip-permissions -p "$prompt" --output-format text -m claude-sonnet-4-20250514 2>/dev/null
}

# Startup greeting
startup_greeting() {
  local prompt="You are Bridge Agent. You just came online in the Bridge project (desktop-to-phone AI communication system).

Recent commits:
$RECENT_COMMITS

Project summary from CLAUDE.md:
$PROJECT_CONTEXT

Introduce yourself in under 500 chars. Mention what was recently shipped and suggest what to build next. Be enthusiastic. Use Telegram Markdown."

  local greeting
  greeting=$(claude --dangerously-skip-permissions -p "$prompt" --output-format text -m claude-sonnet-4-20250514 2>/dev/null)
  if [ -n "$greeting" ]; then
    echo "[agent] $greeting"
    send_bridge "notify" "$greeting"
  fi
}

echo "Listening for messages..."

while true; do
  # Poll for messages
  URL="$API_BASE/api/bridge/messages?session=$SESSION"
  [ -n "$LAST_TS" ] && URL="$URL&since=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$LAST_TS'))")"

  RESP=$(curl -s "$URL" 2>/dev/null)

  if [ -n "$RESP" ] && [ "$RESP" != "null" ]; then
    # Process messages
    python3 -c "
import json, sys

data = json.loads('''$RESP''') if '''$RESP''' else {}
msgs = data.get('messages', [])
seen_file = '$SEEN_FILE'

try:
    with open(seen_file) as f:
        seen = set(f.read().splitlines())
except:
    seen = set()

for msg in msgs:
    key = (msg.get('timestamp','') + ':' + msg.get('content',''))[:200]
    if key in seen:
        continue
    seen.add(key)
    # Skip agent/system messages
    if msg.get('from') in ('agent', 'system'):
        continue
    if '$INITIALIZED' == 'false':
        continue
    print(json.dumps(msg))

with open(seen_file, 'w') as f:
    f.write('\n'.join(seen))

# Print last timestamp
if msgs:
    print('__LAST_TS__' + msgs[-1].get('timestamp',''))
" 2>/dev/null | while IFS= read -r line; do
      # Extract last timestamp
      if [[ "$line" == __LAST_TS__* ]]; then
        echo "${line#__LAST_TS__}" > /tmp/bridge_agent_last_ts
        continue
      fi

      # Parse message
      FROM=$(echo "$line" | python3 -c "import sys,json;m=json.load(sys.stdin);print(m.get('from','user'))" 2>/dev/null)
      CONTENT=$(echo "$line" | python3 -c "import sys,json;m=json.load(sys.stdin);print(m.get('content',''))" 2>/dev/null)

      if [ -n "$CONTENT" ]; then
        echo "[$FROM] $CONTENT"

        # Get AI response
        RESPONSE=$(ask_claude "$FROM says: $CONTENT")

        if [ -n "$RESPONSE" ]; then
          echo "[agent] $RESPONSE"
          send_bridge "notify" "$RESPONSE"
        fi
      fi
    done

    [ -f /tmp/bridge_agent_last_ts ] && LAST_TS=$(cat /tmp/bridge_agent_last_ts)
  fi

  # First loop done — mark initialized and send greeting
  if [ "$INITIALIZED" = "false" ]; then
    INITIALIZED=true
    echo "Initialized. Sending startup greeting..."
    startup_greeting &
  fi

  sleep 2
done
