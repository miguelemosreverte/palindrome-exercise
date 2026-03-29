/**
 * Conversational Agent Server
 *
 * Local web server with WebSocket for real-time chat.
 * The agent (CLI or daemon) sends messages and waits for user answers.
 * The UI shows the conversation + live browser status + final report.
 *
 * Usage:
 *   import { AgentServer } from './server.js';
 *   const agent = new AgentServer({ port: 3456 });
 *   await agent.start();
 *   const answer = await agent.ask('What is your CUIT?');
 *   agent.say('Logging in...');
 *   agent.setStatus('navigating', 'https://afip.gob.ar');
 *   agent.addToReport('<h2>Tax Summary</h2><p>...</p>');
 */

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class AgentServer {
  constructor(options = {}) {
    this.port = options.port || 3456;
    this.messages = []; // { role: 'agent'|'user', text, timestamp }
    this.report = '';
    this.status = { state: 'idle', detail: '' };
    this.pendingQuestion = null; // { resolve, text }
    this.clients = new Set(); // SSE clients
    this.server = null;
  }

  async start() {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.port);
    console.log(`\n  Agent UI: http://localhost:${this.port}\n`);
    return this;
  }

  stop() {
    this.clients.forEach(c => c.end());
    this.server?.close();
  }

  /** Agent says something (no answer expected) */
  say(text, type = 'info') {
    const msg = { role: 'agent', text, type, timestamp: Date.now() };
    this.messages.push(msg);
    this.broadcast({ event: 'message', data: msg });
  }

  /** Agent asks a question and waits for user's answer */
  ask(text) {
    const msg = { role: 'agent', text, type: 'question', timestamp: Date.now() };
    this.messages.push(msg);
    this.broadcast({ event: 'message', data: msg });
    return new Promise(resolve => {
      this.pendingQuestion = { resolve, text };
    });
  }

  /** Update live status */
  setStatus(state, detail = '') {
    this.status = { state, detail };
    this.broadcast({ event: 'status', data: this.status });
  }

  /** Append HTML to the report section */
  addToReport(html) {
    this.report += html;
    this.broadcast({ event: 'report', data: this.report });
  }

  /** Replace entire report */
  setReport(html) {
    this.report = html;
    this.broadcast({ event: 'report', data: this.report });
  }

  broadcast(payload) {
    const data = `event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`;
    this.clients.forEach(client => client.write(data));
  }

  handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${this.port}`);

    if (url.pathname === '/events') {
      // SSE stream
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      this.clients.add(res);
      // Send current state
      res.write(`event: init\ndata: ${JSON.stringify({ messages: this.messages, report: this.report, status: this.status })}\n\n`);
      req.on('close', () => this.clients.delete(res));
      return;
    }

    if (url.pathname === '/answer' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const { text } = JSON.parse(body);
        const msg = { role: 'user', text, timestamp: Date.now() };
        this.messages.push(msg);
        this.broadcast({ event: 'message', data: msg });
        if (this.pendingQuestion) {
          this.pendingQuestion.resolve(text);
          this.pendingQuestion = null;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }

    if (url.pathname === '/api/messages') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: this.messages, report: this.report, status: this.status }));
      return;
    }

    // Serve UI
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(UI_HTML);
  }
}

// ─── CLI mode: ask/answer via stdin ──────────────────────────────────

export class AgentCLI {
  constructor() {
    this.messages = [];
    this.report = '';
    this.rl = null;
  }

  async start() {
    const { createInterface } = await import('readline');
    this.rl = createInterface({ input: process.stdin, output: process.stdout });
    return this;
  }

  stop() { this.rl?.close(); }

  say(text) {
    console.log(`\x1b[36m  ● ${text}\x1b[0m`);
    this.messages.push({ role: 'agent', text, timestamp: Date.now() });
  }

  ask(text) {
    return new Promise(resolve => {
      this.rl.question(`\x1b[33m  ? ${text}\x1b[0m\n  > `, answer => {
        this.messages.push({ role: 'agent', text, timestamp: Date.now() });
        this.messages.push({ role: 'user', text: answer, timestamp: Date.now() });
        resolve(answer);
      });
    });
  }

  setStatus(state, detail) {
    console.log(`\x1b[2m  [${state}] ${detail}\x1b[0m`);
  }

  addToReport(html) { this.report += html; }
  setReport(html) { this.report = html; }
}

// ─── UI HTML ─────────────────────────────────────────────────────────

const UI_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agent</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #f4f4f5; height: 100vh; display: flex; flex-direction: column; }

  header { background: #18181b; color: #fff; padding: 0.8rem 1.2rem; display: flex; align-items: center; gap: 0.8rem; }
  header h1 { font-size: 1rem; font-weight: 600; }
  .status { font-size: 0.75rem; color: #a1a1aa; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
  .status-dot.idle { background: #a1a1aa; }
  .status-dot.navigating { background: #fbbf24; animation: pulse 1s infinite; }
  .status-dot.waiting { background: #60a5fa; animation: pulse 1s infinite; }
  .status-dot.done { background: #34d399; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

  .main { flex: 1; display: flex; overflow: hidden; }

  /* Chat */
  .chat { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .messages { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .msg { max-width: 80%; padding: 0.6rem 0.9rem; border-radius: 12px; font-size: 0.88rem; line-height: 1.4; }
  .msg.agent { background: #fff; border: 1px solid #e4e4e7; align-self: flex-start; border-bottom-left-radius: 4px; }
  .msg.agent.question { border-left: 3px solid #3b82f6; }
  .msg.user { background: #18181b; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
  .msg .time { font-size: 0.65rem; color: #a1a1aa; margin-top: 0.2rem; }

  .input-bar { padding: 0.8rem; background: #fff; border-top: 1px solid #e4e4e7; display: flex; gap: 0.5rem; }
  .input-bar input { flex: 1; padding: 0.6rem 0.8rem; border: 1px solid #d4d4d8; border-radius: 8px; font-size: 0.88rem; outline: none; }
  .input-bar input:focus { border-color: #3b82f6; }
  .input-bar button { padding: 0.6rem 1.2rem; background: #18181b; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 500; }
  .input-bar button:hover { background: #27272a; }
  .input-bar input[type="password"] { font-family: monospace; letter-spacing: 2px; }

  /* Report panel */
  .report-panel { width: 45%; border-left: 1px solid #e4e4e7; overflow-y: auto; background: #fff; padding: 1.2rem; }
  .report-panel:empty::before { content: 'Report will appear here...'; color: #a1a1aa; font-style: italic; }
  .report-panel h2 { font-size: 1.1rem; margin: 1rem 0 0.5rem; color: #18181b; border-bottom: 1px solid #e4e4e7; padding-bottom: 0.3rem; }
  .report-panel h3 { font-size: 0.95rem; margin: 0.8rem 0 0.3rem; }
  .report-panel p, .report-panel li { font-size: 0.85rem; margin-bottom: 0.3rem; color: #3f3f46; }
  .report-panel table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin: 0.5rem 0; }
  .report-panel th { background: #f4f4f5; text-align: left; padding: 0.4rem; font-weight: 500; }
  .report-panel td { padding: 0.4rem; border-bottom: 1px solid #e4e4e7; }
  .report-panel .stat { display: inline-block; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 0.3rem 0.7rem; border-radius: 6px; margin: 0.2rem; font-size: 0.8rem; }
  .report-panel .stat b { color: #166534; }

  @media (max-width: 768px) {
    .main { flex-direction: column; }
    .report-panel { width: 100%; border-left: none; border-top: 1px solid #e4e4e7; max-height: 40vh; }
  }
</style>
</head>
<body>
  <header>
    <h1>🤖 Agent</h1>
    <div class="status"><span class="status-dot idle" id="dot"></span><span id="status-text">Idle</span></div>
  </header>
  <div class="main">
    <div class="chat">
      <div class="messages" id="messages"></div>
      <div class="input-bar">
        <input id="input" placeholder="Type your answer..." autocomplete="off">
        <button id="send">Send</button>
      </div>
    </div>
    <div class="report-panel" id="report"></div>
  </div>
<script>
const msgEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const reportEl = document.getElementById('report');
const dotEl = document.getElementById('dot');
const statusEl = document.getElementById('status-text');
let isPassword = false;

function addMsg(msg) {
  const div = document.createElement('div');
  div.className = 'msg ' + msg.role + (msg.type === 'question' ? ' question' : '');
  div.innerHTML = msg.text + '<div class="time">' + new Date(msg.timestamp).toLocaleTimeString() + '</div>';
  msgEl.appendChild(div);
  msgEl.scrollTop = msgEl.scrollHeight;
  // If question asks for password/clave, switch input to password mode
  if (msg.type === 'question' && /clave|password|contraseña|secret/i.test(msg.text)) {
    inputEl.type = 'password';
    isPassword = true;
  } else if (msg.role === 'user' && isPassword) {
    inputEl.type = 'text';
    isPassword = false;
  }
}

function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  fetch('/answer', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({text}) });
  inputEl.value = '';
  if (isPassword) { inputEl.type = 'text'; isPassword = false; }
}

sendBtn.onclick = send;
inputEl.onkeydown = e => { if (e.key === 'Enter') send(); };

// SSE
const es = new EventSource('/events');
es.addEventListener('init', e => {
  const d = JSON.parse(e.data);
  d.messages.forEach(addMsg);
  if (d.report) reportEl.innerHTML = d.report;
  dotEl.className = 'status-dot ' + d.status.state;
  statusEl.textContent = d.status.detail || d.status.state;
});
es.addEventListener('message', e => addMsg(JSON.parse(e.data)));
es.addEventListener('report', e => { reportEl.innerHTML = JSON.parse(e.data); });
es.addEventListener('status', e => {
  const s = JSON.parse(e.data);
  dotEl.className = 'status-dot ' + s.state;
  statusEl.textContent = s.detail || s.state;
});

inputEl.focus();
</script>
</body>
</html>`;
