#!/bin/bash
# Bridge Agent — uses the LOCAL OpenCode instance to chat via Telegram.
# OpenCode maintains conversation history in its session — no context re-sending needed.
# Uses whatever model/provider the user has configured in OpenCode (free by default).
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
OPENCODE_PORT="${OPENCODE_URL##*:}"
FIREBASE_URL="https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app"
FB_ROOT="mercadopago-bridge"

# ─── Session ───

SESSION="${BRIDGE_SESSION:-}"
[ -z "$SESSION" ] && [ -f "$HOME/.bridge/session" ] && SESSION=$(cat "$HOME/.bridge/session")
[ -z "$SESSION" ] && [ -f "$HOME/.bridge-session" ] && SESSION=$(cat "$HOME/.bridge-session")

if [ -z "$SESSION" ]; then
  echo "No session. Set BRIDGE_SESSION or run bridge-daemon.sh start"
  exit 1
fi

# ─── Detect project ───

PROJECT_NAME=$(basename "$PROJECT_ROOT")
if [ -f "$PROJECT_ROOT/package.json" ]; then
  PROJECT_NAME=$(python3 -c "import json;print(json.load(open('$PROJECT_ROOT/package.json')).get('name','$PROJECT_NAME'))" 2>/dev/null)
fi

# ─── OpenCode setup ───

opencode_is_running() {
  curl -sf "$OPENCODE_URL/global/health" --max-time 2 >/dev/null 2>&1
}

if ! opencode_is_running; then
  if command -v opencode >/dev/null 2>&1; then
    echo "[setup] Spawning opencode on port $OPENCODE_PORT..."
    opencode serve --port "$OPENCODE_PORT" --hostname 127.0.0.1 &
    OPENCODE_PID=$!
    for i in $(seq 1 15); do
      sleep 1
      opencode_is_running && break
    done
    if ! opencode_is_running; then
      echo "[setup] OpenCode failed to start. Install opencode and retry."
      kill "$OPENCODE_PID" 2>/dev/null
      exit 1
    fi
    echo "[setup] OpenCode is healthy (pid $OPENCODE_PID)"
  else
    echo "OpenCode not found. Install it: https://opencode.ai"
    exit 1
  fi
else
  echo "[setup] OpenCode running at $OPENCODE_URL"
fi

# Create a session — OpenCode keeps full conversation history in the session
OC_SESSION_ID=$(curl -sf -X POST "$OPENCODE_URL/session" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

if [ -z "$OC_SESSION_ID" ]; then
  echo "[setup] Could not create OpenCode session"
  exit 1
fi
echo "[setup] OpenCode session: ${OC_SESSION_ID:0:16}..."

# ─── Send system context ONCE as the first message ───
# OpenCode remembers everything in the session — no need to resend

RECENT_COMMITS=$(cd "$PROJECT_ROOT" && git log --oneline -10 2>/dev/null)
PROJECT_CONTEXT=$(head -80 "$PROJECT_ROOT/CLAUDE.md" 2>/dev/null)

SYSTEM_MSG="You are Bridge Agent for the project '$PROJECT_NAME'.
You communicate with users via Telegram through the Bridge system.
Users see your messages on their phone. Keep responses SHORT (under 400 chars).
Be enthusiastic but concise. Do not use Markdown formatting.
Do not repeat yourself — you have full conversation history.

Project: $PROJECT_NAME
Location: $PROJECT_ROOT

Recent commits:
$RECENT_COMMITS

Project info:
$PROJECT_CONTEXT

Say hello briefly, mention 1-2 recent things shipped, and ask what to work on next."

echo "Bridge Agent starting..."
echo "Project: $PROJECT_NAME"
echo "Session: ${SESSION:0:8}..."

# ─── Send to Bridge (Telegram) ───

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

# ─── Send message to OpenCode and get response ───
# Because OpenCode maintains session history, each message builds on the last.
# No system prompt re-sending. No history duplication.

ask_opencode() {
  local user_message="$1"

  # Send message to OpenCode session
  curl -sf -X POST "$OPENCODE_URL/session/$OC_SESSION_ID/message" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"parts":[{"type":"text","text":sys.argv[1]}]}))' "$user_message")" >/dev/null 2>&1

  # Wait for assistant response (OpenCode streams, we poll for completion)
  local last_msg_id=""
  for i in $(seq 1 30); do
    sleep 2
    local answer
    answer=$(curl -sf "$OPENCODE_URL/session/$OC_SESSION_ID/message" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    msgs = data if isinstance(data, list) else data.get('messages', data.get('data', []))
    # Find the last assistant message
    for m in reversed(msgs):
        info = m.get('info', {})
        role = info.get('role', m.get('role', ''))
        if role != 'assistant':
            continue
        parts = m.get('parts', [])
        texts = [p.get('text','') for p in parts if p.get('type')=='text']
        if texts:
            msg_id = info.get('id', m.get('id', ''))
            # Check if generation is complete (has step-finish)
            has_finish = any(p.get('type')=='step-finish' for p in parts)
            if has_finish:
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
}

# ─── Startup: send system context and get greeting ───

echo "Sending startup context to OpenCode..."
GREETING=$(ask_opencode "$SYSTEM_MSG")
if [ -n "$GREETING" ]; then
  echo "[agent] $GREETING"
  send_bridge "notify" "$GREETING"
else
  echo "[agent] startup failed — OpenCode did not respond"
fi

# ─── Listen for Telegram messages via Firebase SSE ───

echo "Listening for messages via Firebase SSE..."

curl -sN -H "Accept: text/event-stream" \
  "$FIREBASE_URL/$FB_ROOT/bridge-messages/$SESSION.json" 2>/dev/null | \
python3 -u -c "
import sys, json

buf = ''
skip_initial = True

for raw_line in sys.stdin:
    line = raw_line.rstrip('\n')
    if line.startswith('data: '):
        buf = line[6:]
    elif line == '' and buf:
        try:
            event = json.loads(buf)
            path = event.get('path','')
            data = event.get('data')
            if path == '/':
                skip_initial = False
            elif data and isinstance(data, dict) and data.get('content') and not skip_initial:
                if data.get('from') not in ('agent', 'system'):
                    print(json.dumps(data), flush=True)
        except:
            pass
        buf = ''
    elif buf:
        buf += line
" 2>/dev/null | while IFS= read -r msg_json; do
  FROM=$(echo "$msg_json" | python3 -c "import sys,json;print(json.load(sys.stdin).get('from','user'))" 2>/dev/null)
  CONTENT=$(echo "$msg_json" | python3 -c "import sys,json;print(json.load(sys.stdin).get('content',''))" 2>/dev/null)

  [ -z "$CONTENT" ] && continue
  echo "[$FROM] $CONTENT"

  # Send to OpenCode — it already has full conversation history
  RESPONSE=$(ask_opencode "$FROM says: $CONTENT")
  if [ -n "$RESPONSE" ]; then
    echo "[agent] $RESPONSE"
    send_bridge "notify" "$RESPONSE"
  fi
done

echo "SSE stream ended, restarting..."
exec "$0" "$@"
