#!/bin/bash
# Bridge Daemon — global background service that tracks multiple projects
# and routes phone messages to the right one.
#
# Usage:
#   bridge-daemon start       — start the daemon in the background
#   bridge-daemon stop        — stop the daemon
#   bridge-daemon status      — show daemon status and registered projects
#   bridge-daemon register [path] [name] — register a project directory
#   bridge-daemon unregister [path|id]   — remove a project
#   bridge-daemon list        — list all registered projects

BRIDGE_DIR="$HOME/.bridge"
PID_FILE="$BRIDGE_DIR/daemon.pid"
SESSION_FILE="$BRIDGE_DIR/session"
PROJECTS_FILE="$BRIDGE_DIR/projects.json"
INBOX_DIR="$BRIDGE_DIR/inbox"
APPROVALS_DIR="$BRIDGE_DIR/approvals"
LOG_FILE="$BRIDGE_DIR/daemon.log"
API_BASE="https://palindrome-exercise.vercel.app"
POLL_INTERVAL=2

ensure_dirs() {
  mkdir -p "$BRIDGE_DIR" "$INBOX_DIR" "$APPROVALS_DIR"
  [ -f "$PROJECTS_FILE" ] || echo '[]' > "$PROJECTS_FILE"
}

get_session() {
  if [ -f "$SESSION_FILE" ]; then
    cat "$SESSION_FILE"
  elif [ -n "$BRIDGE_SESSION" ]; then
    echo "$BRIDGE_SESSION" > "$SESSION_FILE"
    echo "$BRIDGE_SESSION"
  elif [ -f "$HOME/.bridge-session" ]; then
    cp "$HOME/.bridge-session" "$SESSION_FILE"
    cat "$SESSION_FILE"
  else
    # Generate a new session ID
    local sid
    sid="bridge-$(date +%s)-$(head -c 6 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 8)"
    echo "$sid" > "$SESSION_FILE"
    echo "$sid"
  fi
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# Auto-detect project name from path
detect_name() {
  local path="$1"
  # Try package.json
  if [ -f "$path/package.json" ]; then
    local name
    name=$(python3 -c "import json;print(json.load(open('$path/package.json')).get('name',''))" 2>/dev/null)
    if [ -n "$name" ]; then echo "$name"; return; fi
  fi
  # Fall back to directory name
  basename "$path"
}

# Generate short project ID
gen_id() {
  head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 8
}

cmd_start() {
  ensure_dirs
  if is_running; then
    echo "Daemon already running (PID $(cat "$PID_FILE"))"
    return 0
  fi

  local session
  session=$(get_session)
  echo "Starting bridge daemon with session: $session"

  # Launch daemon loop in background
  _daemon_loop &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  echo "Daemon started (PID $pid). Log: $LOG_FILE"
}

_daemon_loop() {
  local session last_ts
  session=$(cat "$SESSION_FILE")
  last_ts=$(date +%s)000

  echo "[$(date)] Daemon started, session=$session" >> "$LOG_FILE"

  while true; do
    # Poll for new messages
    local resp
    resp=$(curl -s "$API_BASE/api/bridge/messages?session=$session&since=$last_ts" 2>/dev/null)
    if [ -n "$resp" ] && [ "$resp" != "null" ]; then
      local msg_count
      msg_count=$(echo "$resp" | python3 -c "import sys,json;msgs=json.load(sys.stdin).get('messages',[]);print(len(msgs))" 2>/dev/null || echo "0")
      if [ "$msg_count" -gt 0 ]; then
        echo "$resp" | python3 -c "
import sys, json, os, time

data = json.load(sys.stdin)
msgs = data.get('messages', [])
projects_file = os.path.expanduser('~/.bridge/projects.json')
inbox_dir = os.path.expanduser('~/.bridge/inbox')

try:
    with open(projects_file) as f:
        projects = json.load(f)
except:
    projects = []

for msg in msgs:
    if msg.get('from') == 'agent':
        continue
    content = msg.get('content', '')
    target_id = None

    # Check for project tag like [my-app] or #1
    if content.startswith('[') and ']' in content:
        tag = content[1:content.index(']')]
        content = content[content.index(']')+1:].strip()
        for p in projects:
            if p.get('name') == tag or p.get('id') == tag:
                target_id = p['id']
                break
    elif content.startswith('#') and len(content) > 1 and content[1:].split()[0].isdigit():
        idx = int(content[1:].split()[0]) - 1
        content = ' '.join(content.split()[1:])
        if 0 <= idx < len(projects):
            target_id = projects[idx]['id']

    # Default to most recently registered project
    if not target_id and projects:
        most_recent = sorted(projects, key=lambda p: p.get('registeredAt', ''), reverse=True)
        target_id = most_recent[0]['id']

    if target_id:
        inbox_file = os.path.join(inbox_dir, target_id + '.json')
        try:
            with open(inbox_file) as f:
                inbox = json.load(f)
        except:
            inbox = []
        inbox.append({'content': content, 'from': msg.get('from','user'), 'ts': msg.get('ts', int(time.time()*1000))})
        with open(inbox_file, 'w') as f:
            json.dump(inbox, f)
" 2>/dev/null
        last_ts=$(date +%s)000
      fi
    fi

    # Poll for approval responses
    if [ -d "$APPROVALS_DIR" ]; then
      for req_file in "$APPROVALS_DIR"/pending_*.json; do
        [ -f "$req_file" ] || continue
        local approval_id
        approval_id=$(python3 -c "import json;print(json.load(open('$req_file')).get('approvalId',''))" 2>/dev/null)
        if [ -n "$approval_id" ]; then
          local approval_resp
          approval_resp=$(curl -s "$API_BASE/api/bridge/agent?session=$session&approval=$approval_id" 2>/dev/null)
          local approval_status
          approval_status=$(echo "$approval_resp" | python3 -c "import sys,json;d=json.load(sys.stdin);a=d.get('approval',{});print(a.get('status','pending') if isinstance(a,dict) else 'pending')" 2>/dev/null)
          if [ "$approval_status" = "approved" ] || [ "$approval_status" = "denied" ]; then
            local result_file="${req_file/pending_/result_}"
            echo "$approval_resp" > "$result_file"
            rm -f "$req_file"
          fi
        fi
      done
    fi

    sleep "$POLL_INTERVAL"
  done
}

cmd_stop() {
  if ! is_running; then
    echo "Daemon is not running."
    return 0
  fi
  local pid
  pid=$(cat "$PID_FILE")
  kill "$pid" 2>/dev/null
  rm -f "$PID_FILE"
  echo "Daemon stopped (was PID $pid)."
}

cmd_status() {
  ensure_dirs
  if is_running; then
    echo "Daemon: RUNNING (PID $(cat "$PID_FILE"))"
  else
    echo "Daemon: STOPPED"
  fi
  echo "Session: $(cat "$SESSION_FILE" 2>/dev/null || echo 'none')"
  echo ""
  cmd_list
}

cmd_register() {
  ensure_dirs
  local path="${1:-$(pwd)}"
  path="$(cd "$path" 2>/dev/null && pwd)" || { echo "Invalid path: $1"; return 1; }
  local name="${2:-$(detect_name "$path")}"
  local id
  id=$(gen_id)

  python3 -c "
import json, os
f = os.path.expanduser('~/.bridge/projects.json')
try:
    with open(f) as fh: projects = json.load(fh)
except: projects = []
# Remove existing entry for same path
projects = [p for p in projects if p.get('path') != '$path']
import datetime
projects.append({
    'id': '$id',
    'path': '$path',
    'name': '$name',
    'pid': os.getpid(),
    'registeredAt': datetime.datetime.utcnow().isoformat() + 'Z'
})
with open(f, 'w') as fh: json.dump(projects, fh, indent=2)
print('Registered: $name ($id) at $path')
"
}

cmd_unregister() {
  ensure_dirs
  local target="$1"
  [ -z "$target" ] && { echo "Usage: bridge-daemon unregister <path|id>"; return 1; }
  # Resolve path if it exists as directory
  if [ -d "$target" ]; then
    target="$(cd "$target" && pwd)"
  fi

  python3 -c "
import json, os
f = os.path.expanduser('~/.bridge/projects.json')
with open(f) as fh: projects = json.load(fh)
target = '$target'
before = len(projects)
projects = [p for p in projects if p.get('path') != target and p.get('id') != target]
with open(f, 'w') as fh: json.dump(projects, fh, indent=2)
removed = before - len(projects)
print(f'Removed {removed} project(s).' if removed else 'No matching project found.')
"
}

cmd_list() {
  ensure_dirs
  python3 -c "
import json, os
f = os.path.expanduser('~/.bridge/projects.json')
try:
    with open(f) as fh: projects = json.load(fh)
except: projects = []
if not projects:
    print('No registered projects.')
else:
    print(f'Registered projects ({len(projects)}):')
    for i, p in enumerate(projects, 1):
        inbox_file = os.path.expanduser(f'~/.bridge/inbox/{p[\"id\"]}.json')
        try:
            with open(inbox_file) as ifh: msgs = len(json.load(ifh))
        except: msgs = 0
        print(f'  #{i} [{p[\"id\"]}] {p[\"name\"]}')
        print(f'      path: {p[\"path\"]}')
        print(f'      inbox: {msgs} message(s)')
"
}

# Main dispatch
case "${1:-}" in
  start)      cmd_start ;;
  stop)       cmd_stop ;;
  status)     cmd_status ;;
  register)   shift; cmd_register "$@" ;;
  unregister) shift; cmd_unregister "$@" ;;
  list)       cmd_list ;;
  *)
    echo "Usage: bridge-daemon <start|stop|status|register|unregister|list>"
    exit 1
    ;;
esac
