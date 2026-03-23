#!/usr/bin/env bash
# Tool execution log inspector
# Usage:
#   ./scripts/logs.sh                  # last 10 entries
#   ./scripts/logs.sh 20               # last 20 entries
#   ./scripts/logs.sh errors           # only failures
#   ./scripts/logs.sh errors 20        # last 20 failures
#   ./scripts/logs.sh chart            # only chart attempts
#   ./scripts/logs.sh python           # only python attempts
#   ./scripts/logs.sh search           # only search attempts
#   ./scripts/logs.sh clear            # delete all logs

RTDB="https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app"
PATH_LOGS="mercadopago-bridge/tool-logs"

if [ "$1" = "clear" ]; then
  echo "Clearing all tool logs..."
  curl -s -X DELETE "${RTDB}/${PATH_LOGS}.json"
  echo "Done."
  exit 0
fi

FILTER="$1"
LIMIT="${2:-10}"

# If first arg is a number, treat as limit
if [[ "$1" =~ ^[0-9]+$ ]]; then
  FILTER=""
  LIMIT="$1"
fi

node -e "
fetch('${RTDB}/${PATH_LOGS}.json')
  .then(r => r.json())
  .then(data => {
    if (!data || typeof data !== 'object') { console.log('No logs found.'); return; }
    let entries = Object.entries(data).map(([k,v]) => ({id:k,...v}));
    entries.sort((a,b) => (b.ts||0) - (a.ts||0));

    const filter = '${FILTER}';
    const limit = ${LIMIT};

    if (filter === 'errors') entries = entries.filter(e => !e.ok);
    else if (filter === 'chart' || filter === 'python' || filter === 'search' || filter === 'web_search')
      entries = entries.filter(e => e.tool === (filter === 'search' ? 'web_search' : filter));

    entries = entries.slice(0, limit);

    if (!entries.length) { console.log('No matching logs.'); return; }

    console.log('');
    for (const e of entries) {
      const time = new Date(e.ts).toLocaleString();
      const status = e.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      const tool = e.tool.padEnd(12);
      const model = (e.model || '').split('/').pop() || '?';

      console.log(\`\${status} \${time}  \x1b[1m\${tool}\x1b[0m  [\${model}]\`);

      if (e.error) console.log(\`  \x1b[31merror:\x1b[0m \${e.error}\`);
      if (e.result && e.ok) console.log(\`  \x1b[32mresult:\x1b[0m \${String(e.result).slice(0, 120)}\`);

      const input = String(e.input || '');
      if (input.length > 0) {
        const preview = input.slice(0, 200).replace(/\\n/g, '\\\\n');
        console.log(\`  input: \${preview}\${input.length > 200 ? '...' : ''}\`);
      }
      console.log('');
    }

    const total = Object.keys(data).length;
    const fails = Object.values(data).filter(e => !e.ok).length;
    console.log(\`\x1b[2m--- \${total} total logs, \${fails} failures ---\x1b[0m\`);
  })
  .catch(e => console.error('Error:', e.message));
"
