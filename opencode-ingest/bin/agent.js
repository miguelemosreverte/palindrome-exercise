#!/usr/bin/env node

/**
 * Conversational Browser Agent
 *
 * Proxies through OpenCode's API (localhost:9001) which has chrome-devtools-mcp.
 * Shows a chat UI where:
 *   - You see the agent's messages + actions
 *   - You answer questions (credentials, choices)
 *   - The report builds in real-time on the right panel
 *
 * Usage:
 *   node bin/agent.js [--port=3456] [--opencode=9001]
 *
 * Requires: opencode serve --port=9001 running from the project dir
 */

import { createServer } from 'http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '3456');
const OC_PORT = parseInt(process.argv.find(a => a.startsWith('--opencode='))?.split('=')[1] || '9001');
const OC_BASE = `http://127.0.0.1:${OC_PORT}`;

// ─── OpenCode API helpers ─────────────────────────────────────────────

async function ocPost(path, body) {
  const res = await fetch(`${OC_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function ocGet(path) {
  const res = await fetch(`${OC_BASE}${path}`);
  return res.json();
}

async function createSession() {
  const data = await ocPost('/session', {});
  return data.id;
}

async function sendMessage(sessionId, text) {
  await ocPost(`/session/${sessionId}/message`, {
    parts: [{ type: 'text', text }],
  });
}

async function pollResponse(sessionId, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const msgs = await ocGet(`/session/${sessionId}/message`);
      const list = Array.isArray(msgs) ? msgs : [];
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m.info?.role !== 'assistant') continue;
        const parts = m.parts || [];
        if (parts.some(p => p.type === 'step-finish')) {
          const texts = parts.filter(p => p.type === 'text').map(p => p.text);
          return texts.join('\n');
        }
      }
    } catch {}
  }
  return '(timeout — no response)';
}

// ─── State ────────────────────────────────────────────────────────────

let sessionId = null;
const messages = [];
const clients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(c => c.write(payload));
}

function addMsg(role, text, type = 'info') {
  const msg = { role, text, type, timestamp: Date.now() };
  messages.push(msg);
  broadcast('message', msg);
  return msg;
}

// ─── Server ───────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(res);
    res.write(`event: init\ndata: ${JSON.stringify({ messages, sessionId })}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/send' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const { text } = JSON.parse(body);
      addMsg('user', text);

      // Create session if needed
      if (!sessionId) {
        try {
          sessionId = await createSession();
          // Prime the agent with a system instruction
          await sendMessage(sessionId,
            'You are a browser agent with chrome-devtools MCP tools. ' +
            'Be PROACTIVE: when the user mentions a site (like AFIP, Gmail, YouTube), navigate there immediately — don\'t ask for the URL. ' +
            'Research online if you don\'t know a site. Take screenshots at every step to verify. ' +
            'Only ask the user when you genuinely need input: credentials, choices, confirmations. ' +
            'Now the user says: ' + text
          );
          addMsg('agent', '🔗 Connected', 'status');
        } catch (err) {
          addMsg('agent', `❌ Cannot connect to OpenCode at ${OC_BASE}. Is \`opencode serve --port=${OC_PORT}\` running?`, 'error');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":false}');
          return;
        }

        // Wait for primed response
        broadcast('status', { state: 'thinking', detail: 'Agent is navigating...' });
        try {
          const response = await pollResponse(sessionId);
          addMsg('agent', response);
          broadcast('status', { state: 'idle', detail: '' });
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }

      // Send to OpenCode
      broadcast('status', { state: 'thinking', detail: 'Agent is working...' });
      try {
        await sendMessage(sessionId, text);
        const response = await pollResponse(sessionId);
        addMsg('agent', response);
        broadcast('status', { state: 'idle', detail: '' });
      } catch (err) {
        addMsg('agent', `❌ Error: ${err.message}`, 'error');
        broadcast('status', { state: 'idle', detail: '' });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }

  // Serve UI
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(HTML);
});

server.listen(PORT, () => {
  console.log(`\n  Agent UI: http://localhost:${PORT}`);
  console.log(`  OpenCode: ${OC_BASE}\n`);
  import('child_process').then(cp => cp.exec(`open http://localhost:${PORT}`));
});

// ─── HTML ─────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Browser Agent</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #09090b; color: #fafafa; height: 100vh; display: flex; flex-direction: column; }

  header { background: #18181b; padding: 0.7rem 1.2rem; display: flex; align-items: center; gap: 0.8rem; border-bottom: 1px solid #27272a; }
  header h1 { font-size: 0.95rem; font-weight: 600; }
  .status { font-size: 0.75rem; color: #71717a; margin-left: auto; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #71717a; margin-right: 4px; }
  .dot.thinking { background: #fbbf24; animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }

  .chat { flex: 1; overflow-y: auto; padding: 1rem 1.2rem; display: flex; flex-direction: column; gap: 0.6rem; }

  .msg { max-width: 85%; padding: 0.7rem 1rem; border-radius: 14px; font-size: 0.88rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .msg.user { background: #3b82f6; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
  .msg.agent { background: #27272a; color: #e4e4e7; align-self: flex-start; border-bottom-left-radius: 4px; }
  .msg.agent.status { background: transparent; color: #71717a; font-size: 0.78rem; padding: 0.3rem 0; }
  .msg.agent.error { border-left: 3px solid #ef4444; }
  .msg code { background: #3f3f46; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.82rem; }
  .msg strong { color: #fbbf24; }
  .msg table { border-collapse: collapse; margin: 0.5rem 0; width: 100%; font-size: 0.8rem; }
  .msg th { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #3f3f46; color: #a1a1aa; font-weight: 500; }
  .msg td { padding: 0.3rem 0.5rem; border-bottom: 1px solid #27272a; }

  .input-bar { padding: 0.7rem 1rem; background: #18181b; border-top: 1px solid #27272a; display: flex; gap: 0.5rem; }
  .input-bar input { flex: 1; padding: 0.65rem 0.9rem; background: #27272a; border: 1px solid #3f3f46; border-radius: 10px; color: #fafafa; font-size: 0.88rem; outline: none; }
  .input-bar input:focus { border-color: #3b82f6; }
  .input-bar input::placeholder { color: #52525b; }
  .input-bar button { padding: 0.65rem 1.4rem; background: #3b82f6; color: #fff; border: none; border-radius: 10px; cursor: pointer; font-size: 0.85rem; font-weight: 500; }
  .input-bar button:hover { background: #2563eb; }
  .input-bar button:disabled { background: #27272a; color: #52525b; cursor: default; }

  .hint { text-align: center; color: #52525b; font-size: 0.78rem; padding: 0.5rem; }

  @media (max-width: 640px) {
    .msg { max-width: 95%; }
  }
</style>
</head>
<body>
  <header>
    <h1>🌐 Browser Agent</h1>
    <div class="status"><span class="dot" id="dot"></span><span id="status">Ready</span></div>
  </header>
  <div class="chat" id="chat">
    <div class="hint">Tell the agent what site to visit and what you need. It will browse using your Chrome and ask you questions along the way.</div>
  </div>
  <div class="input-bar">
    <input id="input" placeholder="e.g. Go to afip.gob.ar and help me log in..." autocomplete="off">
    <button id="send">Send</button>
  </div>
<script>
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const send = document.getElementById('send');
const dot = document.getElementById('dot');
const status = document.getElementById('status');
let busy = false;

function addMsg(msg) {
  const div = document.createElement('div');
  div.className = 'msg ' + msg.role + (msg.type ? ' ' + msg.type : '');
  // Simple markdown: **bold**, \`code\`, tables
  let html = msg.text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>\$1</strong>')
    .replace(/\`([^\`]+)\`/g, '<code>\$1</code>');
  // Detect tables
  if (html.includes('|') && html.includes('---')) {
    const lines = html.split('\\n');
    let inTable = false;
    let tableHtml = '';
    const out = [];
    for (const line of lines) {
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        if (line.includes('---')) continue;
        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
        if (!inTable) { tableHtml = '<table><tr>' + cells.map(c => '<th>'+c+'</th>').join('') + '</tr>'; inTable = true; }
        else { tableHtml += '<tr>' + cells.map(c => '<td>'+c+'</td>').join('') + '</tr>'; }
      } else {
        if (inTable) { tableHtml += '</table>'; out.push(tableHtml); inTable = false; }
        out.push(line);
      }
    }
    if (inTable) out.push(tableHtml + '</table>');
    html = out.join('\\n');
  }
  div.innerHTML = html;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  // Auto password mode
  if (msg.role === 'agent' && /clave|password|contraseña/i.test(msg.text)) input.type = 'password';
  else if (msg.role === 'user') input.type = 'text';
}

async function doSend() {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  busy = true;
  send.disabled = true;
  dot.className = 'dot thinking';
  status.textContent = 'Thinking...';

  try {
    const res = await fetch('/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text}) });
  } catch(e) {}
  busy = false;
  send.disabled = false;
  dot.className = 'dot';
  status.textContent = 'Ready';
}

send.onclick = doSend;
input.onkeydown = e => { if (e.key === 'Enter') doSend(); };

// SSE
const es = new EventSource('/events');
es.addEventListener('init', e => { JSON.parse(e.data).messages.forEach(addMsg); });
es.addEventListener('message', e => addMsg(JSON.parse(e.data)));
es.addEventListener('status', e => {
  const s = JSON.parse(e.data);
  dot.className = 'dot' + (s.state === 'thinking' ? ' thinking' : '');
  status.textContent = s.detail || s.state || 'Ready';
});

input.focus();
</script>
</body>
</html>`;
