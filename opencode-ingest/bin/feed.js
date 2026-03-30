#!/usr/bin/env node
/**
 * feed — Feed generation and serving CLI.
 *
 * Usage:
 *   node bin/feed.js generate <task>     Generate feed items for a task
 *   node bin/feed.js list [--limit=20]   Show recent feed items
 *   node bin/feed.js serve [--port=3458] Serve feed UI
 *   node bin/feed.js clear               Clear all feed items
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { existsSync, readdirSync } from 'fs';
import { generateFeed, loadFeed, saveFeed } from '../lib/feed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TASKS_DIR = join(ROOT, 'tasks');

const [cmd, ...args] = process.argv.slice(2);
const getFlag = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const positional = args.filter(a => !a.startsWith('--'));

// ─── Commands ────────────────────────────────────────────────────────

async function cmdGenerate() {
  const task = positional[0];
  if (!task) {
    // Generate for all tasks
    const tasks = readdirSync(TASKS_DIR).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
    let total = 0;
    for (const t of tasks) {
      console.log(`\nGenerating feed for: ${t}`);
      const items = await generateFeed(t);
      console.log(`  ${items.length} new feed items`);
      total += items.length;
    }
    console.log(`\nTotal: ${total} new items`);
  } else {
    console.log(`Generating feed for: ${task}`);
    const items = await generateFeed(task);
    console.log(`${items.length} new feed items generated.\n`);
    for (const item of items.slice(0, 10)) {
      console.log(`  [${item.type}] ${item.title}`);
      if (item.body) console.log(`    ${item.body}`);
    }
    if (items.length > 10) console.log(`  ... and ${items.length - 10} more`);
  }
}

function cmdList() {
  const limit = parseInt(getFlag('limit') || '20');
  const feed = loadFeed();
  const items = feed.items.filter(i => !i.dismissed).slice(0, limit);
  if (!items.length) {
    console.log('No feed items. Run: node bin/feed.js generate <task>');
    return;
  }
  const ICONS = { NEW: '+', PRICE_DROP: '$', CANDIDATE_MATCH: '*', TRENDING: '^', INSIGHT: 'i', ALERT: '!' };
  console.log(`\nFeed (${items.length} of ${feed.items.length} total):\n`);
  for (const item of items) {
    const icon = ICONS[item.type] || '?';
    const age = timeSince(item.timestamp);
    const read = item.read ? ' ' : '*';
    console.log(`${read} [${icon}] ${item.type.padEnd(16)} ${item.title}`);
    if (item.body) console.log(`           ${item.body}`);
    console.log(`           ${age} · ${item.source}`);
    console.log();
  }
}

function cmdClear() {
  saveFeed({ items: [] });
  console.log('Feed cleared.');
}

function timeSince(ts) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── Feed UI server ──────────────────────────────────────────────────

function cmdServe() {
  const PORT = parseInt(getFlag('port') || '3458');

  const server = createServer((req, res) => {
    if (req.url === '/api/feed') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(loadFeed()));
      return;
    }

    if (req.method === 'POST' && req.url?.startsWith('/api/feed/')) {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const parts = req.url.split('/');
        const id = parts[3];
        const action = parts[4]; // read, dismiss
        const feed = loadFeed();
        const item = feed.items.find(i => i.id === id);
        if (!item) { res.writeHead(404); res.end('Not found'); return; }
        if (action === 'read') item.read = true;
        if (action === 'dismiss') item.dismissed = true;
        saveFeed(feed);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // Serve HTML UI
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(feedHTML());
  });

  server.listen(PORT, () => {
    console.log(`Feed UI: http://localhost:${PORT}`);
    console.log(`Feed API: http://localhost:${PORT}/api/feed`);
  });
}

function feedHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Feed — OpenCode Ingest</title>
<style>
  :root {
    --bg: #faf9f6; --card: #fff; --border: #e0ddd5; --text: #1a1a1a;
    --muted: #6b6860; --accent: #0f4c75; --danger: #c0392b; --success: #27ae60;
    --serif: 'Georgia', 'Times New Roman', serif;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--sans); background: var(--bg); color: var(--text); line-height: 1.5; }

  header {
    max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem 1rem;
    border-bottom: 2px solid var(--text);
  }
  header h1 { font-family: var(--serif); font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; }
  header .subtitle { color: var(--muted); font-size: 0.9rem; margin-top: 0.25rem; }

  .filters {
    max-width: 900px; margin: 0 auto; padding: 1rem 1.5rem;
    display: flex; gap: 0.5rem; flex-wrap: wrap; border-bottom: 1px solid var(--border);
  }
  .filters button {
    padding: 0.35rem 0.75rem; border: 1px solid var(--border); border-radius: 3px;
    background: var(--card); font-size: 0.8rem; cursor: pointer; color: var(--text);
    transition: all 0.15s;
  }
  .filters button.active { background: var(--text); color: var(--bg); border-color: var(--text); }
  .filters button:hover { border-color: var(--text); }

  .feed { max-width: 900px; margin: 0 auto; padding: 1rem 1.5rem; }
  .empty { text-align: center; padding: 3rem; color: var(--muted); }

  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 4px;
    padding: 1.25rem; margin-bottom: 0.75rem; position: relative;
    transition: box-shadow 0.15s;
  }
  .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .card.unread { border-left: 3px solid var(--accent); }
  .card.dismissed { opacity: 0.4; }

  .card-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
  .card-icon {
    width: 36px; height: 36px; border-radius: 4px; display: flex;
    align-items: center; justify-content: center; font-size: 1.1rem;
    flex-shrink: 0; font-weight: 700;
  }
  .type-NEW .card-icon { background: #e8f5e9; color: #2e7d32; }
  .type-PRICE_DROP .card-icon { background: #fce4ec; color: #c62828; }
  .type-CANDIDATE_MATCH .card-icon { background: #e3f2fd; color: #1565c0; }
  .type-TRENDING .card-icon { background: #fff3e0; color: #e65100; }
  .type-INSIGHT .card-icon { background: #f3e5f5; color: #6a1b9a; }
  .type-ALERT .card-icon { background: #fff8e1; color: #f57f17; }

  .card-meta { flex: 1; min-width: 0; }
  .card-type { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .card-title { font-family: var(--serif); font-size: 1.05rem; font-weight: 600; margin-top: 0.1rem; }
  .card-body { color: var(--muted); font-size: 0.88rem; margin: 0.4rem 0; }
  .card-time { font-size: 0.75rem; color: var(--muted); }

  .card-thumb {
    width: 56px; height: 56px; border-radius: 4px; object-fit: cover;
    flex-shrink: 0; background: var(--border);
  }

  .card-actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  .card-actions button, .card-actions a {
    padding: 0.3rem 0.7rem; font-size: 0.78rem; border: 1px solid var(--border);
    border-radius: 3px; background: var(--card); color: var(--text);
    text-decoration: none; cursor: pointer; transition: all 0.15s;
  }
  .card-actions button:hover, .card-actions a:hover { border-color: var(--text); }
  .card-actions .primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .card-actions .primary:hover { opacity: 0.9; }

  .source-tag {
    display: inline-block; font-size: 0.7rem; padding: 0.1rem 0.4rem;
    background: #f0ede6; border-radius: 2px; color: var(--muted); margin-left: 0.5rem;
  }

  /* Responsive: phone list view */
  @media (max-width: 600px) {
    header { padding: 1.25rem 1rem 0.75rem; }
    header h1 { font-size: 1.5rem; }
    .feed { padding: 0.75rem; }
    .card { padding: 1rem; }
    .card-thumb { width: 44px; height: 44px; }
    .card-title { font-size: 0.95rem; }
  }

  /* Desktop: wider cards */
  @media (min-width: 1200px) {
    header, .filters, .feed { max-width: 1000px; }
    .feed { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    .feed .card { margin-bottom: 0; }
    .feed .empty { grid-column: 1 / -1; }
  }
</style>
</head>
<body>

<header>
  <h1>Your Feed</h1>
  <div class="subtitle" id="subtitle">Loading...</div>
</header>

<div class="filters" id="filters">
  <button class="active" data-type="all">All</button>
  <button data-type="NEW">New</button>
  <button data-type="PRICE_DROP">Price Drops</button>
  <button data-type="CANDIDATE_MATCH">Candidates</button>
  <button data-type="TRENDING">Trending</button>
  <button data-type="INSIGHT">Insights</button>
</div>

<div class="feed" id="feed">
  <div class="empty">Loading feed...</div>
</div>

<script>
const ICONS = { NEW: '+', PRICE_DROP: '$', CANDIDATE_MATCH: '★', TRENDING: '↑', INSIGHT: 'i', ALERT: '!' };
let allItems = [];
let activeFilter = 'all';

async function fetchFeed() {
  const res = await fetch('/api/feed');
  const data = await res.json();
  allItems = data.items || [];
  render();
}

function timeSince(ts) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function render() {
  const items = allItems.filter(i => !i.dismissed && (activeFilter === 'all' || i.type === activeFilter));
  const unread = allItems.filter(i => !i.read && !i.dismissed).length;
  document.getElementById('subtitle').textContent = items.length + ' items' + (unread ? ' · ' + unread + ' unread' : '');

  const feed = document.getElementById('feed');
  if (!items.length) { feed.innerHTML = '<div class="empty">No items to show. Run <code>node bin/feed.js generate &lt;task&gt;</code></div>'; return; }

  feed.innerHTML = items.map(item => {
    const cls = ['card', 'type-' + item.type, item.read ? '' : 'unread', item.dismissed ? 'dismissed' : ''].filter(Boolean).join(' ');
    const thumb = item.thumbnail ? '<img class="card-thumb" src="' + item.thumbnail + '" onerror="this.style.display=\\'none\\'" />' : '';
    return '<div class="' + cls + '" data-id="' + item.id + '">' +
      '<div class="card-header">' +
        '<div class="card-icon">' + (ICONS[item.type] || '?') + '</div>' +
        '<div class="card-meta">' +
          '<div class="card-type">' + item.type.replace('_', ' ') + '<span class="source-tag">' + item.source + '</span></div>' +
          '<div class="card-title">' + esc(item.title) + '</div>' +
        '</div>' +
        thumb +
      '</div>' +
      (item.body ? '<div class="card-body">' + esc(item.body) + '</div>' : '') +
      '<div class="card-time">' + timeSince(item.timestamp) + '</div>' +
      '<div class="card-actions">' +
        (item.url ? '<a class="primary" href="' + item.url + '" target="_blank">View</a>' : '') +
        '<button onclick="markRead(\\'' + item.id + '\\')">Mark Read</button>' +
        '<button onclick="dismiss(\\'' + item.id + '\\')">Dismiss</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function markRead(id) {
  await fetch('/api/feed/' + id + '/read', { method: 'POST' });
  const item = allItems.find(i => i.id === id);
  if (item) item.read = true;
  render();
}

async function dismiss(id) {
  await fetch('/api/feed/' + id + '/dismiss', { method: 'POST' });
  const item = allItems.find(i => i.id === id);
  if (item) item.dismissed = true;
  render();
}

document.getElementById('filters').addEventListener('click', e => {
  if (e.target.tagName !== 'BUTTON') return;
  document.querySelectorAll('.filters button').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  activeFilter = e.target.dataset.type;
  render();
});

fetchFeed();
setInterval(fetchFeed, 15000);
</script>
</body>
</html>`;
}

// ─── Dispatch ────────────────────────────────────────────────────────

switch (cmd) {
  case 'generate': await cmdGenerate(); break;
  case 'list': cmdList(); break;
  case 'serve': cmdServe(); break;
  case 'clear': cmdClear(); break;
  default:
    console.log(`Usage:
  node bin/feed.js generate [task]     Generate feed items (all tasks if no task specified)
  node bin/feed.js list [--limit=20]   Show recent feed items
  node bin/feed.js serve [--port=3458] Serve feed UI
  node bin/feed.js clear               Clear all feed items`);
}
