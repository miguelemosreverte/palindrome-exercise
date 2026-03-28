#!/bin/bash
# Task Runner — durable autonomous agent runtime
#
# Reads a task from Firebase, executes each step via Claude CLI + Playwright MCP,
# persists progress after each step, and resumes from where it left off on restart.
#
# Usage:
#   ./scripts/task-runner.sh <taskId>
#   ./scripts/task-runner.sh <taskId> --dry-run    # show steps without executing
#   TASK_ID=abc123 ./scripts/task-runner.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Config
FIREBASE_URL="https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app"
BRIDGE_API="https://palindrome-exercise.vercel.app"
TASKS_PATH="mercadopago-bridge/bridge-tasks"
MCP_CONFIG="$REPO_DIR/.mcp-playwright.json"

# Session
SESSION_ID="${BRIDGE_SESSION:-}"
if [ -z "$SESSION_ID" ] && [ -f "$HOME/.bridge/session" ]; then
  SESSION_ID=$(cat "$HOME/.bridge/session")
fi
if [ -z "$SESSION_ID" ] && [ -f "$HOME/.bridge-session" ]; then
  SESSION_ID=$(cat "$HOME/.bridge-session")
fi

# Args
TASK_ID="${1:-${TASK_ID:-}}"
DRY_RUN=false
[ "${2:-}" = "--dry-run" ] && DRY_RUN=true

if [ -z "$TASK_ID" ]; then
  echo "Usage: task-runner.sh <taskId> [--dry-run]"
  exit 1
fi

# --- Firebase helpers ---

fb_read() {
  curl -sf "$FIREBASE_URL/$1.json"
}

fb_write() {
  curl -sf -X PUT "$FIREBASE_URL/$1.json" \
    -H "Content-Type: application/json" \
    -d "$2"
}

fb_patch() {
  curl -sf -X PATCH "$FIREBASE_URL/$1.json" \
    -H "Content-Type: application/json" \
    -d "$2"
}

# --- Telegram notification ---

notify() {
  local action="$1"
  local message="$2"
  if [ -n "$SESSION_ID" ]; then
    curl -sf -X POST "$BRIDGE_API/api/bridge/agent" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\":\"$SESSION_ID\",\"action\":\"$action\",\"message\":\"$message\"}" > /dev/null 2>&1 || true
  fi
}

# --- Template expansion ---
# Replaces {{results.stepName}} with actual results from previous steps

expand_template() {
  local template="$1"
  local results_json="$2"
  local output="$template"

  # Find all {{results.xxx}} references
  while [[ "$output" =~ \{\{results\.([a-zA-Z0-9_]+)\}\} ]]; do
    local key="${BASH_REMATCH[1]}"
    local value
    value=$(echo "$results_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
v = data.get('$key', '')
# Escape for JSON embedding
print(str(v).replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"').replace('\n', ' '))
" 2>/dev/null || echo "")
    output="${output//\{\{results.$key\}\}/$value}"
  done

  echo "$output"
}

# --- LLM Engine Detection ---
# Our system uses whatever engine is available, in priority order:
# 1. OpenCode (if running locally with MCP support)
# 2. ChutesAI (if API key available — MiniMax M2.5 with tool calling)
# 3. Claude CLI (if installed — as fallback)

detect_engine() {
  # 1. Check OpenCode
  if curl -sf "http://localhost:9001/global/health" --max-time 2 >/dev/null 2>&1; then
    echo "opencode"
    return
  fi
  # 2. Check ChutesAI
  if [ -n "${CHUTESAI_API_KEY:-}" ] || [ -f "$REPO_DIR/.env" ]; then
    [ -z "${CHUTESAI_API_KEY:-}" ] && source "$REPO_DIR/.env" 2>/dev/null
    if [ -n "${CHUTESAI_API_KEY:-}" ]; then
      echo "chutesai"
      return
    fi
  fi
  # 3. Check Claude CLI
  if command -v claude >/dev/null 2>&1; then
    echo "claude"
    return
  fi
  echo "none"
}

ENGINE=$(detect_engine)
echo "Engine: $ENGINE"

# --- Execute a single step through our system ---

execute_step() {
  local prompt="$1"
  local timeout_sec="${2:-300}"

  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] Would execute: ${prompt:0:100}..."
    return 0
  fi

  local result=""

  case "$ENGINE" in
    opencode)
      # Create session, send message, poll for response
      local oc_sid
      oc_sid=$(python3 -c "
import urllib.request, json
req = urllib.request.Request('http://localhost:9001/session', data=b'{}', headers={'Content-Type':'application/json'}, method='POST')
print(json.loads(urllib.request.urlopen(req).read()).get('id',''))
" 2>/dev/null)
      if [ -n "$oc_sid" ]; then
        python3 -c "
import urllib.request, json, sys
msg = json.dumps({'parts':[{'type':'text','text':sys.argv[1]}]}).encode()
req = urllib.request.Request('http://localhost:9001/session/'+sys.argv[2]+'/message', data=msg, headers={'Content-Type':'application/json'}, method='POST')
urllib.request.urlopen(req)
" "$prompt" "$oc_sid" 2>/dev/null
        # Poll for response
        for i in $(seq 1 60); do
          sleep 3
          result=$(python3 -c "
import urllib.request, json
msgs = json.loads(urllib.request.urlopen('http://localhost:9001/session/$oc_sid/message').read())
for m in reversed(msgs if isinstance(msgs, list) else []):
    info = m.get('info',{})
    if info.get('role') != 'assistant': continue
    parts = m.get('parts',[])
    if any(p.get('type')=='step-finish' for p in parts):
        texts = [p.get('text','') for p in parts if p.get('type')=='text']
        print(''.join(texts))
        break
" 2>/dev/null)
          [ -n "$result" ] && break
        done
      fi
      ;;

    chutesai)
      # Call ChutesAI API with MiniMax (supports tool calling)
      [ -z "${CHUTESAI_API_KEY:-}" ] && source "$REPO_DIR/.env" 2>/dev/null
      result=$(python3 -c "
import urllib.request, json, sys, os
key = os.environ.get('CHUTESAI_API_KEY','')
req = urllib.request.Request(
    'https://llm.chutes.ai/v1/chat/completions',
    data=json.dumps({
        'model': 'MiniMaxAI/MiniMax-M2.5-TEE',
        'messages': [{'role':'user','content':sys.argv[1]}],
        'max_tokens': 4096,
        'temperature': 0.3
    }).encode(),
    headers={'Content-Type':'application/json','Authorization':'Bearer '+key}
)
resp = json.loads(urllib.request.urlopen(req, timeout=$timeout_sec).read())
print(resp.get('choices',[{}])[0].get('message',{}).get('content',''))
" "$prompt" 2>/dev/null)
      ;;

    claude)
      # Claude CLI with Playwright MCP
      result=$(echo "$prompt" | claude --mcp-config "$MCP_CONFIG" --model haiku --output-format text --dangerously-skip-permissions -p - 2>&1) || true
      ;;

    *)
      echo "ERROR: No LLM engine available (install opencode, set CHUTESAI_API_KEY, or install claude)"
      return 1
      ;;
  esac

  echo "$result"
}

# --- Main loop ---

echo "Task Runner starting: $TASK_ID"

# Read task from Firebase
TASK_JSON=$(fb_read "$TASKS_PATH/$TASK_ID")
if [ -z "$TASK_JSON" ] || [ "$TASK_JSON" = "null" ]; then
  echo "Error: task $TASK_ID not found in Firebase"
  exit 1
fi

# Parse task fields
GOAL=$(echo "$TASK_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('goal',''))")
STATUS=$(echo "$TASK_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','pending'))")
CURRENT_STEP=$(echo "$TASK_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('currentStep',0))")
TOTAL_STEPS=$(echo "$TASK_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('steps',[])))")
RESULTS_JSON=$(echo "$TASK_JSON" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('results',{})))")

echo "Goal: $GOAL"
echo "Status: $STATUS | Step $CURRENT_STEP of $TOTAL_STEPS"

if [ "$STATUS" = "completed" ]; then
  echo "Task already completed."
  exit 0
fi

if [ "$STATUS" = "cancelled" ]; then
  echo "Task was cancelled."
  exit 0
fi

# Mark as running
fb_patch "$TASKS_PATH/$TASK_ID" "{\"status\":\"running\",\"updatedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null
notify "status" "Starting task: $GOAL (step $((CURRENT_STEP + 1))/$TOTAL_STEPS)"

# Execute steps starting from currentStep
STEP_INDEX=$CURRENT_STEP
while [ "$STEP_INDEX" -lt "$TOTAL_STEPS" ]; do
  # Read step details
  STEP_JSON=$(echo "$TASK_JSON" | python3 -c "import sys,json; s=json.load(sys.stdin)['steps'][$STEP_INDEX]; print(json.dumps(s))")
  STEP_NAME=$(echo "$STEP_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")
  STEP_PROMPT=$(echo "$STEP_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['prompt'])")

  echo ""
  echo "=== Step $((STEP_INDEX + 1))/$TOTAL_STEPS: $STEP_NAME ==="

  # Expand template variables with previous results
  EXPANDED_PROMPT=$(expand_template "$STEP_PROMPT" "$RESULTS_JSON")

  # Mark step as running
  fb_patch "$TASKS_PATH/$TASK_ID/steps/$STEP_INDEX" "{\"status\":\"running\"}" > /dev/null
  notify "status" "Running step $((STEP_INDEX + 1))/$TOTAL_STEPS: $STEP_NAME"

  # Execute
  STEP_RESULT=""
  STEP_STATUS="completed"
  RETRIES=0
  MAX_RETRIES=1

  while [ $RETRIES -le $MAX_RETRIES ]; do
    STEP_RESULT=$(execute_step "$EXPANDED_PROMPT" 300)

    if [ -n "$STEP_RESULT" ] && [ "$STEP_RESULT" != "null" ]; then
      break
    fi

    if [ $RETRIES -lt $MAX_RETRIES ]; then
      echo "Step failed, retrying ($((RETRIES + 1))/$MAX_RETRIES)..."
      notify "status" "Retrying step $STEP_NAME..."
      RETRIES=$((RETRIES + 1))
    else
      STEP_STATUS="failed"
      STEP_RESULT="Step failed after $((MAX_RETRIES + 1)) attempts"
      echo "Step failed permanently."
      notify "error" "Step $STEP_NAME failed after retries"
      RETRIES=$((RETRIES + 1))
    fi
  done

  # Persist result to Firebase (durable checkpoint)
  # Escape result for JSON
  ESCAPED_RESULT=$(python3 -c "
import sys, json
result = sys.stdin.read()
print(json.dumps(result))
" <<< "$STEP_RESULT")

  # Persist to Firebase (real-time sync with phone)
  fb_patch "$TASKS_PATH/$TASK_ID/steps/$STEP_INDEX" "{\"status\":\"$STEP_STATUS\",\"result\":$ESCAPED_RESULT}" > /dev/null
  fb_patch "$TASKS_PATH/$TASK_ID/results" "{\"$STEP_NAME\":$ESCAPED_RESULT}" > /dev/null
  fb_patch "$TASKS_PATH/$TASK_ID" "{\"currentStep\":$((STEP_INDEX + 1)),\"updatedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null

  # Persist to SQLite (durable local storage)
  node -e "
    const db = require('./lib/db');
    db.completeStep('$TASK_ID', $STEP_INDEX, $ESCAPED_RESULT, 0, 0);
    db.saveData('$TASK_ID', 'task-results/$STEP_NAME', $ESCAPED_RESULT, 'text');
  " 2>/dev/null || true

  # Update local results for template expansion of subsequent steps
  RESULTS_JSON=$(echo "$RESULTS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['$STEP_NAME'] = $ESCAPED_RESULT
print(json.dumps(data))
")

  echo "Step $STEP_NAME: $STEP_STATUS (${#STEP_RESULT} chars)"
  notify "status" "Step $STEP_NAME $STEP_STATUS ($((STEP_INDEX + 1))/$TOTAL_STEPS done)"

  STEP_INDEX=$((STEP_INDEX + 1))
done

# All steps done — compile summary
echo ""
echo "=== Task Complete ==="

SUMMARY=$(python3 -c "
import json, sys
results = json.loads('''$RESULTS_JSON''')
parts = []
for k, v in results.items():
    snippet = str(v)[:200]
    parts.append(f'- {k}: {snippet}')
print('\n'.join(parts))
" 2>/dev/null || echo "Task completed with $TOTAL_STEPS steps")

fb_patch "$TASKS_PATH/$TASK_ID" "{\"status\":\"completed\",\"updatedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null
notify "success" "Task completed: $GOAL"
notify "summary" "Results for: $GOAL\n\n$SUMMARY"

echo "Done."
