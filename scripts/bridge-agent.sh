#!/bin/bash
# Bridge Agent — a living AI that listens to Telegram and responds via OpenCode or Claude CLI.
# Prefers a local OpenCode instance; falls back to `claude` CLI if unavailable.
#
# Usage:
#   ./scripts/bridge-agent.sh
#
# Env:
#   BRIDGE_SESSION  — Bridge session ID
#   OPENCODE_URL    — OpenCode base URL (default: http://localhost:9001)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_BASE="https://palindrome-exercise.vercel.app"
OPENCODE_URL="${OPENCODE_URL:-http://localhost:9001}"
OPENCODE_PORT="${OPENCODE_URL##*:}"  # extract port

# Session
SESSION="${BRIDGE_SESSION:-}"
[ -z "$SESSION" ] && [ -f "$HOME/.bridge/session" ] && SESSION=$(cat "$HOME/.bridge/session")
[ -z "$SESSION" ] && [ -f "$HOME/.bridge-session" ] && SESSION=$(cat "$HOME/.bridge-session")

if [ -z "$SESSION" ]; then
  echo "No session. Set BRIDGE_SESSION or run bridge-daemon.sh start"
  exit 1
fi

SEEN_FILE=$(mktemp)
INITIALIZED=false
OC_SESSION_ID=""
AGENT_MODE=""  # "opencode" or "claude"

# Build project context
PROJECT_CONTEXT=$(head -100 "$PROJECT_ROOT/CLAUDE.md" 2>/dev/null)
RECENT_COMMITS=$(cd "$PROJECT_ROOT" && git log --oneline -10 2>/dev/null)

SYSTEM_PROMPT="You are Bridge Agent, an enthusiastic AI assistant living inside the Bridge project (desktop-to-phone AI communication). You communicate with users via Telegram. Keep responses SHORT (under 400 chars). Be enthusiastic but concise. Do not use Markdown formatting."

# ─── OpenCode helpers ───

opencode_is_running() {
  curl -sf "$OPENCODE_URL/global/health" --max-time 2 >/dev/null 2>&1
}

start_opencode() {
  echo "[setup] Spawning opencode on port $OPENCODE_PORT..."
  opencode serve --port "$OPENCODE_PORT" --hostname 127.0.0.1 &
  OPENCODE_PID=$!
  # Wait up to 15s for it to become healthy
  for i in $(seq 1 15); do
    sleep 1
    if opencode_is_running; then
      echo "[setup] OpenCode is healthy (pid $OPENCODE_PID)"
      return 0
    fi
  done
  echo "[setup] OpenCode failed to start in time"
  kill "$OPENCODE_PID" 2>/dev/null
  return 1
}

create_opencode_session() {
  OC_SESSION_ID=$(curl -sf -X POST "$OPENCODE_URL/session" \
    -H "Content-Type: application/json" \
    -d '{}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  if [ -n "$OC_SESSION_ID" ]; then
    echo "[setup] OpenCode session: ${OC_SESSION_ID:0:16}..."
    return 0
  fi
  return 1
}

# ─── Detect agent mode ───

detect_mode() {
  # 1. Check if OpenCode is already running
  if opencode_is_running; then
    echo "[setup] OpenCode already running at $OPENCODE_URL"
    AGENT_MODE="opencode"
    return
  fi

  # 2. Try to spawn it
  if command -v opencode >/dev/null 2>&1; then
    if start_opencode; then
      AGENT_MODE="opencode"
      return
    fi
  fi

  # 3. Fall back to claude CLI
  if command -v claude >/dev/null 2>&1; then
    echo "[setup] Falling back to claude CLI"
    AGENT_MODE="claude"
    return
  fi

  echo "Neither opencode nor claude found. Install one and retry."
  exit 1
}

detect_mode

if [ "$AGENT_MODE" = "opencode" ]; then
  create_opencode_session || {
    echo "[setup] Could not create OpenCode session, falling back to claude"
    AGENT_MODE="claude"
  }
fi

echo "Bridge Agent starting..."
echo "Session: ${SESSION:0:8}..."
echo "Using: $AGENT_MODE"

# ─── Send to Bridge ───

send_bridge() {
  local action="$1"
  local message="$2"
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

# ─── Ask the agent ───

ask_opencode() {
  local user_message="$1"
  local full_prompt="$SYSTEM_PROMPT

Recent commits:
$RECENT_COMMITS

The user sent this message via Telegram. Respond naturally:
$user_message"

  # Send message
  local send_resp
  send_resp=$(curl -sf -X POST "$OPENCODE_URL/session/$OC_SESSION_ID/message" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"parts":[{"type":"text","text":sys.argv[1]}]}))' "$full_prompt")" 2>/dev/null)

  if [ -z "$send_resp" ]; then
    echo ""
    return
  fi

  # Poll for the assistant response (up to 60s)
  for i in $(seq 1 30); do
    sleep 2
    local messages
    messages=$(curl -sf "$OPENCODE_URL/session/$OC_SESSION_ID/message" 2>/dev/null)
    if [ -z "$messages" ]; then continue; fi

    local answer
    answer=$(echo "$messages" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    msgs = data if isinstance(data, list) else data.get('messages', data.get('data', []))
    for m in reversed(msgs):
        role = m.get('role', m.get('info',{}).get('role',''))
        parts = m.get('parts', [])
        if role == 'assistant' or (not role and parts):
            texts = [p.get('text','') for p in parts if p.get('type')=='text']
            if texts:
                print(''.join(texts))
                break
except:
    pass
" 2>/dev/null)

    if [ -n "$answer" ]; then
      echo "$answer"
      return
    fi
  done
  echo ""
}

ask_claude() {
  local user_message="$1"
  claude -p --output-format text --model haiku --tools "" \
    "$SYSTEM_PROMPT

Recent commits:
$RECENT_COMMITS

The user sent this message via Telegram. Respond naturally:
$user_message" 2>/dev/null
}

ask_agent() {
  if [ "$AGENT_MODE" = "opencode" ]; then
    ask_opencode "$1"
  else
    ask_claude "$1"
  fi
}

# ─── Startup greeting ───

startup_greeting() {
  local greeting
  local startup_prompt="You are Bridge Agent. You just came online in the Bridge project (desktop-to-phone AI communication system).

Recent commits:
$RECENT_COMMITS

Project summary:
$PROJECT_CONTEXT

Introduce yourself in under 500 chars. Mention what was recently shipped and suggest what to build next. Be enthusiastic. Do not use Markdown formatting."

  if [ "$AGENT_MODE" = "opencode" ]; then
    greeting=$(ask_opencode "$startup_prompt")
  else
    greeting=$(claude -p --output-format text --model haiku --tools "" "$startup_prompt" 2>/dev/null)
  fi

  if [ -n "$greeting" ]; then
    echo "[agent] $greeting"
    send_bridge "notify" "$greeting"
  else
    echo "[agent] greeting failed"
  fi
}

# ─── Poll and respond ───

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
      RESPONSE=$(ask_agent "$FROM says: $CONTENT")
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
