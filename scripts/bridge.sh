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
#   bridge register [name]    # Register current dir as a project with the daemon
#   bridge approve "desc" [--wait]  # Send approval request (exit 0=approved, 1=denied)
#   bridge projects           # List all registered projects
#   bridge inbox              # Read messages routed to this project by the daemon
#
# Set BRIDGE_SESSION env var or pass --session SESSION_ID

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_BASE="https://palindrome-exercise.vercel.app"

# Try to find session ID (check daemon session file too)
SESSION_ID="${BRIDGE_SESSION:-}"
if [ -z "$SESSION_ID" ] && [ -f "$HOME/.bridge/session" ]; then
  SESSION_ID=$(cat "$HOME/.bridge/session")
fi
if [ -z "$SESSION_ID" ] && [ -f "$HOME/.bridge-session" ]; then
  SESSION_ID=$(cat "$HOME/.bridge-session")
fi

ACTION="$1"
shift 2>/dev/null
MESSAGE="$*"

# Detect project name for register command
_detect_project_name() {
  local dir="${1:-.}"
  # Try git remote
  local remote_url
  remote_url=$(git -C "$dir" remote get-url origin 2>/dev/null)
  if [ -n "$remote_url" ]; then
    basename "$remote_url" .git
    return
  fi
  # Try package.json
  if [ -f "$dir/package.json" ]; then
    local name
    name=$(python3 -c "import json;print(json.load(open('$dir/package.json')).get('name',''))" 2>/dev/null)
    if [ -n "$name" ]; then echo "$name"; return; fi
  fi
  # Fall back to directory name
  basename "$(cd "$dir" && pwd)"
}

# Find project ID for current directory
_current_project_id() {
  local cwd
  cwd="$(pwd)"
  python3 -c "
import json, os
f = os.path.expanduser('~/.bridge/projects.json')
try:
    with open(f) as fh: projects = json.load(fh)
except: projects = []
for p in projects:
    if p.get('path') == '$cwd':
        print(p['id'])
        break
" 2>/dev/null
}

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
  register)
    NAME="${1:-$(_detect_project_name .)}"
    "$SCRIPT_DIR/bridge-daemon.sh" register "$(pwd)" "$NAME"
    ;;
  approve)
    DESC="$1"
    shift 2>/dev/null
    WAIT=false
    [ "$1" = "--wait" ] && WAIT=true

    # Generate approval ID
    APPROVAL_ID="approval-$(date +%s)-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    APPROVALS_DIR="$HOME/.bridge/approvals"
    mkdir -p "$APPROVALS_DIR"

    # Send approval request to phone with inline keyboard
    curl -s -X POST "$API_BASE/api/bridge/agent" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\":\"$SESSION_ID\",\"action\":\"approve\",\"message\":\"$DESC\",\"metadata\":{\"approvalId\":\"$APPROVAL_ID\"}}" > /dev/null 2>&1

    # Write pending file for daemon to track
    echo "{\"approvalId\":\"$APPROVAL_ID\",\"description\":\"$DESC\",\"ts\":$(date +%s)000}" > "$APPROVALS_DIR/pending_${APPROVAL_ID}.json"

    if [ "$WAIT" = true ]; then
      echo "Waiting for approval: $DESC"
      RESULT_FILE="$APPROVALS_DIR/result_${APPROVAL_ID}.json"
      while [ ! -f "$RESULT_FILE" ]; do
        sleep 2
      done
      STATUS=$(python3 -c "import json;print(json.load(open('$RESULT_FILE')).get('status','denied'))" 2>/dev/null)
      if [ "$STATUS" = "approved" ]; then
        echo "Approved"
        exit 0
      else
        echo "Denied"
        exit 1
      fi
    else
      echo "Approval requested: $APPROVAL_ID"
      echo "Check with: cat $APPROVALS_DIR/result_${APPROVAL_ID}.json"
    fi
    ;;
  projects)
    "$SCRIPT_DIR/bridge-daemon.sh" list
    ;;
  inbox)
    PROJECT_ID=$(_current_project_id)
    if [ -z "$PROJECT_ID" ]; then
      echo "Current directory is not a registered project."
      echo "Run: bridge register"
      exit 1
    fi
    INBOX_FILE="$HOME/.bridge/inbox/${PROJECT_ID}.json"
    if [ ! -f "$INBOX_FILE" ]; then
      echo "No messages in inbox."
      exit 0
    fi
    python3 -c "
import json
with open('$INBOX_FILE') as f: msgs = json.load(f)
if not msgs:
    print('No messages in inbox.')
else:
    for m in msgs:
        print(f'[{m.get(\"from\",\"user\")}] {m[\"content\"]}')
" 2>/dev/null
    ;;
  *)
    echo "Usage: bridge <command> [args]"
    echo ""
    echo "Commands:"
    echo "  notify <msg>         Send notification to phone"
    echo "  ask <msg>            Ask a question on phone"
    echo "  summary <msg>        Send summary to phone"
    echo "  status <msg>         Send status update"
    echo "  error <msg>          Send error notification"
    echo "  success <msg>        Send success notification"
    echo "  send <msg>           Send raw message"
    echo "  read                 Read recent messages from user"
    echo "  register [name]      Register current dir as a project"
    echo "  approve <desc> [--wait]  Request approval from phone"
    echo "  projects             List all registered projects"
    echo "  inbox                Read messages routed to this project"
    echo ""
    echo "Set BRIDGE_SESSION env var or ~/.bridge/session file"
    ;;
esac
