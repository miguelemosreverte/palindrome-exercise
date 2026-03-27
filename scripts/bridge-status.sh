#!/bin/bash
# Bridge Status — standardized project status reporting.
# Writes structured status to Firebase so all clients (Telegram, desktop, Mini App) can read it.
#
# Usage:
#   bridge-status set-task "Implementing auth flow"
#   bridge-status complete-task "Implemented auth flow"
#   bridge-status add-next "Add rate limiting"
#   bridge-status report                          # Send full status to Telegram
#   bridge-status show                            # Print current status locally

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_BASE="https://palindrome-exercise.vercel.app"
FIREBASE_URL="https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app"
FB_ROOT="mercadopago-bridge"

SESSION="${BRIDGE_SESSION:-}"
[ -z "$SESSION" ] && [ -f "$HOME/.bridge/session" ] && SESSION=$(cat "$HOME/.bridge/session")
[ -z "$SESSION" ] && [ -f "$HOME/.bridge-session" ] && SESSION=$(cat "$HOME/.bridge-session")

PROJECT_NAME=$(basename "$PROJECT_ROOT")

STATUS_PATH="$FB_ROOT/bridge-project-status/$SESSION"

# Read current status from Firebase
read_status() {
  python3 -c "
import urllib.request, json, sys
url = '$FIREBASE_URL/$STATUS_PATH.json'
try:
    data = json.loads(urllib.request.urlopen(url).read())
    if data:
        json.dump(data, sys.stdout)
    else:
        json.dump({'project':'$PROJECT_NAME','currentTask':None,'completedTasks':[],'nextSteps':[],'state':'idle'}, sys.stdout)
except:
    json.dump({'project':'$PROJECT_NAME','currentTask':None,'completedTasks':[],'nextSteps':[],'state':'idle'}, sys.stdout)
" 2>/dev/null
}

# Write status to Firebase
write_status() {
  local data="$1"
  python3 -c "
import urllib.request, json, sys
url = '$FIREBASE_URL/$STATUS_PATH.json'
req = urllib.request.Request(url, data=sys.argv[1].encode(),
    headers={'Content-Type': 'application/json'}, method='PUT')
urllib.request.urlopen(req)
" "$data" 2>/dev/null
}

# Send status report to Telegram via Bridge
send_report() {
  local msg="$1"
  python3 -c "
import json, sys, urllib.request
data = json.dumps({
    'sessionId': '$SESSION',
    'action': 'status',
    'message': sys.argv[1],
    'metadata': {'state': 'working', 'project': '$PROJECT_NAME'}
}).encode()
req = urllib.request.Request('$API_BASE/api/bridge/agent', data=data,
    headers={'Content-Type': 'application/json'})
try: urllib.request.urlopen(req)
except: pass
" "$msg" 2>/dev/null
}

case "${1:-}" in
  set-task)
    shift
    TASK="$*"
    STATUS=$(read_status)
    echo "$STATUS" | python3 -c "
import json, sys, datetime
s = json.load(sys.stdin)
s['currentTask'] = sys.argv[1]
s['state'] = 'working'
s['updatedAt'] = datetime.datetime.utcnow().isoformat() + 'Z'
print(json.dumps(s))
" "$TASK" | xargs -0 -I{} python3 -c "
import urllib.request
url = '$FIREBASE_URL/$STATUS_PATH.json'
req = urllib.request.Request(url, data=b'{}', headers={'Content-Type':'application/json'}, method='PUT')
urllib.request.urlopen(req)
" 2>/dev/null
    # Simpler approach:
    NEW=$(echo "$STATUS" | python3 -c "
import json,sys,datetime
s=json.load(sys.stdin)
s['currentTask']=sys.argv[1]
s['state']='working'
s['updatedAt']=datetime.datetime.utcnow().isoformat()+'Z'
print(json.dumps(s))" "$TASK")
    write_status "$NEW"
    echo "Task set: $TASK"
    ;;
  complete-task)
    shift
    TASK="$*"
    STATUS=$(read_status)
    NEW=$(echo "$STATUS" | python3 -c "
import json,sys,datetime
s=json.load(sys.stdin)
done=s.get('completedTasks',[])
done.append({'task':sys.argv[1],'completedAt':datetime.datetime.utcnow().isoformat()+'Z'})
s['completedTasks']=done[-20:]
s['currentTask']=None
s['state']='idle'
s['updatedAt']=datetime.datetime.utcnow().isoformat()+'Z'
print(json.dumps(s))" "$TASK")
    write_status "$NEW"
    echo "Completed: $TASK"
    ;;
  add-next)
    shift
    STEP="$*"
    STATUS=$(read_status)
    NEW=$(echo "$STATUS" | python3 -c "
import json,sys,datetime
s=json.load(sys.stdin)
ns=s.get('nextSteps',[])
ns.append(sys.argv[1])
s['nextSteps']=ns
s['updatedAt']=datetime.datetime.utcnow().isoformat()+'Z'
print(json.dumps(s))" "$STEP")
    write_status "$NEW"
    echo "Added next step: $STEP"
    ;;
  remove-next)
    shift
    IDX="${1:-0}"
    STATUS=$(read_status)
    NEW=$(echo "$STATUS" | python3 -c "
import json,sys
s=json.load(sys.stdin)
ns=s.get('nextSteps',[])
idx=int(sys.argv[1])
if 0<=idx<len(ns):
    removed=ns.pop(idx)
    print(json.dumps(s))
else:
    print(json.dumps(s))" "$IDX")
    write_status "$NEW"
    echo "Removed next step #$IDX"
    ;;
  report)
    STATUS=$(read_status)
    MSG=$(echo "$STATUS" | python3 -c "
import json,sys
s=json.load(sys.stdin)
lines=['Project: '+s.get('project','unknown')]
ct=s.get('currentTask')
if ct:
    lines.append('Working on: '+ct)
else:
    lines.append('Status: idle')
done=s.get('completedTasks',[])
if done:
    lines.append('')
    lines.append('Recently completed:')
    for t in done[-5:]:
        lines.append('  - '+t.get('task',''))
ns=s.get('nextSteps',[])
if ns:
    lines.append('')
    lines.append('Next steps:')
    for i,n in enumerate(ns):
        lines.append('  '+str(i+1)+'. '+n)
print('\n'.join(lines))")
    send_report "$MSG"
    echo "$MSG"
    ;;
  show)
    read_status | python3 -c "
import json,sys
s=json.load(sys.stdin)
print('Project:',s.get('project','unknown'))
print('State:',s.get('state','idle'))
ct=s.get('currentTask')
print('Current task:',ct or 'none')
done=s.get('completedTasks',[])
print('Completed:',len(done),'tasks')
for t in done[-5:]:
    print('  -',t.get('task',''))
ns=s.get('nextSteps',[])
print('Next steps:',len(ns))
for i,n in enumerate(ns):
    print(' ',str(i+1)+'.',n)"
    ;;
  *)
    echo "Usage: bridge-status <command> [args]"
    echo ""
    echo "Commands:"
    echo "  set-task <desc>       Set current task"
    echo "  complete-task <desc>  Mark task as done"
    echo "  add-next <desc>      Add a next step"
    echo "  remove-next <idx>    Remove a next step by index"
    echo "  report               Send status report to Telegram"
    echo "  show                 Print current status locally"
    ;;
esac
